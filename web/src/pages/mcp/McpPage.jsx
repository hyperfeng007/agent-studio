import { useEffect,useState } from 'react'
import { Alert,App,Button,Empty,Form,Input,Modal,Select,Space,Tag } from 'antd'
import { PlusOutlined,ReloadOutlined } from '@ant-design/icons'
import api from '../../api'
export default function McpPage({ embedded = false }) {
 const {message,modal}=App.useApp()
 const [servers,setServers]=useState([]),[error,setError]=useState(''),[editing,setEditing]=useState(null),[busy,setBusy]=useState(null)
 const load=async()=>{try{setServers(await api.mcp.list());setError('')}catch(e){setError(e.message)}}
 useEffect(()=>{load()},[])
 const act=async(id,fn)=>{setBusy(id);try{await fn();await load()}catch(e){message.error(e.message)}finally{setBusy(null)}}
 const save=async()=>{
  try {
   const args=JSON.parse(editing.argsText||'[]')
   const data={...editing,args,...(editing.secretsText?.trim()?{secrets:JSON.parse(editing.secretsText)}:{})}
   setBusy('save')
   if(editing.id)await api.mcp.save(editing.id,data);else await api.mcp.create(data)
   setEditing(null);await load()
  }catch(e){message.error(e.message)}finally{setBusy(null)}
 }
 return <div className={embedded ? "mcp-settings-page" : "page capability-page"}><main className="capability-main">
  <header className="capability-header"><div><h2>MCP 工具服务</h2><p className="assistant-muted">连接 → 在助手中勾选工具 → 每次调用确认后执行</p></div><Space><Button icon={<ReloadOutlined />} onClick={load}>刷新</Button><Button type="primary" icon={<PlusOutlined />} disabled={!!error} onClick={()=>setEditing({name:'',transport:'stdio',command:'',argsText:'[]',url:'',secretsText:''})}>添加服务器</Button></Space></header>
  <Alert type="warning" showIcon message="工具运行在 Node 服务端电脑，而不是浏览器所在电脑。" description="仅支持服务端本机 localhost 管理和调用；不开放无认证的局域网工具访问。stdio 启动命令本身就能执行代码，请只连接可信服务。每个工具调用都需单次确认，不提供永久放行。" />
  {error&&<Alert style={{marginTop:16}} type="error" message={error} />}
  {!error&&!servers.length&&<Empty description="尚未配置 MCP 服务" />}
  {servers.map(s=><section className="capability-card" key={s.id}><div className="capability-header"><div><h3>{s.name} <Tag>{s.transport==='stdio'?'本机 stdio':'Streamable HTTP'}</Tag><Tag color={s.connected?'green':'default'}>{s.connected?'已连接':'未连接'}</Tag></h3><p className="assistant-muted">{s.transport==='stdio'?`${s.command} ${(s.args||[]).join(' ')}`:s.url}</p></div><Space wrap>
   <Button loading={busy===s.id} disabled={!!busy} type={s.connected?'default':'primary'} onClick={()=>s.connected?act(s.id,()=>api.mcp.disconnect(s.id)):modal.confirm({title:`连接 ${s.name}？`,content:s.transport==='stdio'?`将在服务端执行 ${s.command} ${(s.args||[]).join(' ')}。这可能启动程序或安装依赖，只允许可信命令。`:`将连接 ${s.url}，并发送已配置的鉴权头。`,okText:'确认连接',cancelText:'取消',onOk:()=>act(s.id,()=>api.mcp.connect(s.id))})}>{s.connected?'断开':'连接并发现工具'}</Button>
   <Button disabled={!!busy} onClick={()=>setEditing({...s,argsText:JSON.stringify(s.args||[],null,2),secretsText:''})}>编辑</Button><Button disabled={!!busy} danger onClick={()=>modal.confirm({title:'删除服务器？',okText:'删除',cancelText:'取消',onOk:()=>act(s.id,()=>api.mcp.remove(s.id))})}>删除</Button>
  </Space></div>
  {s.connected&&<><p className="assistant-muted">发现 {s.tools.length} 个工具。连接不等于授权，需在智能助手设置中逐项勾选。</p>{s.tools.map(t=><details className="tool-definition" key={t.name}><summary><strong>{t.name}</strong> · {t.description?.slice(0,150)}</summary><pre>{JSON.stringify(t.inputSchema,null,2)}</pre></details>)}</>}
  </section>)}
 </main>
 <Modal open={!!editing} width={670} title={editing?.id?'编辑 MCP 服务器':'添加 MCP 服务器'} onCancel={()=>!busy&&setEditing(null)} onOk={save} confirmLoading={busy==='save'} okText="保存配置（不自动连接）" cancelText="取消">
 {editing&&<Form layout="vertical">
  <Alert style={{marginBottom:16}} type="info" message="保存不会执行命令。编辑已有服务器将断开连接，并撤销助手对该服务器的旧授权，需重新勾选。" />
  <Form.Item label="名称" required><Input aria-label="MCP名称" value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})} /></Form.Item>
  <Form.Item label="连接方式"><Select value={editing.transport} options={[{value:'stdio',label:'本机 stdio'},{value:'http',label:'Streamable HTTP'}]} onChange={transport=>setEditing({...editing,transport,secretsText:''})} /></Form.Item>
  {editing.transport==='stdio'?<><Form.Item label="可执行命令" required extra="例如 node、npx，或可执行文件完整路径；参数填写在下面，不要在此拼接整条 shell 命令。"><Input aria-label="MCP命令" value={editing.command} onChange={e=>setEditing({...editing,command:e.target.value})} /></Form.Item><Form.Item label="参数（JSON 字符串数组）"><Input.TextArea aria-label="MCP参数" rows={3} value={editing.argsText} onChange={e=>setEditing({...editing,argsText:e.target.value})} placeholder={'["/path/to/server.js"]'} /></Form.Item></>:<Form.Item label="MCP URL" required extra="远程地址要求 HTTPS；本机可用 http://127.0.0.1:端口/mcp。不支持旧式 SSE 或 OAuth 交互登录。"><Input value={editing.url} onChange={e=>setEditing({...editing,url:e.target.value})} /></Form.Item>}
  <Form.Item label={editing.transport==='stdio'?'环境变量（JSON 对象）':'请求头（JSON 对象）'} extra={`${editing.hasSecrets?'已有加密凭据；相同目标留空保留，输入 {} 清除；更换目标会清除旧凭据。':'留空不设置。'} 服务端加密存储、不回显。请勿将密钥放在命令参数或 URL 中。`}><Input.TextArea autoComplete="off" rows={3} value={editing.secretsText} onChange={e=>setEditing({...editing,secretsText:e.target.value})} placeholder={editing.transport==='stdio'?'{}':'{"Authorization":"Bearer ..."}'} /></Form.Item>
 </Form>}
 </Modal>
 </div>
}
