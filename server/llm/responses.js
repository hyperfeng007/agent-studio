import { SSEParser, readResponseText, extractError, parseJsonResponse } from './sse.js'
import { splitSystem, inlineImages, normalizeMessages } from './message.js'
import { toResponsesTools, syntheticCallId } from './tools.js'
import { ApiError } from './openai.js'
import { llmFetch } from './net.js'

/**
 * OpenAI Responses API adapter (used by providers flagged `openai-response`,
 * e.g. ChatGPT-backed Codex or the /v1/responses endpoint).
 */
export async function streamResponses(ctx) {
  const { provider, model, params, signal } = ctx
  const { systemText, messages } = splitSystem(ctx.messages)

  // Responses API 的形态：消息是 input 里的 item，工具调用是 `function_call` item，
  // 工具结果是 `function_call_output` item（靠 call_id 关联）。
  const input = []
  for (const m of normalizeMessages(messages)) {
    if (m.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: m.toolCallId, output: m.text || '' })
      continue
    }
    for (const c of m.toolCalls || []) {
      input.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: c.arguments })
    }
    if (!m.text && !m.images.length) continue
    const content = [{ type: 'input_text', text: m.text }]
    if (m.images.length) {
      for (const img of await inlineImages(m.images)) {
        content.push({ type: 'input_image', image_url: `data:${img.mediaType};base64,${img.data}`, detail: 'auto' })
      }
    }
    input.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content })
  }

  const host = String(provider.apiHost).replace(/\/+$/, '')
  const url = /\/v\d+$/.test(host) ? `${host}/responses` : `${host}/v1/responses`
  const body = { model, input, stream: true }
  if (systemText) body.instructions = systemText
  if (params.maxTokens) body.max_output_tokens = params.maxTokens
  if (params.reasoningEffort && params.reasoningEffort !== 'none') {
    body.reasoning = { effort: params.reasoningEffort }
  }
  if (params.temperature != null && !body.reasoning) body.temperature = params.temperature
  if (ctx.tools?.length) {
    body.tools = toResponsesTools(ctx.tools)
    if (ctx.toolChoice === 'required') body.tool_choice = 'required'
    else if (ctx.toolChoice === 'none') body.tool_choice = 'none'
    else if (ctx.toolChoice === 'auto') body.tool_choice = 'auto'
    else if (typeof ctx.toolChoice === 'object' && ctx.toolChoice?.name) {
      body.tool_choice = { type: 'function', name: ctx.toolChoice.name }
    }
  }

  const headers = { 'Content-Type': 'application/json' }
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`
  if (provider.customHeaders) Object.assign(headers, provider.customHeaders)

  const res = await llmFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
  if (!res.ok) throw new ApiError(extractError(await res.text(), res.status), res.status)

  const callIds = new Map()
  const sawArgs = new Set()
  let toolOrdinal = 0
  let sawToolCall = false

  const parser = new SSEParser((payload) => {
    let json
    try {
      json = JSON.parse(payload)
    } catch {
      return
    }
    switch (json.type) {
      case 'response.output_text.delta':
        ctx.emit({ type: 'delta', text: json.delta || '' })
        break
      case 'response.output_item.added':
        // 工具调用 item：call_id + name 在这里给出，参数走 function_call_arguments.delta
        if (json.item?.type === 'function_call') {
          const ordinal = toolOrdinal++
          callIds.set(json.output_index ?? ordinal, ordinal)
          ctx.emit({
            type: 'tool_call',
            index: ordinal,
            id: json.item.call_id || json.item.id || syntheticCallId('call'),
            name: json.item.name || ''
          })
        }
        break
      case 'response.function_call_arguments.delta': {
        const ordinal = callIds.get(json.output_index ?? json.item_id) ?? callIds.get(json.item_id) ?? 0
        sawArgs.add(json.output_index)
        ctx.emit({ type: 'tool_call_args', index: ordinal, text: json.delta || '' })
        break
      }
      case 'response.output_item.done':
        // 有些实现不发 arguments.delta，只在 done 里给完整参数
        if (json.item?.type === 'function_call' && json.item.arguments && !sawArgs.has(json.output_index)) {
          const ordinal = callIds.get(json.output_index) ?? 0
          ctx.emit({ type: 'tool_call_args', index: ordinal, text: json.item.arguments })
        }
        if (json.item?.type === 'function_call') sawToolCall = true
        break
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        ctx.emit({ type: 'reasoning', text: json.delta || '' })
        break
      case 'response.completed':
      case 'response.incomplete': {
        const u = json.response?.usage
        if (u) {
          ctx.emit({
            type: 'usage',
            usage: {
              input_tokens: u.input_tokens,
              output_tokens: u.output_tokens,
              total_tokens: u.total_tokens,
              cache_read_tokens: u.input_tokens_details?.cached_tokens
            }
          })
        }
        // 有 function_call item 时，结束原因是「要调工具」，不是普通的 stop
        const hasCalls = sawToolCall || (json.response?.output || []).some((o) => o?.type === 'function_call')
        ctx.emit({ type: 'finish_reason', value: hasCalls ? 'tool_calls' : json.response?.status || 'stop' })
        break
      }
      case 'response.failed':
      case 'error':
        ctx.emit({ type: 'provider_error', message: json.message || json.error?.message || 'Responses stream error' })
        break
      default:
        break
    }
  })

  for await (const chunk of readResponseText(res)) parser.feed(chunk)
  parser.end()
}

export async function listModelsResponses(provider) {
  const host = String(provider.apiHost).replace(/\/+$/, '')
  const url = /\/v\d+$/.test(host) ? `${host}/models` : `${host}/v1/models`
  const headers = { 'Content-Type': 'application/json' }
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`
  const res = await llmFetch(url, { headers })
  if (!res.ok) throw new ApiError(extractError(await res.text(), res.status), res.status)
  const json = await parseJsonResponse(res)
  return (json.data || []).map((m) => ({ id: m.id, name: m.id, owned_by: m.owned_by, capabilities: ['text'] }))
}
