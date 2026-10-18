/** Controlled MCP fixture: never shells out; records execution only in a test-provided file. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import fs from 'node:fs'
import express from 'express'
const make=()=>{
 const server=new McpServer({name:'controlled-fixture',version:'1.0.0'})
 server.registerTool('echo_note',{description:'Return provided text without executing commands',inputSchema:{text:z.string()}},async({text})=>{
  if(process.env.COUNT_FILE)fs.appendFileSync(process.env.COUNT_FILE,'call\n')
  return {content:[{type:'text',text:`fixture: ${text}`}]}
 })
 return server
}
if(process.env.HTTP_FIXTURE==='1') {
 const app=express();app.use(express.json())
 app.post('/mcp',async(req,res)=>{
  const server=make(),transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined})
  await server.connect(transport)
  res.on('close',()=>{transport.close();server.close()})
  await transport.handleRequest(req,res,req.body)
 })
 app.get('/mcp',(req,res)=>res.status(405).end())
 const http=app.listen(0,'127.0.0.1',()=>console.log('PORT='+http.address().port))
} else await make().connect(new StdioServerTransport())
