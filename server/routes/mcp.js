import express from 'express'
import { requireLocalMcp } from '../mcp/security.js'
import { serverList,saveServer,connect,disconnect,deleteServer,approve } from '../mcp/service.js'
export const mcpRouter=express.Router()
mcpRouter.use(requireLocalMcp)
const wrap=fn=>(req,res)=>Promise.resolve().then(()=>fn(req,res)).catch(e=>res.status(e.status||500).json({error:e.message}))
mcpRouter.get('/',(req,res)=>res.json(serverList()))
mcpRouter.post('/',wrap(async(req,res)=>res.json(await saveServer(req.body||{}))))
mcpRouter.put('/:id',wrap(async(req,res)=>res.json(await saveServer(req.body||{},req.params.id))))
mcpRouter.delete('/:id',wrap(async(req,res)=>{await deleteServer(req.params.id);res.json({ok:true})}))
mcpRouter.post('/:id/connect',wrap(async(req,res)=>{
 if(req.body.confirm!==true)return res.status(400).json({error:'必须确认此操作会启动本机进程或连接远程服务'})
 res.json(await connect(req.params.id))
}))
mcpRouter.post('/:id/disconnect',wrap(async(req,res)=>{await disconnect(req.params.id);res.json({ok:true})}))
mcpRouter.post('/approvals/:id',wrap((req,res)=>{approve(req.params.id,req.body.allowed);res.json({ok:true})}))
