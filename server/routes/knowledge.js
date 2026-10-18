import express from 'express'
import { table, findRow, upsertRow } from '../store.js'
import { bases, createBase, removeBase, importDocument, removeDocument, retryDocument, publicDocument, searchKnowledge } from '../knowledge/service.js'
export const knowledgeRouter=express.Router()
const wrap=fn=>(req,res)=>Promise.resolve().then(()=>fn(req,res)).catch(e=>res.status(e.status||500).json({error:e.message}))
knowledgeRouter.get('/',(req,res)=>res.json(bases()))
knowledgeRouter.post('/',wrap((req,res)=>res.json(createBase(req.body||{}))))
knowledgeRouter.put('/:id',wrap((req,res)=>{
 const base=findRow('knowledgeBases',req.params.id)
 if(!base)return res.status(404).json({error:'知识库不存在'})
 if(!req.body.name?.trim())return res.status(400).json({error:'名称不能为空'})
 const next={...base,name:req.body.name.trim().slice(0,80)};upsertRow('knowledgeBases',next);res.json(next)
}))
knowledgeRouter.delete('/:id',wrap((req,res)=>{removeBase(req.params.id);res.json({ok:true})}))
knowledgeRouter.get('/:id/documents',wrap((req,res)=>res.json(table('knowledgeDocuments').filter(d=>d.baseId===req.params.id).map(publicDocument))))
knowledgeRouter.post('/:id/documents',wrap((req,res)=>res.json(importDocument(req.params.id,req.body||{}))))
knowledgeRouter.delete('/documents/:id',wrap((req,res)=>{removeDocument(req.params.id);res.json({ok:true})}))
knowledgeRouter.post('/documents/:id/retry',wrap((req,res)=>{retryDocument(req.params.id);res.json({ok:true})}))
knowledgeRouter.get('/documents/:id/chunks',wrap((req,res)=>{
 const d=findRow('knowledgeDocuments',req.params.id);if(!d)return res.status(404).json({error:'资料不存在'})
 res.json((d.chunks||[]).map(({vector,...c})=>c))
}))
knowledgeRouter.post('/:id/search',wrap(async(req,res)=>{
 const query=String(req.body.query||'').trim().slice(0,2000)
 if(!query)return res.status(400).json({error:'请输入检索问题'})
 res.json(await searchKnowledge([req.params.id],query))
}))
