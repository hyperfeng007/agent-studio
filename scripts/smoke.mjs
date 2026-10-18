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
  const el = qa(selector).find((b) => text(b).includes(label))
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

/* ------------------------------------------------- 2. 真实流式对话 */
console.log('\n=== 2) 发送消息（mock 流式渲染） ===')
const ta = q('.inputbar textarea')
if (ta) {
  typeInto(ta, '你好，请介绍一下你自己')
  await wait(400)
  const sendBtn = qa('.inputbar button').find((b) => b.className.includes('ant-btn-primary'))
  sendBtn?.click()
  await wait(4000)
  check('流式过程中出现内容', qa('.msg').length >= 2, `${qa('.msg').length} 条消息`)
  check('思考过程块渲染', !!q('.thinking'))
  await wait(9000)
  check('Markdown 渲染', qa('.md').length >= 2, `${qa('.md').length} 个 md 块`)
  check('代码高亮块', qa('.md pre code').length >= 1, `${qa('.md pre').length} 个 pre`)
  check('表格渲染', qa('.md table').length >= 1)
  check('消息操作按钮', qa('.msg-tool').length >= 4, `${qa('.msg-tool').length} 个`)
  const last = qa('.msg').pop()
  check('回复内容非空', text(last).length > 100, `${text(last).length} 字符`)
} else {
  check('输入框存在', false)
}

/* ------------------------------------------------------- 3. 小程序 */
console.log('\n=== 3) 小程序 (Mini Apps) ===')
dom.window.location.hash = '#/minapps'
await wait(3500)
check('小程序网格渲染', qa('.minapp-card').length > 10, `${qa('.minapp-card').length} 个`)
check('搜索框存在', !!doc().querySelector('input[placeholder*="搜索小程序"]'))
// 点击卡片 = 新标签页打开（浏览器无法绕过站点的 X-Frame-Options）
let openedUrl = null
dom.window.open = (url) => { openedUrl = url; return { focus() {}, closed: false } }
const firstCard = q('.minapp-card')
firstCard?.click()
await wait(1200)
check('点击卡片在新标签页打开', !!openedUrl && /^https?:\/\//.test(openedUrl), openedUrl || '未调用 window.open')
check('不再默认进入内嵌视图', !q('.minapp-view'), q('.minapp-view') ? '仍然内嵌' : 'ok')
// 内嵌视图降级为卡片悬停按钮
const embedBtn = q('.minapp-embed')
check('卡片提供内嵌入口', !!embedBtn)
embedBtn?.click()
await wait(2500)
check('内嵌视图可打开', !!q('.minapp-view'), text(q('.minapp-view-head')).slice(0, 50))
check('iframe 或拦截提示', !!q('.minapp-frame') || bodyText().includes('未能内嵌'))
clickByText('.minapp-view-head button', '返回')
await wait(800)
check('内嵌视图可关闭', !q('.minapp-view'))
const mgrBtn = qa('button').find(b => b.querySelector('.anticon-setting'))
mgrBtn?.click()
await wait(1800)
check('管理弹窗打开', bodyText().includes('小程序管理'), mgrBtn ? 'clicked' : 'button not found')
qa('.ant-modal-close').forEach((b) => b.click())
await wait(500)

/* --------------------------------------------------- 4. 主流智能体 */
console.log('\n=== 4) 主流智能体 (Code CLI) ===')
dom.window.location.hash = '#/codecli'
await wait(6000)
check('工具列表渲染', qa('.tool-item').length === 6, `${qa('.tool-item').length} 个工具（只保留主流智能体）`)
check('新增 OpenClaw', qa('.tool-item').some((r) => text(r).includes('OpenClaw')), 'openclaw')
check('已删除的工具不在列表里', !qa('.tool-item').some((r) => /Gemini CLI|Qwen Code|Kimi Code|Qoder|Copilot/i.test(text(r))), '仅 6 个主流智能体')
check('新增 Hermes Agent', qa('.tool-item').some((r) => text(r).includes('Hermes Agent')), 'hermes-agent')
check('DeepSeek Harness 用真实包名', qa('.tool-item').some((r) => text(r).includes('@deepseek-ai/dsh')), '@deepseek-ai/dsh')
check('工具状态标签', qa('.tool-item .ant-tag').length >= 5)
check('详情分区卡片', qa('.section-card').length >= 3, `${qa('.section-card').length} 个`)
check('连接方式选择器', bodyText().includes('统一网关') && bodyText().includes('服务商直连'))
check('工作目录选择器', bodyText().includes('工作目录'))
check('终端选择器', bodyText().includes('终端'))
// data/codecli/* 存的是「Agent Studio 托管安装」的 CLI 副本（每个上百 MB、
// 数千文件），属于可重建的本地产物，不该占用工作区/快照。所以这里不依赖它，
// 而是走「手动指定可执行文件路径」这条兜底路径验证启动命令生成 —— 顺带把该
// 功能本身端到端覆盖掉（写配置 → UI 读回 → 预览命令行）。
const fakeBin = path.join(os.tmpdir(), 'agent-studio-smoke-fake-pi')
fs.writeFileSync(fakeBin, '#!/bin/sh\necho agent-studio-smoke-fake\n')
fs.chmodSync(fakeBin, 0o755)
await fetch(`${BASE}/api/codecli/configs/pi`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'gateway', providerId: 'mock', modelId: 'mock-chat', binPath: fakeBin })
})

