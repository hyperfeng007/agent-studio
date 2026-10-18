import assert from 'node:assert/strict'
import http from 'node:http'
import {streamChat} from '../server/llm/index.js'
import {EMITTERS} from '../server/gateway/emitters.js'
import {fromOpenAI,fromAnthropic,fromResponses,fromGemini} from '../server/gateway/index.js'
import {normalizeMessages} from '../server/llm/message.js'
const tools=[{name:'bash',description:'Execute shell',parameters:{type:'object',properties:{command:{type:'string'}},required:['command']}}]
const calls=[{id:'c1',type:'function',function:{name:'bash',arguments:'{"command":"echo one"}'}},{id:'c2',type:'function',function:{name:'bash',arguments:'{"command":"echo two"}'}}]
const messages=[{role:'user',content:'test'},{role:'assistant',content:null,tool_calls:calls},{role:'tool',tool_call_id:'c1',content:'one'},{role:'tool',tool_call_id:'c2',content:'two'}]
let captured
let upstream
const server=http.createServer(async(req,res)=>{
 let text='';for await(const c of req)text+=c
 captured=JSON.parse(text)
 res.writeHead(200,{'Content-Type':'text/event-stream'})
 const e=EMITTERS[upstream](res,'test')
 e.start();e.text('Running'); e.toolCall(0,'c1','bash');e.toolCall(1,'c2','bash');
 e.toolCallArgs(0,'{"command":');e.toolCallArgs(1,'{"command":');
 e.toolCallArgs(0,'"echo one"}');e.toolCallArgs(1,'"echo two"}');e.end()
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
let checks=0
try{
 for(upstream of Object.keys(EMITTERS)){
  const events=[]
  await streamChat({provider:{id:'test',type:upstream,apiHost:`http://127.0.0.1:${server.address().port}`},model:'test',messages,tools,params:{},emit:e=>events.push(e)})
  assert.ok(captured.tools?.length)
  const wire=JSON.stringify(captured)
  assert.ok(wire.includes('echo one')&&wire.includes('echo two'))
  assert.equal(events.filter(e=>e.type==='tool_call').length,2)
  for(let index=0;index<2;index++)assert.deepEqual(JSON.parse(events.filter(e=>e.type==='tool_call_args'&&e.index===index).map(e=>e.text).join('')),{command:`echo ${index?'two':'one'}`})
  checks++
  for(const [dialect, factory] of Object.entries(EMITTERS)){
   for(const stream of [false,true]){
    let result;let text=''
    const e=factory({write:x=>text+=x,end(){},json:o=>result=o},'test',{stream})
    e.start();for(const event of events){if(event.type==='tool_call')e.toolCall(event.index,event.id,event.name);if(event.type==='tool_call_args')e.toolCallArgs(event.index,event.text)}e.end()
    if(!stream){
     let parsed
     if(dialect==='openai')parsed=fromOpenAI({messages:[result.choices[0].message]})
     if(dialect==='anthropic')parsed=fromAnthropic({messages:[result]})
     if(dialect==='openai-response')parsed=fromResponses({input:result.output})
     if(dialect==='gemini')parsed=fromGemini({contents:[result.candidates[0].content]})
     assert.equal(normalizeMessages(parsed.messages).flatMap(m=>m.toolCalls||[]).length,2)
    }else{
     assert.ok(text.includes('echo one') && text.includes('echo two'))
     const frames=text.split('\n').filter(l=>l.startsWith('data: ')&&!l.includes('[DONE]')).map(l=>JSON.parse(l.slice(6)))
     if(dialect==='anthropic'){
      const closed=new Set();for(const f of frames){if(f.type==='content_block_stop')closed.add(f.index);if(f.type==='content_block_delta')assert.ok(!closed.has(f.index),'delta after block stop')}
     }
     assert.ok(frames.length)
    }
    checks++
   }
  }
 }
 // Repeated same-name Gemini calls across multiple turns must retain chronological IDs.
 const parsed=fromGemini({contents:[{role:'model',parts:[{functionCall:{name:'bash',args:{command:'one'}}}]},{role:'user',parts:[{functionResponse:{name:'bash',response:{result:'one'}}}]},{role:'model',parts:[{functionCall:{name:'bash',args:{command:'two'}}}]},{role:'user',parts:[{functionResponse:{name:'bash',response:{result:'two'}}}]}]})
 const normalized=normalizeMessages(parsed.messages)
 assert.equal(normalized[0].toolCalls[0].id,normalized[1].toolCallId)
 assert.equal(normalized[2].toolCalls[0].id,normalized[3].toolCallId)
 assert.notEqual(normalized[1].toolCallId,normalized[3].toolCallId)
 checks++
 console.log(`工具协议测试 ${checks}/${checks} 通过（本地 HTTP 上游，四协议双工具、流式/非流式互转、多轮关联）`)
}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
