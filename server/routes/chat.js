import { runAssistantChat } from '../llm/assistantRun.js'
import { isLocalMcpRequest } from '../mcp/security.js'
import express from 'express'
import fs from 'node:fs'
import { findRow, table, getSettings } from '../store.js'
import { getProvider, withRotatedKey } from '../services/providers.js'
import { streamChat, ApiError } from '../llm/index.js'

export const chatRouter = express.Router()

function send(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`)
}

function sseHead(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  res.flushHeaders?.()
}

/** Replace /api/files/:id references with inline data URLs the adapters accept. */
function resolveFileRefs(messages) {
  return messages.map((m) => {
    if (typeof m.content !== 'string' || !m.content.includes('/api/files/')) return m
    return m
  })
}

async function inlineMessageFiles(messages) {
  const out = []
  for (const m of messages) {
    if (!Array.isArray(m.content)) {
      out.push(m)
      continue
    }
    const content = []
    for (const part of m.content) {
      if (part.type === 'image_url' && typeof part.image_url?.url === 'string' && part.image_url.url.startsWith('/api/files/')) {
        const id = part.image_url.url.split('/').pop()
        const rec = findRow('files', id)
        if (rec && fs.existsSync(rec.path)) {
          const b64 = fs.readFileSync(rec.path).toString('base64')
          content.push({ type: 'image_url', image_url: { url: `data:${rec.mime};base64,${b64}` } })
          continue
        }
      }
      content.push(part)
    }
    out.push({ ...m, content })
  }
  return out
}

/**
 * POST /api/chat/stream — the single streaming entry point used by 对话.
 * Emits normalised SSE events the renderer appends to the live message:
 *   start | delta | reasoning | usage | finish_reason | done | error
 */
chatRouter.post('/stream', async (req, res) => {
  const { providerId, modelId, messages = [], params = {} } = req.body || {}
  const provider = getProvider(providerId)
  if (!provider) return res.status(400).json({ error: '未找到服务商，请先在 设置 → 模型服务 中配置' })
  if (!provider.enabled && provider.id !== 'mock') return res.status(400).json({ error: `服务商「${provider.name}」未启用` })
  const model = provider.models.find((m) => m.id === modelId) || { id: modelId, capabilities: ['text'] }

  const assistant = req.body.assistantId ? findRow('assistants', req.body.assistantId) : null
  if (assistant?.mcpGrants?.some(g => g.tools?.length) && !isLocalMcpRequest(req)) return res.status(403).json({error:'MCP 工具仅允许在服务端本机通过 localhost 使用'})
  sseHead(res)
  const controller = new AbortController()
  let closed = false
  res.on('close', () => {
    closed = true
    controller.abort()
  })

  const started = Date.now()
  let firstTokenAt = 0
  let thinkingAt = 0
  let thinkingDone = 0
  let content = ''
  let reasoning = ''
  let usage = null
  let finishReason = ''

  send(res, { type: 'start', modelId, providerId, providerName: provider.name })

  try {
    const inbound = await inlineMessageFiles(resolveFileRefs(messages))
    await runAssistantChat({
      provider: withRotatedKey(provider),
      providerType: provider.type,
      model,
      modelId: model.id,
      messages: inbound,
      params,
      signal: controller.signal,
      emit: (e) => {
        if (closed) return
        switch (e.type) {
          case 'references':
          case 'tool_approval':
          case 'tool_status':
            send(res, e)
            break
          case 'delta':
            if (!firstTokenAt) firstTokenAt = Date.now()
            content += e.text
            send(res, { type: 'delta', text: e.text })
            break
          case 'reasoning':
            if (!thinkingAt) thinkingAt = Date.now()
            thinkingDone = Date.now()
            reasoning += e.text
            send(res, { type: 'reasoning', text: e.text })
            break
          case 'usage':
            usage = { ...(usage || {}), ...e.usage }
            send(res, { type: 'usage', usage: e.usage })
            break
          case 'finish_reason':
            finishReason = e.value
            break
          case 'provider_error':
            throw new ApiError(e.message)
          default:
            break
        }
      }
    }, assistant)

    const finished = Date.now()
    send(res, {
      type: 'done',
      content,
      reasoningContent: reasoning,
      usage,
      finishReason,
      aborted: false,
      metrics: {
        time_first_token_millsec: firstTokenAt ? firstTokenAt - started : null,
        thought_time_millsec: thinkingAt ? thinkingDone - thinkingAt : 0,
        time_completion_millsec: finished - started,
        chars_per_second: content ? Math.round((content.length / Math.max(1, (finished - started) / 1000)) * 10) / 10 : 0
      }
    })
  } catch (err) {
    if (err?.name === 'AbortError' || closed) {
      send(res, { type: 'done', content, reasoningContent: reasoning, usage, aborted: true, finishReason: 'abort' })
    } else {
      send(res, { type: 'error', message: err.message || String(err), status: err.status || 0, content, reasoningContent: reasoning })
    }
  } finally {
    res.end()
  }
})

/** Non-streaming single completion — used by 自动重命名话题 / 快捷翻译等. */
chatRouter.post('/complete', async (req, res) => {
  const { providerId, modelId, messages = [], params = {} } = req.body || {}
  const provider = getProvider(providerId)
  if (!provider) return res.status(400).json({ error: '未找到服务商' })
  const model = provider.models.find((m) => m.id === modelId) || { id: modelId, capabilities: ['text'] }
  let content = ''
  try {
    await streamChat({
      provider: withRotatedKey(provider),
      providerType: provider.type,
      model,
      modelId: model.id,
      messages,
      params,
      emit: (e) => {
        if (e.type === 'delta') content += e.text
        if (e.type === 'provider_error') throw new ApiError(e.message)
      }
    })
    res.json({ content })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/** 话题自动命名：让当前模型把首轮对话压成 <=20 字的标题。 */
chatRouter.post('/auto-name', async (req, res) => {
  const { providerId, modelId, content } = req.body || {}
  const provider = getProvider(providerId)
  if (!provider) return res.status(400).json({ error: '未找到服务商' })
  const model = provider.models.find((m) => m.id === modelId) || { id: modelId }
  const fallback = String(content || '新话题').replace(/\s+/g, ' ').trim().slice(0, 20) || '新话题'
  try {
    let text = ''
    await streamChat({
      provider: withRotatedKey(provider),
      providerType: provider.type,
      model,
      modelId: model.id,
      messages: [
        {
          role: 'system',
          content: '你是话题命名助手。把用户的第一条消息概括成一个不超过 20 个字的中文短标题，只输出标题本身，不要引号、不要标点结尾、不要解释。'
        },
        { role: 'user', content: String(content || '').slice(0, 2000) }
      ],
      params: { maxTokens: 60, temperature: 0.3 },
      emit: (e) => {
        if (e.type === 'delta') text += e.text
        if (e.type === 'provider_error') throw new ApiError(e.message)
      }
    })
    const name = text.replace(/^["'「【]|["'」】]$/g, '').replace(/\s+/g, ' ').trim().slice(0, 30)
    res.json({ name: name || fallback })
  } catch {
    res.json({ name: fallback, fallback: true })
  }
})

/** Token 估算（用于「上下文数量」提示）。 */
chatRouter.post('/estimate', (req, res) => {
  const messages = req.body?.messages || []
  const chars = JSON.stringify(messages).length
  res.json({ chars, estimatedTokens: Math.ceil(chars / 3.2) })
})
