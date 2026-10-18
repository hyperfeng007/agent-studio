import { streamOpenAI, listModelsOpenAI, ApiError } from './openai.js'
import { streamAnthropic, listModelsAnthropic } from './anthropic.js'
import { streamGemini, listModelsGemini } from './gemini.js'
import { streamResponses, listModelsResponses } from './responses.js'
import { streamMock, listModelsMock } from './mock.js'
import { normalizeTools, normalizeToolChoice } from './tools.js'

/** 猜一下传进来的工具定义是哪种方言的形状（网关已经解析过，这里只为直接调用者兜底）。 */
function detectToolDialect(tools) {
  if (tools.some((t) => t?.functionDeclarations || t?.function_declarations)) return 'gemini'
  if (tools.some((t) => t?.input_schema || t?.inputSchema)) return 'anthropic'
  if (tools.some((t) => t?.function)) return 'openai'
  return 'responses' // { name, description, parameters } —— 规范形与 Responses 的形状一致
}

export { ApiError }

const STREAMERS = {
  openai: streamOpenAI,
  azure: streamOpenAI,
  ollama: streamOpenAI,
  'openai-response': streamResponses,
  anthropic: streamAnthropic,
  gemini: streamGemini,
  mock: streamMock
}

const LISTERS = {
  openai: listModelsOpenAI,
  azure: listModelsOpenAI,
  ollama: listModelsOpenAI,
  'openai-response': listModelsResponses,
  anthropic: listModelsAnthropic,
  gemini: listModelsGemini,
  mock: listModelsMock
}

function adapterType(provider) {
  if (provider.id === 'mock' || provider.apiHost === 'builtin://mock') return 'mock'
  return STREAMERS[provider.type] ? provider.type : 'openai'
}

/**
 * Unified streaming entry point.
 * ctx: { provider, model, modelId, messages, params, signal, emit }
 * `emit` receives normalised events:
 *   { type: 'delta', text } | { type: 'reasoning', text }
 *   { type: 'usage', usage } | { type: 'finish_reason', value }
 *   { type: 'provider_error', message }
 */
export async function streamChat(ctx) {
  const type = adapterType(ctx.provider)
  const streamer = STREAMERS[type] || streamOpenAI

  // Wire protocols need `model` as a plain string: OpenAI / Anthropic /
  // Responses put it in the JSON body, Gemini in the URL. Callers pass either a
  // string id or the whole model record (设置 → 模型服务 stores records), so
  // normalise once here — sending the record upstream makes strict providers
  // answer HTTP 400 "model: invalid type: map, expected a string".
  const modelRecord = ctx.model && typeof ctx.model === 'object' ? ctx.model : null
  const modelId =
    (typeof ctx.model === 'string' && ctx.model.trim()) || ctx.modelId || modelRecord?.id || ''
  const modelInfo = modelRecord || ctx.modelInfo || { id: modelId }
  if (!modelId) throw Object.assign(new Error('缺少模型 ID，请在「设置 → 模型服务」或智能助手上选择一个模型'), { status: 400 })

  // 工具定义可能是任意方言的形状（网关已按方言解析，这里再做一次防御性规范化：
  // 直接调 streamChat 的地方，比如脚本与测试，可以随手塞 OpenAI / Anthropic 形态）
  const rawTools = ctx.tools || []
  const tools = rawTools.length ? normalizeTools(rawTools, detectToolDialect(rawTools)) : []

  ctx.provider = { ...ctx.provider, type: type === 'mock' ? 'openai' : ctx.provider.type }
  return streamer({
    ...ctx,
    model: modelId,
    modelId,
    modelInfo,
    providerType: ctx.provider.type,
    tools,
    toolChoice: normalizeToolChoice(ctx.toolChoice, 'openai') ?? ctx.toolChoice
  })
}

/** Fetch the provider's model catalogue (设置 → 模型服务 → 管理). */
export async function fetchProviderModels(provider) {
  const type = adapterType(provider)
  const lister = LISTERS[type] || listModelsOpenAI
  const models = await lister(provider)
  return models.filter((m) => m && m.id)
}

/**
 * 检查 (check) — verify credentials/host.
 * Tries the cheap /models endpoint first and falls back to a 1-token completion.
 */
export async function checkProvider(provider, modelId) {
  const started = Date.now()
  // `checkViaChat` providers must not be judged by GET /models: OpenCode Zen
  // answers that endpoint without a key while the actual chat call is gated,
  // which would report "✓ 连通" for a channel that cannot answer anything.
  try {
    if (provider.checkViaChat) throw Object.assign(new Error('skip /models probe'), { skipModels: true })
    const models = await fetchProviderModels(provider)
    return { valid: true, modelCount: models.length, latencyMs: Date.now() - started, models }
  } catch (err) {
    if (!err.skipModels && !modelId) return { valid: false, error: err.message, latencyMs: Date.now() - started }
    if (!modelId) {
      // No model selected: fall back to the provider's first text model.
      modelId = (provider.models || []).find((m) => !(m.capabilities || []).includes('embedding'))?.id || ''
      if (!modelId) return { valid: false, error: err.message, latencyMs: Date.now() - started }
    }
  }
  // Fallback: smallest possible completion through the streaming path.
  try {
    let got = false
    await streamChat({
      provider,
      model: { id: modelId, capabilities: ['text'] },
      modelId,
      messages: [{ role: 'user', content: 'ping' }],
      params: { maxTokens: 1 },
      emit: (e) => {
        if (e.type === 'delta' || e.type === 'usage' || e.type === 'finish_reason') got = true
        if (e.type === 'provider_error') throw new ApiError(e.message)
      }
    })
    return { valid: got, latencyMs: Date.now() - started, modelCount: got ? 1 : 0 }
  } catch (err) {
    return { valid: false, error: err.message, latencyMs: Date.now() - started }
  }
}
