import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { npmInvocation, spawnCli, npmNetworkEnv } from '../server/codecli/processLaunch.js'
let checks=0
const check=(name,fn)=>{fn();checks++;console.log('✅ '+name)}
const args=['install','--no-audit','@deepseek-ai/dsh@latest']
const win={platform:'win32',execPath:'C:\\Program Files\\nodejs\\node.exe',exists:()=>true}
const direct=npmInvocation(args,win)
check('Windows npm 使用当前 Node，不把 npm 放进带引号的 cmd 命令',()=>{assert.equal(direct.command,win.execPath);assert.equal(direct.direct,true)})
check('npm-cli 路径带空格仍为单独参数',()=>assert.equal(direct.args[0],'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'))
check('DSH 包名和参数不改写、不提前添加引号',()=>assert.deepEqual(direct.args.slice(1),args))
check('找不到 npm-cli 时保留原始 npm 命令供跨平台启动器处理',()=>assert.deepEqual(npmInvocation(args,{...win,exists:()=>false}),{command:'npm',args,direct:false}))
check('非 Windows 保持 npm PATH 行为',()=>assert.equal(npmInvocation(args,{platform:'linux'}).command,'npm'))
const original={HTTPS_PROXY:'http://old',npm_config_proxy:'http://old',NODE_EXTRA_CA_CERTS:'corp.pem'}
const network=npmNetworkEnv(original,{mode:'system',url:'http://system:8080',bypass:'localhost'})
check('托管安装使用应用当前代理且不修改原始环境',()=>{assert.equal(network.npm_config_https_proxy,'http://system:8080');assert.equal(original.HTTPS_PROXY,'http://old');assert.equal(network.NODE_EXTRA_CA_CERTS,'corp.pem')})
check('直连模式清除本次 npm 的旧代理',()=>assert.equal(npmNetworkEnv(original,{mode:'off'}).npm_config_proxy,''))
const expected=['a b','中文路径','a"b','x&y','tail\\']
const child=spawnCli(process.execPath,['-e','process.stdout.write(JSON.stringify(process.argv.slice(1)))',...expected])
let text='';child.stdout.on('data',b=>text+=b)
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)})
check('真实子进程保持空格、中文、引号、符号和反斜杠参数',()=>{assert.equal(code,0);assert.deepEqual(JSON.parse(text),expected)})
const parsed=JSON.parse(execFileSync(process.execPath,['-e',`Object.defineProperty(process,'platform',{value:'win32'});console.log(JSON.stringify(require('cross-spawn')._parse('npm',${JSON.stringify(args)},{forceShell:true})))`],{encoding:'utf8'}))
check('Windows 回退将完整命令交给 cmd，并禁止 Node 再次转义',()=>{assert.equal(parsed.options.windowsVerbatimArguments,true);assert.deepEqual(parsed.args.slice(0,3),['/d','/s','/c']);assert.equal(parsed.args.length,4);assert.ok(parsed.args[3].includes('@deepseek-ai/dsh@latest'));assert.ok(!parsed.args[3].includes('\\"npm\\"'))})
if(process.platform==='win32') {
 const p=spawnCli('npm',['--version']);let version='';p.stdout.on('data',b=>version+=b)
 const status=await new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',resolve)})
 check('原生 Windows npm --version',()=>{assert.equal(status,0);assert.match(version,/\d+\.\d+\.\d+/)})
} else console.log('SKIP 原生 Windows npm 启动：当前为非 Windows 环境')
console.log(`CLI 启动回归 ${checks}/${checks} 通过`)
