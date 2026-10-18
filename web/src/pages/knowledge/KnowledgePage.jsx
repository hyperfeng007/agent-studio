import { useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import { Alert, App, Button, Empty, Form, Input, Modal, Select, Space, Spin, Table, Tag } from 'antd'
import { PlusOutlined, UploadOutlined, SearchOutlined } from '@ant-design/icons'
import api from '../../api'
const STATUS={queued:'等待处理',parsing:'解析中',indexing:'向量索引中',ready:'可检索',failed:'失败'}
export default function KnowledgePage() {
  const {message,modal}=App.useApp()
  const providers=useSelector(s=>s.providers.list)
  const [bases,setBases]=useState([]),[active,setActive]=useState(null),[docs,setDocs]=useState([])
  const [error,setError]=useState(''),[loading,setLoading]=useState(true),[uploading,setUploading]=useState(false)
  const [create,setCreate]=useState(false),[draft,setDraft]=useState({name:'',mode:'keyword'}),[saving,setSaving]=useState(false)
  const [query,setQuery]=useState(''),[hits,setHits]=useState(null),[searching,setSearching]=useState(false)
  const [preview,setPreview]=useState(null)
  const upload=useRef(null)
  const base=bases.find(b=>b.id===active)
  const load=async()=>{setLoading(true);try{const list=await api.knowledge.list();setBases(list);setActive(id=>list.some(b=>b.id===id)?id:list[0]?.id||null);setError('')}catch(e){setError(e.message)}finally{setLoading(false)}}
  useEffect(()=>{load()},[])
  useEffect(()=>{
    let live=true
    setDocs([]);setHits(null);setQuery('')
    const refresh=async()=>{if(!active)return;try{const d=await api.knowledge.documents(active);if(live)setDocs(d)}catch(e){if(live)setError(e.message)}}
    refresh();const timer=setInterval(refresh,2000)
    return()=>{live=false;clearInterval(timer)}
  },[active])
  const perform=async fn=>{try{await fn();if(active)setDocs(await api.knowledge.documents(active))}catch(e){message.error(e.message)}}
  const files=async event=>{
    const selected=[...event.target.files];event.target.value='';setUploading(true)
    try{
      for(const file of selected){
        if(file.size>20*1024*1024)throw Error(`${file.name} 超过 20 MB`)
        const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(file)})
        await api.knowledge.upload(active,{name:file.name,data})
      }
      message.success('已加入解析队列');setDocs(await api.knowledge.documents(active))
    }catch(e){message.error(e.message)}finally{setUploading(false)}
  }
  const save=async()=>{
    if(!draft.name?.trim())return message.warning('请输入名称')
    setSaving(true)
    try{const b=await api.knowledge.create(draft);setCreate(false);await load();setActive(b.id)}catch(e){message.error(e.message)}finally{setSaving(false)}
  }
  return <div className="page capability-page">
    <aside className="capability-sidebar"><div className="capability-title">知识库<Button type="text" aria-label="新建知识库" icon={<PlusOutlined />} onClick={()=>{setDraft({name:'',mode:'keyword'});setCreate(true)}} /></div><p className="assistant-muted">让助手依据你的资料回答</p>
      {loading?<Spin />:bases.map(b=><button className={`capability-nav ${b.id===active?'active':''}`} key={b.id} onClick={()=>setActive(b.id)}>{b.name}<small>{b.mode==='vector'?'向量 + 关键词':'本地关键词'}</small></button>)}
    </aside>
    <main className="capability-main">{error&&<Alert type="error" message={error} action={<Button onClick={load}>重试</Button>} />}
    {!base?<Empty description="创建知识库，再导入资料并绑定到智能助手"><Button type="primary" onClick={()=>setCreate(true)}>新建知识库</Button></Empty>:<>
      <header className="capability-header"><div><h2>{base.name}</h2><p className="assistant-muted">{base.mode==='vector'?`Embedding：${base.modelId} · 检索片段会发送给所选模型`:'关键词检索 · 解析与索引在本机完成，无需 Embedding API'} · 单文件 ≤20 MB</p></div><Button danger onClick={()=>modal.confirm({title:'删除整个知识库？',content:'资料文件和检索索引将删除，历史聊天引用快照保留。',okText:'删除',cancelText:'取消',onOk:async()=>{await api.knowledge.remove(active);await load()}})}>删除知识库</Button></header>
      <Alert showIcon type="info" message="使用方法：导入资料 → 等待“可检索” → 在智能助手编辑窗口的“知识库与工具”中绑定。" description="支持 UTF-8 TXT/Markdown、文本 PDF（最多150页）、DOCX。扫描件需先做 OCR；DOCX 引用按片段定位，不虚构页码。" />
      <div className="capability-actions"><Button type="primary" icon={<UploadOutlined />} loading={uploading} onClick={()=>upload.current?.click()}>导入资料</Button><span className="assistant-muted">删除后立即停止参与检索；同名再次导入会创建独立资料，替换时请先删除旧版。</span><input type="file" hidden multiple accept=".txt,.md,.pdf,.docx" ref={upload} onChange={files} /></div>
      <Table rowKey="id" dataSource={docs} pagination={{pageSize:8}} locale={{emptyText:'尚无资料'}} columns={[
        {title:'资料',dataIndex:'name',ellipsis:true},
        {title:'状态',render:(_,d)=><><Tag color={d.status==='ready'?'green':d.status==='failed'?'red':'blue'}>{STATUS[d.status]}</Tag>{d.error&&<div className="capability-error">{d.error}</div>}</>},
        {title:'片段',dataIndex:'chunkCount',width:70},
        {title:'操作',width:200,render:(_,d)=><Space><Button size="small" disabled={d.status!=='ready'} onClick={()=>perform(async()=>setPreview({name:d.name,chunks:await api.knowledge.chunks(d.id)}))}>查看</Button><Button size="small" disabled={['queued','parsing','indexing'].includes(d.status)} onClick={()=>perform(()=>api.knowledge.retry(d.id))}>重试</Button><Button size="small" danger onClick={()=>modal.confirm({title:`删除 ${d.name}？`,okText:'删除',cancelText:'取消',onOk:()=>perform(()=>api.knowledge.removeDocument(d.id))})}>删除</Button></Space>}
      ]} />
      <section className="capability-card"><h3>检索测试</h3><p className="assistant-muted">先验证能否找到正确片段。此测试只检索，不调用聊天模型。</p><Input.Search aria-label="检索知识库" value={query} onChange={e=>setQuery(e.target.value)} placeholder="输入问题或关键词" enterButton="检索" loading={searching} onSearch={async()=>{setSearching(true);try{setHits(await api.knowledge.search(active,query))}catch(e){message.error(e.message)}finally{setSearching(false)}}} />
      {hits&&(!hits.length?<Empty description="没有找到片段，试试资料中的关键词，或确认索引已完成" />:hits.map(h=><div className="reference-card" key={h.documentId+'-'+h.chunk}><strong>[{h.label}] {h.name}</strong><small>{h.page?`第 ${h.page} 页 · `:''}片段 {h.chunk} · 得分 {h.score.toFixed(3)}</small><p>{h.text}</p></div>))}</section>
    </>}</main>
    <Modal open={create} title="新建知识库" onCancel={()=>!saving&&setCreate(false)} confirmLoading={saving} okText="创建" cancelText="取消" onOk={()=>draft.mode==='vector'?modal.confirm({title:'确认发送资料给 Embedding 服务商？',content:'导入的文本片段和检索问题会发送给选择的 Embedding API；敏感资料建议使用本机兼容接口。',okText:'同意并创建',cancelText:'取消',onOk:save}):save()}>
      <Form layout="vertical"><Form.Item label="名称" required><Input aria-label="知识库名称" maxLength={80} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} /></Form.Item><Form.Item label="检索模式"><Select value={draft.mode} onChange={mode=>setDraft({...draft,mode})} options={[{value:'keyword',label:'本地关键词（免配置）'},{value:'vector',label:'向量 + 关键词（需 Embedding 模型）'}]} /></Form.Item>
      {draft.mode==='vector'&&<><Form.Item label="Embedding 服务商"><Select value={draft.providerId} onChange={providerId=>setDraft({...draft,providerId})} options={providers.filter(p=>p.enabled&&['openai','ollama'].includes(p.type)).map(p=>({value:p.id,label:p.name}))} /></Form.Item><Form.Item label="Embedding 模型 ID" extra="不是聊天模型。使用 OpenAI 兼容 /v1/embeddings 接口。模式与模型创建后固定，切换请新建知识库并重新导入。"><Input value={draft.modelId} placeholder="如 text-embedding-3-small 或本机 embedding 模型" onChange={e=>setDraft({...draft,modelId:e.target.value})} /></Form.Item></>}
      </Form>
    </Modal>
    <Modal open={!!preview} title={preview?.name} footer={null} onCancel={()=>setPreview(null)} width={760}><div style={{maxHeight:'60vh',overflow:'auto'}}>{preview?.chunks.map(c=><div className="reference-card" key={c.index}><strong>{c.page?`第 ${c.page} 页 · `:''}片段 {c.index}</strong><pre>{c.text}</pre></div>)}</div></Modal>
  </div>
}
