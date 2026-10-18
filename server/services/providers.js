import { PROVIDERS, builtinProvider } from '../config/providers.js'
import { openCodeAuth } from './openCodeAuth.js'
import { table, findRow, upsertRow, deleteRow, getSettings, updateSettings } from '../store.js'

/**
 * Provider resolution follows the same layering Cherry Studio uses:
 *   built-in registry  ->  user overrides stored locally (apiKey/host/enabled/models)
 *   + fully custom providers created through 设置 → 模型服务 → 添加
 */
export function effectiveProviders() {
  const overrides = table('providers')
  const byId = new Map(overrides.map((o) => [o.id, o]))

  const list = []
  for (const builtin of PROVIDERS) {
    const o = byId.get(builtin.id) || {}
    list.push(mergeProvider(builtin, o))
    byId.delete(builtin.id)
  }
  for (const custom of byId.values()) {
    if (custom.isCustom) list.push(mergeProvider(null, custom))
  }

  // Pin enabled providers first, then keep registry order (same as the settings list).
  return list.sort((a, b) => Number(b.enabled) - Number(a.enabled))
}

/** 出厂即启用的服务商（其余需要用户自己填 Key 后开启）。 */
const DEFAULT_ENABLED = new Set(['opencode-free'])

/**
 * API Key resolution chain for `keyChain` providers (currently opencode-free):
 *   1. Key typed in 设置 → 模型服务            (source: 'user')
 *   2. Local OpenCode CLI login (auth.json)   (source: 'opencode-cli')
 *   3. No key at all — let the provider answer (source: 'none')
 */
function resolveApiKey(base, override) {
  const own = override.apiKey ?? ''
  if (own || base.keyChain !== 'opencode-cli') return { apiKey: own, keySource: own ? 'user' : 'none' }
  const reused = openCodeAuth()
  return reused.key
    ? { apiKey: reused.key, keySource: 'opencode-cli', keyFile: reused.file }
    : { apiKey: '', keySource: 'none' }
}

function mergeProvider(builtin, override) {
  const base = builtin || {}
  const models = override.models && override.models.length ? override.models : (base.models || [])
  const { apiKey, keySource, keyFile } = resolveApiKey(base, override)
  return {
    id: base.id || override.id,
    name: override.name || base.name || override.id,
    type: override.type || base.type || 'openai',
    apiHost: override.apiHost || base.apiHost || '',
    apiKey,
    apiKeys: override.apiKeys || [],
    basicAuthUsername: override.basicAuthUsername || base.basicAuthUsername || '',
    basicAuthPassword: override.basicAuthPassword || '',
    apiVersion: override.apiVersion || base.apiVersion || '',
    customHeaders: override.customHeaders || base.customHeaders || null,
    website: base.website || override.website || '',
    docs: base.docs || override.docs || '',
    apiKeyUrl: base.apiKeyUrl || override.apiKeyUrl || '',
    searchUrl: base.searchUrl || override.searchUrl || '',
    isSystem: !!base.id,
    isCustom: !base.id,
    enabled: override.enabled ?? DEFAULT_ENABLED.has(base.id),
    models: models.map((m) => ({ provider: base.id || override.id, status: 1, capabilities: ['text'], ...m })),
    note: base.note || override.note || '',
    keyOptional: !!base.keyOptional,
    keyChain: base.keyChain || '',
    keySource,
    keyFile: keyFile || '',
    checkViaChat: !!base.checkViaChat
  }
}

export function getProvider(id) {
  if (!id) return null
  const builtin = builtinProvider(id)
  const override = findRow('providers', id)
  if (!builtin && !override) return null
  return mergeProvider(builtin, override || {})
}

export function saveProviderOverride(id, patch) {
  const existing = findRow('providers', id) || { id }
  const next = { ...existing, ...patch, id }
  upsertRow('providers', next)
  return getProvider(id)
}

export function createCustomProvider(data) {
  const id = data.id || `custom-${Date.now().toString(36)}`
  if (findRow('providers', id) || builtinProvider(id)) {
    throw Object.assign(new Error('服务商 ID 已存在'), { status: 409 })
  }
  const record = {
    id,
    isCustom: true,
    name: data.name || id,
    type: data.type || 'openai',
    apiHost: data.apiHost || '',
    apiKey: data.apiKey || '',
    enabled: data.enabled ?? true,
    models: data.models || []
  }
  upsertRow('providers', record)
  return getProvider(id)
}

export function removeProvider(id) {
  if (builtinProvider(id)) {
    // Built-in providers cannot be deleted, only reset (same as the original).
    const override = findRow('providers', id)
    if (override) deleteRow('providers', id)
    return getProvider(id)
  }
  deleteRow('providers', id)
  return null
}

/** Enabled providers that have at least one usable model — feeds the chat model picker. */
export function availableModels() {
  const out = []
  for (const p of effectiveProviders()) {
    if (!p.enabled) continue
    for (const m of p.models) {
      if (m.status === 3) continue
      if ((m.capabilities || []).includes('embedding')) continue
      if ((m.capabilities || []).includes('rerank')) continue
      out.push({ ...m, provider: p.id, providerName: p.name, providerType: p.type })
    }
  }
  return out
}

/**
 * 多密钥轮询 — Cherry Studio lets a provider hold several API keys and rotates
 * them per request to spread rate limits. Rotation state lives in memory.
 */
const rotationCursor = new Map()

export function withRotatedKey(provider) {
  const keys = (provider.apiKeys || []).map((k) => (typeof k === 'string' ? k : k?.value)).filter(Boolean)
  if (keys.length <= 1) {
    return keys.length === 1 ? { ...provider, apiKey: keys[0] } : provider
  }
  const idx = rotationCursor.get(provider.id) || 0
  rotationCursor.set(provider.id, (idx + 1) % keys.length)
  return { ...provider, apiKey: keys[idx], activeKeyIndex: idx }
}

export function findModel(providerId, modelId) {
  const p = getProvider(providerId)
  if (!p) return null
  const m = p.models.find((x) => x.id === modelId)
  return m ? { ...m, provider: p.id } : null
}

export function defaultModel() {
  const settings = getSettings()
  if (settings.defaultModel) {
    const p = getProvider(settings.defaultModel.providerId)
    if (p?.enabled) {
      const m = p.models.find((x) => x.id === settings.defaultModel.modelId)
      if (m) return { providerId: p.id, modelId: m.id }
    }
  }
  const models = availableModels()
  if (models.length) return { providerId: models[0].provider, modelId: models[0].id }
  return null
}

export function setDefaultModel(providerId, modelId) {
  return updateSettings({ defaultModel: providerId && modelId ? { providerId, modelId } : null })
}