const piItem = qa('.tool-item').find(el => text(el).startsWith('Pi'))
check('Pi 工具项存在', !!piItem, piItem ? text(piItem).replace(/\s+/g, ' ').slice(0, 50) : 'Pi not found')
piItem?.click()
await wait(3000)
const detailInputs = qa('.tool-detail input')
check('详情读回手动指定的可执行文件路径', detailInputs.some((i) => i.value === fakeBin),
  detailInputs.map((i) => i.value).filter(Boolean).slice(0, 4).join(' | ') || 'no input carried the path')
check('检测兜底：手动指定路径', bodyText().includes('手动指定'), '未找到手动指定可执行文件入口')
clickByText('.tool-detail button', '预览启动命令')
await wait(2500)
check('命令行预览使用手动指定的路径', !!q('.cmd-preview') && text(q('.cmd-preview')).includes('agent-studio-smoke-fake-pi'),
  text(q('.cmd-preview')).slice(0, 90))

/*
 * 终止进程回归 —— 曾经的现象是「点了终止但 CLI 还在跑，然后 Agent Studio 自己
 * 整个退出」。这里真起一个带子进程的假 CLI，通过 HTTP 终止，然后断言：整棵树
 * 都没了、回执是真实的、服务还活着。
 */
const sleepBin = path.join(os.tmpdir(), 'agent-studio-smoke-tree')
const gpidFile = path.join(os.tmpdir(), 'agent-studio-smoke-tree.pid')
fs.writeFileSync(sleepBin, `#!/bin/sh\nsleep 45 & echo $! > "${gpidFile}"\nwait\n`)
fs.chmodSync(sleepBin, 0o755)
await fetch(`${BASE}/api/codecli/configs/pi`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'gateway', providerId: 'mock', modelId: 'mock-chat', binPath: sleepBin })
})
const launched = await (await fetch(`${BASE}/api/codecli/tools/pi/launch`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ cols: 80, rows: 24 })
})).json()
check('启动会话成功', !!launched.sessionId, launched.error || launched.sessionId || '')
await wait(3000)
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const gpid = fs.existsSync(gpidFile) ? Number(fs.readFileSync(gpidFile, 'utf8').trim()) : 0
check('假 CLI 的子进程确实在跑（否则终止测试没有意义）', gpid > 0 && alive(gpid), `grandchild pid ${gpid}`)
const killRes = await (await fetch(`${BASE}/api/codecli/sessions/${launched.sessionId}/kill`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
})).json()
check('终止进程返回真实回执', killRes.ok === true && killRes.killed === true, JSON.stringify(killRes).slice(0, 150))
await wait(800)
check('整棵进程树都被终止（不残留 sleep）', gpid > 0 && !alive(gpid), `grandchild ${gpid} alive=${alive(gpid)}`)
const afterKill = await (await fetch(`${BASE}/api/providers`)).json()
check('终止之后服务仍然活着', Array.isArray(afterKill) && afterKill.length > 30, `${Array.isArray(afterKill) ? afterKill.length : 0} 个服务商`)
fs.rmSync(sleepBin, { force: true })
fs.rmSync(gpidFile, { force: true })

// 恢复自动检测，别把配置指向一个即将删除的临时文件
await fetch(`${BASE}/api/codecli/configs/pi`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ binPath: '' })
})
fs.rmSync(fakeBin, { force: true })

