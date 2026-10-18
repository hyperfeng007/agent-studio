import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api, { streamChat } from '../api'

/** In-flight stream abort handles, keyed by message id. */
const aborts = new Map()

export function stopStream(messageId) {
  const fn = aborts.get(messageId)
  if (fn) fn()
}

/** Build the context window exactly like the original: system prompt + last N
 *  messages after the most recent 清除上下文 divider. */
export function buildContext(assistant, messages, contextCount) {
  const out = []
  if (assistant?.prompt) out.push({ role: 'system', content: assistant.prompt })
  let start = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === 'clear') {
      start = i + 1
      break
    }
  }
  const visible = messages
    .slice(start)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.status !== 'error')
    // In a multi-model group only the first answer is fed back as context.
    .filter((m) => !m.groupId || (m.groupIndex ?? 0) === 0)
  const limited = contextCount > 0 ? visible.slice(-contextCount) : visible
  for (const m of limited) {
    out.push({ role: m.role, content: contentOf(m) })
  }
  return out
}

function contentOf(m) {
  const images = (m.files || []).filter((f) => (f.mime || '').startsWith('image/'))
  if (!images.length) return m.content || ''
  return [
    { type: 'text', text: m.content || '' },
    ...images.map((f) => ({ type: 'image_url', image_url: { url: api.files.rawUrl(f.id) } }))
  ]
}

export function paramsOf(assistant) {
  const s = assistant?.settings || {}
  const p = { temperature: s.temperature ?? 0.7, topP: s.topP ?? 1, streamOutput: s.streamOutput !== false }
  if (s.maxTokens) p.maxTokens = s.maxTokens
  if (s.reasoningEffort) p.reasoningEffort = s.reasoningEffort
  return p
}

const initialState = {
  assistants: [],
  activeAssistantId: null,
  topics: [],
  activeTopicId: null,
  messages: [],
  loadingAssistants: false,
  loadingMessages: false,
  sending: false,
  compareModels: [],
  error: null
}

const slice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    setAssistants(state, { payload }) {
      state.assistants = payload
    },
    addAssistant(state, { payload }) {
      state.assistants.unshift(payload)
      state.activeAssistantId = payload.id
    },
    patchAssistant(state, { payload }) {
      const i = state.assistants.findIndex((a) => a.id === payload.id)
      if (i >= 0) state.assistants[i] = { ...state.assistants[i], ...payload }
    },
    removeAssistant(state, { payload }) {
      state.assistants = state.assistants.filter((a) => a.id !== payload)
      if (state.activeAssistantId === payload) {
        state.activeAssistantId = state.assistants[0]?.id || null
        state.topics = []
        state.activeTopicId = null
        state.messages = []
      }
    },
    setActiveAssistant(state, { payload }) {
      state.activeAssistantId = payload
    },
    setTopics(state, { payload }) {
      state.topics = payload
    },
    addTopic(state, { payload }) {
      state.topics.unshift(payload)
      state.activeTopicId = payload.id
      state.messages = []
    },
    patchTopic(state, { payload }) {
      const i = state.topics.findIndex((t) => t.id === payload.id)
      if (i >= 0) state.topics[i] = { ...state.topics[i], ...payload }
    },
    removeTopic(state, { payload }) {
      state.topics = state.topics.filter((t) => t.id !== payload)
      if (state.activeTopicId === payload) {
        state.activeTopicId = state.topics[0]?.id || null
        state.messages = []
      }
    },
    setActiveTopic(state, { payload }) {
      state.activeTopicId = payload
    },
    setMessages(state, { payload }) {
      state.messages = payload
    },
    appendMessage(state, { payload }) {
      state.messages.push(payload)
    },
    patchMessage(state, { payload }) {
      const i = state.messages.findIndex((m) => m.id === payload.id)
      if (i >= 0) state.messages[i] = { ...state.messages[i], ...payload }
    },
    removeMessages(state, { payload }) {
      const ids = Array.isArray(payload) ? payload : [payload]
      state.messages = state.messages.filter((m) => !ids.includes(m.id))
    },
    setSending(state, { payload }) {
      state.sending = payload
    },
    setCompareModels(state, { payload }) {
      state.compareModels = payload
    },
    setError(state, { payload }) {
      state.error = payload
    }
  }
})

export const {
  setAssistants, addAssistant, patchAssistant, removeAssistant, setActiveAssistant,
  setTopics, addTopic, patchTopic, removeTopic, setActiveTopic,
  setMessages, appendMessage, patchMessage, removeMessages,
  setSending, setCompareModels, setError
} = slice.actions

/* ------------------------------------------------------------------ thunks */

export const fetchAssistants = createAsyncThunk('chat/fetchAssistants', async (_, { dispatch }) => {
  const list = await api.assistants.list()
  dispatch(setAssistants(list))
  return list
})

