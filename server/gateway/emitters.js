import { randomUUID } from 'node:crypto'
import { argsToObject } from '../llm/tools.js'

/**
 * Protocol emitters for the unified gateway (统一网关).
 *
 * A CLI always speaks its own dialect. The gateway translates whatever
 * provider/model the user configured back into that dialect, so Claude Code can
 * run against DeepSeek, Codex against Gemini, etc. Each emitter exposes the
 * same surface: start(), text(), reasoning(), toolCall(), toolCallArgs(), usage(), error(), end().
 */

function write(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`)
}

function writeEvent(res, event, obj) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`)
}

export function sseHead(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  res.flushHeaders?.()
}

/* ------------------------------------------------------------ Anthropic */

export function anthropicEmitter(res, model, { stream = true } = {}) {
  const id = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`
  let blockIndex = -1
  let openKind = null
  const toolCalls = new Map() // 规范化 index → { ordinal, id, name, args, blockIndex }
  let toolOrdinal = 0
  let inputTokens = 0
  let outputTokens = 0
  let chunks = []

  const start = () => {
    if (!stream) return
    write(res, {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 0 }
      }
    })
    write(res, { type: 'ping' })
  }

  const openBlock = (kind) => {
    if (openKind === kind) return
    closeBlock()
    blockIndex++
    openKind = kind
    write(res, {
      type: 'content_block_start',
      index: blockIndex,
      content_block: kind === 'thinking' ? { type: 'thinking', thinking: '' } : { type: 'text', text: '' }
    })
  }

  /** 工具调用块：Anthropic 的参数以 input_json_delta 分片流式送出。 */
  const openToolBlock = (call) => {
    closeBlock()
    blockIndex++
    openKind = `tool:${call.ordinal}`
    call.blockIndex = blockIndex
    write(res, {
      type: 'content_block_start',
      index: blockIndex,
      content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} }
    })
  }

  const closeBlock = () => {
    if (openKind === null) return
    write(res, { type: 'content_block_stop', index: blockIndex })
    openKind = null
  }

  return {
    start,
    reasoning(text) {
      chunks.push({ kind: 'thinking', text })
      if (!stream) return
      openBlock('thinking')
      write(res, { type: 'content_block_delta', index: blockIndex, delta: { type: 'thinking_delta', thinking: text } })
    },
    text(text) {
      chunks.push({ kind: 'text', text })
      if (!stream) return
      openBlock('text')
      write(res, { type: 'content_block_delta', index: blockIndex, delta: { type: 'text_delta', text } })
    },
    toolCall(index, callId, name) {
      const prior = toolCalls.get(index)
      if (prior) { if (callId) prior.id = callId; if (name) prior.name += name; return }
      const call = { ordinal: toolOrdinal++, id: callId || `toolu_${randomUUID().replace(/-/g, '')}`, name, args: '' }
      toolCalls.set(index, call)
      chunks.push({ kind: 'tool_use', call })
    },
    toolCallArgs(index, text) {
      const call = toolCalls.get(index)
      if (call) call.args += text || ''
    },
    usage(u) {
      if (u.input_tokens) inputTokens = u.input_tokens
      if (u.output_tokens) outputTokens = u.output_tokens
    },
    error(message) {
      if (!stream) return
      write(res, { type: 'error', error: { type: 'api_error', message } })
    },
    end(stopReason) {
      const hasTools = toolCalls.size > 0
      // 有工具调用时结束原因必须是 tool_use，否则 Claude Code 会把参数 JSON 当成普通回答
      const reason = stopReason || (hasTools ? 'tool_use' : 'end_turn')
      if (!stream) {
        const content = []
        for (const c of chunks) {
          if (c.kind === 'tool_use') {
            content.push({ type: 'tool_use', id: c.call.id, name: c.call.name, input: argsToObject(c.call.args) })
            continue
          }
          const last = content[content.length - 1]
          if (last && last.type === (c.kind === 'thinking' ? 'thinking' : 'text')) {
            last[c.kind === 'thinking' ? 'thinking' : 'text'] += c.text
          } else {
            content.push(c.kind === 'thinking' ? { type: 'thinking', thinking: c.text } : { type: 'text', text: c.text })
          }
        }
        return res.json({
          id,
          type: 'message',
          role: 'assistant',
          model,
          content,
          stop_reason: reason,
          stop_sequence: null,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens }
        })
      }
      closeBlock()
      for (const call of toolCalls.values()) {
        openToolBlock(call)
        write(res, { type: 'content_block_delta', index: call.blockIndex, delta: { type: 'input_json_delta', partial_json: call.args || '{}' } })
        closeBlock()
      }
      write(res, { type: 'message_delta', delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: outputTokens } })
      write(res, { type: 'message_stop' })
      res.end()
    }
  }
}

/* --------------------------------------------------------------- OpenAI */

export function openaiEmitter(res, model, { stream = true } = {}) {
  const id = `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 24)}`
  const created = Math.floor(Date.now() / 1000)
  let started = false
  let usage = null
  let text = ''
  let reasoning = ''
  const toolCalls = new Map() // 规范化 index → { id, name, args }

  const chunk = (delta, finishReason = null) => ({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  })

  return {
    start() {
      if (!stream) return
      write(res, chunk({ role: 'assistant', content: '' }))
      started = true
    },
    reasoning(t) {
      reasoning += t
      if (!stream) return
      write(res, { ...chunk({ reasoning_content: t }), usage: undefined })
    },
    text(t) {
      text += t
      if (!stream) return
      write(res, chunk({ content: t }))
    },
    toolCall(index, callId, name) {
      toolCalls.set(index, { id: callId || `call_${randomUUID().replace(/-/g, '').slice(0, 20)}`, name, args: '' })
      if (!stream) return
      // 第一片带 id 与函数名，后续片只带 arguments 分片（OpenAI 的形态）
      write(res, chunk({ tool_calls: [{ index, id: toolCalls.get(index).id, type: 'function', function: { name, arguments: '' } }] }))
    },
    toolCallArgs(index, t) {
      const call = toolCalls.get(index)
      if (!call) return
      call.args += t || ''
      if (!stream) return
      write(res, chunk({ tool_calls: [{ index, function: { arguments: t || '' } }] }))
    },
    usage(u) {
      usage = u
    },
    error(message) {
      if (!stream) return
      write(res, { error: { message, type: 'gateway_error', code: null } })
    },
    end(finishReason) {
      const calls = [...toolCalls.entries()].sort((a, b) => a[0] - b[0])
      // 有工具调用时 finish_reason 必须是 tool_calls，否则 CLI 会认为这一轮只是普通回答
      const reason = finishReason || (calls.length ? 'tool_calls' : 'stop')
      const encoded = calls.map(([index, c]) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } }))
      if (!stream) {
        return res.json({
          id,
          object: 'chat.completion',
          created,
          model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: text || null,
                reasoning_content: reasoning || undefined,
                ...(encoded.length ? { tool_calls: encoded } : {})
              },
              finish_reason: reason
            }
          ],
          usage: usage
            ? {
                prompt_tokens: usage.input_tokens,
                completion_tokens: usage.output_tokens,
                total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
              }
            : undefined
        })
      }
      if (usage) write(res, { ...chunk({}, reason), usage: { prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens, total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0) } })
      else write(res, chunk({}, reason))
      res.write('data: [DONE]\n\n')
      res.end()
    }
  }
}

/* ----------------------------------------------- OpenAI Responses API */

export function responsesEmitter(res, model, { stream = true } = {}) {
  const id = `resp_${randomUUID().replace(/-/g, '').slice(0, 24)}`
  const itemId = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`
  const created = Math.floor(Date.now() / 1000)
  let text = ''
  let reasoning = ''
  let usage = null
  let seq = 0
  const next = () => seq++
  const toolCalls = new Map() // 规范化 index → { itemId, callId, name, args, outputIndex }

  const base = { response: { id, object: 'response', created_at: created, model, status: 'in_progress', output: [] } }

  return {
    start() {
      if (!stream) return
      writeEvent(res, 'response.created', { type: 'response.created', sequence_number: next(), ...base })
      writeEvent(res, 'response.in_progress', { type: 'response.in_progress', sequence_number: next(), ...base })
      writeEvent(res, 'response.output_item.added', {
        type: 'response.output_item.added',
        sequence_number: next(),
        output_index: 0,
        item: { id: itemId, type: 'message', role: 'assistant', status: 'in_progress', content: [] }
      })
      writeEvent(res, 'response.content_part.added', {
        type: 'response.content_part.added',
        sequence_number: next(),
        item_id: itemId,
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text', text: '' }
      })
    },
    reasoning(t) {
      reasoning += t
      if (!stream) return
      writeEvent(res, 'response.reasoning_summary_text.delta', { type: 'response.reasoning_summary_text.delta', sequence_number: next(), item_id: itemId, output_index: 0, summary_index: 0, delta: t })
    },
    text(t) {
      text += t
      if (!stream) return
      writeEvent(res, 'response.output_text.delta', {
        type: 'response.output_text.delta',
        sequence_number: next(),
        item_id: itemId,
        output_index: 0,
        content_index: 0,
        delta: t
      })
    },
    toolCall(index, callId, name) {
      // output_index 0 留给 message item（start() 里已经发出），工具调用依次排在其后
      const outputIndex = toolCalls.size + 1
      const call = {
        outputIndex,
        itemId: `fc_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        callId: callId || `call_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        name,
        args: ''
      }
      toolCalls.set(index, call)
      if (!stream) return
      writeEvent(res, 'response.output_item.added', {
        type: 'response.output_item.added',
        sequence_number: next(),
        output_index: outputIndex,
        item: { id: call.itemId, type: 'function_call', status: 'in_progress', call_id: call.callId, name, arguments: '' }
      })
    },
    toolCallArgs(index, t) {
      const call = toolCalls.get(index)
      if (!call) return
      call.args += t || ''
      if (!stream) return
      writeEvent(res, 'response.function_call_arguments.delta', {
        type: 'response.function_call_arguments.delta',
        sequence_number: next(),
        item_id: call.itemId,
        output_index: call.outputIndex,
        delta: t || ''
      })
    },
    usage(u) {
      usage = u
    },
    error(message) {
      if (!stream) return
      writeEvent(res, 'response.failed', { type: 'response.failed', sequence_number: next(), response: { ...base.response, status: 'failed', error: { message } } })
    },
    end() {
      const calls = [...toolCalls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c)
      const callItems = calls.map((c) => ({
        id: c.itemId,
        type: 'function_call',
        status: 'completed',
        call_id: c.callId,
        name: c.name,
        arguments: c.args || '{}'
      }))
      const out = {
        id,
        object: 'response',
        created_at: created,
        model,
        status: 'completed',
        output: [
          {
            id: itemId,
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text, annotations: [] }]
          },
          ...callItems
        ],
        usage: usage
          ? { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0) }
          : undefined
      }
      if (!stream) return res.json(out)
      writeEvent(res, 'response.output_text.done', { type: 'response.output_text.done', sequence_number: next(), item_id: itemId, output_index: 0, content_index: 0, text })
      writeEvent(res, 'response.content_part.done', { type: 'response.content_part.done', sequence_number: next(), item_id: itemId, output_index: 0, content_index: 0, part: { type: 'output_text', text, annotations: [] } })
      writeEvent(res, 'response.output_item.done', { type: 'response.output_item.done', sequence_number: next(), output_index: 0, item: out.output[0] })
      for (const c of calls) {
        writeEvent(res, 'response.function_call_arguments.done', {
          type: 'response.function_call_arguments.done',
          sequence_number: next(),
          item_id: c.itemId,
          output_index: c.outputIndex,
          arguments: c.args || '{}'
        })
        writeEvent(res, 'response.output_item.done', {
          type: 'response.output_item.done',
          sequence_number: next(),
          output_index: c.outputIndex,
          item: callItems.find((i) => i.call_id === c.callId)
        })
      }
      writeEvent(res, 'response.completed', { type: 'response.completed', sequence_number: next(), response: out })
      res.end()
    }
  }
}

