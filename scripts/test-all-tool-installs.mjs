import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CODE_CLI_TOOLS } from '../server/config/codeCliTools.js'
if(process.platform==='win32') { console.log('该隔离安装夹具使用 POSIX npm shim；Windows 请运行 test:cli-process 并做实机安装验证。');process.exit(0) }
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'agent all tools '))
process.env.DATA_DIR=path.join(tmp,'data');process.env.PATH=tmp+path.delimiter+process.env.PATH
process.env.FIXTURE_TOOLS=JSON.stringify(CODE_CLI_TOOLS.map(t=>({pkg:t.npmPackage,bin:t.bin})))
fs.writeFileSync(path.join(tmp,'npm'),`#!${process.execPath}
const fs=require('fs'),path=require('path');const args=process.argv.slice(2);
if(args[0]==='view'){console.log('1.0.0');process.exit(0)}
if(args[0]!=='install')process.exit(2);
const pkg=args.at(-1).replace(/@(latest|[\\d.]+)$/,'');
if(/^opencode-(linux|darwin|windows)-/.test(pkg)){const d=path.join(process.cwd(),'node_modules',pkg,'bin');fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'opencode'),'#!'+process.execPath+'\\nconsole.log("1.0.0")\\n',{mode:0o755});console.log('fixture platform binary '+pkg);process.exit(0)}
const tool=JSON.parse(process.env.FIXTURE_TOOLS).find(t=>t.pkg===pkg);if(!tool)process.exit(3);
const dir=path.join(process.cwd(),'node_modules',pkg),binDir=path.join(process.cwd(),'node_modules','.bin');fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(binDir,{recursive:true});
fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:pkg,version:'1.0.0',bin:{[tool.bin]:'cli.js'}}));
fs.writeFileSync(path.join(binDir,tool.bin),pkg==='opencode-ai'?'#!/bin/sh\\nexec "$(dirname "$0")/../opencode-ai/bin/opencode" "$@"\\n':'#!'+process.execPath+'\\nconsole.log("1.0.0")\\n',{mode:0o755});console.log('fixture installed '+pkg);
`,{mode:0o755})
const {installTool,managedDir,toolOperationRunning}=await import('../server/codecli/manager.js')
let checks=0
try {
 for(const tool of CODE_CLI_TOOLS) {
  let result=await installTool(tool,()=>{}, {action:'install'})
  assert.equal(result.ok,true,tool.id+' install');assert.equal(result.detection.source,'managed');assert.equal(result.version,'1.0.0');checks++;console.log('✅ '+tool.name+' 安装与检测')
  const dir=managedDir(tool.id);fs.writeFileSync(path.join(dir,'credentials.fixture'),'keep');fs.writeFileSync(path.join(dir,'node_modules','old.fixture'),'old')
  result=await installTool(tool,()=>{}, {action:'update'});assert.equal(result.ok,true);assert.ok(fs.existsSync(path.join(dir,'node_modules','old.fixture')));checks++;console.log('✅ '+tool.name+' 更新')
  result=await installTool(tool,()=>{}, {action:'reinstall'});assert.equal(result.ok,true);assert.equal(fs.readFileSync(path.join(dir,'credentials.fixture'),'utf8'),'keep');assert.ok(!fs.existsSync(path.join(dir,'node_modules','old.fixture')));assert.equal(toolOperationRunning(tool.id),false);checks++;console.log('✅ '+tool.name+' 重装清理依赖、保留配置')
 }
 const first=installTool(CODE_CLI_TOOLS[0],()=>{})
 const second=await installTool(CODE_CLI_TOOLS[0],()=>{})
 assert.equal(second.ok,false);await first;checks++;console.log('✅ 同一工具拒绝并发安装')
 if(!fs.existsSync(path.join(managedDir('opencode'),'node_modules','opencode-ai','bin','opencode')))throw new Error('opencode platform binary not placed');checks++;console.log('✅ OpenCode 平台二进制由安装器放置（不依赖上游 postinstall）')
 console.log(`七工具托管安装夹具 ${checks}/${checks}；使用本地模拟 npm，不是上游真实安装`)
} finally {fs.rmSync(tmp,{recursive:true,force:true})}
process.exit(0)
