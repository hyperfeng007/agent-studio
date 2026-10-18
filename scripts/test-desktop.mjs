import assert from 'node:assert/strict'
import express from 'express'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import gui from './gui-preload.cjs'
import { createDesktopRouter } from '../server/routes/desktop.js'
let stopped=0, checks=0
const root=path.resolve('.'),app=express()
app.use(express.json())
app.use('/api/desktop',createDesktopRouter({root,instanceId:'owned-instance',pid:1234,shutdown:()=>stopped++}))
const server=http.createServer(app)
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const base=`http://127.0.0.1:${server.address().port}/api/desktop`
const check=(label,fn)=>{fn();checks++;console.log('✅ '+label)}
const post=body=>fetch(base+'/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
try {
 const identity=await (await fetch(base+'/identity')).json()
 check('本机身份包含确切项目目录、实例及 PID',()=>assert.deepEqual(identity,{root,instanceId:'owned-instance',pid:1234}))
 const cross=await fetch(base+'/identity',{headers:{Origin:'https://evil.example'}})
 check('跨站不能读取或协调桌面实例',()=>assert.equal(cross.status,403))
 const host=await new Promise((resolve,reject)=>{const req=http.get(base+'/identity',{headers:{Host:'remote.example'}},res=>{res.resume();resolve({status:res.statusCode})});req.on('error',reject)})
 check('非 localhost 主机名被拒绝',()=>assert.equal(host.status,403))
 const badRoot=await post({root:root+'-other',instanceId:'owned-instance'})
 check('不同目录不得停止服务',()=>assert.equal(badRoot.status,409))
 const stale=await post({root,instanceId:'old-instance'})
 check('过期实例不得停止服务',()=>{assert.equal(stale.status,409);assert.equal(stopped,0)})
 const good=await post({root,instanceId:'owned-instance'})
 check('确认当前实例后接受正常关闭',()=>assert.equal(good.status,202))
 await post({root,instanceId:'owned-instance'})
 await new Promise(r=>setTimeout(r,200))
 check('重复关闭只执行一次清理',()=>assert.equal(stopped,1))
 const exe=fs.readFileSync('Agent Studio.exe'),pe=exe.readUInt32LE(0x3c)
 check('启动器是 x64 Windows GUI EXE，不是控制台 EXE',()=>{assert.equal(exe.toString('ascii',pe,pe+4),'PE\0\0');assert.equal(exe.readUInt16LE(pe+4),0x8664);assert.equal(exe.readUInt16LE(pe+24+68),2)})
 const source=fs.readFileSync('launcher/NativeJob.cs','utf8')
 check('包含挂起创建、Job归属与退出清理保护',()=>{assert.ok(source.includes('0x08000404'));assert.ok(source.includes('AssignProcessToJobObject'));assert.ok(source.includes('0x2000'));assert.ok(source.includes('IsProcessInJob'))})
 check('GUI 子进程隐藏窗口且保留参数和回调',()=>{
  const callback=()=>{}, options={cwd:'C:/example',env:{A:'B'},windowsHide:false}
  const args=gui.hiddenArgs('execFile',['node',['file.js'],options,callback])
  assert.equal(args[2].windowsHide,true);assert.equal(args[2].cwd,options.cwd);assert.equal(args[3],callback);assert.equal(options.windowsHide,false)
  assert.deepEqual(gui.hiddenArgs('spawn',['node']),['node',{windowsHide:true}])
  assert.deepEqual(gui.hiddenArgs('exec',['echo hi',callback]),['echo hi',{windowsHide:true},callback])
 })
 console.log(`桌面启动协调 ${checks}/${checks}；不替代原生 Windows 生命周期测试`)
} finally { server.closeAllConnections();await new Promise(r=>server.close(r)) }
