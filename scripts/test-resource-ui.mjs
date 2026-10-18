import http from 'node:http'
/**
 * Runtime smoke test.
 *
 * jsdom cannot execute ESM module scripts, so this loads the IIFE bundle built
 * by web/vite.smoke.config.js and drives the real UI against the live server:
 * it catches render crashes and verifies the four modules actually mount.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM, VirtualConsole } from 'jsdom'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = process.env.BASE || 'http://localhost:3000'
const BUNDLE = path.join(__dirname, '..', 'web', 'dist-smoke', 'app.js')

if (!fs.existsSync(BUNDLE)) {
  console.error('缺少 IIFE 构建产物，请先运行: npx vite build --config web/vite.smoke.config.js')
  process.exit(1)
}

/*
 * 出厂默认服务商是 OpenCode Zen（免 Key），但它的免费层对第三方客户端返回 403
 * 「OpenCode's free tier can only be used from within OpenCode」，smoke 必须离线
 * 可复现，所以这里临时启用 mock 并把默认模型指过去，跑完原样恢复（下面的
 * restoreFactory()）。默认服务商本身的语义由 scripts/test-providers.mjs 用隔离
 * DATA_DIR 断言，不在这里依赖运行时状态。
 */
const jput = async (u, body) => (await fetch(BASE + u, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
const factoryProviders = await (await fetch(`${BASE}/api/providers`)).json()
const factorySettings = await (await fetch(`${BASE}/api/settings`)).json()
// 助手上存的模型优先于全局默认，所以一并指到 mock-reasoning（跑完恢复）。
const factoryAssistants = await (await fetch(`${BASE}/api/assistants`)).json()
const smokeAssistant = Array.isArray(factoryAssistants) ? factoryAssistants[0] : null
await jput('/api/providers/mock', { enabled: true })
// mock-reasoning（不是 mock-chat）：它带 reasoning 能力，能顺带覆盖「思考过程」块的渲染。
await jput('/api/settings', { defaultModel: { providerId: 'mock', modelId: 'mock-reasoning' } })
if (smokeAssistant) await jput(`/api/assistants/${smokeAssistant.id}`, { model: { provider: 'mock', id: 'mock-reasoning' } })
const restoreFactory = async () => {
  if (smokeAssistant) await jput(`/api/assistants/${smokeAssistant.id}`, { model: smokeAssistant.model || null })
  await jput('/api/providers/mock', { enabled: factoryProviders.find((p) => p.id === 'mock')?.enabled ?? false })
  await jput('/api/settings', { defaultModel: factorySettings.defaultModel ?? null })
}

const errors = []
const vc = new VirtualConsole()
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.stack || e.message).slice(0, 600)))
vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ').slice(0, 500)))

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: `${BASE}/#/chat`,
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(w) {
    const nativeComputedStyle = w.getComputedStyle.bind(w)
    w.getComputedStyle = el => nativeComputedStyle(el)
    w.matchMedia = (q) => ({
      matches: false, media: q, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false }
    })
    w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
    w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
    w.scrollTo = () => {}
    w.scroll = () => {}
    w.HTMLCanvasElement.prototype.getContext = () => null
    w.WebSocket = class {
      constructor() { this.readyState = 0; setTimeout(() => this.onerror?.({}), 30) }
      send() {}
      close() { this.readyState = 3 }
      addEventListener() {}
    }
    w.navigator.clipboard = { writeText: async () => {} }
    w.fetch = async (input, init) => {
      const url = typeof input === 'string' ? (input.startsWith('/') ? BASE + input : input) : input.url
      return fetch(url, init)
    }
    w.addEventListener('error', (e) => errors.push('window.error: ' + (e.error?.stack || e.message).slice(0, 600)))
    w.addEventListener('unhandledrejection', (e) => errors.push('unhandledrejection: ' + String(e.reason?.stack || e.reason).slice(0, 600)))
  }
})

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const doc = () => dom.window.document
const q = (sel) => doc().querySelector(sel)
const qa = (sel) => [...doc().querySelectorAll(sel)]
const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim()
const bodyText = () => text(doc().body)

function typeInto(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
}

