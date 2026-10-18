/**
 * 工具调用（function calling）的规范化层。
 *
 * 为什么需要它：智能体 CLI 的全部价值都在工具循环上——CLI 把 `tools`（bash / read / edit …）
 * 发给网关，模型决定调用哪个工具、参数是什么，CLI 执行后把结果回传，模型再继续。
 * 网关收到的是四种方言之一（OpenAI / Anthropic / Gemini / Responses），上游服务商又可能是
 * 另一种协议，所以这里定义一套**中立表示**，进出各做一次转换：
 *
 *   工具定义   { name, description, parameters }            parameters 是 JSON Schema
 *   工具调用   { id, name, arguments }                      arguments 是 JSON **字符串**（流式拼接后）
 *   工具结果   { role: 'tool', toolCallId, name, content, isError }
 *   事件       { type: 'tool_call', index, id, name }
 *              { type: 'tool_call_args', index, text }
 *              { type: 'finish_reason', value: 'tool_calls' }
 *
 * 消息层沿用 OpenAI 的形态作为规范形（assistant.tool_calls + role:'tool'），
 * 因为网关的入站解析本来就把各方言转成 OpenAI 风格的消息数组。
 */

let seq = 0
/** 有些协议（Gemini）不给调用 id，这里合成一个稳定的 id。 */
export function syntheticCallId(prefix = 'call') {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/* ------------------------------------------------------------------ *
 * 入站：四种方言的工具定义 → 规范形
 * ------------------------------------------------------------------ */

/**
 * @param {*} raw  请求体里的 tools 字段
 * @param {'openai'|'anthropic'|'gemini'|'responses'} dialect
 */
export function normalizeTools(raw, dialect = 'openai') {
  if (!raw) return []
  const out = []
  const list = Array.isArray(raw) ? raw : [raw]

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue

    if (dialect === 'gemini') {
      // Gemini: tools: [{ functionDeclarations: [{ name, description, parameters }] }]
      const decls = entry.functionDeclarations || entry.function_declarations
      if (Array.isArray(decls)) {
        for (const d of decls) {
          if (!d?.name) continue
          out.push({ name: d.name, description: d.description || '', parameters: d.parameters || { type: 'object', properties: {} } })
        }
      } else if (entry.name) {
        out.push({ name: entry.name, description: entry.description || '', parameters: entry.parameters || { type: 'object', properties: {} } })
      }
      continue
    }

    if (dialect === 'anthropic') {
      // Anthropic: tools: [{ name, description, input_schema }]
      if (!entry.name) continue
      out.push({
        name: entry.name,
        description: entry.description || '',
        parameters: entry.input_schema || entry.inputSchema || { type: 'object', properties: {} }
      })
      continue
    }

    if (dialect === 'responses') {
      // Responses: tools: [{ type:'function', name, description, parameters }]（function 是平铺的）
      if (entry.type && entry.type !== 'function') continue // web_search / file_search 等托管工具我们不转发
      if (!entry.name) continue
      out.push({ name: entry.name, description: entry.description || '', parameters: entry.parameters || { type: 'object', properties: {} } })
      continue
    }

    // OpenAI: tools: [{ type:'function', function: { name, description, parameters } }]
    const fn = entry.function || entry
    if (!fn?.name) continue
    out.push({ name: fn.name, description: fn.description || '', parameters: fn.parameters || { type: 'object', properties: {} } })
  }
  return out
}

/** 入站 tool_choice → 'auto' | 'none' | 'required' | { name } */
export function normalizeToolChoice(raw, dialect = 'openai') {
  if (raw == null) return undefined
  if (dialect === 'gemini') {
    // toolConfig.functionCallingConfig.mode: AUTO / ANY / NONE
    const mode = raw?.functionCallingConfig?.mode || raw?.function_calling_config?.mode || raw
    if (typeof mode !== 'string') return undefined
    const m = mode.toUpperCase()
    if (m === 'NONE') return 'none'
    if (m === 'ANY') return 'required'
    if (m === 'AUTO') return 'auto'
    return undefined
  }
  if (dialect === 'anthropic') {
    if (typeof raw === 'object') {
      if (raw.type === 'auto') return 'auto'
      if (raw.type === 'any') return 'required'
      if (raw.type === 'none') return 'none'
      if (raw.type === 'tool' && raw.name) return { name: raw.name }
    }
    return undefined
  }
  if (typeof raw === 'string') {
    if (raw === 'auto' || raw === 'none' || raw === 'required') return raw
    return undefined
  }
  if (typeof raw === 'object') {
    const name = raw?.function?.name || raw?.name
    if (name) return { name }
  }
  return undefined
}

/* ------------------------------------------------------------------ *
 * 出站：规范形 → 四种协议的工具定义
 * ------------------------------------------------------------------ */

export function toOpenAITools(tools) {
  return (tools || []).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } }
  }))
}

