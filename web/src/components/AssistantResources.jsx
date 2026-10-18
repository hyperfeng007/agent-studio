import {useEffect,useState} from 'react'
import {Alert,Button,Checkbox,Empty,Select,Spin} from 'antd'
import api from '../api'
export default function AssistantResources({draft,onChange}) {
 const [bases,setBases]=useState([]),[servers,setServers]=useState([]),[kbError,setKbError]=useState(''),[mcpError,setMcpError]=useState(''),[loading,setLoading]=useState(true)
 const load=async()=>{
  setLoading(true)
  await Promise.all([
   api.knowledge.list().then(x=>{setBases(x);setKbError('')}).catch(e=>setKbError(e.message)),
   api.mcp.list().then(x=>{setServers(x);setMcpError('')}).catch(e=>setMcpError(e.message))
  ]);setLoading(false)
 }
 useEffect(()=>{load()},[])
 const grants=draft.mcpGrants||[]
 return <div><div className="capability-header"><h3>绑定知识库</h3><Button size="small" onClick={load}>刷新资源</Button></div>
 <p className="assistant-muted">最多 6 个。每次发言先检索相关资料，再提供给聊天模型；回答下方可查看来源片段。敏感资料请使用可信模型。</p>
 {kbError&&<Alert type="error" message={kbError} />}
 <Select mode="multiple" style={{width:'100%'}} placeholder="选择知识库，不选则不检索" value={draft.knowledgeBaseIds||[]} onChange={knowledgeBaseIds=>onChange({knowledgeBaseIds})} options={bases.map(b=>({value:b.id,label:b.name}))} />
 <h3 style={{marginTop:26}}>MCP 工具授权</h3><Alert type="warning" showIcon message="只勾选这个助手需要的工具，每次执行仍需确认。" description="请先在 MCP 页面手动连接服务器。本机之外的浏览器不能执行 MCP；工具实际运行在 Node 服务端，所选模型必须支持原生工具调用。" />
 {mcpError&&<Alert type="info" message={mcpError} style={{marginTop:12}} />}
 {loading?<Spin />:servers.map(s=><section key={s.id} className="capability-card"><strong>{s.name} · {s.connected?'已连接':'未连接'}</strong>
  {!s.connected?<p className="assistant-muted">请先连接服务器。<Button size="small" type="link" onClick={()=>onChange({mcpGrants:grants.filter(g=>g.serverId!==s.id)})}>清除该服务器授权</Button></p>:<Checkbox.Group value={grants.find(g=>g.serverId===s.id)?.tools||[]} onChange={tools=>onChange({mcpGrants:[...grants.filter(g=>g.serverId!==s.id),...(tools.length?[{serverId:s.id,tools}]:[])]})} options={s.tools.map(t=>({value:t.name,label:t.name}))} />}
 </section>)}
 {!loading&&!mcpError&&!servers.length&&<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未配置 MCP 服务" />}
 {grants.length>0&&<Button danger size="small" style={{marginTop:12}} onClick={()=>onChange({mcpGrants:[]})}>撤销此助手的全部 MCP 授权</Button>}
 </div>
}
