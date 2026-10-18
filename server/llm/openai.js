import { SSEParser, readResponseText, extractError, parseJsonResponse } from './sse.js'
import { splitSystem, inlineImages, normalizeMessages } from './message.js'
import { toOpenAITools } from './tools.js'

export { ApiError } from './errors.js'
import { ApiError } from './errors.js'
import { llmFetch } from './net.js'

function joinUrl(host, p) {
  return `${String(host).replace(/\/+$/, '')}${p}`
}

/**
 * Turn a non-2xx into an actionable message.
 *
 * OpenCode Zen (`opencode-free`) gates its free tier: anonymous callers get
 * HTTP 403 "OpenCode's free tier can only be used from within OpenCode" on the
 * `-free` models (verified live 2026-09), and a stale model answers 400
 * "Upstream request failed: Model is unavailable." A bare "403 Forbidden" tells
 * the user nothing, so map both to the three ways out.
 */
function httpError(provider, res, text) {
  const raw = extractError(text, res.status)
  if (provider?.id === 'opencode-free') {
    const gated = res.status === 401 || res.status === 403 || /free tier/i.test(raw)
    const down = /model is unavailable/i.test(raw) || res.status === 500
    if (gated || down) {
      const reason = gated ? `免费层拒绝了本次调用（HTTP ${res.status}）` : `该模型上游当前不可用（HTTP ${res.status}）`
      return new ApiError(
        `OpenCode Zen：${reason}。可以这样解决：` +
          '① 到 https://opencode.ai/auth 免费注册并把 Zen API Key 填进「设置 → 模型服务 → OpenCode Zen」；' +
          '② 本机装过 OpenCode CLI 的话，运行一次 opencode auth login，Agent Studio 会自动复用它的凭据；' +
          '③ 换一个模型（免费层里 big-pickle / mimo-v2.5-free / nemotron-3-ultra-free 较稳），或到设置里开启「本地演示 (Mock)」离线试用。' +
          `原始返回：${raw}`,
        res.status
      )
    }
  }
  return new ApiError(raw, res.status)
}

function authHeaders(provider) {
  if (provider.type === 'azure') {
    return { 'api-key': provider.apiKey || '', 'Content-Type': 'application/json' }
  }
  const headers = { 'Content-Type': 'application/json' }
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`
  if (provider.basicAuthUsername) {
    const token = Buffer.from(`${provider.basicAuthUsername}:${provider.basicAuthPassword || ''}`).toString('base64')
    headers.Authorization = `Basic ${token}`
  }
  if (provider.customHeaders) Object.assign(headers, provider.customHeaders)
  return headers
}

function completionsUrl(provider, model) {
  const host = provider.apiHost
  if (provider.type === 'azure') {
    const version = provider.apiVersion || '2025-04-01-preview'
    return joinUrl(host, `/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=${version}`)
  }
  // Most OpenAI-compatible gateways expose /chat/completions under the host as
  // configured (some already end with /v1, some do not) — normalise both.
  const h = String(host).replace(/\/+$/, '')
  return /\/v\d+$/.test(h) ? `${h}/chat/completions` : `${h}/v1/chat/completions`
}

export /**
 * 规范化消息 → OpenAI chat 消息。
 * 工具调用是 agent CLI 的命脉：assistant.tool_calls 与 role:'tool'（工具执行结果）
 * 必须原样带上去，否则模型看不到自己上一步调用了什么、也拿不到执行结果，
 * agent 循环就断了（表现为"模型把工具调用当普通文本写出来"）。
 */
async function toOpenAIMessages(messages) {
  const out = []
  const calls = (m) => m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } }))
  for (const m of normalizeMessages(messages)) {
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.text || '' })
      continue
    }
    if (!m.images.length) {
      const msg = { role: m.role, content: m.text || (m.toolCalls?.length ? null : '') }
      if (m.toolCalls?.length) msg.tool_calls = calls(m)
      out.push(msg)
      continue
    }
    const inlined = await inlineImages(m.images)
    const content = [{ type: 'text', text: m.text }]
    for (const img of inlined) {
      content.push({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.data}` } })
    }
    const msg = { role: m.role, content }
    if (m.toolCalls?.length) msg.tool_calls = calls(m)
    out.push(msg)
  }
  return out
}