/* ---------------------------- 4.5 终端中文输入（IME）导致窗口左移的修复守卫 */
console.log('\n=== 4.5) 终端中文输入（IME）位移修复 ===')
// xterm 需要 canvas，jsdom 里跑不起来，所以这一段用「源码 + 构建产物」双重静态守卫：
// 源码断言行为，产物断言这些代码真的被打包进去了。
const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'styles.css'), 'utf8')
const tvSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'TerminalView.jsx'), 'utf8')
const bundleSrc = fs.readFileSync(BUNDLE, 'utf8')
check('.terminal-body 用 overflow:clip（hidden 的盒子仍会被焦点滚动拽走）', /\.terminal-body\s*\{[^}]*overflow:\s*clip/.test(cssSrc))
check('.terminal-panel 同样 clip', /\.terminal-panel\s*\{[^}]*overflow:\s*clip/.test(cssSrc))
check('监听 IME 组合事件', /compositionstart/.test(tvSrc) && /compositionend/.test(tvSrc))
check('把留在屏幕外的隐藏输入框夹回盒子内', /clampTextarea/.test(tvSrc) && /xterm-helper-textarea/.test(tvSrc))
check('祖先链横向滚动一律归零', /clampHorizontalScroll/.test(tvSrc) && /scrollLeft = 0/.test(tvSrc))
check('fit() 去抖且组合期间不重排', /scheduleFit/.test(tvSrc) && /if \(composing\) return/.test(tvSrc))
check('卸载时移除这些监听', /removeEventListener\('compositionend'/.test(tvSrc) && /removeEventListener\('scroll'/.test(tvSrc))
check('构建产物里确实带 IME 处理', bundleSrc.includes('compositionstart') && bundleSrc.includes('xterm-helper-textarea'))

/* ---------------------------------------------- 5. 设置 → 模型服务 */
console.log('\n=== 5) 设置 → 模型服务 (Model Service) ===')
dom.window.location.hash = '#/settings/model-service'
await wait(5000)
check('设置导航渲染', qa('.settings-nav .list-row').length >= 5)
check('服务商列表渲染', qa('.provider-row').length > 20, `${qa('.provider-row').length} 个`)
check('服务商详情渲染', !!q('.provider-detail h3'), text(q('.provider-detail h3')))
check('检查/管理模型按钮', bodyText().includes('检查') && bodyText().includes('管理模型'))
check('启用开关存在', qa('.provider-detail .ant-switch').length >= 1)
check('已启用模型列表', qa('.provider-detail .model-row').length >= 1, `${qa('.provider-detail .model-row').length} 行`)

// opencode-free：出厂默认服务商，免 API Key（列表按「已启用优先」排序，所以它在第一行）
const firstRow = q('.provider-row')
check('默认服务商是 OpenCode Zen', text(firstRow).includes('OpenCode Zen'), text(firstRow).replace(/\s+/g, ' ').slice(0, 40))
check('默认服务商已启用', !!firstRow?.querySelector('.ant-switch-checked'), 'switch checked')
firstRow?.click()
await wait(1200)
check('免 API Key 标记', bodyText().includes('免 API Key'), 'tag rendered')
check('凭据来源横幅', bodyText().includes('本机 OpenCode'), 'keyChain banner')
check('免 Key 时密钥框可留空', !!doc().querySelector('input[placeholder*="可留空"]'), 'placeholder')

// 切换到 OpenAI 服务商并打开模型管理
const openaiRow = qa('.provider-row').find((r) => text(r).includes('OpenAI'))
openaiRow?.click()
await wait(1200)
check('切换服务商详情', text(q('.provider-detail h3')) === 'OpenAI', text(q('.provider-detail h3')))
clickByText('.provider-detail button', '管理模型')
await wait(2000)
check('模型管理弹窗打开', bodyText().includes('模型管理'))
check('获取模型列表 tab', bodyText().includes('获取模型列表'))
qa('.ant-modal-close').forEach((b) => b.click())
await wait(600)

// 添加自定义服务商
clickByText('.provider-list button', '添加服务商')
await wait(1500)
check('添加服务商弹窗', bodyText().includes('渠道类型'))
qa('.ant-modal-close').forEach((b) => b.click())
await wait(400)

console.log('\n=== 6) 常规设置 ===')
dom.window.location.hash = '#/settings/general'
await wait(2500)
check('常规设置渲染', bodyText().includes('发送快捷键') && bodyText().includes('消息样式'))

/* ------------------------------------- 6.5 网络代理与诊断（fetch failed 回归） */
console.log('\n=== 6.5) 网络代理与诊断 ===')
dom.window.location.hash = '#/settings/proxy'
await wait(2600)
check('网络代理页渲染', bodyText().includes('代理模式') && bodyText().includes('代理绕过规则'))
check('三档代理模式（对齐 Cherry Studio）', ['系统代理', '自定义代理', '不使用代理'].every((t) => bodyText().includes(t)))
check('分段控件渲染', qa('.ant-segmented-item').length >= 3, `${qa('.ant-segmented-item').length} 项`)
check('强制 IPv4 开关', bodyText().includes('强制 IPv4') && qa('.ant-switch').length >= 1)
check('当前生效状态行', bodyText().includes('当前生效') && bodyText().includes('重新探测系统代理'))
check('网络诊断区渲染', bodyText().includes('网络诊断') && bodyText().includes('开始诊断'))
check('说明了 Node 不跟随系统代理这件事', bodyText().includes('Node 的出站请求默认'))

const segClicked = clickByText('.ant-segmented-item-label', '自定义代理')
await wait(1400)
const urlInput = doc().querySelector('input[placeholder="http://127.0.0.1:7890"]')
check('切到自定义代理后地址框可编辑', segClicked && !!urlInput && !urlInput.disabled)

const J = { 'Content-Type': 'application/json' }
const putSettings = async (patch) => (await fetch(`${BASE}/api/settings`, { method: 'PUT', headers: J, body: JSON.stringify(patch) })).json()

// 坏域名服务商：端到端验证「用户看到的错误」不再是一句 fetch failed
const badProv = await (await fetch(`${BASE}/api/providers`, { method: 'POST', headers: J, body: JSON.stringify({ name: 'Smoke 坏域名', type: 'openai', apiHost: 'https://no-such-host.invalid', apiKey: 'x', models: [{ id: 'm', name: 'm', capabilities: ['text'] }] }) })).json()
await fetch(`${BASE}/api/providers/${badProv.id}`, { method: 'PUT', headers: J, body: JSON.stringify({ enabled: true }) })
const chatError = async () => {
  const sse = await (await fetch(`${BASE}/api/chat/stream`, { method: 'POST', headers: J, body: JSON.stringify({ providerId: badProv.id, modelId: 'm', messages: [{ role: 'user', content: 'hi' }] }) })).text()
  const raw = (sse.match(/"message":"((?:[^"\\]|\\.)*)"/) || [])[1] || ''
  try { return JSON.parse(`"${raw}"`) } catch { return raw }
}

// ① 代理指向死端口：错误里要能看出是代理连不上
const appliedCustom = await putSettings({ proxyMode: 'custom', proxyUrl: '127.0.0.1:1' })
check('代理设置保存即生效（地址自动补 http://）', appliedCustom?.network?.url === 'http://127.0.0.1:1', JSON.stringify(appliedCustom?.network || {}).slice(0, 110))
const stCustom = await (await fetch(`${BASE}/api/network/status`)).json()
check('GET /api/network/status 反映真实 dispatcher', stCustom.mode === 'custom' && stCustom.url === 'http://127.0.0.1:1' && !!stCustom.appliedAt)
// 智能体子进程也要拿到代理（账号模式下 CLI 自己直连上游）
// 用手动指定的可执行文件路径预览（不依赖是否真的装过 pi）
const previewBin = process.platform === 'win32' ? 'cmd.exe' : '/bin/echo'
const previewRes = await (await fetch(`${BASE}/api/codecli/tools/pi/preview`, { method: 'POST', headers: J, body: JSON.stringify({ binPath: previewBin, mode: 'account' }) })).json()
const previewEnv = previewRes?.env || null
check(
  '启动智能体时透传代理环境变量（账号模式下 CLI 自己直连上游）',
  !!previewEnv && previewEnv.HTTPS_PROXY === 'http://127.0.0.1:1' && previewEnv.NO_PROXY === 'localhost,127.0.0.1,::1',
  previewEnv ? `HTTPS_PROXY=${previewEnv.HTTPS_PROXY} NO_PROXY=${previewEnv.NO_PROXY}` : `预览失败：${(previewRes?.error || '').slice(0, 60)}`
)

const errViaDeadProxy = await chatError()
check('代理坏了也能看出来（不再只有 fetch failed）', /当前生效/.test(errViaDeadProxy) && /127\.0\.0\.1:1|代理/.test(errViaDeadProxy), errViaDeadProxy.split('\n')[0].slice(0, 90))

// ② 诊断本机服务：DNS/TCP 直连为绿，HTTP 步骤把 404 归类为「不是网络问题」
const dgLocal = await (await fetch(`${BASE}/api/network/diagnose`, { method: 'POST', headers: J, body: JSON.stringify({ host: BASE }) })).json()
const stepOk = (r, name) => (r.steps || []).find((x) => x.name === name)?.ok
check('诊断四步都跑到了', ['目标地址', '代理配置', 'DNS 解析', 'TCP 连接（直连）', 'HTTP 请求（真实链路）'].every((n) => (dgLocal.steps || []).some((x) => x.name === n)), (dgLocal.steps || []).map((x) => x.name).join('/'))
check('诊断本机 DNS/TCP 为绿', stepOk(dgLocal, 'DNS 解析') === true && stepOk(dgLocal, 'TCP 连接（直连）') === true)
check('HTTP 状态码被判定为「网络通」', /网络通/.test(dgLocal.verdict || ''), dgLocal.verdict || '')

// ③ 还原直连后：解析不到域名 → 明确指出 DNS 一步
const appliedSystem = await putSettings({ proxyMode: 'system', proxyUrl: '', proxyBypass: 'localhost,127.0.0.1,::1', forceIPv4: false })
check('可还原为系统代理（直连）', appliedSystem?.network?.mode === 'system' && !appliedSystem?.network?.url)
const errDirect = await chatError()
check('直连时报出目标域名与 ENOTFOUND', /目标：no-such-host\.invalid/.test(errDirect) && /ENOTFOUND/.test(errDirect) && !/^fetch failed$/m.test(errDirect), errDirect.split('\n')[0].slice(0, 90))
check('错误里给出代理设置的具体路径', /设置 → 常规设置 → 网络代理|网络代理/.test(errDirect))
const dgBad = await (await fetch(`${BASE}/api/network/diagnose`, { method: 'POST', headers: J, body: JSON.stringify({ host: 'https://no-such-host.invalid' }) })).json()
check('诊断定位到 DNS 一步', dgBad.ok === false && stepOk(dgBad, 'DNS 解析') === false && (dgBad.steps || []).find((x) => x.name === 'DNS 解析')?.code === 'ENOTFOUND', dgBad.verdict || '')
check('诊断附带下一步建议', (dgBad.hints || []).join(' ').length > 10, (dgBad.hints || [])[0]?.slice(0, 60) || '')
const reapply = await (await fetch(`${BASE}/api/network/reapply`, { method: 'POST', headers: J, body: '{}' })).json()
check('重新探测系统代理接口可用', reapply?.ok === true && !!reapply?.network?.source, reapply?.network?.source || '')

await fetch(`${BASE}/api/providers/${badProv.id}`, { method: 'DELETE' })

console.log('\n=== 7) 备份与恢复 ===')
dom.window.location.hash = '#/settings/backup'
await wait(2500)
check('数据统计渲染', qa('.stat-card').length >= 5, `${qa('.stat-card').length} 个`)

/* ------------------------------------------- 恢复出厂的服务商/默认模型状态 */
await restoreFactory()

/* ------------------------------------------------------------ 汇总 */
console.log('\n================ 汇总 ================')
const failed = results.filter((r) => !r.ok)
console.log(`通过 ${results.length - failed.length}/${results.length}`)
if (failed.length) {
  console.log('失败项:')
  failed.forEach((f) => console.log('  ❌', f.name, f.detail))
}
const uniq = [...new Set(errors)].filter(
  // jsdom 伪影：没有真实布局引擎，textarea 自适应高度算出 NaN；ResizeObserver 也是桩。
  (e) => !/Not implemented|Could not parse CSS|WebSocket|matchMedia|canvas|NaN` is an invalid value/i.test(e)
)
console.log(uniq.length ? '\n运行时错误:\n' + uniq.slice(0, 8).join('\n---\n') : '\n运行时错误: 无 ✅')
dom.window.close()
process.exit(failed.length || uniq.length ? 2 : 0)