export const selectAssistant = createAsyncThunk('chat/selectAssistant', async (id, { dispatch, getState }) => {
  dispatch(setActiveAssistant(id))
  dispatch(setTopics([]))
  dispatch(setActiveTopic(null))
  dispatch(setMessages([]))
  dispatch(setCompareModels([]))
  const topics = await api.assistants.topics(id)
  if (getState().chat.activeAssistantId !== id) return topics
  dispatch(setTopics(topics))
  const current = getState().chat.activeTopicId
  const next = topics.find((t) => t.id === current) ? current : topics[0]?.id
  if (next) await dispatch(selectTopic(next))
  else {
    dispatch(setActiveTopic(null))
    dispatch(setMessages([]))
  }
  return topics
})

export const selectTopic = createAsyncThunk('chat/selectTopic', async (id, { dispatch, getState }) => {
  dispatch(setActiveTopic(id))
  const messages = await api.topics.messages(id)
  if (getState().chat.activeTopicId === id) dispatch(setMessages(messages))
  return id
})

export const createAssistant = createAsyncThunk('chat/createAssistant', async (data, { dispatch }) => {
  const a = await api.assistants.create(data)
  dispatch(addAssistant(a))
  const topics = await api.assistants.topics(a.id)
  dispatch(setTopics(topics))
  dispatch(setActiveTopic(topics[0]?.id || null))
  dispatch(setMessages([]))
  return a
})

export const createTopic = createAsyncThunk('chat/createTopic', async ({ assistantId, name }, { dispatch, getState }) => {
  const t = await api.topics.create(assistantId, name)
  if (getState().chat.activeAssistantId === assistantId) {
    dispatch(addTopic(t))
    dispatch(setMessages([]))
  }
  return t
})

export const clearTopic = createAsyncThunk('chat/clearTopic', async (topicId, { dispatch }) => {
  await api.topics.clear(topicId)
  dispatch(setMessages(await api.topics.messages(topicId)))
  return topicId
})

/**
 * Send a turn. Supports multi-model compare: one user message + N assistant
 * messages sharing a groupId, streamed in parallel.
 */
