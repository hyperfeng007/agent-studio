import { isLocalMcpRequest } from '../mcp/security.js'
import { ASSISTANT_PRESETS } from '../config/assistantPresets.js'
import express from 'express'
import { customAlphabet } from 'nanoid'
import { table, findRow, upsertRow, insertRow, deleteRow, deleteWhere, getSettings, saveNow } from '../store.js'
import { getProvider } from '../services/providers.js'

export const chatDataRouter = express.Router()
const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12)
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(e.status || 500).json({ error: e.message }))

/* ------------------------------------------------------------------ models */

function hydrateAssistant(a) {
  if (!a?.model) return a
  const p = getProvider(a.model.provider)
  const m = p?.models.find((x) => x.id === a.model.id)
  return {
    ...a,
    model: {
      id: a.model.id,
      provider: a.model.provider,
      name: a.model.name || m?.name || a.model.id,
      capabilities: m?.capabilities || a.model.capabilities || ['text'],
      contextLength: m?.contextLength ?? a.model.contextLength,
      maxTokens: m?.maxTokens ?? a.model.maxTokens,
      group: m?.group || a.model.group || '',
      providerName: p?.name || a.model.provider,
      enabled: !!p?.enabled
    }
  }
}


function validateBindings(body) {
  if (body.knowledgeBaseIds !== undefined && (!Array.isArray(body.knowledgeBaseIds) || body.knowledgeBaseIds.length>6 || body.knowledgeBaseIds.some(x=>typeof x!=='string'))) throw Object.assign(new Error('最多绑定 6 个知识库'),{status:400})
  if (body.mcpGrants !== undefined && (!Array.isArray(body.mcpGrants) || body.mcpGrants.length>12 || body.mcpGrants.some(g=>!g || typeof g.serverId!=='string' || !Array.isArray(g.tools) || g.tools.some(t=>typeof t!=='string')) || body.mcpGrants.reduce((n,g)=>n+g.tools.length,0)>24)) throw Object.assign(new Error('MCP 授权格式不正确，最多 24 个工具'),{status:400})
}

/* -------------------------------------------------------------- assistants */

chatDataRouter.get('/assistant-presets', (req, res) => res.json(ASSISTANT_PRESETS))

chatDataRouter.get('/assistants', (req, res) => {
  const rows = table('assistants').map(hydrateAssistant)
  res.json(rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)))
})

chatDataRouter.get('/assistants/:id', wrap((req, res) => {
  const a = findRow('assistants', req.params.id)
  if (!a) return res.status(404).json({ error: '智能助手不存在' })
  res.json(hydrateAssistant(a))
}))

chatDataRouter.post('/assistants', wrap((req, res) => {
  const b = req.body || {}
  validateBindings(b)
  if (b.mcpGrants?.length && !isLocalMcpRequest(req)) return res.status(403).json({error:'MCP 授权仅能在服务端本机配置'})
  if (typeof b.name !== 'string' || !b.name.trim() || b.name.trim().length > 80) return res.status(400).json({ error: '名称须为 1–80 个字符' })
  const now = Date.now()
  const id = nanoid()
  const assistant = {
    id,
    name: b.name.trim(),
    prompt: b.prompt || '',
    emoji: b.emoji || '⭐️',
    description: String(b.description || '').slice(0, 500),
    group: String(b.group || '').trim().slice(0, 40),
    presetId: typeof b.presetId === 'string' ? b.presetId : null,
    pinned: false,
    type: b.type || 'assistant',
    model: b.model || (getSettings().defaultModel ? { id: getSettings().defaultModel.modelId, provider: getSettings().defaultModel.providerId } : null),
    topics: [],
    knowledgeBaseIds: Array.isArray(b.knowledgeBaseIds) ? [...new Set(b.knowledgeBaseIds)].slice(0,6) : [],
    mcpGrants: Array.isArray(b.mcpGrants) ? b.mcpGrants.slice(0,12) : [],
    settings: {
      contextCount: b.settings?.contextCount ?? getSettings().contextCount ?? 12,
      temperature: b.settings?.temperature ?? getSettings().temperature ?? 0.7,
      topP: b.settings?.topP ?? getSettings().topP ?? 1,
      maxTokens: b.settings?.maxTokens ?? 0,
      streamOutput: b.settings?.streamOutput ?? true,
      reasoningEffort: b.settings?.reasoningEffort ?? '',
      enableWebSearch: false,
      enableThought: false
    },
    createdAt: now,
    updatedAt: now
  }
  // Every assistant starts with one default topic, exactly like the original.
  const topic = {
    id: nanoid(),
    assistantId: id,
    name: '默认话题',
    messages: [],
    createdAt: now,
    updatedAt: now
  }
  insertRow('topics', topic)
  assistant.topics = [topic.id]
  insertRow('assistants', assistant)
  res.json(hydrateAssistant(assistant))
}))

