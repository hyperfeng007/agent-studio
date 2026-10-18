import express from 'express'
import { findRow, table } from '../store.js'
import { getProvider, withRotatedKey } from '../services/providers.js'
import { streamChat } from '../llm/index.js'
import { EMITTERS, sseHead } from './emitters.js'
import { normalizeTools, normalizeToolChoice, argsToString, syntheticCallId } from '../llm/tools.js'

export const gatewayRouter = express.Router()
gatewayRouter.use(express.json({ limit: '50mb' }))

/* ------------------------------------------------------------- lookups */

function configFor(id) {
  return findRow('codecli', id) || table('codecli').find((c) => c.gatewayId === id) || null
}

function resolveTarget(cfg, requestedModel) {
  const provider = getProvider(cfg?.providerId)
  if (!provider) return null
  const configured = cfg?.modelId
  const inbound = requestedModel && provider.models.find((m) => m.id === requestedModel)
  const modelId = inbound?.id || configured || provider.models[0]?.id
  if (!modelId) return null
  return { provider: withRotatedKey(provider), modelId, model: provider.models.find((m) => m.id === modelId) || { id: modelId } }
}

/* ------------------------------------------------------------- parsers */

export function fromAnthropic(body) {
  const messages = []
  const system = body.system
  if (typeof system === 'string' && system) messages.push({ role: 'system', content: system })
  else if (Array.isArray(system)) messages.push({ role: 'system', content: system.map((s) => ({ type: 'text', text: s.text || '' })) })

  for (const m of body.messages || []) {
    if (typeof m.content === 'string') {
      messages.push({ role: m.role, content: m.content })
      continue
    }
    const parts = []
    const toolCalls = []
    const pendingToolResults = []
    for (const block of m.content || []) {
      if (block.type === 'text') parts.push({ type: 'text', text: block.text })
      else if (block.type === 'image' && block.source?.type === 'base64') {
        parts.push({ type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } })
      } else if (block.type === 'image' && block.source?.url) {
        parts.push({ type: 'image_url', image_url: { url: block.source.url } })
      } else if (block.type === 'tool_use') {
        // assistant 的工具调用：保留 id / name / input，下游会转成上游协议的形态
        toolCalls.push({ id: block.id || syntheticCallId('toolu'), type: 'function', function: { name: block.name, arguments: argsToString(block.input) } })
      } else if (block.type === 'tool_result') {
        // 工具结果在 Anthropic 里是 user 消息的块，这里拆成 OpenAI 风格的 role:'tool' 消息
        const content = typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? block.content.map((c) => c?.text || '').join('') : JSON.stringify(block.content ?? '')
        pendingToolResults.push({ role: 'tool', tool_call_id: block.tool_use_id || '', content, ...(block.is_error ? { is_error: true } : {}) })
      }
      // thinking / redacted_thinking blocks are dropped on the way in
    }
    const msg = { role: m.role, content: parts.length ? parts : '' }
    if (toolCalls.length) msg.tool_calls = toolCalls
    messages.push(msg)
    messages.push(...pendingToolResults)
  }
  return {
    messages,
    tools: normalizeTools(body.tools, 'anthropic'),
    toolChoice: normalizeToolChoice(body.tool_choice, 'anthropic'),
    stream: body.stream !== false,
    params: {
      temperature: body.temperature,
      topP: body.top_p,
      maxTokens: body.max_tokens,
      reasoningEffort: body.thinking?.type === 'enabled' ? 'medium' : undefined
    }
  }
}

export function fromOpenAI(body) {
  return {
    // OpenAI 形态就是规范形：assistant.tool_calls 与 role:'tool' 原样透传
    messages: body.messages || [],
    tools: normalizeTools(body.tools, 'openai'),
    toolChoice: normalizeToolChoice(body.tool_choice, 'openai'),
    stream: body.stream !== false,
    params: {
      temperature: body.temperature,
      topP: body.top_p,
      maxTokens: body.max_tokens || body.max_completion_tokens,
      reasoningEffort: body.reasoning_effort,
      responseFormat: body.response_format?.type === 'json_object' ? 'json' : undefined
    }
  }
}