/* --------------------------------------------------------------- Gemini */

export function geminiEmitter(res, model, { stream = true } = {}) {
  let text = ''
  let usage = null
  const toolCalls = new Map() // 规范化 index → { name, args }

  const frame = (parts, finishReason) => ({
    candidates: [{ content: { role: 'model', parts }, index: 0, ...(finishReason ? { finishReason } : {}) }],
    ...(usage
      ? { usageMetadata: { promptTokenCount: usage.input_tokens, candidatesTokenCount: usage.output_tokens, totalTokenCount: (usage.input_tokens || 0) + (usage.output_tokens || 0) } }
      : {})
  })

  return {
    start() {},
    reasoning(t) {
      text += t
      if (!stream) return
      write(res, frame([{ text: t, thought: true }]))
    },
    text(t) {
      text += t
      if (!stream) return
      write(res, frame([{ text: t }]))
    },
    toolCall(index, callId, name) {
      toolCalls.set(index, { name, args: '' })
    },
    toolCallArgs(index, t) {
      const call = toolCalls.get(index)
      if (call) call.args += t || ''
    },
    usage(u) {
      usage = u
    },
    error(message) {
      if (!stream) return
      write(res, { error: { code: 500, message, status: 'INTERNAL' } })
    },
    end() {
      // Gemini 的 functionCall 是**完整对象**、不分片，真实 API 也是在最后一帧给出，
      // 所以这里累积参数，结束时一次性编码（args 必须是对象而不是 JSON 字符串）。
      const callParts = [...toolCalls.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, c]) => ({ functionCall: { name: c.name, args: argsToObject(c.args) } }))
      if (!stream) {
        const parts = [...(text ? [{ text }] : []), ...callParts]
        return res.json({ candidates: [{ content: { role: 'model', parts: parts.length ? parts : [{ text: '' }] }, finishReason: 'STOP', index: 0 }], ...(usage ? { usageMetadata: { promptTokenCount: usage.input_tokens, candidatesTokenCount: usage.output_tokens, totalTokenCount: (usage.input_tokens || 0) + (usage.output_tokens || 0) } } : {}) })
      }
      write(res, frame(callParts, 'STOP'))
      // The real Gemini API ends the SSE stream without a [DONE] sentinel;
      // sending one makes gemini-cli throw "Unexpected token 'D'".
      res.end()
    }
  }
}

export const EMITTERS = {
  anthropic: anthropicEmitter,
  openai: openaiEmitter,
  'openai-response': responsesEmitter,
  gemini: geminiEmitter
}