chatDataRouter.put('/assistants/:id', wrap((req, res) => {
  const a = findRow('assistants', req.params.id)
  if (!a) return res.status(404).json({ error: '智能助手不存在' })
  validateBindings(req.body)
  if (req.body.mcpGrants?.length && !isLocalMcpRequest(req)) return res.status(403).json({error:'MCP 授权仅能在服务端本机配置'})
  if (req.body.name !== undefined && (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 80)) return res.status(400).json({ error: '名称须为 1–80 个字符' })
  const patch = Object.fromEntries(Object.entries(req.body).filter(([key]) => ['name', 'prompt', 'emoji', 'description', 'group', 'pinned', 'model', 'settings', 'knowledgeBaseIds', 'mcpGrants'].includes(key)))
  if (patch.name) patch.name = patch.name.trim()
  const next = { ...a, ...patch, id: a.id, updatedAt: Date.now() }
  if (req.body.settings) next.settings = { ...a.settings, ...req.body.settings }
  upsertRow('assistants', next)
  res.json(hydrateAssistant(next))
}))

chatDataRouter.post('/assistants/:id/copy', wrap((req, res) => {
  const a = findRow('assistants', req.params.id)
  if (!a) return res.status(404).json({ error: '智能助手不存在' })
  const copy = { ...a, mcpGrants: [], id: nanoid(), name: `${a.name} (副本)`, topics: [], createdAt: Date.now(), updatedAt: Date.now() }
  const topic = { id: nanoid(), assistantId: copy.id, name: '默认话题', messages: [], createdAt: Date.now(), updatedAt: Date.now() }
  insertRow('topics', topic)
  copy.topics = [topic.id]
  insertRow('assistants', copy)
  res.json(hydrateAssistant(copy))
}))

chatDataRouter.delete('/assistants/:id', wrap((req, res) => {
  const a = findRow('assistants', req.params.id)
  if (!a) return res.status(404).json({ error: '智能助手不存在' })
  deleteRow('assistants', req.params.id)
  const topicIds = (a.topics || []).concat(table('topics').filter((t) => t.assistantId === a.id).map((t) => t.id))
  deleteWhere('topics', (t) => topicIds.includes(t.id))
  deleteWhere('messages', (m) => topicIds.includes(m.topicId))
  res.json({ ok: true })
}))

/* ------------------------------------------------------------------ topics */

chatDataRouter.get('/assistants/:id/topics', (req, res) => {
  const rows = table('topics')
    .filter((t) => t.assistantId === req.params.id)
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
  res.json(rows)
})

chatDataRouter.post('/topics', wrap((req, res) => {
  const b = req.body || {}
  const a = findRow('assistants', b.assistantId)
  if (!a) return res.status(404).json({ error: '智能助手不存在' })
  const now = Date.now()
  const topic = {
    id: b.id || nanoid(),
    assistantId: a.id,
    name: b.name || '新话题',
    prompt: b.prompt || '',
    messages: [],
    createdAt: now,
    updatedAt: now
  }
  insertRow('topics', topic)
  a.topics = [...new Set([...(a.topics || []), topic.id])]
  a.updatedAt = now
  upsertRow('assistants', a)
  res.json(topic)
}))

chatDataRouter.put('/topics/:id', wrap((req, res) => {
  const t = findRow('topics', req.params.id)
  if (!t) return res.status(404).json({ error: '话题不存在' })
  const next = { ...t, ...req.body, id: t.id, updatedAt: Date.now() }
  upsertRow('topics', next)
  res.json(next)
}))

chatDataRouter.delete('/topics/:id', wrap((req, res) => {
  const t = findRow('topics', req.params.id)
  if (!t) return res.status(404).json({ error: '话题不存在' })
  deleteRow('topics', req.params.id)
  deleteWhere('messages', (m) => m.topicId === req.params.id)
  const a = findRow('assistants', t.assistantId)
  if (a) {
    a.topics = (a.topics || []).filter((id) => id !== req.params.id)
    upsertRow('assistants', a)
  }
  res.json({ ok: true })
}))

