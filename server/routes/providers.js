import express from 'express'
import { PROVIDER_TYPES, CAPABILITIES } from '../config/providers.js'
import {
  effectiveProviders,
  getProvider,
  saveProviderOverride,
  createCustomProvider,
  removeProvider,
  availableModels,
  withRotatedKey
} from '../services/providers.js'
import { checkProvider, fetchProviderModels } from '../llm/index.js'

export const providersRouter = express.Router()
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(e.status || 500).json({ error: e.message }))

providersRouter.get('/types', (req, res) => res.json(PROVIDER_TYPES))
providersRouter.get('/capabilities', (req, res) => res.json(CAPABILITIES))

/**
 * A key borrowed from the local OpenCode CLI must not be shipped to the browser
 * (the UI only needs to know *that* one was found and *where* it came from), so
 * strip it on the way out — the server still uses the real value when calling.
 */
const KEYLESS_LOCAL = new Set(['mock', 'ollama', 'lmstudio'])
const redact = (p) => (p && p.keySource === 'opencode-cli' ? { ...p, apiKey: '' } : p)

providersRouter.get('/', (req, res) => res.json(effectiveProviders().map(redact)))

providersRouter.get('/models', (req, res) => res.json(availableModels()))

providersRouter.post('/', wrap((req, res) => res.json(createCustomProvider(req.body || {}))))

providersRouter.get('/:id', wrap((req, res) => {
  const p = getProvider(req.params.id)
  if (!p) return res.status(404).json({ error: '服务商不存在' })
  res.json(redact(p))
}))

/** Patch a provider: apiKey / apiHost / enabled / name / models ... */
providersRouter.put('/:id', wrap((req, res) => {
  const p = getProvider(req.params.id)
  if (!p) return res.status(404).json({ error: '服务商不存在' })
  res.json(saveProviderOverride(req.params.id, req.body || {}))
}))

providersRouter.delete('/:id', wrap((req, res) => {
  res.json({ provider: removeProvider(req.params.id) })
}))

/** 检查 — connectivity + credential check shown as 连接成功/失败 in the UI. */
providersRouter.post('/:id/check', wrap(async (req, res) => {
  const p = getProvider(req.params.id)
  if (!p) return res.status(404).json({ error: '服务商不存在' })
  if (!p.apiHost) return res.json({ valid: false, error: '请先填写 API 地址' })
  if (!p.apiKey && !p.keyOptional && !KEYLESS_LOCAL.has(p.id)) {
    return res.json({ valid: false, error: '请先填写 API 密钥' })
  }
  const probe = withRotatedKey(p)
  const result = await checkProvider(probe, req.body?.modelId || p.models[0]?.id)
  res.json(result)
}))

/** 管理 → 获取模型列表 (fetch from the provider). */
providersRouter.post('/:id/models/fetch', wrap(async (req, res) => {
  const p = getProvider(req.params.id)
  if (!p) return res.status(404).json({ error: '服务商不存在' })
  if (!p.apiHost) return res.status(400).json({ error: '请先填写 API 地址' })
  const probe = withRotatedKey(p)
  const models = await fetchProviderModels(probe)
  res.json({ models, count: models.length })
}))

/** 管理 → 保存勾选后的模型清单（含能力标记）。 */
providersRouter.put('/:id/models', wrap((req, res) => {
  const p = getProvider(req.params.id)
  if (!p) return res.status(404).json({ error: '服务商不存在' })
  const models = Array.isArray(req.body?.models) ? req.body.models : []
  const clean = models.map((m) => ({
    id: String(m.id),
    name: m.name || m.id,
    group: m.group || '',
    owned_by: m.owned_by || '',
    description: m.description || '',
    contextLength: m.contextLength,
    maxTokens: m.maxTokens,
    pricing: m.pricing,
    capabilities: Array.isArray(m.capabilities) ? m.capabilities : ['text'],
    status: m.status ?? 1
  }))
  res.json(saveProviderOverride(req.params.id, { models: clean }))
}))

/** 添加自定义模型。 */
providersRouter.post('/:id/models', wrap((req, res) => {
  const p = getProvider(req.params.id)
  if (!p) return res.status(404).json({ error: '服务商不存在' })
  const id = String(req.body?.id || '').trim()
  if (!id) return res.status(400).json({ error: '模型 ID 不能为空' })
  if (p.models.some((m) => m.id === id)) return res.status(409).json({ error: '模型已存在' })
  const model = {
    id,
    name: req.body.name || id,
    group: req.body.group || '',
    capabilities: Array.isArray(req.body.capabilities) ? req.body.capabilities : ['text'],
    contextLength: req.body.contextLength,
    maxTokens: req.body.maxTokens,
    status: 1
  }
  res.json(saveProviderOverride(req.params.id, { models: [...p.models, model] }))
}))

providersRouter.put('/:id/models/:modelId', wrap((req, res) => {
  const p = getProvider(req.params.id)
  if (!p) return res.status(404).json({ error: '服务商不存在' })
  const idx = p.models.findIndex((m) => m.id === req.params.modelId)
  if (idx < 0) return res.status(404).json({ error: '模型不存在' })
  const models = [...p.models]
  models[idx] = { ...models[idx], ...req.body, id: models[idx].id }
  res.json(saveProviderOverride(req.params.id, { models }))
}))

providersRouter.delete('/:id/models/:modelId', wrap((req, res) => {
  const p = getProvider(req.params.id)
  if (!p) return res.status(404).json({ error: '服务商不存在' })
  res.json(saveProviderOverride(req.params.id, { models: p.models.filter((m) => m.id !== req.params.modelId) }))
}))
