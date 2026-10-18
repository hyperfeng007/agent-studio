import { SSEParser, readResponseText, extractError, parseJsonResponse } from './sse.js'
import { splitSystem, inlineImages, normalizeMessages } from './message.js'
import { toAnthropicTools, toAnthropicToolChoice, argsToObject } from './tools.js'
import { ApiError } from './openai.js'
import { llmFetch } from './net.js'

function host(p) {
  return String(p.apiHost).replace(/\/+$/, '')
}

function headers(provider) {
  const h = {
    'Content-Type': 'application/json',
    'anthropic-version': provider.anthropicVersion || '2023-06-01'
  }
  if (provider.apiKey) {
    // Relays commonly accept the bearer form; Anthropic's own API wants x-api-key.
    if (/anthropic\.com$/.test(new URL(host(provider)).hostname) || provider.useXApiKey) {
      h['x-api-key'] = provider.apiKey
    } else {
      h.Authorization = `Bearer ${provider.apiKey}`
      h['x-api-key'] = provider.apiKey
    }
  }
  if (provider.customHeaders) Object.assign(h, provider.customHeaders)
  return h
}

/**
 * 规范化消息 → Anthropic messages。
 * Anthropic 的规矩：工具调用是 assistant 消息里的 `tool_use` 块（input 必须是**对象**），
 * 工具结果必须放在紧随其后的 **user** 消息里，用 `tool_result` 块并带上 `tool_use_id`。
 * 多个结果要合并进同一条 user 消息。
 */
async function toAnthropicMessages(messages) {
  const out = []
  for (const m of normalizeMessages(messages)) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.text || '' }
      if (m.isError) block.is_error = true
      const last = out[out.length - 1]
      if (last && last.role === 'user' && Array.isArray(last.content) && last.content.every((c) => c.type === 'tool_result')) {
        last.content.push(block)
      } else {
        out.push({ role: 'user', content: [block] })
      }
      continue
    }
    const role = m.role === 'system' ? 'user' : m.role
    const content = []
    if (m.images.length) {
      for (const img of await inlineImages(m.images)) {
        content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })
      }
    }
    if (m.text) content.push({ type: 'text', text: m.text })
    for (const c of m.toolCalls || []) {
      content.push({ type: 'tool_use', id: c.id, name: c.name, input: argsToObject(c.arguments) })
    }
    out.push({ role, content: content.length ? content : [{ type: 'text', text: '' }] })
  }
  return out
}

export async function streamAnthropic(ctx) {
  const { provider, model, params, signal } = ctx
  const { systemText, messages } = splitSystem(ctx.messages)
  const body = {
    model,
    max_tokens: params.maxTokens || 8192,
    stream: true,
    messages: await toAnthropicMessages(messages)
  }
  if (systemText) body.system = systemText
  if (ctx.tools?.length) {
    body.tools = toAnthropicTools(ctx.tools)
    const tc = toAnthropicToolChoice(ctx.toolChoice)
    // 开了 extended thinking 时 Anthropic 只接受 auto（或省略）：any/tool 会直接 400
    if (tc && (!body.thinking || tc.type === 'auto')) body.tool_choice = tc
  }
  if (params.temperature != null) body.temperature = params.temperature
  if (params.topP != null) body.top_p = params.topP
  if (params.reasoningEffort && params.reasoningEffort !== 'none') {
    const budget = { low: 4000, medium: 10000, high: 24000 }[params.reasoningEffort] || 10000
    body.thinking = { type: 'enabled', budget_tokens: Math.min(budget, (params.maxTokens || 8192) - 1) }
    delete body.temperature
  }

  if (body.thinking && body.tool_choice?.type !== 'auto') delete body.tool_choice

  const url = `${host(provider)}/v1/messages`
  const res = await llmFetch(url, { method: 'POST', headers: headers(provider), body: JSON.stringify(body), signal })
  if (!res.ok) throw new ApiError(extractError(await res.text(), res.status), res.status)

  // content_block index → 工具调用序号（一个回复里可能同时有 text / thinking / 多个 tool_use 块）
  const toolBlocks = new Map()
  let toolOrdinal = 0

  const parser = new SSEParser((payload) => {
    let json
    try {
      json = JSON.parse(payload)
    } catch {
      return
    }
    switch (json.type) {
      case 'message_start':
        if (json.message?.usage) {
          ctx.emit({
            type: 'usage',
            usage: {
              input_tokens: json.message.usage.input_tokens,
              cache_read_tokens: json.message.usage.cache_read_input_tokens,
              cache_creation_tokens: json.message.usage.cache_creation_input_tokens
            }
          })
        }
        break
      case 'content_block_start':
        // 工具调用块：先拿到 id 与 name，参数随后由 input_json_delta 分片送来
        if (json.content_block?.type === 'tool_use') {
          toolBlocks.set(json.index, toolOrdinal++)
          ctx.emit({ type: 'tool_call', index: toolBlocks.get(json.index), id: json.content_block.id || '', name: json.content_block.name || '' })
        }
        break
      case 'content_block_delta':
        if (json.delta?.type === 'text_delta') ctx.emit({ type: 'delta', text: json.delta.text })
        else if (json.delta?.type === 'thinking_delta') ctx.emit({ type: 'reasoning', text: json.delta.thinking })
        else if (json.delta?.type === 'input_json_delta') {
          // 以前这里被当成普通文本转发，于是工具参数的 JSON 直接显示在对话里
          const ordinal = toolBlocks.has(json.index) ? toolBlocks.get(json.index) : 0
          ctx.emit({ type: 'tool_call_args', index: ordinal, text: json.delta.partial_json || '' })
        }
        break
      case 'message_delta':
        if (json.usage?.output_tokens) ctx.emit({ type: 'usage', usage: { output_tokens: json.usage.output_tokens } })
        if (json.delta?.stop_reason) ctx.emit({ type: 'finish_reason', value: json.delta.stop_reason })
        break
      case 'error':
        ctx.emit({ type: 'provider_error', message: json.error?.message || 'Anthropic stream error' })
        break
      default:
        break
    }
  })

  for await (const chunk of readResponseText(res)) parser.feed(chunk)
  parser.end()
}

export async function listModelsAnthropic(provider) {
  const res = await llmFetch(`${host(provider)}/v1/models?limit=100`, { headers: headers(provider) })
  if (!res.ok) throw new ApiError(extractError(await res.text(), res.status), res.status)
  const json = await parseJsonResponse(res)
  return (json.data || []).map((m) => ({
    id: m.id,
    name: m.display_name || m.id,
    contextLength: m.context_window,
    capabilities: ['text']
  }))
}