export function toOpenAIToolChoice(choice) {
  if (choice === 'auto' || choice === 'none' || choice === 'required') return choice
  if (typeof choice === 'object' && choice?.name) return { type: 'function', function: { name: choice.name } }
  return undefined
}

export function buildOpenAIBody({ provider, model, messages, systemText, params, tools, toolChoice }) {
  const body = { model, messages, stream: true }
  if (tools?.length) {
    body.tools = toOpenAITools(tools)
    const tc = toOpenAIToolChoice(toolChoice)
    if (tc) body.tool_choice = tc
  }
  if (!provider.noStreamOptions) body.stream_options = { include_usage: true }
  if (params.temperature != null) body.temperature = params.temperature
  if (params.topP != null) body.top_p = params.topP
  if (params.maxTokens) body.max_tokens = params.maxTokens
  if (params.frequencyPenalty != null) body.frequency_penalty = params.frequencyPenalty
  if (params.reasoningEffort && params.reasoningEffort !== 'none') body.reasoning_effort = params.reasoningEffort
  if (params.enableThinking === false) body.enable_thinking = false
  if (params.responseFormat === 'json') body.response_format = { type: 'json_object' }
  return body
}

/**
 * OpenAI-compatible streaming chat completion (also used for Azure, Ollama,
 * LM Studio, DeepSeek, SiliconFlow, ... — anything speaking /v1/chat/completions).
 */
export async function streamOpenAI(ctx) {
  const { provider, model, params, signal } = ctx
  const { systemText, messages } = splitSystem(ctx.messages)
  const normalized = await toOpenAIMessages(messages)
  if (systemText) normalized.unshift({ role: 'system', content: systemText })

  const res = await llmFetch(completionsUrl(provider, model), {
    method: 'POST',
    headers: authHeaders(provider),
    body: JSON.stringify(
      buildOpenAIBody({ provider, model, messages: normalized, systemText, params, tools: ctx.tools, toolChoice: ctx.toolChoice })
    ),
    signal
  })

  if (!res.ok) throw httpError(provider, res, await res.text())

  const parser = new SSEParser((payload) => {
    if (payload.trim() === '[DONE]') return
    let json
    try {
      json = JSON.parse(payload)
    } catch {
      return
    }
    const choice = json.choices?.[0]
    const delta = choice?.delta || {}
    if (delta.reasoning_content) ctx.emit({ type: 'reasoning', text: delta.reasoning_content })
    if (delta.content) ctx.emit({ type: 'delta', text: delta.content })
    // 工具调用：arguments 是分片流式到达的，按 index 原样转发给网关
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const index = typeof tc.index === 'number' ? tc.index : 0
        if (tc.id || tc.function?.name) ctx.emit({ type: 'tool_call', index, id: tc.id || '', name: tc.function?.name || '' })
        const frag = tc.function?.arguments
        if (frag) ctx.emit({ type: 'tool_call_args', index, text: frag })
      }
    }
    if (choice?.finish_reason) ctx.emit({ type: 'finish_reason', value: choice.finish_reason })
    if (json.usage) {
      ctx.emit({
        type: 'usage',
        usage: {
          input_tokens: json.usage.prompt_tokens,
          output_tokens: json.usage.completion_tokens,
          total_tokens: json.usage.total_tokens,
          cache_read_tokens: json.usage.prompt_tokens_details?.cached_tokens
        }
      })
    }
  })

  for await (const chunk of readResponseText(res)) parser.feed(chunk)
  parser.end()
}

export async function listModelsOpenAI(provider) {
  const host = String(provider.apiHost).replace(/\/+$/, '')
  let url
  if (provider.type === 'azure') {
    url = joinUrl(host, `/openai/models?api-version=${provider.apiVersion || '2025-04-01-preview'}`)
  } else {
    url = /\/v\d+$/.test(host) ? `${host}/models` : `${host}/v1/models`
  }
  const res = await llmFetch(url, { headers: authHeaders(provider) })
  if (!res.ok) throw httpError(provider, res, await res.text())
  const json = await parseJsonResponse(res)
  const rows = json.data || json.models || json.result || []
  return rows.map((m) => ({
    id: m.id || m.name || m.model,
    name: m.id || m.name || m.model,
    owned_by: m.owned_by,
    contextLength: m.context_length || m.context_window,
    capabilities: m.capabilities || ['text']
  }))
}
