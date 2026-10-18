import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-assistants-'))
process.env.DATA_DIR = dir
const {chatDataRouter} = await import('../server/routes/chatData.js')
const {updateSettings, saveNow, table} = await import('../server/store.js')
updateSettings({defaultModel:{providerId:'mock',modelId:'mock-chat'},temperature:0.4})
const app=express();app.use(express.json());app.use('/api',chatDataRouter)
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r))
const url=`http://127.0.0.1:${server.address().port}/api`
let checks=0
async function request(route,method='GET',body){const res=await fetch(url+route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()}}
function check(label,fn){fn();checks++;console.log('✅ '+label)}
try {
 const presets=(await request('/assistant-presets')).data
 check('助手库独立可用，不依赖当前用户是否已有助手',()=>{assert.equal(presets.length,15);assert.equal(table('assistants').length,0);assert.ok(presets.every(p=>p.presetId&&p.group))})
 const invalid=await request('/assistants','POST',{name:'  '})
 check('拒绝空白名称，不创建孤立话题',()=>{assert.equal(invalid.status,400);assert.equal(table('topics').length,0)})
 const created=(await request('/assistants','POST',{...presets[1],id:'must-not-use',settings:{contextCount:6}})).data
 check('从模板创建独立助手，并继承全局默认模型',()=>{assert.notEqual(created.id,'must-not-use');assert.equal(created.prompt,presets[1].prompt);assert.equal(created.model.id,'mock-chat');assert.equal(created.settings.temperature,0.4);assert.equal(created.settings.contextCount,6)})
 const topics=(await request(`/assistants/${created.id}/topics`)).data
 check('新助手自动创建一个独立默认话题',()=>{assert.equal(topics.length,1);assert.equal(topics[0].assistantId,created.id);assert.equal(topics[0].messages.length,0)})
 const updated=(await request(`/assistants/${created.id}`,'PUT',{name:' 自定义翻译 ',description:'描述',group:'工作',pinned:true,prompt:'只输出译文',settings:{temperature:0.2},topics:[],id:'tamper'})).data
 check('编辑/分组/置顶保存，不能篡改话题关联',()=>{assert.equal(updated.name,'自定义翻译');assert.equal(updated.group,'工作');assert.equal(updated.pinned,true);assert.deepEqual(updated.topics,created.topics);assert.equal(updated.id,created.id);assert.equal(updated.settings.contextCount,6)})
 const copy=(await request(`/assistants/${created.id}/copy`,'POST',{})).data
 check('副本保留配置，但不复制历史话题与消息',()=>{assert.notEqual(copy.id,created.id);assert.equal(copy.prompt,updated.prompt);assert.equal(copy.settings.temperature,0.2);assert.notEqual(copy.topics[0],created.topics[0])})
 saveNow()
 check('修改确实写入持久化数据',()=>{const db=JSON.parse(fs.readFileSync(path.join(dir,'db.json'),'utf8'));assert.equal(db.assistants.find(a=>a.id===created.id).group,'工作')})
 const original=(await request('/assistant-presets')).data[1]
 check('编辑实例不修改模板',()=>{assert.equal(original.prompt,presets[1].prompt);assert.notEqual(original.prompt,updated.prompt)})
 await request(`/assistants/${created.id}`,'DELETE')
 check('删除只移除目标助手及其话题，保留副本',()=>{assert.equal(table('assistants').length,1);assert.equal(table('topics').length,1);assert.equal(table('assistants')[0].id,copy.id)})
 console.log(`智能助手 API ${checks}/${checks} 通过`)
} finally {saveNow();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})}
