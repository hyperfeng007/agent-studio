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


const createdIds = []
const unique = `助手流程测试-${Date.now()}`
try {
  q('button[aria-label="添加智能助手"]')?.click()
  await wait(900)
  check('添加入口打开助手库', !!q('.assistant-library-list'))
  const search = q('input[aria-label="搜索助手库"]')
  typeInto(search, '灾难性回溯')
  await wait(300)
  check('助手库搜索匹配完整提示词', qa('.assistant-preset-row').length === 1 && text(q('.assistant-preset-row')).includes('正则表达式'))
  q('.assistant-preset-info')?.click()
  await wait(350)
  check('预览展示完整系统提示词', text(q('.assistant-prompt-preview')).includes('灾难性回溯'))
  clickByText('button', '以此为模板新建')
  await wait(400)
  check('模板进入统一新建编辑器', !!q('.assistant-editor-body'))
  const nameInput = q('input[placeholder="为智能助手起个名字"]')
  typeInto(nameInput, unique)
  clickByText('[role="tab"]', '提示词')
  await wait(250)
  check('模板提示词带入编辑器', qa('textarea').some(e=>e.value.includes('灾难性回溯')))
  clickByText('[role="tab"]', '模型参数')
  await wait(250)
  check('新建时可配置模型参数', bodyText().includes('最大输出 tokens') && bodyText().includes('上下文消息数量'))
  clickByText('button', '创建并开始对话')
  await wait(1300)
  const all = await (await fetch(BASE+'/api/assistants')).json()
  const created = all.find(a=>a.name === unique)
  if (created) createdIds.push(created.id)
  check('自定义创建持久化并关闭窗口', !!created && !q('.assistant-editor-body'))
  check('创建后进入新助手对话', text(q('.chat-header')).includes(unique))
  check('新助手继承全局默认模型', created?.model?.id === 'mock-reasoning')
  q('.sidebar-col .list-row.active .row-action')?.click()
  await wait(350)
  const editName=q('input[placeholder="为智能助手起个名字"]')
  if(editName) typeInto(editName, unique+'-已修改')
  clickByText('button', '保存修改')
  await wait(900)
  check('编辑保存同步更新侧栏与会话头部', text(q('.chat-header')).includes(unique+'-已修改'))
  q('.sidebar-col .list-row.active .row-action')?.click()
  await wait(350)
  const cancelName=q('input[placeholder="为智能助手起个名字"]')
  if(cancelName) typeInto(cancelName, '不应保存')
  clickByText('.ant-modal-footer button', '取消')
  await wait(300)
  clickByText('button', '放弃修改')
  await wait(450)
  const saved = created ? await (await fetch(BASE+`/api/assistants/${created.id}`)).json() : null
  check('取消编辑不写入草稿', saved?.name === unique+'-已修改')
  check('同一侧栏上下分区，话题不再嵌套助手行', qa('.sidebar-col').length === 1 && !!q('.assistant-list-section') && !!q('.topic-list-section .assistant-topics') && !q('.assistant-branch .assistant-topics'))
  check('话题区标明当前助手且无折叠树按钮', text(q('.topic-assistant-name')).includes(unique+'-已修改') && !q('.assistant-expand'))
  q('.topic-new')?.click(); await wait(200)
  const topicInput = q('input[placeholder="话题名称（留空则自动生成）"]')
  if(topicInput) {
    typeInto(topicInput,'二级话题测试')
    await wait(100)
    topicInput.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}))
  }
  await wait(700)
  check('Enter 创建二级话题并切换', text(q('.topic-row.active')).includes('二级话题测试') && text(q('.chat-header')).includes('二级话题测试'))
  const persistedTopics = created ? await (await fetch(BASE+`/api/assistants/${created.id}/topics`)).json() : []
  check('新话题写入正确的助手', persistedTopics.some(t=>t.name === '二级话题测试' && t.assistantId === created.id))
  q('.topic-row.active .topic-more')?.click(); await wait(250)
  clickByText('.ant-dropdown-menu-item','置顶话题'); await wait(500)
  const pinnedTopics = created ? await (await fetch(BASE+`/api/assistants/${created.id}/topics`)).json() : []
  check('话题置顶持久化并排在二级列表首位', pinnedTopics.find(t=>t.name === '二级话题测试')?.pinned === true && text(q('.topic-row')).includes('二级话题测试'))
  q('.topic-row.active .topic-more')?.click(); await wait(250)
  clickByText('.ant-dropdown-menu-item','重命名'); await wait(250)
  const renameInput = q('.ant-modal-confirm-body input')
  if(renameInput) typeInto(renameInput,'已重命名的话题')
  clickByText('.ant-modal-confirm-btns button','保存'); await wait(600)
  check('二级话题重命名同步显示', text(q('.topic-row.active')).includes('已重命名的话题') && text(q('.chat-header')).includes('已重命名的话题'))
  const alternate = qa('.assistant-list-section .list-row:not(.active)')[0]
  alternate?.click(); await wait(600)
  check('切换助手后下半区不混入前一助手话题', !!alternate && !text(q('.topic-list-section')).includes('已重命名的话题') && text(q('.topic-assistant-name')) === text(alternate.querySelector('.row-title > span')).replace(/^置顶/,''))
  qa('.assistant-list-section .list-row').find(e=>text(e).includes(unique+'-已修改'))?.click(); await wait(600)
  check('切回助手后恢复其已创建话题', text(q('.topic-list-section')).includes('已重命名的话题') && text(q('.topic-assistant-name')).includes(unique+'-已修改'))
  const other = qa('.topic-row:not(.active) .topic-select')[0]
  other?.click(); await wait(450)
  check('可以切换回同一助手的历史话题', !!other && text(q('.topic-row.active')).includes('默认话题'))
  qa('.topic-select').find(e=>text(e).includes('已重命名的话题'))?.click(); await wait(300)
  q('.topic-row.active .topic-more')?.click(); await wait(250)
  clickByText('.ant-dropdown-menu-item','删除话题'); await wait(250)
  clickByText('.ant-modal-confirm-btns button','删除'); await wait(600)
  check('删除当前话题后回到剩余话题', qa('.topic-row').length === 1 && text(q('.topic-row.active')).includes('默认话题'))
  // Open the blank path as well, ensuring the two entrances stay distinct.
  q('button[aria-label="添加智能助手"]')?.click(); await wait(400)
  clickByText('button','自定义新建'); await wait(400)
  check('空白新建不残留上次草稿', q('input[placeholder="为智能助手起个名字"]')?.value === '')
  clickByText('button','创建并开始对话'); await wait(200)
  check('空名称保留编辑器并显示校验错误', bodyText().includes('请填写智能助手名称') && !!q('.assistant-editor-body'))
} finally {
  for (const id of createdIds) await fetch(BASE+`/api/assistants/${id}`, {method:'DELETE'})
  await restoreFactory()
  dom.window.close()
}
// jsdom has no layout engine: textarea autosizing may calculate a NaN height.
const unexpected=errors.filter(e=>!/NaN` is an invalid value/.test(e))
console.log(`助手交互回归 ${results.filter(r=>r.ok).length}/${results.length}；运行时错误 ${unexpected.length}`)
if(unexpected.length) console.log(unexpected.join('\n'))
process.exit(results.some(r=>!r.ok)||unexpected.length ? 1 : 0)