export function fromResponses(body) {
  const messages = []
  if (body.instructions) messages.push({ role: 'system', content: body.instructions })
  const input = body.input
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input })
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === 'string') {
        messages.push({ role: 'user', content: item })
        continue
      }
      if (item.type === 'function_call') {
        // Codex 会把上一轮的工具调用作为 input item 回传
        messages.push({ role: 'assistant', content: '', tool_calls: [{ id: item.call_id || item.id || syntheticCallId('call'), type: 'function', function: { name: item.name, arguments: argsToString(item.arguments) } }] })
        continue
      }
      if (item.type === 'function_call_output') {
        messages.push({ role: 'tool', tool_call_id: item.call_id || '', content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '') })
        continue
      }
      const role = item.role || (item.type === 'item.completed' ? 'assistant' : 'user')
      let content = item.content
      if (item.type === 'message' && Array.isArray(item.content)) content = item.content
      if (typeof content === 'string') messages.push({ role, content })
      else if (Array.isArray(content)) {
        messages.push({
          role,
          content: content.map((p) => {
            if (p.type === 'input_text' || p.type === 'output_text' || p.type === 'text') return { type: 'text', text: p.text }
            if (p.type === 'input_image') return { type: 'image_url', image_url: { url: p.image_url || p.url } }
            return { type: 'text', text: JSON.stringify(p) }
          })
        })
      }
    }
  }
  return {
    messages,
    tools: normalizeTools(body.tools, 'responses'),
    toolChoice: normalizeToolChoice(body.tool_choice, 'responses'),
    stream: body.stream !== false,
    params: { maxTokens: body.max_output_tokens, reasoningEffort: body.reasoning?.effort, temperature: body.temperature }
  }
}

export function fromGemini(body, requestedModel) {
  const messages = []
  const si = body.systemInstruction || body.system_instruction
  if (si) {
    const parts = Array.isArray(si.parts) ? si.parts : [si.parts]
    messages.push({ role: 'system', content: parts.map((p) => p?.text || '').join('\n') })
  }
  for (const c of body.contents || []) {
    const calls = []
    const results = []
    const role = c.role === 'model' ? 'assistant' : 'user'
    const parts = []
    for (const p of c.parts || []) {
      const fc = p.functionCall || p.function_call
      const fr = p.functionResponse || p.function_response
      if (fc?.name) {
        // Gemini 不给调用 id，合成一个；回传结果时靠 name 关联（normalizeMessages 会补 id）
        calls.push({ id: fc.id || syntheticCallId('gemini'), type: 'function', function: { name: fc.name, arguments: argsToString(fc.args ?? fc.arguments) } })
      } else if (fr?.name) {
        results.push({ role: 'tool', tool_call_id: fr.id || '', name: fr.name, content: JSON.stringify(fr.response ?? fr.result ?? {}) })
      } else if (p.text != null) parts.push({ type: 'text', text: p.text })
      else if (p.inline_data || p.inlineData) {
        const d = p.inline_data || p.inlineData
        parts.push({ type: 'image_url', image_url: { url: `data:${d.mime_type || d.mimeType};base64,${d.data}` } })
      }
    }
    if (parts.length || calls.length) messages.push({ role, content: parts, ...(calls.length ? {tool_calls: calls} : {}) })
    messages.push(...results)
  }
  const gc = body.generationConfig || body.generation_config || {}
  return {
    messages,
    tools: normalizeTools(body.tools, 'gemini'),
    toolChoice: normalizeToolChoice(body.toolConfig || body.tool_config, 'gemini'),
    model: requestedModel,
    stream: true,
    params: { temperature: gc.temperature, topP: gc.topP ?? gc.top_p, maxTokens: gc.maxOutputTokens ?? gc.max_output_tokens }
  }
}

/* ------------------------------------------------------------- runner */

async function runGateway(req, res, { iface, gid, parsed, requestedModel }) {
  const cfg = configFor(gid)
  if (!cfg) return res.status(404).json({ error: { message: `gateway ${gid} not found` } })
  const target = resolveTarget(cfg, requestedModel || parsed.model)
  if (!target) return res.status(400).json({ error: { message: 'gateway 未配置服务商或模型' } })

  const emitterFactory = EMITTERS[iface] || EMITTERS.openai
  const isStream = parsed.stream
  if (!isStream) res.setHeader('Content-Type', 'application/json; charset=utf-8')
  else sseHead(res)

  const emitter = emitterFactory(res, target.modelId, { stream: isStream })
  const controller = new AbortController()
  res.on('close', () => controller.abort())

  let upstreamFinish = null
  let hadToolCall = false

  emitter.start()
  try {
    await streamChat({
      provider: target.provider,
      providerType: target.provider.type,
      model: target.model,
      modelId: target.modelId,
      messages: parsed.messages,
      // 工具定义与工具结果：agent CLI 的核心链路，缺了它模型只能把调用写成文本
      tools: parsed.tools || [],
      toolChoice: parsed.toolChoice,
      params: parsed.params || {},
      signal: controller.signal,
      emit: (e) => {
        switch (e.type) {
          case 'delta':
            emitter.text(e.text)
            break
          case 'reasoning':
            emitter.reasoning(e.text)
            break
          case 'tool_call':
            hadToolCall = true
            emitter.toolCall?.(e.index ?? 0, e.id, e.name)
            break
          case 'tool_call_args':
            emitter.toolCallArgs?.(e.index ?? 0, e.text || '')
            break
          case 'finish_reason':
            upstreamFinish = e.value
            break
          case 'usage':
            emitter.usage(e.usage)
            break
          case 'provider_error':
            emitter.error(e.message)
            break
          default:
            break
        }
      }
    })
    emitter.end(finishReasonFor(iface, upstreamFinish, hadToolCall))
  } catch (err) {
    emitter.error(err.message || 'gateway error')
    emitter.end(finishReasonFor(iface, upstreamFinish, hadToolCall))
  }
}

