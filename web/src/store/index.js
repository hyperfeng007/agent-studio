import { configureStore, createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api from '../api'
import chatReducer, { fetchAssistants } from './chat'

/* --------------------------------------------------------------- settings */

const settingsSlice = createSlice({
  name: 'settings',
  initialState: { data: {}, loaded: false, dark: false },
  reducers: {
    setSettings(state, { payload }) {
      state.data = payload
      state.loaded = true
    },
    patchSettings(state, { payload }) {
      state.data = { ...state.data, ...payload }
    },
    setDark(state, { payload }) {
      state.dark = payload
    }
  }
})

export const { setSettings, patchSettings, setDark } = settingsSlice.actions

export const loadSettings = createAsyncThunk('settings/load', async (_, { dispatch }) => {
  const data = await api.settings.get()
  dispatch(setSettings(data))
  const prefersDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
  const dark = data.theme === 'dark' || (data.theme === 'auto' && prefersDark)
  dispatch(setDark(dark))
  return data
})

export const saveSettings = createAsyncThunk('settings/save', async (patch, { dispatch }) => {
  const data = await api.settings.save(patch)
  dispatch(setSettings(data))
  return data
})

/* -------------------------------------------------------------- providers */

const providersSlice = createSlice({
  name: 'providers',
  initialState: { list: [], models: [], types: [], capabilities: [], loading: false, checkResults: {} },
  reducers: {
    setProviders(state, { payload }) {
      state.list = payload
    },
    setAvailableModels(state, { payload }) {
      state.models = payload
    },
    setProviderMeta(state, { payload }) {
      state.types = payload.types
      state.capabilities = payload.capabilities
    },
    setLoading(state, { payload }) {
      state.loading = payload
    },
    setCheckResult(state, { payload }) {
      state.checkResults[payload.id] = payload.result
    }
  }
})

export const { setProviders, setAvailableModels, setProviderMeta, setLoading, setCheckResult } = providersSlice.actions

export const loadProviders = createAsyncThunk('providers/load', async (_, { dispatch }) => {
  dispatch(setLoading(true))
  try {
    const [list, models] = await Promise.all([api.providers.list(), api.providers.models()])
    dispatch(setProviders(list))
    dispatch(setAvailableModels(models))
    return list
  } finally {
    dispatch(setLoading(false))
  }
})

export const loadProviderMeta = createAsyncThunk('providers/meta', async (_, { dispatch }) => {
  const [types, capabilities] = await Promise.all([api.providers.types(), api.providers.capabilities()])
  dispatch(setProviderMeta({ types, capabilities }))
})

export const saveProvider = createAsyncThunk('providers/save', async ({ id, patch }, { dispatch }) => {
  const provider = await api.providers.save(id, patch)
  const [list, models] = await Promise.all([api.providers.list(), api.providers.models()])
  dispatch(setProviders(list))
  dispatch(setAvailableModels(models))
  return provider
})

export const checkProvider = createAsyncThunk('providers/check', async ({ id, modelId }, { dispatch }) => {
  const result = await api.providers.check(id, modelId)
  dispatch(setCheckResult({ id, result }))
  return result
})

/* ---------------------------------------------------------------- minapps */

const minappsSlice = createSlice({
  name: 'minapps',
  initialState: { list: [], all: [], loading: false },
  reducers: {
    setMinApps(state, { payload }) {
      state.list = payload.filter((m) => !m.hidden)
      state.all = payload
    },
    setMinAppsLoading(state, { payload }) {
      state.loading = payload
    }
  }
})

export const { setMinApps, setMinAppsLoading } = minappsSlice.actions

export const loadMinApps = createAsyncThunk('minapps/load', async (_, { dispatch }) => {
  dispatch(setMinAppsLoading(true))
  try {
    dispatch(setMinApps(await api.minapps.list(true)))
  } finally {
    dispatch(setMinAppsLoading(false))
  }
})

/* ---------------------------------------------------------------- codecli */

const codecliSlice = createSlice({
  name: 'codecli',
  initialState: { tools: [], terminals: [], sessions: [], meta: {}, loading: false, installLogs: {}, detecting: {} },
  reducers: {
    setTools(state, { payload }) {
      state.tools = payload
    },
    patchTool(state, { payload }) {
      const i = state.tools.findIndex((t) => t.id === payload.id)
      if (i >= 0) state.tools[i] = { ...state.tools[i], ...payload }
    },
    setTerminals(state, { payload }) {
      state.terminals = payload
    },
    setSessions(state, { payload }) {
      state.sessions = payload
    },
    setMeta(state, { payload }) {
      state.meta = payload
    },
    setCodecliLoading(state, { payload }) {
      state.loading = payload
    },
    appendInstallLog(state, { payload }) {
      const cur = state.installLogs[payload.id] || ''
      state.installLogs[payload.id] = (cur + payload.text).slice(-60000)
    },
    clearInstallLog(state, { payload }) {
      state.installLogs[payload] = ''
    },
    setDetecting(state, { payload }) {
      state.detecting[payload.id] = payload.value
    }
  }
})

export const {
  setTools, patchTool, setTerminals, setSessions, setMeta, setCodecliLoading,
  appendInstallLog, clearInstallLog, setDetecting
} = codecliSlice.actions

export const loadCodeCli = createAsyncThunk('codecli/load', async ({ refresh = false } = {}, { dispatch }) => {
  dispatch(setCodecliLoading(true))
  try {
    const [tools, terminals, meta, sessions] = await Promise.all([
      api.codecli.tools(refresh),
      api.codecli.terminals(),
      api.codecli.meta(),
      api.codecli.sessions()
    ])
    dispatch(setTools(tools))
    dispatch(setTerminals(terminals))
    dispatch(setMeta(meta))
    dispatch(setSessions(sessions))
    return tools
  } finally {
    dispatch(setCodecliLoading(false))
  }
})

/* ------------------------------------------------------------------ store */

export const store = configureStore({
  reducer: {
    settings: settingsSlice.reducer,
    providers: providersSlice.reducer,
    chat: chatReducer,
    minapps: minappsSlice.reducer,
    codecli: codecliSlice.reducer
  },
  middleware: (getDefault) => getDefault({ serializableCheck: false })
})

export async function bootstrap() {
  await store.dispatch(loadSettings())
  await Promise.all([store.dispatch(loadProviders()), store.dispatch(loadProviderMeta()), store.dispatch(fetchAssistants()), store.dispatch(loadMinApps())])
}