/** 清除上下文 — keeps the topic, drops its messages (adds a system divider). */
chatDataRouter.post('/topics/:id/clear', wrap((req, res) => {
  const t = findRow('topics', req.params.id)
  if (!t) return res.status(404).json({ error: '话题不存在' })
  deleteWhere('messages', (m) => m.topicId === req.params.id)
  const divider = {
    id: nanoid(),
    role: 'system',
    type: 'clear',
    content: '',
    assistantId: t.assistantId,
    topicId: t.id,
    status: 'success',
    createdAt: Date.now()
  }
  insertRow('messages', divider)
  t.messages = [divider.id]
  t.updatedAt = Date.now()
  upsertRow('topics', t)
  res.json({ ok: true, message: divider })
}))

/* ---------------------------------------------------------------- messages */

chatDataRouter.get('/topics/:id/messages', (req, res) => {
  const rows = table('messages')
    .filter((m) => m.topicId === req.params.id)
    .sort((a, b) => a.createdAt - b.createdAt)
  res.json(rows)
})

chatDataRouter.post('/messages', wrap((req, res) => {
  const b = req.body || {}
  const t = findRow('topics', b.topicId)
  if (!t) return res.status(404).json({ error: '话题不存在' })
  const now = Date.now()
  const message = {
    id: b.id || nanoid(),
    role: b.role || 'user',
    type: b.type || 'text',
    content: b.content ?? '',
    reasoningContent: b.reasoningContent ?? '',
    assistantId: b.assistantId || t.assistantId,
    topicId: t.id,
    providerId: b.providerId || undefined,
    modelId: b.modelId || undefined,
    modelName: b.modelName || undefined,
    files: b.files || [],
    status: b.status || 'success',
    error: b.error || undefined,
    usage: b.usage || undefined,
    metrics: b.metrics || undefined,
    groupId: b.groupId || undefined,
    groupIndex: b.groupIndex ?? undefined,
    multiModelIds: b.multiModelIds || undefined,
    createdAt: b.createdAt || now,
    updatedAt: now
  }
  insertRow('messages', message)
  t.messages = [...(t.messages || []), message.id]
  t.updatedAt = now
  upsertRow('topics', t)
  res.json(message)
}))

chatDataRouter.put('/messages/:id', wrap((req, res) => {
  const m = findRow('messages', req.params.id)
  if (!m) return res.status(404).json({ error: '消息不存在' })
  const next = { ...m, ...req.body, id: m.id, updatedAt: Date.now() }
  upsertRow('messages', next)
  const t = findRow('topics', m.topicId)
  if (t) {
    t.updatedAt = Date.now()
    upsertRow('topics', t)
  }
  res.json(next)
}))

chatDataRouter.delete('/messages/:id', wrap((req, res) => {
  const m = findRow('messages', req.params.id)
  if (!m) return res.status(404).json({ error: '消息不存在' })
  // Deleting one message of a multi-model group removes the whole group.
  const ids = m.groupId ? table('messages').filter((x) => x.groupId === m.groupId).map((x) => x.id) : [m.id]
  deleteWhere('messages', (x) => ids.includes(x.id))
  const t = findRow('topics', m.topicId)
  if (t) {
    t.messages = (t.messages || []).filter((id) => !ids.includes(id))
    upsertRow('topics', t)
  }
  res.json({ ok: true, deleted: ids })
}))

/** Delete an assistant answer plus the user turn that produced it (like 删除 in the original). */
chatDataRouter.delete('/topics/:id/messages', wrap((req, res) => {
  deleteWhere('messages', (m) => m.topicId === req.params.id)
  const t = findRow('topics', req.params.id)
  if (t) {
    t.messages = []
    upsertRow('topics', t)
  }
  res.json({ ok: true })
}))

/** 自动重命名话题 — uses the configured model to summarise the first exchange. */
chatDataRouter.post('/topics/:id/rename', wrap(async (req, res) => {
  const t = findRow('topics', req.params.id)
  if (!t) return res.status(404).json({ error: '话题不存在' })
  const name = String(req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: '名称不能为空' })
  t.name = name.slice(0, 60)
  t.updatedAt = Date.now()
  upsertRow('topics', t)
  saveNow()
  res.json(t)
}))