export const sendMessage = createAsyncThunk(
  'chat/sendMessage',
  async ({ content, files = [], models, reuseUserMessage = false }, { dispatch, getState, requestId }) => {
    const state = getState().chat
    const assistant = state.assistants.find((a) => a.id === state.activeAssistantId)
    const topicId = state.activeTopicId
    if (!assistant || !topicId) throw new Error('请先选择智能助手与话题')

    const targets = (models && models.length ? models : assistant.model ? [{ providerId: assistant.model.provider, modelId: assistant.model.id }] : [])
      .filter((m) => m.providerId && m.modelId)
    if (!targets.length) throw new Error('请先选择模型（设置 → 模型服务）')

    const now = Date.now()
    let userMessage = null
    if (!reuseUserMessage) {
      userMessage = await api.messages.create({
        role: 'user',
        content,
        files,
        topicId,
        assistantId: assistant.id,
        status: 'success',
        createdAt: now,
        multiModelIds: targets.length > 1 ? targets.map((t) => `${t.providerId}:${t.modelId}`) : undefined
      })
      dispatch(appendMessage(userMessage))
    }

    const groupId = targets.length > 1 ? `g${now.toString(36)}` : undefined
    const created = []
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]
      const msg = await api.messages.create({
        role: 'assistant',
        content: '',
        topicId,
        assistantId: assistant.id,
        providerId: t.providerId,
        modelId: t.modelId,
        status: 'sending',
        groupId,
        groupIndex: i,
        createdAt: now + i + 1
      })
      created.push(msg)
      dispatch(appendMessage(msg))
    }
    dispatch(setSending(true))

    const all = [...getState().chat.messages]
    const context = buildContext(assistant, all.filter((m) => !created.some((c) => c.id === m.id)), assistant.settings?.contextCount ?? 12)
    const params = paramsOf(assistant)

    await Promise.all(
      created.map(
        (msg, idx) =>
          new Promise((resolve) => {
            let acc = ''
            let reasoning = ''
            let usage = null
            let references = []
            let knowledgeNotice = ''
            let toolEvents = []
            const evidence = () => ({ references, knowledgeNotice, toolEvents: toolEvents.map(({approvalId, ...e}) => e) })
            let completed = false
            let metrics = null
            let lastSave = 0
            const save = (patch) => {
              dispatch(patchMessage({ id: msg.id, ...patch }))
            }
            const persist = (patch) => api.messages.save(msg.id, patch).catch(() => {})

            const abort = streamChat(
              { providerId: msg.providerId, modelId: msg.modelId, messages: context, params, assistantId: assistant.id },
              {
                onReferences: evt => { references = evt.references; knowledgeNotice = evt.notice; save({references, knowledgeNotice}) },
                onToolEvent: evt => {
                  const record = {...evt, status: evt.type === 'tool_approval' ? 'approval' : evt.status}
                  const i = toolEvents.findIndex(e => e.callId === evt.callId)
                  if (i < 0) toolEvents.push(record); else toolEvents[i] = {...toolEvents[i], ...record}
                  save({toolEvents: [...toolEvents]})
                },
                onStart: () => save({ status: 'pending' }),
                onReasoning: (text) => {
                  reasoning += text
                  save({ reasoningContent: reasoning, status: 'pending' })
                },
                onDelta: (text) => {
                  acc += text
                  save({ content: acc, status: 'pending' })
                  if (Date.now() - lastSave > 1200) {
                    lastSave = Date.now()
                    persist({ content: acc, reasoningContent: reasoning })
                  }
                },
                onUsage: (u) => {
                  usage = { ...(usage || {}), ...u }
                },
                onDone: (evt) => {
                  completed = true
                  metrics = evt.metrics
                  usage = evt.usage || usage
                  acc = evt.content ?? acc
                  reasoning = evt.reasoningContent ?? reasoning
                  save({ content: acc, reasoningContent: reasoning, usage, metrics, status: evt.aborted ? 'success' : 'success', error: undefined })
                  persist({ content: acc, reasoningContent: reasoning, usage, metrics, status: 'success', ...evidence() })
                },
                onError: (evt) => {
                  completed = true
                  save({ status: 'error', error: evt.message || '请求失败', content: evt.content ?? acc, reasoningContent: reasoning })
                  persist({ status: 'error', error: evt.message || '请求失败', content: acc, ...evidence() })
                },
                onClose: () => {
                  toolEvents = toolEvents.map(e => e.status === 'approval' ? {...e, status:'expired'} : e.status === 'running' ? {...e,status:'interrupted',result:'已停止等待；外部操作是否已完成需另行核实，取消不能撤销已产生的副作用。'} : e)
                  const ending = {...evidence(), ...(!completed ? {status:'success', content:acc, reasoningContent:reasoning} : {})}
                  save(ending)
                  persist(ending)
                  aborts.delete(msg.id)
                  resolve()
                }
              }
            )
            aborts.set(msg.id, abort)
            save({ status: 'sending' })
          })
      )
    )
    dispatch(setSending(false))

    // 话题自动命名 on the first exchange of a fresh topic.
    const fresh = all.filter((m) => m.role === 'user').length === 0
    const topic = getState().chat.topics.find((t) => t.id === topicId)
    if (fresh && topic && (topic.name === '新话题' || topic.name === '默认话题')) {
      const first = targets[0]
      try {
        const { name } = await api.chat.autoName({ providerId: first.providerId, modelId: first.modelId, content })
        if (name) {
          const t = await api.topics.save(topicId, { name })
          dispatch(patchTopic(t))
        }
      } catch {}
    }
    return requestId
  }
)

/** 重新生成 — drop the answer (and its group) and replay the previous turn. */
export const regenerateMessage = createAsyncThunk('chat/regenerate', async (messageId, { dispatch, getState }) => {
  const state = getState().chat
  const msg = state.messages.find((m) => m.id === messageId)
  if (!msg) return
  const assistant = state.assistants.find((a) => a.id === state.activeAssistantId)
  const before = state.messages.filter((m) => m.createdAt < msg.createdAt)
  const lastUser = [...before].reverse().find((m) => m.role === 'user')

  await api.messages.remove(messageId)
  const groupIds = msg.groupId ? state.messages.filter((m) => m.groupId === msg.groupId).map((m) => m.id) : [messageId]
  dispatch(removeMessages(groupIds))

  if (!lastUser) return
  const models = msg.groupId
    ? state.messages.filter((m) => m.groupId === msg.groupId).map((m) => ({ providerId: m.providerId, modelId: m.modelId }))
    : [{ providerId: msg.providerId, modelId: msg.modelId }]
  await dispatch(sendMessage({ content: lastUser.content, files: lastUser.files || [], models, reuseUserMessage: true }))
})

export const deleteMessage = createAsyncThunk('chat/deleteMessage', async (messageId, { dispatch, getState }) => {
  const msg = getState().chat.messages.find((m) => m.id === messageId)
  const res = await api.messages.remove(messageId)
  dispatch(removeMessages(res?.deleted || [messageId]))
  return messageId
})

export const updateMessage = createAsyncThunk('chat/updateMessage', async ({ id, patch }, { dispatch }) => {
  const saved = await api.messages.save(id, patch)
  dispatch(patchMessage(saved))
  return saved
})

export default slice.reducer
