/** Live HTTP/SSE integration. Only creates and removes its own temporary resources. */
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const BASE=process.env.BASE||'http://localhost:3000'
const ids={},tmp=fs.mkdtempSync(path.join(os.tmpdir(),'as-live-tools-')),countFile=path.join(tmp,'executions')
let checks=0,lastBody
const check=(name,fn)=>{fn();checks++;console.log('✅ '+name)}
const request=async(route,method='GET',data)=>{
 const response=await fetch(BASE+route,{method,headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined})
 const body=await response.json();if(!response.ok)throw Error(body.error);return body
}
const upstream=http.createServer(async(req,res)=>{
 let body='';for await(const c of req)body+=c
 lastBody=JSON.parse(body)
 const finished=lastBody.messages.some(m=>m.role==='tool')
 const tool=lastBody.tools?.[0]?.function?.name
 res.writeHead(200,{'Content-Type':'text/event-stream'})
 const event=delta=>res.write(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:null}]})}\n\n`)
 if(tool&&!finished){event({tool_calls:[{index:0,id:'native_call',type:'function',function:{name:tool,arguments:'{"text":"approved check"}'}}]})}
 else event({content:finished?'依据工具结果完成回答。':'根据资料回答。[来源1]'})
 res.end('data: [DONE]\n\n')
})
await new Promise(r=>upstream.listen(0,'127.0.0.1',r))
async function stream(allow){
 const res=await fetch(BASE+'/api/chat/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assistantId:ids.assistant,providerId:ids.provider,modelId:'fixture',messages:[{role:'user',content:'报销十五天'}]})})
 assert.equal(res.status,200)
 let buffer='';const events=[]
 for await(const bytes of res.body){buffer+=new TextDecoder().decode(bytes);const packets=buffer.split('\n\n');buffer=packets.pop();for(const packet of packets){const data=packet.split('\n').find(l=>l.startsWith('data: '));if(!data)continue;const event=JSON.parse(data.slice(6));events.push(event)
  if(event.type==='tool_approval') {
   check('SSE 确认到达前工具未执行',()=>assert.equal(fs.existsSync(countFile),false))
   await request('/api/mcp/approvals/'+event.approvalId,'POST',{allowed:allow})
  }
 }}
 return events
}
try{
 const malformed=await fetch(BASE+'/api/settings/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({db:{assistants:{}}})})
 check('畸形备份在更改数据前被拒绝',()=>assert.equal(malformed.status,400))
 const rejected=await fetch(BASE+'/api/knowledge',{headers:{Origin:'https://evil.example'}})
 check('实际 HTTP 路由拒绝跨站读取资料',()=>assert.equal(rejected.status,403))
 const p=await request('/api/providers','POST',{name:'资源端到端测试',type:'openai',apiHost:`http://127.0.0.1:${upstream.address().port}`,models:[{id:'fixture'}]});ids.provider=p.id
 await request(`/api/providers/${p.id}`,'PUT',{enabled:true})
 const kb=await request('/api/knowledge','POST',{name:'E2E资料',mode:'keyword'});ids.kb=kb.id
 await request(`/api/knowledge/${kb.id}/documents`,'POST',{name:'rule.txt',data:Buffer.from('报销必须在十五天内提交发票。').toString('base64')})
 for(let i=0;i<100;i++){const docs=await request(`/api/knowledge/${kb.id}/documents`);if(docs[0]?.status==='ready')break;await new Promise(r=>setTimeout(r,50))}
 const assistant=await request('/api/assistants','POST',{name:'资源 E2E 助手',knowledgeBaseIds:[kb.id],model:{provider:p.id,id:'fixture'}});ids.assistant=assistant.id
 let events=await stream(false)
 check('聊天 SSE 返回真实来源片段',()=>{assert.equal(events.find(e=>e.type==='references').references[0].name,'rule.txt');assert.ok(lastBody.messages[0].content.includes('十五天'))})
 check('RAG 对话正常结束',()=>assert.ok(events.some(e=>e.type==='done')))
 const server=await request('/api/mcp','POST',{name:'E2E MCP',transport:'stdio',command:process.execPath,args:[path.resolve('scripts/fixtures/mcp-server.mjs')],secrets:{COUNT_FILE:countFile}});ids.mcp=server.id
 await request(`/api/mcp/${server.id}/connect`,'POST',{confirm:true})
 await request(`/api/assistants/${assistant.id}`,'PUT',{mcpGrants:[{serverId:server.id,tools:['echo_note']}]})
 events=await stream(false)
 check('拒绝调用经 HTTP/SSE 全链路生效',()=>{assert.ok(events.some(e=>e.type==='tool_status'&&e.status==='denied'));assert.equal(fs.existsSync(countFile),false)})
 events=await stream(true)
 check('允许后工具真实执行一次并继续回复',()=>{assert.equal(fs.readFileSync(countFile,'utf8'),'call\n');assert.ok(events.some(e=>e.type==='tool_status'&&e.status==='done'));assert.ok(events.some(e=>e.type==='done'&&e.content.includes('依据工具结果')))})
 await request(`/api/knowledge/${kb.id}`,'DELETE');delete ids.kb
 await request(`/api/assistants/${assistant.id}`,'PUT',{mcpGrants:[]})
 events=await stream(false)
 check('已删除知识库不再注入旧内容',()=>assert.equal(events.find(e=>e.type==='references')?.references?.length || 0,0))
 console.log(`资源 HTTP/SSE 集成 ${checks}/${checks} 通过`)
}finally{
 for(const [key,route] of [['mcp','mcp'],['assistant','assistants'],['kb','knowledge'],['provider','providers']])if(ids[key])await request(`/api/${route}/${ids[key]}`,'DELETE').catch(()=>{})
 upstream.closeAllConnections();await new Promise(r=>upstream.close(r));fs.rmSync(tmp,{recursive:true,force:true})
}
