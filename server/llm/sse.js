import { ApiError } from './errors.js'

/**
 * Minimal SSE (text/event-stream) frame parser.
 * Feeds raw text chunks in, emits complete `data:` payloads out.
 */
export class SSEParser {
  constructor(onData) {
    this.onData = onData
    this.buffer = ''
    this.dataLines = []
  }

  feed(chunk) {
    this.buffer += chunk
    let idx
    // Frames are separated by a blank line; tolerate \r\n and \n.
    while ((idx = this.buffer.search(/\r?\n\r?\n/)) !== -1) {
      const rawFrame = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx).replace(/^\r?\n\r?\n/, '')
      this.handleFrame(rawFrame)
    }
  }

  handleFrame(frame) {
    for (const line of frame.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue
      if (line.startsWith('data:')) {
        this.dataLines.push(line.slice(5).replace(/^ /, ''))
      }
    }
    if (this.dataLines.length) {
      const payload = this.dataLines.join('\n')
      this.dataLines = []
      this.onData(payload)
    }
  }

  /** Flush a trailing frame that was not terminated by a blank line. */
  end() {
    if (this.buffer.trim()) this.handleFrame(this.buffer.trim())
    this.buffer = ''
    if (this.dataLines.length) {
      const payload = this.dataLines.join('\n')
      this.dataLines = []
      this.onData(payload)
    }
  }
}

/** Iterate a fetch Response body as decoded text chunks. */
export async function* readResponseText(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value && value.length) yield decoder.decode(value, { stream: true })
    }
    const tail = decoder.decode()
    if (tail) yield tail
  } finally {
    try {
      reader.releaseLock()
    } catch {}
  }
}

/**
 * 读正文并解析 JSON；正文不是 JSON 时给出「地址填错」这一最常见原因，而不是抛
 * `Unexpected token '<'` 这种让人摸不着头脑的 SyntaxError。
 *
 * 典型场景：apiHost 填成了站点首页（https://example.com）而不是接口地址
 * （https://example.com/v1），服务器用 200 返回了一整页 HTML。
 */
export async function parseJsonResponse(res, what = '模型列表') {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    const head = text.replace(/\s+/g, ' ').slice(0, 60)
    const looksHtml = /^\s*<(!doctype|html|\?xml)/i.test(text)
    const err = new ApiError(
      `服务商返回的${what}不是 JSON（HTTP ${res.status}${head ? `，正文开头：${head}` : ''}）。` +
        (looksHtml
          ? '这通常意味着 API 地址指向了网页而不是接口：请把它改成形如 https://api.example.com（多数服务商还需要 /v1）。'
          : '请确认 API 地址与服务商类型（渠道类型）是否匹配。'),
      res.status
    )
    // 结构化标记：网络是通的，问题出在地址/接口形态上（诊断据此分类，不靠字符串匹配）
    err.badBody = true
    err.bodyHead = head
    throw err
  }
}

export function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Human readable provider error, extracted from whichever shape the API used. */
export function extractError(body, status) {
  const parsed = safeJson(body)
  const msg =
    parsed?.error?.message ||
    parsed?.message ||
    parsed?.error?.msg ||
    (Array.isArray(parsed?.error) ? parsed.error[0]?.message : null) ||
    parsed?.detail
  if (msg) return `HTTP ${status}: ${msg}`
  return `HTTP ${status}: ${body.slice(0, 300)}`
}
