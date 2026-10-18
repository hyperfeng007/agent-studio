import fs from 'node:fs'
import path from 'node:path'
import { randomUUID,randomBytes,createCipheriv,createDecipheriv } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { DATA_DIR,table,findRow,insertRow,upsertRow,deleteRow } from '../store.js'
import { executableEnvironment } from '../codecli/manager.js'
import { llmFetch } from '../llm/net.js'
const clients=new Map(), connecting=new Set(), approvals=new Map(), pendingClients=new Map(), generations=new Map()
const fail=(message,status=400)=>Object.assign(new Error(message),{status})
function vaultKey() {
  const file=path.join(DATA_DIR,'mcp-vault.key')
  fs.mkdirSync(DATA_DIR,{recursive:true})
  if(!fs.existsSync(file)) fs.writeFileSync(file,randomBytes(32),{mode:0o600,flag:'wx'})
  return fs.readFileSync(file)
}
function encrypt(value) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',vaultKey(),iv)
  const text=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()])
  return [iv,cipher.getAuthTag(),text].map(b=>b.toString('base64')).join('.')
}
function decrypt(value) {
  if(!value)return {}
  const [iv,tag,text]=value.split('.').map(v=>Buffer.from(v,'base64'))
  const cipher=createDecipheriv('aes-256-gcm',vaultKey(),iv);cipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([cipher.update(text),cipher.final()]).toString('utf8'))
}
export function serverList() {
  return table('mcpServers').map(({secrets,...s})=>({...s,hasSecrets:!!secrets,connected:clients.has(s.id),connecting:connecting.has(s.id),tools:clients.get(s.id)?.tools || []}))
}
export async function saveServer(body,id) {
  if(typeof body.name!=='string'||!body.name.trim())throw fail('请填写服务器名称')
  const transport=body.transport==='http'?'http':'stdio'
  if(transport==='stdio' && (typeof body.command!=='string'||!body.command.trim()))throw fail('stdio 需要启动命令')
  if(body.args && (!Array.isArray(body.args)||body.args.some(x=>typeof x!=='string')))throw fail('参数必须是字符串数组，不是 shell 命令行')
  if(transport==='http') {
    let u;try{u=new URL(body.url)}catch{throw fail('请输入完整 MCP URL')}
    if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw fail('仅支持 HTTP/HTTPS，凭据请填写在请求头中')
    if(u.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw fail('远程 MCP 必须使用 HTTPS，本机调试可用 HTTP')
  }
  const old=id?findRow('mcpServers',id):null
  if(id&&!old)throw fail('服务器不存在',404)
  if(id)await disconnect(id)
  const sameTarget=old && old.transport===transport && old.command===(body.command||'') && old.url===(body.url||'') && JSON.stringify(old.args)===JSON.stringify(body.args||[])
  let secrets=sameTarget?old.secrets:undefined
  if(body.secrets!==undefined) {
    if(!body.secrets || typeof body.secrets!=='object'||Array.isArray(body.secrets)||Object.values(body.secrets).some(v=>typeof v!=='string'))throw fail('环境变量/请求头必须是键值均为字符串的 JSON 对象')
    secrets=encrypt(body.secrets)
  }
  const s={id:id||randomUUID(),name:body.name.trim().slice(0,80),transport,command:body.command||'',args:body.args||[],url:body.url||'',secrets,createdAt:old?.createdAt||Date.now()}
  upsertRow('mcpServers',s)
  // Changing a server invalidates all previous per-assistant grants.
  if(old) for(const a of table('assistants')) if(a.mcpGrants?.some(g=>g.serverId===id))upsertRow('assistants',{...a,mcpGrants:a.mcpGrants.filter(g=>g.serverId!==id)})
  return serverList().find(x=>x.id===s.id)
}
export async function disconnect(id) {
  generations.set(id,(generations.get(id)||0)+1)
  const pending=pendingClients.get(id)
  if(pending) await pending.close().catch(()=>{})
  const c=clients.get(id);clients.delete(id)
  if(c) await c.client.close().catch(()=>{})
}
export async function deleteServer(id) {
  await disconnect(id);deleteRow('mcpServers',id)
  for(const a of table('assistants'))if(a.mcpGrants?.some(g=>g.serverId===id))upsertRow('assistants',{...a,mcpGrants:a.mcpGrants.filter(g=>g.serverId!==id)})
}
export async function connect(id) {
  const s=findRow('mcpServers',id)
  if(!s)throw fail('服务器不存在',404)
  if(connecting.has(id))throw fail('正在连接，请稍候',409)
  if(clients.has(id))return serverList().find(s=>s.id===id)
  connecting.add(id)
  const client=new Client({name:'agent-studio',version:'1.3.4'},{capabilities:{}})
  const generation=generations.get(id)||0
  pendingClients.set(id,client)
  let transport
  try {
    let secrets
    try { secrets=decrypt(s.secrets) } catch { throw fail('凭据无法解密：请重新填写；恢复完整备份需同时恢复 data/mcp-vault.key') }
    if(s.transport==='stdio') {
      const inherited=await executableEnvironment(),env={}
      for(const key of Object.keys(inherited))if(['path','home','userprofile','appdata','localappdata','systemroot','windir','temp','tmp','comspec','pathext'].includes(key.toLowerCase()))env[key]=inherited[key]
      // The SDK already uses cross-spawn. Pass raw input, not a second cmd wrapper.
      const portable=(await import('../codecli/portable.js')).portableToolEnv('mcp-'+String(s.id||'server').replace(/[^\w.-]/g,'_'))
      transport=new StdioClientTransport({command:s.command,args:s.args,env:{...env,...portable,...secrets},stderr:'pipe',maxBufferSize:2*1024*1024})
    } else transport=new StreamableHTTPClientTransport(new URL(s.url),{requestInit:{headers:secrets},fetch:llmFetch})
    transport.stderr?.resume() // Drain diagnostics without persisting possible secrets.
    // Closing on timeout also terminates a just-started stdio server.
    const timer=setTimeout(()=>void client.close().catch(()=>{}),20000)
    let tools=[]
    try {
      await client.connect(transport,{timeout:20000})
      let cursor
      do {
        const result=await client.listTools(cursor?{cursor}:undefined,{timeout:10000})
        tools.push(...result.tools);cursor=result.nextCursor
        if(tools.length>100)throw fail('服务器工具超过 100 个，请使用较小的工具集')
      } while(cursor)
    } finally {clearTimeout(timer)}
    if ((generations.get(id)||0)!==generation || !findRow('mcpServers',id)) throw fail('连接已取消或配置已变更')
    clients.set(id,{client,tools,server:s})
    client.onclose=()=>{if(clients.get(id)?.client===client)clients.delete(id)}
    return serverList().find(s=>s.id===id)
  } catch(e) {await client.close().catch(()=>{});throw fail(`MCP 连接失败：${e.message}`)}
  finally {connecting.delete(id);pendingClients.delete(id)}
}
export function boundTools(assistant) {
  const result=[]
  for(const grant of assistant?.mcpGrants || []) {
    if(!grant.tools?.length)continue
    const session=clients.get(grant.serverId)
    if(!session)throw fail('助手绑定的 MCP 尚未连接，请在本机 MCP 页面手动连接后重试')
    for(const name of grant.tools) {
      const t=session.tools.find(t=>t.name===name)
      if(!t)throw fail(`已授权工具 ${name} 不再存在，请重新配置授权`)
      result.push({name:`mcp_${result.length+1}`,description:`${session.server.name} / ${t.name}: ${t.description||''}`.slice(0,1500),parameters:t.inputSchema||{type:'object',properties:{}},serverId:grant.serverId,toolName:t.name,serverName:session.server.name})
      if(result.length>24)throw fail('单个助手最多启用 24 个 MCP 工具')
    }
  }
  return result
}
export function awaitApproval(event,emit,signal) {
  return new Promise(resolve=>{
    const id=randomUUID()
    const cleanup=value=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);approvals.delete(id);resolve(value)}
    const abort=()=>cleanup(false)
    const timer=setTimeout(()=>cleanup(false),90000)
    approvals.set(id,cleanup)
    signal?.addEventListener('abort',abort,{once:true})
    if(signal?.aborted)return cleanup(false)
    emit({...event,type:'tool_approval',approvalId:id,expiresAt:Date.now()+90000})
  })
}
export function approve(id,allowed) {const fn=approvals.get(id);if(!fn)throw fail('此请求已超时、取消或处理',410);fn(allowed===true)}
export async function executeBoundTool(tool,args,assistantId,signal) {
  const assistant=findRow('assistants',assistantId)
  if(!assistant?.mcpGrants?.some(g=>g.serverId===tool.serverId && g.tools?.includes(tool.toolName)))throw fail('工具授权已撤销')
  const session=clients.get(tool.serverId)
  if(!session)throw fail('MCP 已断开连接')
  const response=await session.client.callTool({name:tool.toolName,arguments:args},undefined,{timeout:30000,signal})
  // Keep tool results bounded; binary/resource content is not automatically opened or fetched.
  return {isError:!!response.isError,text:(response.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n').slice(0,16000) || '工具未返回文本；本版本不自动加载资源或二进制结果。'}
}
export async function shutdownMcp() {for(const id of new Set([...clients.keys(),...pendingClients.keys()]))await disconnect(id)}
