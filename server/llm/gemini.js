import { SSEParser, readResponseText, extractError, parseJsonResponse } from './sse.js'
import { splitSystem, inlineImages, normalizeMessages } from './message.js'
import { toGeminiTools, toGeminiToolConfig, argsToObject, argsToString, syntheticCallId } from './tools.js'
import { ApiError } from './openai.js'
import { llmFetch } from './net.js'

function host(p) {
  return String(p.apiHost).replace(/\/+$/, '')
}

/** Gemini 的 functionResponse.response 必须是对象。 */
function toFunctionResponsePayload(text) {
  const t = String(text ?? '')
  try {
    const parsed = JSON.parse(t)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    return { result: parsed }
  } catch {
    return { result: t }
  }
}

/**
 * 规范化消息 → Gemini contents。
 * 模型的工具调用是 model 回合里的 `functionCall` part（args 是对象），
 * 工具结果是 user 回合里的 `functionResponse` part（只带 name，不带 id）。
 */
async function toGeminiContents(messages) {
  const contents = []
  for (const m of normalizeMessages(messages)) {
    if (m.role === 'tool') {
      const part = { function_response: { name: m.name || 'tool', response: toFunctionResponsePayload(m.text) } }
      const last = contents[contents.length - 1]
      if (last && last.role === 'user' && last.parts.length && last.parts.every((p) => p.function_response)) last.parts.push(part)
      else contents.push({ role: 'user', parts: [part] })
      continue
    }
    const parts = []
    if (m.text) parts.push({ text: m.text })
    for (const img of await inlineImages(m.images)) {
      parts.push({ inline_data: { mime_type: img.mediaType, data: img.data } })
    }
    for (const c of m.toolCalls || []) parts.push({ function_call: { name: c.name, args: argsToObject(c.arguments) } })
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: parts.length ? parts : [{ text: '' }] })
  }
  return contents
}

export async function streamGemini(ctx) {
  const { provider, model, params, signal } = ctx
  const { systemText, messages } = splitSystem(ctx.messages)
  const generationConfig = {}
  if (params.temperature != null) generationConfig.temperature = params.temperature
  if (params.topP != null) generationConfig.topP = params.topP
  if (params.maxTokens) generationConfig.maxOutputTokens = params.maxTokens
  if (params.responseFormat === 'json') generationConfig.responseMimeType = 'application/json'
  if (params.thinkingBudget != null) generationConfig.thinkingConfig = { thinkingBudget: params.thinkingBudget }

  const body = { contents: await toGeminiContents(messages), generationConfig }
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] }
  if (ctx.tools?.length) {
    body.tools = toGeminiTools(ctx.tools)
    const tc = toGeminiToolConfig(ctx.toolChoice)
    if (tc) body.toolConfig = tc
  }

  const key = provider.apiKey ? `&key=${encodeURIComponent(provider.apiKey)}` : ''
  const url = `${host(provider)}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse${key}`
  const headers = { 'Content-Type': 'application/json' }
  if (provider.customHeaders) Object.assign(headers, provider.customHeaders)

  const res = await llmFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
  if (!res.ok) throw new ApiError(extractError(await res.text(), res.status), res.status)

  let toolOrdinal = 0
  let sawFunctionCall = false

  const parser = new SSEParser((payload) => {
    let json
    try {
      json = JSON.parse(payload)
    } catch {
      return
    }
    if (json.error) {
      ctx.emit({ type: 'provider_error', message: json.error.message || 'Gemini stream error' })
      return
    }
    const candidate = json.candidates?.[0]
    for (const part of candidate?.content?.parts || []) {
      const fc = part.functionCall || part.function_call
      if (fc?.name) {
        // Gemini 的 functionCall 是一次性给全的（args 是对象），也没有调用 id —— 合成一个，
        // 下一轮请求里 functionResponse 靠 name 关联（normalizeMessages 会回填 id）。
        const ordinal = toolOrdinal++
        sawFunctionCall = true
        ctx.emit({ type: 'tool_call', index: ordinal, id: fc.id || syntheticCallId('gemini'), name: fc.name })
        ctx.emit({ type: 'tool_call_args', index: ordinal, text: argsToString(fc.args ?? fc.arguments) })
        continue
      }
      if (!part.text) continue
      if (part.thought) ctx.emit({ type: 'reasoning', text: part.text })
      else ctx.emit({ type: 'delta', text: part.text })
    }
    if (candidate?.finishReason) {
      // Gemini 调工具时 finishReason 仍是 STOP，这里翻译成规范值，网关才能给出正确的结束原因
      ctx.emit({
        type: 'finish_reason',
        value: sawFunctionCall && candidate.finishReason === 'STOP' ? 'tool_calls' : candidate.finishReason
      })
    }
    if (json.usageMetadata) {
      ctx.emit({
        type: 'usage',
        usage: {
          input_tokens: json.usageMetadata.promptTokenCount,
          output_tokens: json.usageMetadata.candidatesTokenCount,
          total_tokens: json.usageMetadata.totalTokenCount,
          cache_read_tokens: json.usageMetadata.cachedContentTokenCount
        }
      })
    }
  })

  for await (const chunk of readResponseText(res)) parser.feed(chunk)
  parser.end()
}

export async function listModelsGemini(provider) {
  const key = provider.apiKey ? `?key=${encodeURIComponent(provider.apiKey)}` : ''
  const res = await llmFetch(`${host(provider)}/v1beta/models${key}`, { headers: { 'Content-Type': 'application/json' } })
  if (!res.ok) throw new ApiError(extractError(await res.text(), res.status), res.status)
  const json = await parseJsonResponse(res)
  return (json.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({
      id: String(m.name || '').replace(/^models\//, ''),
      name: m.displayName || String(m.name || '').replace(/^models\//, ''),
      description: m.description,
      contextLength: m.inputTokenLimit,
      maxTokens: m.outputTokenLimit,
      capabilities: ['text']
    }))
}
