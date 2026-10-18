import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { randomUUID, createHash } from 'node:crypto'
import { DATA_DIR, table, findRow, insertRow, upsertRow, deleteRow } from '../store.js'
import { getProvider, withRotatedKey } from '../services/providers.js'
import { llmFetch } from '../llm/net.js'
const directory = path.join(DATA_DIR,'knowledge')
const documentFile = id => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw Object.assign(new Error('无效资料 ID'),{status:400})
  return path.join(directory,id+'.bin')
}
const running = new Map()
const queued = []
let working=false
const fail = (message,status=400) => Object.assign(new Error(message),{status})
export const publicDocument = ({chunks, file, ...d}) => ({...d, chunkCount:chunks?.length || 0})
export function bases() {return table('knowledgeBases').map(b=>({...b,documentCount:table('knowledgeDocuments').filter(d=>d.baseId===b.id).length}))}
export function createBase(body) {
  if(typeof body.name!=='string'||!body.name.trim()) throw fail('请填写知识库名称')
  if(body.mode==='vector' && (!body.providerId || !body.modelId)) throw fail('请选择 Embedding 服务商并填写模型 ID')
  const b={id:randomUUID(),name:body.name.trim().slice(0,80),mode:body.mode==='vector'?'vector':'keyword',providerId:body.providerId || '',modelId:body.modelId || '',createdAt:Date.now()}
  insertRow('knowledgeBases',b);return b
}
export function removeDocument(id) {
  const d=findRow('knowledgeDocuments',id)
  if(!d) throw fail('资料不存在',404)
  running.get(id)?.abort()
  deleteRow('knowledgeDocuments',id)
  try {fs.unlinkSync(documentFile(id))} catch {}
}
export function removeBase(id) {
  for(const d of [...table('knowledgeDocuments')]) if(d.baseId===id) removeDocument(d.id)
  deleteRow('knowledgeBases',id)
  for(const a of table('assistants')) if(a.knowledgeBaseIds?.includes(id))upsertRow('assistants',{...a,knowledgeBaseIds:a.knowledgeBaseIds.filter(x=>x!==id)})
}
export function chunksOf(pages) {
  const chunks=[]
  for(const p of pages) {
    const text=p.text.replace(/\r\n/g,'\n').trim()
    for(let start=0;start<text.length;start+=700) {
      chunks.push({index:chunks.length+1,page:p.page,text:text.slice(start,start+850)})
    }
  }
  if(chunks.length>300) throw fail('分段超过 300 段，请拆分文档')
  return chunks
}
function extract(doc,signal) {
  return new Promise((resolve,reject)=>{
    const w=new Worker(new URL('./extract-worker.js',import.meta.url),{workerData:{file:documentFile(doc.id),ext:doc.ext},resourceLimits:{maxOldGenerationSizeMb:192}})
    const done=(err,value)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);w.terminate();err?reject(err):resolve(value)}
    const abort=()=>done(fail('任务已取消'))
    const timer=setTimeout(()=>done(fail('解析超过 45 秒，请拆分文件后重试')),45000)
    signal.addEventListener('abort',abort,{once:true})
    if(signal.aborted) return abort()
    w.once('message',m=>m.error?done(fail(m.error)):done(null,m.pages))
    w.once('error',e=>done(e))
    w.once('exit',code=>{if(code!==0) done(fail('文档解析进程退出（可能超过内存限制）'))})
  })
}
function embeddingFingerprint(base) {
  const p=getProvider(base.providerId)
  return createHash('sha256').update(JSON.stringify([base.providerId,base.modelId,p?.type,p?.apiHost])).digest('hex')
}
export async function embed(base,texts,signal) {
  const p=getProvider(base.providerId)
  if(!p?.enabled) throw fail('Embedding 服务商未启用或已删除')
  if(!['openai','ollama'].includes(p.type)) throw fail('当前 Embedding 支持 OpenAI 兼容接口；Ollama 请使用其 /v1 兼容地址')
  const provider=withRotatedKey(p)
  const host=String(provider.apiHost).replace(/\/+$/,'')
  const url=/\/v\d+$/.test(host)?host+'/embeddings':host+'/v1/embeddings'
  const vectors=[]
  for(let i=0;i<texts.length;i+=16) {
    const input=texts.slice(i,i+16)
    const response=await llmFetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(provider.apiKey?{Authorization:`Bearer ${provider.apiKey}`}:{ }),...(provider.customHeaders||{})},body:JSON.stringify({model:base.modelId,input}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000)})
    if(!response.ok) throw fail(`Embedding 请求失败 HTTP ${response.status}：请检查地址、模型和密钥`)
    const data=await response.json()
    const rows=[...(data.data || [])].sort((a,b)=>a.index-b.index)
    if(rows.length!==input.length || rows.some((r,n)=>r.index!==n || !Array.isArray(r.embedding) || !r.embedding.length || r.embedding.length>8192 || r.embedding.some(v=>!Number.isFinite(v)))) throw fail('Embedding 返回的向量数量、索引或格式不正确')
    vectors.push(...rows.map(r=>r.embedding))
  }
  if(vectors.some(v=>v.length!==vectors[0].length)) throw fail('Embedding 向量维度不一致')
  return vectors
}
async function processDocument(id) {
  const doc=findRow('knowledgeDocuments',id);if(!doc) return
  const controller=new AbortController();running.set(id,controller)
  const update=patch=>{const current=findRow('knowledgeDocuments',id);if(current) upsertRow('knowledgeDocuments',{...current,...patch,updatedAt:Date.now()})}
  try {
    update({status:'parsing',error:'',chunks:[]})
    const pages=await extract(doc,controller.signal)
    const chunks=chunksOf(pages)
    if(!chunks.length) throw fail('文档没有可检索的文字')
    const otherDocs=table('knowledgeDocuments').filter(d=>d.id!==id)
    if(otherDocs.reduce((n,d)=>n+(d.chunks?.length||0),0)+chunks.length>2000) throw fail('轻量索引总量上限为 2000 个片段，请清理旧资料后重试')
    const base=findRow('knowledgeBases',doc.baseId)
    if(!base || controller.signal.aborted) return
    let indexFingerprint
    if(base.mode==='vector') {
      indexFingerprint=embeddingFingerprint(base)
      update({status:'indexing'})
      const vectors=await embed(base,chunks.map(c=>c.text),controller.signal)
      if(indexFingerprint!==embeddingFingerprint(base))throw fail('索引期间 Embedding 配置变化，请重试')
      const used=otherDocs.reduce((sum,d)=>sum+(d.chunks||[]).reduce((n,c)=>n+(c.vector?.length||0),0),0)
      if(used+vectors.reduce((n,v)=>n+v.length,0)>2000000) throw fail('向量索引容量已满（200 万数值），请减少文档或使用较小维度模型')
      chunks.forEach((c,i)=>c.vector=vectors[i].map(v=>Math.round(v*1e6)/1e6))
    }
    if(!controller.signal.aborted) update({status:'ready',chunks,error:'',indexedAt:Date.now(),indexFingerprint})
  } catch(e) { update({status:'failed',error:e.message,chunks:[]}) }
  finally {running.delete(id)}
}
async function drain() {if(working)return;working=true;try{while(queued.length)await processDocument(queued.shift())}finally{working=false}}
export function retryDocument(id) {
  const doc=findRow('knowledgeDocuments',id)
  if(!doc)throw fail('资料不存在',404)
  if(running.has(id)||queued.includes(id))throw fail('该资料仍在处理中',409)
  upsertRow('knowledgeDocuments',{...doc,status:'queued',error:'',chunks:[]})
  queued.push(id);void drain()
}
export function importDocument(baseId,{name,data}) {
  if(!findRow('knowledgeBases',baseId))throw fail('知识库不存在',404)
  if(table('knowledgeDocuments').length>=100)throw fail('此轻量版本最多保存 100 份资料，请先清理不再使用的资料')
  const ext=path.extname(String(name||'')).toLowerCase()
  if(!['.txt','.md','.pdf','.docx'].includes(ext))throw fail('仅支持 TXT、Markdown、PDF、DOCX')
  if(typeof data!=='string' || !data)throw fail('缺少文件内容')
  const buffer=Buffer.from(data,'base64')
  if(buffer.length>20*1024*1024)throw fail('文件超过 20 MB',413)
  fs.mkdirSync(directory,{recursive:true})
  const doc={id:randomUUID(),baseId,name:String(name).slice(0,180),ext,size:buffer.length,status:'queued',chunks:[],createdAt:Date.now()}
  fs.writeFileSync(documentFile(doc.id),buffer)
  insertRow('knowledgeDocuments',doc);queued.push(doc.id);void drain();return publicDocument(doc)
}
export function recoverKnowledgeJobs() {
  for(const d of table('knowledgeDocuments')) if(['queued','parsing','indexing'].includes(d.status))upsertRow('knowledgeDocuments',{...d,status:'failed',error:'上次处理被服务重启或备份恢复中断，请点击重试',chunks:[]})
}
export function terms(text) {
  const s=String(text).toLowerCase()
  const tokens=s.match(/[a-z0-9_]{2,}/g)||[]
  for(const run of s.match(/[\u3400-\u9fff]+/g)||[]) {
    if(run.length===1)tokens.push(run)
    for(let i=0;i<run.length-1;i++)tokens.push(run.slice(i,i+2))
  }
  return [...new Set(tokens)]
}
export function cosine(a,b) {
  if(a.length!==b?.length) return 0
  let dot=0,aa=0,bb=0
  for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i]}
  return aa&&bb?dot/Math.sqrt(aa*bb):0
}
export async function searchKnowledge(ids,query,{limit=5,signal}={}) {
  const selected=[...new Set(ids||[])].slice(0,6).map(id=>findRow('knowledgeBases',id)).filter(Boolean)
  const tokens=terms(query)
  const hits=[]
  for(const base of selected) {
    const docs=table('knowledgeDocuments').filter(d=>d.baseId===base.id && d.status==='ready')
    if(!docs.length)continue
    if(base.mode==='vector' && docs.some(d=>d.indexFingerprint!==embeddingFingerprint(base)))throw fail('Embedding 地址或模型配置变化，请对资料重新索引后检索')
    const vector=base.mode==='vector'?(await embed(base,[query],signal))[0]:null
    for(const doc of docs)for(const c of doc.chunks||[]) {
      const lower=c.text.toLowerCase()
      const lexical=tokens.length?tokens.filter(t=>lower.includes(t)).length/tokens.length:0
      const semantic=vector?cosine(vector,c.vector):0
      if(vector && c.vector?.length!==vector.length)throw fail('检索向量维度已变化，请重新索引知识库资料')
      if(lexical===0 && semantic<0.35)continue
      hits.push({baseId:base.id,baseName:base.name,documentId:doc.id,name:doc.name,page:c.page,chunk:c.index,text:c.text,indexedAt:doc.indexedAt,score:vector?0.7*semantic+0.3*lexical:lexical,mode:base.mode})
    }
  }
  return hits.sort((a,b)=>b.score-a.score).slice(0,Math.min(8,limit)).map((h,i)=>({...h,label:`来源${i+1}`}))
}