/**
 * 把上游的结束原因翻译成当前方言能认的值。
 * 有工具调用时必须给出「要调工具」的结束原因（OpenAI `tool_calls` / Anthropic `tool_use`），
 * 否则 CLI 会把这一轮当成普通回答，工具永远不会被执行。
 */
function finishReasonFor(iface, upstream, hadToolCall) {
  const up = String(upstream || '')
  if (iface === 'anthropic') {
    if (hadToolCall || up === 'tool_calls' || up === 'tool_use') return 'tool_use'
    if (/^(length|max_tokens|MAX_TOKENS)$/.test(up)) return 'max_tokens'
    return undefined // emitter 默认 end_turn
  }
  if (iface === 'openai') {
    if (hadToolCall || up === 'tool_calls' || up === 'tool_use') return 'tool_calls'
    if (/^(length|max_tokens|MAX_TOKENS)$/.test(up)) return 'length'
    if (/^(content_filter|SAFETY)$/.test(up)) return 'content_filter'
    return 'stop'
  }
  return undefined // gemini（finishReason 由 emitter 固定给 STOP）/ responses（不需要）
}

/* -------------------------------------------------------------- routes */

// Anthropic dialect
gatewayRouter.post('/anthropic/:gid/v1/messages', (req, res) =>
  runGateway(req, res, { iface: 'anthropic', gid: req.params.gid, parsed: fromAnthropic(req.body || {}) })
)
gatewayRouter.get('/anthropic/:gid/v1/models', (req, res) => {
  const cfg = configFor(req.params.gid)
  const t = cfg ? resolveTarget(cfg) : null
  const ids = t ? [t.modelId] : []
  if (cfg?.smallModelId) ids.push(cfg.smallModelId)
  res.json({ data: ids.map((id) => ({ type: 'model', id, display_name: id, created_at: Date.now() })), has_more: false })
})

// OpenAI chat completions dialect
gatewayRouter.post('/openai/:gid/v1/chat/completions', (req, res) =>
  runGateway(req, res, { iface: 'openai', gid: req.params.gid, parsed: fromOpenAI(req.body || {}) })
)
gatewayRouter.post('/openai/:gid/chat/completions', (req, res) =>
  runGateway(req, res, { iface: 'openai', gid: req.params.gid, parsed: fromOpenAI(req.body || {}) })
)
gatewayRouter.get('/openai/:gid/v1/models', (req, res) => {
  const cfg = configFor(req.params.gid)
  const t = cfg ? resolveTarget(cfg) : null
  res.json({ object: 'list', data: t ? [{ id: t.modelId, object: 'model', owned_by: t.provider.id }] : [] })
})

// OpenAI Responses dialect
gatewayRouter.post('/openai-response/:gid/v1/responses', (req, res) =>
  runGateway(req, res, { iface: 'openai-response', gid: req.params.gid, parsed: fromResponses(req.body || {}) })
)
gatewayRouter.post('/openai-response/:gid/responses', (req, res) =>
  runGateway(req, res, { iface: 'openai-response', gid: req.params.gid, parsed: fromResponses(req.body || {}) })
)

// Gemini dialect (path looks like /v1beta/models/gemini-2.5-pro:streamGenerateContent)
gatewayRouter.all('/gemini/:gid/v1beta/models/*', (req, res) => {
  const tail = req.params[0] || ''
  const [modelPart, action] = tail.split(':')
  const requestedModel = decodeURIComponent(modelPart)
  if (req.method === 'GET' && !action) {
    const cfg = configFor(req.params.gid)
    const t = cfg ? resolveTarget(cfg, requestedModel) : null
    return res.json({ models: t ? [{ name: `models/${t.modelId}`, displayName: t.modelId, supportedGenerationMethods: ['generateContent'] }] : [] })
  }
  const parsed = fromGemini(req.body || {}, requestedModel)
  parsed.stream = action?.includes('stream') !== false
  return runGateway(req, res, { iface: 'gemini', gid: req.params.gid, parsed, requestedModel })
})

gatewayRouter.get('/:iface/:gid/health', (req, res) => {
  const cfg = configFor(req.params.gid)
  const t = cfg ? resolveTarget(cfg) : null
  res.json({ ok: !!t, iface: req.params.iface, provider: t?.provider?.name, model: t?.modelId })
})