function clickByText(selector, label) {
  const el = qa(selector).find((b) => text(b).replace(/\s/g, '').includes(label.replace(/\s/g, '')))
  if (el) el.click()
  return !!el
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

try {
  const code = fs.readFileSync(BUNDLE, 'utf8')
  dom.window.eval(code)
} catch (err) {
  console.error('执行 bundle 失败:', err.message)
  process.exit(1)
}

await wait(7000)

/* ------------------------------------------------------------ 1. 对话页 */
console.log('\n=== 1) 对话页 (Chat) ===')
check('左侧图标导航渲染', qa('.navbar-item').length >= 4, `${qa('.navbar-item').length} 项`)
check('智能助手栏渲染', !!q('.sidebar-col'), qa('.sidebar-col .list-row').length + ' 行')
check('会话头部渲染', !!q('.chat-header'), text(q('.chat-header')).slice(0, 60))
check('输入框渲染', !!q('.inputbar textarea'))
check('模型选择器渲染', bodyText().includes('本地演示') || bodyText().includes('选择模型'))



const stamp=Date.now(),kbName=`UI知识库-${stamp}`,mcpName=`UI-MCP-${stamp}`
let kbId,serverId,assistantId,providerId,upstream
try {
 dom.window.location.hash='#/knowledge';await wait(600)
 check('知识库管理页面渲染',bodyText().includes('让助手依据你的资料回答'))
 q('button[aria-label="新建知识库"]')?.click();await wait(250)
 typeInto(q('input[aria-label="知识库名称"]'),kbName)
 clickByText('.ant-modal-footer button','创建');await wait(600)
 const bases=await (await fetch(BASE+'/api/knowledge')).json();kbId=bases.find(b=>b.name===kbName)?.id
 check('UI 新建本地关键词知识库并进入详情',!!kbId&&bodyText().includes('导入资料'))
 const input=q('input[type="file"]')
 const file=new dom.window.File(['报销审批流程：十五天内提交发票，由部门经理审批。'],'ui-guide.txt',{type:'text/plain'})
 Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new dom.window.Event('change',{bubbles:true}))
 await wait(2600)
 check('文件选择器真实导入并显示可检索状态',bodyText().includes('ui-guide.txt')&&bodyText().includes('可检索'))
 typeInto(q('input[aria-label="检索知识库"]'),'报销审批')
 clickByText('button','检索');await wait(450)
 check('检索测试显示真实来源片段',!!q('.reference-card')&&text(q('.reference-card')).includes('十五天'))
 dom.window.location.hash='#/settings/model-service';await wait(600)
 check('主导航不再提供独立 MCP 入口',!qa('.navbar-item').some(e=>text(e)==='MCP 工具'))
 clickByText('.settings-nav .list-row','MCP 工具');await wait(600)
 check('设置菜单打开 MCP 并高亮入口',dom.window.location.hash==='#/settings/mcp'&&text(q('.settings-nav .list-row.active'))==='MCP 工具'&&!!q('.mcp-settings-page'))
 dom.window.location.hash='#/mcp';await wait(600)
 check('旧 MCP 地址自动跳转到设置',dom.window.location.hash==='#/settings/mcp'&&!!q('.mcp-settings-page'))
 check('MCP 管理页显示执行位置和权限边界',bodyText().includes('Node 服务端电脑')&&bodyText().includes('添加服务器'))
 clickByText('button','添加服务器');await wait(250)
 typeInto(q('input[aria-label="MCP名称"]'),mcpName)
 typeInto(q('input[aria-label="MCP命令"]'),process.execPath)
 typeInto(q('textarea[aria-label="MCP参数"]'),JSON.stringify([path.resolve('scripts/fixtures/mcp-server.mjs')]))
 clickByText('button','保存配置（不自动连接）');await wait(600)
 const servers=await (await fetch(BASE+'/api/mcp')).json();const srv=servers.find(s=>s.name===mcpName);serverId=srv?.id
 check('保存 MCP 后不自动启动',!!serverId&&srv.connected===false)
 // Scope button lookup to this test's server card, never operate on user servers.
 const card=qa('.capability-card').find(c=>text(c).includes(mcpName))
 ;[...card.querySelectorAll('button')].find(b=>text(b).includes('连接并发现工具'))?.click();await wait(200)
 clickByText('.ant-modal-confirm-btns button','确认连接');await wait(1400)
 check('UI 确认连接后真实发现 MCP 工具',bodyText().includes('echo_note')&&text(card).includes('已连接'))
 dom.window.location.hash='#/chat';await wait(900)
 q('.sidebar-col .list-row.active .row-action')?.click();await wait(250)
 clickByText('[role="tab"]','知识库与工具');await wait(600)
 check('助手编辑器提供真实的知识库与工具授权页',bodyText().includes('绑定知识库')&&bodyText().includes(mcpName)&&bodyText().includes('echo_note'))
 clickByText('.ant-modal-footer button','取消');await wait(300)
 const post=async(route,data)=>{const r=await fetch(BASE+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return r.json()}
 upstream=http.createServer(async(req,res)=>{
  let text='';for await(const c of req)text+=c
  const body=JSON.parse(text),tool=body.tools?.[0]?.function?.name
  const after=body.messages?.some(m=>m.role==='tool')
  res.writeHead(200,{'Content-Type':'text/event-stream'})
  const delta=tool&&!after?{tool_calls:[{index:0,id:'ui_call',type:'function',function:{name:tool,arguments:'{"text":"hello from UI"}'}}]}:{content:'工具调用已完成，依据资料回答。[来源1]'}
  res.write(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:null}]})}\n\n`)
  res.end('data: [DONE]\n\n')
 })
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r))
 const provider=await post('/api/providers',{name:`UI-provider-${stamp}`,type:'openai',apiHost:`http://127.0.0.1:${upstream.address().port}`,models:[{id:'ui-model'}]});providerId=provider.id
 await jput(`/api/providers/${providerId}`,{enabled:true})
 const agentName=`UI-tool-agent-${stamp}`
 const agent=await post('/api/assistants',{name:agentName,model:{provider:providerId,id:'ui-model'},knowledgeBaseIds:[kbId],mcpGrants:[{serverId,tools:['echo_note']}]});assistantId=agent.id
 dom.window.location.hash='#/minapps';await wait(700);dom.window.location.hash='#/chat';await wait(1200)
 qa('.sidebar-col .list-row').find(e=>text(e).includes(agentName))?.click();await wait(500)
 typeInto(q('.inputbar textarea'),'报销审批，使用工具确认')
 await wait(100);qa('.inputbar button').find(b=>b.className.includes('ant-btn-primary'))?.click();await wait(900)
 check('聊天中出现原生 MCP 单次确认卡片',!!q('.tool-call-card')&&bodyText().includes('允许本次执行')&&bodyText().includes('echo_note'))
 clickByText('.tool-call-card button','允许本次执行');await wait(1000)
 check('点击允许后执行结果和模型回答均显示',text(q('.tool-call-card')).includes('fixture: hello from UI')&&bodyText().includes('工具调用已完成'))
 check('回答展示可展开的知识库来源',!!q('.chat-references')&&text(q('.chat-references')).includes('ui-guide.txt'))
 const topics=await (await fetch(BASE+`/api/assistants/${assistantId}/topics`)).json()
 const rows=await (await fetch(BASE+`/api/topics/${topics[0].id}/messages`)).json()
 const answer=rows.find(m=>m.role==='assistant')
 check('工具记录与来源持久化，但一次性确认令牌不落库',!!answer?.references?.length&&answer.toolEvents?.[0]?.status==='done'&&!answer.toolEvents?.[0]?.approvalId)

}finally{
 // On failure, look up only uniquely named test objects to avoid leaving fixtures behind.
 if(!kbId){const list=await (await fetch(BASE+'/api/knowledge')).json();kbId=list.find(b=>b.name===kbName)?.id}
 if(!serverId){const list=await (await fetch(BASE+'/api/mcp')).json();serverId=list.find(s=>s.name===mcpName)?.id}
 if(assistantId)await fetch(BASE+`/api/assistants/${assistantId}`,{method:'DELETE'})
 if(providerId)await fetch(BASE+`/api/providers/${providerId}`,{method:'DELETE'})
 if(upstream){upstream.closeAllConnections();await new Promise(r=>upstream.close(r))}
 if(serverId)await fetch(BASE+`/api/mcp/${serverId}`,{method:'DELETE'})
 if(kbId)await fetch(BASE+`/api/knowledge/${kbId}`,{method:'DELETE'})
 await restoreFactory();dom.window.close()
}
const unexpected=errors.filter(e=>!/NaN` is an invalid value/.test(e))
console.log(`资源 UI 回归 ${results.filter(r=>r.ok).length}/${results.length}；运行时错误 ${unexpected.length}`)
if(unexpected.length)console.log(unexpected.join('\n'))
process.exit(results.some(r=>!r.ok)||unexpected.length?1:0)
