import {useEffect,useState} from 'react'
import {Alert,Button,Space,Tag,App} from 'antd'
import api from '../api'
function ToolCall({event,streaming}) {
 const {message}=App.useApp()
 const [submitted,setSubmitted]=useState(false),[now,setNow]=useState(Date.now())
 useEffect(()=>{if(event.status!=='approval')return;const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[event.status])
 const valid=streaming&&event.status==='approval'&&event.approvalId&&now<event.expiresAt
 const respond=async allowed=>{setSubmitted(true);try{await api.mcp.approve(event.approvalId,allowed)}catch(e){message.error(e.message)}}
 const labels={approval:valid?'等待确认':'确认已失效',running:'执行中',done:'已完成',error:'失败',denied:'已拒绝 / 超时',expired:'已取消',interrupted:'已停止等待'}
 return <div className="tool-call-card"><strong>{event.serverName} / {event.toolName}</strong> <Tag>{labels[event.status]||event.status}</Tag>
 <details open={!!valid}><summary>调用参数与结果</summary><pre>{JSON.stringify(event.arguments,null,2)}</pre>{event.result&&<pre>{event.result}</pre>}</details>
 {valid&&<><Alert type="warning" showIcon message="将在 Node 服务端电脑执行。请检查参数，来源内容不能代替你的授权。" /><Space style={{marginTop:8}}><Button danger type="primary" disabled={submitted} onClick={()=>respond(true)}>允许本次执行</Button><Button disabled={submitted} onClick={()=>respond(false)}>拒绝</Button><small>{submitted?'等待处理…':`${Math.max(0,Math.ceil((event.expiresAt-now)/1000))} 秒后自动拒绝`}</small></Space></>}
 </div>
}
export default function ChatEvidence({msg,streaming}) {
 return <>
 {(msg.toolEvents||[]).map((e,i)=><ToolCall key={e.callId||i} event={e} streaming={streaming} />)}
 {msg.knowledgeNotice&&<div className="assistant-muted" style={{marginTop:10}}>{msg.knowledgeNotice}</div>}
 {!!msg.references?.length&&<details className="chat-references"><summary>知识库检索来源 · {msg.references.length} 个片段</summary>{msg.references.map(r=><details className="reference-card" key={r.label}><summary><strong>[{r.label}] {r.name}</strong> · {r.page?`第 ${r.page} 页 · `:''}片段 {r.chunk}</summary><small>{r.baseName} · 索引时间 {new Date(r.indexedAt).toLocaleString()}</small><pre>{r.text}</pre></details>)}</details>}
 </>
}
