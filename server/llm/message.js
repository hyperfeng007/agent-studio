/** Shared helpers to normalise chat message content across provider protocols. */

import { llmFetch } from './net.js'
import { argsToString, syntheticCallId } from './tools.js'
export function splitDataUrl(url) {
  if (typeof url !== 'string') return null
  const m = url.match(/^data:([^;,]+)(;base64)?,(.*)$/s)
  if (!m) return null
  return { mediaType: m[1], base64: m[2] === ';base64', data: m[3] }
}

/**
 * Turn any supported content shape into { text, images }.
 * images entries are { url } for remote refs or { mediaType, data } for base64.
 */
export function partsOf(content) {
  if (content == null) return { text: '', images: [], toolCalls: [], toolResults: [] }
  if (typeof content === 'string') return { text: content, images: [], toolCalls: [], toolResults: [] }
  let text = ''
  const images = []
  const toolCalls = []
  const toolResults = []
  for (const part of Array.isArray(content) ? content : [content]) {
    if (!part) continue
    const type = part.type
    if (type === 'text' || type === 'input_text' || type === 'output_text') {
      text += part.text || ''
    } else if (type === 'image_url') {
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url
      if (!url) continue
      const du = splitDataUrl(url)
      images.push(du && du.base64 ? { mediaType: du.mediaType, data: du.data } : { url })
    } else if (type === 'input_image') {
      const url = part.image_url || part.url
      if (!url) continue
      const du = splitDataUrl(url)
      images.push(du && du.base64 ? { mediaType: du.mediaType, data: du.data } : { url })
    } else if (type === 'image') {
      // Anthropic style block
      if (part.source?.type === 'base64') images.push({ mediaType: part.source.media_type, data: part.source.data })
      else if (part.source?.url) images.push({ url: part.source.url })
    } else if (type === 'thinking' || type === 'redacted_thinking') {
      // 入站的推理块不参与转发（上游会自己重新生成）
    } else if (type === 'tool_use' || part.functionCall || part.function_call) {
      // Anthropic 的 tool_use 块 / Gemini 的 functionCall part → 规范化的工具调用
      const fc = part.function_call || part.functionCall
      toolCalls.push({
        id: part.id || fc?.id || syntheticCallId('call'),
        name: part.name || fc?.name || '',
        arguments: argsToString(part.input ?? fc?.args ?? fc?.arguments)
      })
    } else if (type === 'tool_result' || part.function_response || part.functionResponse) {
      // Anthropic 的 tool_result 块 / Gemini 的 functionResponse part → 规范化的工具结果
      const fr = part.function_response || part.functionResponse
      const content = part.content ?? fr?.response ?? fr?.output ?? ''
      toolResults.push({
        toolCallId: part.tool_use_id || fr?.id || '',
        name: part.name || fr?.name || '',
        content: typeof content === 'string' ? content : JSON.stringify(content),
        isError: !!part.is_error
      })
    } else if (typeof part === 'string') {
      text += part
    }
  }
  return { text, images, toolCalls, toolResults }
}

/**
 * 把任意方言的消息数组规范化成中立形态，供四个适配器各自转成上游协议：
 *
 *   { role: 'system'|'user'|'assistant'|'tool',
 *     text, images[],
 *     toolCalls?: [{ id, name, arguments }],      // assistant
 *     toolCallId?, name?, isError? }               // role === 'tool'
 *
 * 关键点：Anthropic 把工具结果塞在 user 消息的 content 块里，Gemini 塞在 parts 里，
 * 而 OpenAI 用独立的 role:'tool' 消息。这里统一拆成 role:'tool'，顺序保持在文本之后。
 */
export function normalizeMessages(messages) {
  const out = []
  for (const m of messages || []) {
    if (!m) continue
    const role = m.role === 'model' ? 'assistant' : m.role === 'function' ? 'tool' : m.role
    const { text, images, toolCalls, toolResults } = partsOf(m.content)

    // OpenAI 形态：assistant.tool_calls 在消息级
    const msgCalls = Array.isArray(m.tool_calls) || Array.isArray(m.toolCalls) ? m.tool_calls || m.toolCalls : null
    const calls = msgCalls
      ? msgCalls.map((c) => ({
          id: c.id || c.call_id || syntheticCallId('call'),
          name: c.function?.name || c.name || '',
          arguments: argsToString(c.function?.arguments ?? c.arguments)
        }))
      : toolCalls

    if (role === 'tool') {
      out.push({
        role: 'tool',
        text: text || (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')),
        images: [],
        toolCallId: m.tool_call_id || m.toolCallId || toolResults[0]?.toolCallId || '',
        name: m.name || toolResults[0]?.name || '',
        isError: !!m.is_error || !!toolResults[0]?.isError
      })
      continue
    }

    out.push({ role, text, images, ...(calls.length ? { toolCalls: calls } : {}) })

    // user 消息里夹带的工具结果（Anthropic / Gemini）拆成独立的 tool 消息
    for (const r of toolResults) {
      out.push({ role: 'tool', text: r.content, images: [], toolCallId: r.toolCallId, name: r.name, isError: r.isError })
    }
  }

  // 回填缺失的 id / name：Gemini 的 functionResponse 只有 name，OpenAI 的 role:'tool' 只有 id，
  // 而 Anthropic 必须有 tool_use_id、OpenAI 必须有 tool_call_id —— 用会话里 assistant 的
  // tool_calls 作为权威映射补齐。
  const idToName = new Map()
  const pending = []
  for (const m of out) {
    for (const c of m.toolCalls || []) {
      idToName.set(c.id, c.name)
      pending.push(c)
    }
    if (m.role !== 'tool') continue
    if (!m.toolCallId && m.name) {
      const index = pending.findIndex(c => c.name === m.name)
      if (index < 0) throw new Error(`工具结果 ${m.name} 找不到对应调用`)
      m.toolCallId = pending.splice(index, 1)[0].id
    } else {
      const index = pending.findIndex(c => c.id === m.toolCallId)
      if (index >= 0) pending.splice(index, 1)
    }
    if (!m.name) m.name = idToName.get(m.toolCallId) || ''
  }

  // Anthropic/Gemini 的工具结果是包在 user 消息里的，拆完之后那条 user 消息可能什么都不剩；
  // 空消息发给上游有的服务商会直接 400，这里丢掉。
  return out.filter((m) => m.role === 'tool' || m.text || m.images.length || (m.toolCalls && m.toolCalls.length))
}

/** Extract the system prompt (Cherry Studio keeps it on the assistant, sent first). */
export function splitSystem(messages) {
  const system = []
  const rest = []
  for (const m of messages || []) {
    if (m.role === 'system' || m.role === 'developer') system.push(partsOf(m.content).text)
    else rest.push(m)
  }
  return { systemText: system.filter(Boolean).join('\n\n'), messages: rest }
}

export async function fetchBuffer(url) {
  const res = await llmFetch(url)
  if (!res.ok) throw new Error(`下载图片失败 HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const type = res.headers.get('content-type') || 'image/png'
  return { mediaType: type.split(';')[0], data: buf.toString('base64') }
}

/** Ensure every image is base64 (Anthropic/Gemini only accept inline data). */
export async function inlineImages(images) {
  const out = []
  for (const img of images) {
    if (img.data) out.push(img)
    else if (img.url) out.push(await fetchBuffer(img.url))
  }
  return out
}
