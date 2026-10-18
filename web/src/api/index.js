/** Thin API client + SSE stream helper. */

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/**
 * 浏览器连不上 Agent Studio 自己（服务退出 / 端口被占 / 被安全软件拦截）时的说法。
 * 与「服务端连不上模型 API」是两件事，必须区分开，否则两边都显示一句 fetch 错误、
 * 用户分不清该修代理还是该重启服务。
 */
function localServerMessage(err) {
  const raw = err?.message || String(err)
  return (
    `无法连接 Agent Studio 服务（${raw}）。` +
    '这通常是服务进程已退出、端口被占用，或被本机安全软件拦截：' +
    '看一眼启动窗口是否还在、有没有报错；必要时重启 start.bat，并检查 data/crash.log。' +
    '（模型 API 连不上是另一回事，那种情况会显示目标域名与原因。）'
  )
}

async function request(path, options = {}) {
  // Content-Type must be set whenever a body is present, otherwise Express's
  // json() middleware skips parsing and req.body arrives empty.
  const headers = { ...(options.headers || {}) }
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
  let res
  try {
    res = await fetch(path, { ...options, headers })
  } catch (err) {
    throw new Error(localServerMessage(err))
  }
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  if (!res.ok) {
    const msg = data?.error || data?.message || `请求失败 (HTTP ${res.status})`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data
}

const get = (p) => request(p)
const post = (p, body) => request(p, { method: 'POST', body: JSON.stringify(body ?? {}) })
const put = (p, body) => request(p, { method: 'PUT', body: JSON.stringify(body ?? {}) })
const del = (p) => request(p, { method: 'DELETE' })

export const api = {
  knowledge: {
    list: () => get('/api/knowledge'),
    create: data => post('/api/knowledge', data),
    remove: id => del(`/api/knowledge/${id}`),
    documents: id => get(`/api/knowledge/${id}/documents`),
    upload: (id, data) => post(`/api/knowledge/${id}/documents`, data),
    removeDocument: id => del(`/api/knowledge/documents/${id}`),
    retry: id => post(`/api/knowledge/documents/${id}/retry`),
    chunks: id => get(`/api/knowledge/documents/${id}/chunks`),
    search: (id, query) => post(`/api/knowledge/${id}/search`, {query})
  },
  mcp: {
    list: () => get('/api/mcp'),
    create: data => post('/api/mcp',data),
    save: (id,data) => put(`/api/mcp/${id}`,data),
    remove: id => del(`/api/mcp/${id}`),
    connect: id => post(`/api/mcp/${id}/connect`,{confirm:true}),
    disconnect: id => post(`/api/mcp/${id}/disconnect`),
    approve: (id,allowed) => post(`/api/mcp/approvals/${id}`,{allowed})
  },
  network: {
    status: () => get('/api/network/status'),
    reapply: () => post('/api/network/reapply'),
    diagnose: (data) => post('/api/network/diagnose', data)
  },
  settings: {
    get: () => get('/api/settings'),
    save: (patch) => put('/api/settings', patch),
    stats: () => get('/api/settings/stats'),
    reset: () => post('/api/settings/reset')
  },
  providers: {
    list: () => get('/api/providers'),
    types: () => get('/api/providers/types'),
    capabilities: () => get('/api/providers/capabilities'),
    models: () => get('/api/providers/models'),
    get: (id) => get(`/api/providers/${id}`),
    save: (id, patch) => put(`/api/providers/${id}`, patch),
    create: (data) => post('/api/providers', data),
    remove: (id) => del(`/api/providers/${id}`),
    check: (id, modelId) => post(`/api/providers/${id}/check`, { modelId }),
    fetchModels: (id) => post(`/api/providers/${id}/models/fetch`),
    saveModels: (id, models) => put(`/api/providers/${id}/models`, { models }),
    addModel: (id, model) => post(`/api/providers/${id}/models`, model),
    updateModel: (id, modelId, patch) => put(`/api/providers/${id}/models/${encodeURIComponent(modelId)}`, patch),
    removeModel: (id, modelId) => del(`/api/providers/${id}/models/${encodeURIComponent(modelId)}`)
  },
  assistants: {
    presets: () => get('/api/assistant-presets'),
    list: () => get('/api/assistants'),
    get: (id) => get(`/api/assistants/${id}`),
    create: (data) => post('/api/assistants', data),
    save: (id, patch) => put(`/api/assistants/${id}`, patch),
    copy: (id) => post(`/api/assistants/${id}/copy`),
    remove: (id) => del(`/api/assistants/${id}`),
    topics: (id) => get(`/api/assistants/${id}/topics`)
  },
  topics: {
    create: (assistantId, name) => post('/api/topics', { assistantId, name }),
    save: (id, patch) => put(`/api/topics/${id}`, patch),
    remove: (id) => del(`/api/topics/${id}`),
    clear: (id) => post(`/api/topics/${id}/clear`),
    messages: (id) => get(`/api/topics/${id}/messages`),
    clearMessages: (id) => del(`/api/topics/${id}/messages`)
  },
  messages: {
    create: (data) => post('/api/messages', data),
    save: (id, patch) => put(`/api/messages/${id}`, patch),
    remove: (id) => del(`/api/messages/${id}`)
  },
  chat: {
    autoName: (data) => post('/api/chat/auto-name', data),
    complete: (data) => post('/api/chat/complete', data)
  },
  files: {
    upload: (data) => post('/api/files/upload', data),
    list: () => get('/api/files'),
    remove: (id) => del(`/api/files/${id}`),
    rawUrl: (id) => `/api/files/${id}/raw`
  },
  minapps: {
    list: (all = false) => get(`/api/minapps${all ? '?all=1' : ''}`),
    create: (data) => post('/api/minapps', data),
    save: (id, patch) => put(`/api/minapps/${id}`, patch),
    remove: (id) => del(`/api/minapps/${id}`),
    reorder: (ids) => post('/api/minapps/reorder', { ids }),
    restore: (id) => post(`/api/minapps/${id}/restore`)
  },
  codecli: {
    meta: () => get('/api/codecli/meta'),
    tools: (refresh = false) => get(`/api/codecli/tools${refresh ? '?refresh=1' : ''}`),
    detect: (id) => get(`/api/codecli/tools/${id}/detect`),
    uninstall: (id) => post(`/api/codecli/tools/${id}/uninstall`),
    providers: (id) => get(`/api/codecli/tools/${id}/providers`),
    config: (id) => get(`/api/codecli/configs/${id}`),
    saveConfig: (id, patch) => put(`/api/codecli/configs/${id}`, patch),
    terminals: () => get('/api/codecli/terminals'),
    sessions: () => get('/api/codecli/sessions'),
    kill: (id) => post(`/api/codecli/sessions/${id}/kill`),
    fsList: (p) => get(`/api/codecli/fs/list?path=${encodeURIComponent(p || '')}`),
    preview: (id, cfg) => post(`/api/codecli/tools/${id}/preview`, cfg),
    launch: (id, payload) => post(`/api/codecli/tools/${id}/launch`, payload),
    installUrl: (id, action = 'install') => `/api/codecli/tools/${id}/${action}`
  }
}

/**
 * Consume POST /api/chat/stream as SSE.
 * handlers: { onStart, onDelta, onReasoning, onUsage, onDone, onError }
 * Returns an abort() function.
 */
export function streamChat(body, handlers) {
  const controller = new AbortController()
  ;(async () => {
    let res
    try {
      res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
        signal: controller.signal
      })
    } catch (err) {
      if (err.name !== 'AbortError') handlers.onError?.({ message: localServerMessage(err) })
      return
    }
    if (!res.ok || !res.body) {
      let msg = `HTTP ${res.status}`
      try {
        msg = (await res.json()).error || msg
      } catch {}
      handlers.onError?.({ message: msg })
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue
            let evt
            try {
              evt = JSON.parse(line.slice(5).trim())
            } catch {
              continue
            }
            switch (evt.type) {
              case 'references':
                handlers.onReferences?.(evt)
                break
              case 'tool_approval':
              case 'tool_status':
                handlers.onToolEvent?.(evt)
                break
              case 'start':
                handlers.onStart?.(evt)
                break
              case 'delta':
                handlers.onDelta?.(evt.text)
                break
              case 'reasoning':
                handlers.onReasoning?.(evt.text)
                break
              case 'usage':
                handlers.onUsage?.(evt.usage)
                break
              case 'done':
                handlers.onDone?.(evt)
                break
              case 'error':
                handlers.onError?.(evt)
                break
              default:
                break
            }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') handlers.onError?.({ message: err.message })
    } finally {
      handlers.onClose?.()
    }
  })()
  return () => controller.abort()
}

/** Consume an SSE endpoint that only reports progress (npm install logs). */
export function streamLogs(url, onEvent, method = 'POST') {
  const controller = new AbortController()
  ;(async () => {
    try {
      const res = await fetch(url, { method, signal: controller.signal })
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue
            try {
              onEvent(JSON.parse(line.slice(5).trim()))
            } catch {}
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') onEvent({ type: 'error', message: err.message })
    }
  })()
  return () => controller.abort()
}

export default api