export function toAnthropicTools(tools) {
  return (tools || []).map((t) => ({
    name: t.name,
    description: t.description || '',
    input_schema: t.parameters || { type: 'object', properties: {} }
  }))
}

export function toResponsesTools(tools) {
  return (tools || []).map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description || '',
    parameters: t.parameters || { type: 'object', properties: {} },
    strict: false
  }))
}

/**
 * Gemini 对 JSON Schema 挑食：`$schema` / `additionalProperties` 会直接 400
 * （INVALID_ARGUMENT: unsupported field），联合类型 `type: ['string','null']` 也不认。
 * 这里递归清洗一遍，只保留 Gemini 支持的子集。
 */
export function sanitizeSchemaForGemini(schema) {
  if (Array.isArray(schema)) return schema.map(sanitizeSchemaForGemini)
  if (!schema || typeof schema !== 'object') return schema
  const out = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k === '$schema' || k === 'additionalProperties' || k === '$defs' || k === 'definitions' || k === '$id' || k === '$ref') continue
    if (k === 'type') {
      if (Array.isArray(v)) {
        const nonNull = v.filter((t) => t !== 'null')
        if (nonNull.length === 1) {
          out.type = nonNull[0]
          if (v.includes('null')) out.nullable = true
        } else if (nonNull.length > 1) {
          out.type = 'string' // Gemini 不支持联合类型，退化成字符串
        }
        continue
      }
      out.type = v
      continue
    }
    if (k === 'properties' || k === 'items' || k === 'patternProperties') {
      out[k] = sanitizeSchemaForGemini(v)
      continue
    }
    if (k === 'required' || k === 'enum') {
      out[k] = Array.isArray(v) ? [...v] : v
      continue
    }
    out[k] = v && typeof v === 'object' ? sanitizeSchemaForGemini(v) : v
  }
  // Gemini 要求 type:object 必须带 properties
  if (out.type === 'object' && !out.properties) out.properties = {}
  return out
}

export function toGeminiTools(tools) {
  if (!tools?.length) return undefined
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description || '',
        parameters: sanitizeSchemaForGemini(t.parameters || { type: 'object', properties: {} })
      }))
    }
  ]
}

export function toAnthropicToolChoice(choice) {
  if (!choice || choice === 'auto') return choice === 'auto' ? { type: 'auto' } : undefined
  if (choice === 'required') return { type: 'any' }
  if (choice === 'none') return { type: 'none' }
  if (typeof choice === 'object' && choice.name) return { type: 'tool', name: choice.name }
  return undefined
}

export function toGeminiToolConfig(choice) {
  if (!choice) return undefined
  if (typeof choice === 'object' && choice.name) return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [choice.name] } }
  const mode = choice === 'required' ? 'ANY' : choice === 'none' ? 'NONE' : 'AUTO'
  return { functionCallingConfig: { mode } }
}

/* ------------------------------------------------------------------ *
 * 参数（arguments）的字符串 ↔ 对象互转
 * ------------------------------------------------------------------ */

/** 模型给的 arguments 一定是字符串（OpenAI/Anthropic/Responses），Gemini 给对象。 */
export function argsToString(args) {
  if (args == null) return '{}'
  if (typeof args === 'string') return args.trim() || '{}'
  try {
    return JSON.stringify(args)
  } catch {
    return '{}'
  }
}

/** 发给 Anthropic / Gemini 时要把字符串还原成对象；解析失败就退化成 {} 并保留原文。 */
export function argsToObject(args) {
  if (args == null) return {}
  if (typeof args === 'object') return args
  const s = String(args).trim()
  if (!s) return {}
  try {
    const parsed = JSON.parse(s)
    return parsed && typeof parsed === 'object' ? parsed : { value: parsed }
  } catch {
    throw new Error('工具参数不是有效 JSON，拒绝把损坏的参数转换为可执行调用')
  }
}

/* ------------------------------------------------------------------ *
 * 会话里的 id ↔ name 映射
 * ------------------------------------------------------------------ */

/**
 * Gemini 的 functionResponse 只带 name、不带 id；OpenAI 的 role:'tool' 只带 id、不带 name。
 * 转换时需要从上下文里把映射找回来（assistant 消息的 tool_calls 就是权威来源）。
 */
export function buildCallIndex(messages) {
  const idToName = new Map()
  const nameToId = new Map()
  for (const m of messages || []) {
    const calls = m?.tool_calls || m?.toolCalls
    if (!Array.isArray(calls)) continue
    for (const c of calls) {
      const id = c?.id || c?.call_id
      const name = c?.function?.name || c?.name
      if (id && name) {
        idToName.set(id, name)
        if (!nameToId.has(name)) nameToId.set(name, id)
      }
    }
  }
  return { idToName, nameToId }
}

/** 把 finish/stop reason 统一成规范值。 */
export function normalizeFinishReason(value, { hadToolCall = false } = {}) {
  if (value === 'tool_use' || value === 'tool_calls') return 'tool_calls'
  if (!value && hadToolCall) return 'tool_calls'
  return value
}
