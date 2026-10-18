import { recoverKnowledgeJobs } from '../knowledge/service.js'
import { shutdownMcp } from '../mcp/service.js'
import { isLocalMcpRequest } from '../mcp/security.js'
import express from 'express'
import { getSettings, updateSettings, loadDb, saveNow, table } from '../store.js'
import { defaultModel } from '../services/providers.js'
import { applyNetworkSettings, networkStatus, DEFAULT_BYPASS } from '../net/proxy.js'

export const settingsRouter = express.Router()

const DEFAULT_SETTINGS = {
  language: 'zh-CN',
  theme: 'auto',
  fontSize: 14,
  messageStyle: 'plain',
  inputbarPosition: 'bottom',
  showAssistants: true,
  showTopics: true,
  sendMessageShortcut: 'Enter',
  pasteLongTextAsFile: false,
  pasteLongTextThreshold: 1500,
  renderThinkCompleteBlocks: true,
  messageNav: 'none',
  contextCount: 12,
  temperature: 0.7,
  topP: 1,
  maxTokens: 0,
  streamOutput: true,
  autoRenameTopic: true,
  sidebarIcons: ['chat', 'minapps', 'codecli', 'settings'],
  // —— 网络与代理（对齐 Cherry Studio 设置 → 系统 → 代理模式）——
  // system = 系统代理（默认，跟随 Windows/macOS 设置）；custom = 自定义代理；off = 不使用代理（强制直连）
  proxyMode: 'system',
  proxyUrl: '',
  proxyBypass: DEFAULT_BYPASS,
  forceIPv4: false,
  // 旧字段，保留只为兼容既有 db.json：proxyEnabled=true + proxyUrl ⇒ 等价于 custom
  proxyEnabled: false
}

/** 设置里只允许这些网络字段被写入（避免把任意键塞进 dispatcher 配置）。 */
const NETWORK_KEYS = ['proxyMode', 'proxyUrl', 'proxyBypass', 'forceIPv4', 'proxyEnabled']
const touchesNetwork = (patch = {}) => NETWORK_KEYS.some((k) => k in patch)

settingsRouter.get('/', (req, res) => {
  const s = getSettings()
  res.json({
    ...DEFAULT_SETTINGS,
    ...s,
    defaultModel: s.defaultModel || defaultModel(),
    // 当前进程里真正生效的网络配置（可能与设置不同：例如系统代理探测不到）
    network: networkStatus()
  })
})

settingsRouter.put('/', async (req, res) => {
  const patch = req.body || {}
  const next = updateSettings(patch)
  // 代理相关设置保存后立即生效，不需要重启服务。
  if (touchesNetwork(patch)) {
    try {
      await applyNetworkSettings(next, { log: true })
    } catch (err) {
      return res.status(500).json({ error: `代理设置未能生效：${err.message}`, settings: { ...DEFAULT_SETTINGS, ...next } })
    }
  }
  res.json({ ...DEFAULT_SETTINGS, ...next, network: networkStatus() })
})

settingsRouter.get('/stats', (req, res) => {
  const db = loadDb()
  res.json({
    assistants: db.assistants.length,
    topics: db.topics.length,
    messages: db.messages.length,
    minapps: db.minapps.length,
    providers: db.providers.length,
    codecli: db.codecli.length
  })
})

/** 备份 → 导出数据（与原版一致的整库 JSON 导出）。 */
settingsRouter.get('/export', (req, res) => {
  saveNow()
  const db = loadDb()
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="agent-studio-backup-${Date.now()}.json"`)
  res.end(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), db }, null, 2))
})

/** 备份 → 导入数据。 */
settingsRouter.post('/import', async (req, res) => {
  const db = loadDb()
  const incoming = req.body?.db || req.body
  if (!incoming || typeof incoming !== 'object') return res.status(400).json({ error: '无效的备份文件' })
  const collections=['assistants','topics','messages','minapps','providers','codecli','knowledgeBases','knowledgeDocuments','mcpServers']
  const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v)
  if(!object(incoming)||!['settings',...collections].some(k=>k in incoming))return res.status(400).json({error:'备份没有有效数据表'})
  if(incoming.settings!==undefined&&!object(incoming.settings))return res.status(400).json({error:'备份 settings 必须是对象'})
  for(const key of collections)if(incoming[key]!==undefined) {
    if(!Array.isArray(incoming[key])||incoming[key].some(row=>!object(row)||typeof row.id!=='string'||(row.name!==undefined&&typeof row.name!=='string')))return res.status(400).json({error:`备份 ${key} 数据格式无效`})
  }
  let chunkCount=0,vectorCount=0
  for(const d of incoming.knowledgeDocuments||[]) {
    if(!Array.isArray(d.chunks)||d.chunks.length>300)return res.status(400).json({error:'备份资料片段无效或超限'})
    chunkCount+=d.chunks.length
    for(const c of d.chunks) {
      if(!object(c)||typeof c.text!=='string'||c.text.length>200000||(c.vector!==undefined&&(!Array.isArray(c.vector)||c.vector.some(x=>typeof x!=='number'||!Number.isFinite(x)))))return res.status(400).json({error:'备份资料片段或向量格式无效'})
      vectorCount+=c.vector?.length||0
    }
  }
  if((incoming.knowledgeDocuments?.length||0)>100||chunkCount>2000||vectorCount>2000000)return res.status(400).json({error:'备份知识库索引超过本应用容量限制'})
  if(table('knowledgeDocuments').some(d=>['queued','parsing','indexing'].includes(d.status)))return res.status(409).json({error:'请等待知识库索引完成，或删除正在索引的资料后再恢复备份'})
  if (incoming.mcpServers && !isLocalMcpRequest(req)) return res.status(403).json({error:'含 MCP 配置的备份只能在服务端本机恢复'})
  await shutdownMcp()
  for (const key of ['settings', 'assistants', 'topics', 'messages', 'minapps', 'providers', 'codecli', 'knowledgeBases', 'knowledgeDocuments', 'mcpServers']) {
    if (incoming[key] !== undefined) db[key] = incoming[key]
  }
  // Imported tool bindings always require a fresh local authorization.
  for (const a of db.assistants || []) a.mcpGrants = []
  recoverKnowledgeJobs()
  saveNow()
  res.json({ ok: true })
})

settingsRouter.post('/reset', (req, res) => {
  const db = loadDb()
  for (const key of ['assistants', 'topics', 'messages']) db[key] = []
  db.settings = {}
  saveNow()
  res.json({ ok: true })
})

settingsRouter.get('/tables', (req, res) => {
  const db = loadDb()
  res.json(Object.fromEntries(Object.keys(db).map((k) => [k, Array.isArray(db[k]) ? db[k].length : 'object'])))
})
