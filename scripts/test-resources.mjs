import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'as-resources-'))
process.env.DATA_DIR=dir
const store=await import('../server/store.js')
const kb=await import('../server/knowledge/service.js')
const mcp=await import('../server/mcp/service.js')
const {runAssistantChat}=await import('../server/llm/assistantRun.js')
const {isLocalMcpRequest}=await import('../server/mcp/security.js')
const wait=ms=>new Promise(r=>setTimeout(r,ms))
const countFile=path.join(dir,'count')
let count=0
async function check(name,fn){await fn();count++;console.log('✅ '+name)}
const embedding=http.createServer(async(req,res)=>{
 let s='';for await(const c of req)s+=c
 const body=JSON.parse(s)
 res.setHeader('Content-Type','application/json')
 res.end(JSON.stringify({data:body.input.map((text,index)=>({index,embedding:text.includes('报销')?[1,0,0]:[0,1,0]}))}))
})
embedding.listen(0,'127.0.0.1');await once(embedding,'listening')
let child
try {
 const base=kb.createBase({name:'工作资料',mode:'keyword'})
 let doc=kb.importDocument(base.id,{name:'policy.txt',data:Buffer.from('差旅报销制度：员工应在出差结束后十五天内提交发票。审批人为部门经理。').toString('base64')})
 const ready=async id=>{for(let i=0;i<100;i++){const d=store.findRow('knowledgeDocuments',id);if(d?.status==='ready'||d?.status==='failed')return d;await wait(50)}throw Error('job timeout')}
 doc=await ready(doc.id)
 await check('TXT 真实导入、异步解析、分段并持久化',()=>{assert.equal(doc.status,'ready');assert.ok(doc.chunks[0].text.includes('十五天'))})
 for (const ext of ['docx','pdf']) {
  const raw=fs.readFileSync(path.resolve(`scripts/fixtures/knowledge.${ext}`)).toString('base64')
  const imported=kb.importDocument(base.id,{name:`sample.${ext}`,data:raw})
  const parsed=await ready(imported.id)
  await check(`${ext.toUpperCase()} 真实文件解析`,()=>{assert.equal(parsed.status,'ready',parsed.error);assert.ok(parsed.chunks.length);if(ext==='pdf')assert.equal(parsed.chunks[0].page,1)})
  kb.removeDocument(imported.id)
 }
 await check('中文关键词检索返回可定位来源',async()=>{const r=await kb.searchKnowledge([base.id],'差旅报销');assert.equal(r[0].documentId,doc.id);assert.equal(r[0].label,'来源1');assert.equal(r[0].chunk,1)})
 await check('无关问题不伪造来源',async()=>assert.equal((await kb.searchKnowledge([base.id],'galactic oxygen')).length,0))
 await check('未选知识库不越权混检',async()=>assert.equal((await kb.searchKnowledge([],'报销')).length,0))
 await check('拒绝非支持文件类型及空名称',()=>{assert.throws(()=>kb.importDocument(base.id,{name:'evil.exe',data:'YWJj'}));assert.throws(()=>kb.createBase({name:' '}))})
 let invalid=kb.importDocument(base.id,{name:'scan.txt',data:Buffer.from('  ').toString('base64')});invalid=await ready(invalid.id)
 await check('空文本明确失败，而非显示索引完成',()=>{assert.equal(invalid.status,'failed');assert.match(invalid.error,/文本/)})
 await check('失败资料可以重试',async()=>{kb.retryDocument(invalid.id);const result=await ready(invalid.id);assert.equal(result.status,'failed')})
 await check('检索增强真正注入模型请求，并发送引用事件',async()=>{
  const events=[];let inbound
  await runAssistantChat({messages:[{role:'user',content:'报销'}],emit:e=>events.push(e)}, {knowledgeBaseIds:[base.id]}, {streamer:async ctx=>{inbound=ctx.messages}})
  assert.equal(events[0].type,'references');assert.ok(inbound[0].content.includes('十五天'));assert.ok(inbound[0].content.includes('不可信'))
 })
 store.insertRow('providers',{id:'embedding-test',name:'local',type:'openai',enabled:true,apiHost:`http://127.0.0.1:${embedding.address().port}`,models:[]})
 const vb=kb.createBase({name:'向量资料',mode:'vector',providerId:'embedding-test',modelId:'fixture'})
 let vd=kb.importDocument(vb.id,{name:'vector.md',data:Buffer.from('报销申请需要发票。').toString('base64')});vd=await ready(vd.id)
 await check('真实 HTTP Embedding 请求与向量检索闭环',async()=>{assert.equal(vd.status,'ready',vd.error);assert.deepEqual(vd.chunks[0].vector,[1,0,0]);const r=await kb.searchKnowledge([vb.id],'报销');assert.equal(r[0].mode,'vector')})
 await check('Embedding 地址变更必须重新索引，不混用旧向量',async()=>{
  const old={...store.findRow('providers','embedding-test')}
  store.upsertRow('providers',{...old,apiHost:old.apiHost+'/changed'})
  await assert.rejects(()=>kb.searchKnowledge([vb.id],'报销'),/重新索引/)
  store.upsertRow('providers',old)
 })
 await check('删除资料后立即从检索移除并删除原文件',async()=>{kb.removeDocument(doc.id);assert.equal((await kb.searchKnowledge([base.id],'报销')).length,0);assert.ok(!fs.existsSync(path.join(dir,'knowledge',doc.id+'.bin')))})
 await check('删除知识库清理其全部资料',()=>{kb.removeBase(base.id);assert.ok(!store.table('knowledgeDocuments').some(d=>d.baseId===base.id))})
 const local={socket:{remoteAddress:'127.0.0.1'},headers:{host:'localhost:3000',origin:'http://localhost:3000'}}
 await check('MCP 禁止远程、跨站与 DNS rebinding 请求',()=>{
  assert.ok(isLocalMcpRequest(local))
  assert.equal(isLocalMcpRequest({...local,socket:{remoteAddress:'10.0.0.2'}}),false)
  assert.equal(isLocalMcpRequest({...local,headers:{host:'localhost:3000',origin:'https://evil.test'}}),false)
  assert.equal(isLocalMcpRequest({...local,headers:{host:'evil.test'}}),false)
 })
 const config=await mcp.saveServer({name:'受控工具',transport:'stdio',command:process.execPath,args:[path.resolve('scripts/fixtures/mcp-server.mjs')],secrets:{COUNT_FILE:countFile}})
 await check('保存 MCP 不执行，凭据不在配置响应中明文返回',()=>{assert.equal(config.connected,false);assert.equal(config.secrets,undefined);assert.ok(!fs.existsSync(countFile));assert.ok(!store.findRow('mcpServers',config.id).secrets.includes(countFile))})
 const connected=await mcp.connect(config.id)
 await check('真实 MCP stdio 握手与工具发现',()=>{assert.equal(connected.tools[0].name,'echo_note');assert.ok(connected.connected)})
 store.insertRow('assistants',{id:'agent',mcpGrants:[{serverId:config.id,tools:['echo_note']}]})
 const assistant=store.findRow('assistants','agent')
 await check('工具按助手授权，仅暴露已勾选工具',()=>{assert.equal(mcp.boundTools(assistant).length,1);assert.equal(mcp.boundTools({mcpGrants:[]}).length,0)})
 let step=0
 const streamer=async ctx=>{
  if(step++===0){ctx.emit({type:'tool_call',index:0,id:'call_1',name:'mcp_1'});ctx.emit({type:'tool_call_args',index:0,text:'{"text":"hello"}'})}
  else {assert.equal(ctx.messages.at(-1).role,'tool');ctx.emit({type:'delta',text:ctx.messages.at(-1).content})}
 }
 const events=[]
 await runAssistantChat({messages:[{role:'user',content:'test'}],emit:e=>events.push(e),signal:new AbortController().signal},assistant,{streamer,approve:async()=>false})
 await check('拒绝工具调用时真实 MCP 工具从未执行',()=>{assert.ok(!fs.existsSync(countFile));assert.equal(events.find(e=>e.type==='tool_status').status,'denied')})
 step=0;events.length=0
 await runAssistantChat({messages:[{role:'user',content:'test'}],emit:e=>events.push(e),signal:new AbortController().signal},assistant,{streamer,approve:async()=>true})
 await check('允许后实际执行 → 返回结果 → 模型继续回答',()=>{assert.equal(fs.readFileSync(countFile,'utf8'),'call\n');assert.ok(events.some(e=>e.type==='delta'&&e.text==='fixture: hello'))})
 await check('审批一次性生效，重复确认被拒绝',async()=>{let id;const promise=mcp.awaitApproval({callId:'once'},e=>id=e.approvalId,new AbortController().signal);mcp.approve(id,true);assert.equal(await promise,true);assert.throws(()=>mcp.approve(id,true))})
 await check('停止生成会取消待审批，不执行工具',async()=>{const c=new AbortController();const promise=mcp.awaitApproval({},()=>{},c.signal);c.abort();assert.equal(await promise,false)})
 await check('未授权工具名被阻止',async()=>{await assert.rejects(()=>runAssistantChat({messages:[],emit:()=>{}},assistant,{streamer:async ctx=>ctx.emit({type:'tool_call',index:0,id:'bad',name:'not_allowed'})}),/未授权/)})
 await check('单次最多四次工具调用，防止无限循环',async()=>{
  let executions=0
  await assert.rejects(()=>runAssistantChat({messages:[],emit:()=>{}},assistant,{streamer:async ctx=>ctx.emit({type:'tool_call',index:0,id:'repeat',name:'mcp_1'}),approve:async()=>true,execute:async()=>{executions++;return {text:'ok'}}}),/上限/)
  assert.ok(executions<=4)
 })
 await check('编辑服务器会撤销原授权并断开',async()=>{await mcp.saveServer({name:'changed',transport:'stdio',command:process.execPath,args:[]},config.id);assert.equal(mcp.serverList()[0].connected,false);assert.deepEqual(store.findRow('assistants','agent').mcpGrants,[])})
 child=spawn(process.execPath,['scripts/fixtures/mcp-server.mjs'],{env:{...process.env,HTTP_FIXTURE:'1'},stdio:['ignore','pipe','pipe']})
 const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('http fixture timeout')),10000);child.stdout.on('data',b=>{const m=String(b).match(/PORT=(\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]))}});child.on('error',reject)})
 const hc=await mcp.saveServer({name:'HTTP fixture',transport:'http',url:`http://127.0.0.1:${port}/mcp`})
 await check('真实 MCP Streamable HTTP 握手与发现',async()=>{const result=await mcp.connect(hc.id);assert.equal(result.tools[0].name,'echo_note')})
 await check('拒绝远程明文 HTTP 与含凭据 URL',async()=>{await assert.rejects(()=>mcp.saveServer({name:'bad',transport:'http',url:'http://example.com/mcp'}));await assert.rejects(()=>mcp.saveServer({name:'bad',transport:'http',url:'https://user:pass@example.com/mcp'}))})
 console.log(`知识库/MCP ${count}/${count} 通过`)
}finally{
 await mcp.shutdownMcp();child?.kill();embedding.closeAllConnections();await new Promise(r=>embedding.close(r));store.saveNow();fs.rmSync(dir,{recursive:true,force:true})
}
