#!/usr/bin/env node
/**
 * Wire-body regression test: what actually goes out to the provider.
 *
 * The bug this guards against: 设置 → 模型服务 stores model *records*
 * ({ id, name, capabilities }), and the chat route forwards them as ctx.model.
 * Every wire protocol wants a plain string — OpenAI / Anthropic / Responses in
 * the JSON body, Gemini in the URL. Sending the record makes strict upstreams
 * answer:
 *
 *   HTTP 400: Failed to deserialize the JSON body into the target type:
 *             model: invalid type: map, expected a string
 *
 * A local echo server captures the real request so the assertion is made on
 * bytes on the wire, not on internal state.
 *
 * Usage: node scripts/test-wire-body.mjs
 */
import http from 'node:http'
import assert from 'node:assert/strict'
import { streamChat } from '../server/llm/index.js'

const captured = []

const FRAMES = {
  openai:
    'data: {"id":"1","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n' +
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
    'data: [DONE]\n\n',
  anthropic:
    'event: message_start\n' +
    'data: {"type":"message_start","message":{"id":"m1","type":"message","role":"assistant","model":"x","content":[],"usage":{"input_tokens":3,"output_tokens":1}}}\n\n' +
    'event: content_block_delta\n' +
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n' +
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  gemini: 'data: {"candidates":[{"content":{"parts":[{"text":"hi"}],"role":"model"},"finishReason":"STOP"}]}\n\n',
  responses:
    'data: {"type":"response.output_text.delta","delta":"hi"}\n\n' +
    'data: {"type":"response.completed","response":{"id":"r1","status":"completed","usage":{"input_tokens":3,"output_tokens":1}}}\n\n'
}

function dialectOf(url) {
  if (url.includes('/v1/messages')) return 'anthropic'
  if (url.includes(':streamGenerateContent')) return 'gemini'
  if (url.includes('/responses')) return 'responses'
  return 'openai'
}

const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (d) => (raw += d))
  req.on('end', () => {
    let body = null
    try {
      body = raw ? JSON.parse(raw) : null
    } catch {
      body = { __unparsed: raw }
    }
    captured.push({ url: req.url, body })
    const dialect = dialectOf(req.url)
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' })
    res.end(FRAMES[dialect])
  })
})

await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const DIALECTS = [
  { type: 'openai', label: 'OpenAI Chat', find: (c) => c.url.endsWith('/v1/chat/completions'), read: (c) => c.body?.model },
  { type: 'openai-response', label: 'OpenAI Responses', find: (c) => c.url.includes('/responses'), read: (c) => c.body?.model },
  { type: 'anthropic', label: 'Anthropic Messages', find: (c) => c.url.endsWith('/v1/messages'), read: (c) => c.body?.model },
  { type: 'gemini', label: 'Gemini v1beta', find: (c) => c.url.includes(':streamGenerateContent'), read: (c) => decodeURIComponent(c.url.split('/models/')[1] || '').split(':')[0] }
]

const MODEL_RECORD = { id: 'gpt-4o-mini', name: 'GPT-4o mini', capabilities: ['text', 'vision'] }
let fail = 0
const check = (name, fn) => {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    fail++
    console.log(`❌ ${name}\n   ${e.message.split('\n').slice(0, 4).join('\n   ')}`)
  }
}

const call = async (type, model, extra = {}) => {
  captured.length = 0
  const events = []
  await streamChat({
    provider: { id: 'wire-test', name: 'wire-test', type, apiHost: base, apiKey: 'sk-test', models: [MODEL_RECORD] },
    model,
    modelId: typeof model === 'string' ? model : model?.id,
    messages: [{ role: 'user', content: '你好' }],
    params: { temperature: 0.2 },
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
    ...extra
  }).catch(() => {}) // response parsing is not what this test asserts on
  return { captured: captured.slice(), events }
}

for (const d of DIALECTS) {
  // 1) the shape the chat route really sends: a full model record
  const { captured: c1 } = await call(d.type, MODEL_RECORD)
  const hit1 = c1.find(d.find)
  check(`${d.label} — 模型记录 (object) 发出的是字符串 id`, () => {
    assert.ok(hit1, `no request captured for ${d.label} (urls: ${c1.map((c) => c.url).join(', ')})`)
    assert.equal(typeof d.read(hit1), 'string', `model on the wire was ${JSON.stringify(d.read(hit1))}`)
    assert.equal(d.read(hit1), 'gpt-4o-mini')
    assert.ok(!JSON.stringify(hit1.body ?? {}).includes('"model":{'), 'body still contains a model map')
  })

  // 2) a plain string must pass through untouched
  const { captured: c2 } = await call(d.type, 'gpt-4o-mini')
  const hit2 = c2.find(d.find)
  check(`${d.label} — 字符串 id 原样发出`, () => {
    assert.ok(hit2, 'no request captured')
    assert.equal(d.read(hit2), 'gpt-4o-mini')
  })
}

// 3) no model at all must fail loudly instead of sending "undefined"
await (async () => {
  let err = null
  try {
    await streamChat({
      provider: { id: 'wire-test', type: 'openai', apiHost: base, apiKey: 'k' },
      messages: [{ role: 'user', content: 'hi' }],
      params: {},
      signal: new AbortController().signal,
      emit: () => {}
    })
  } catch (e) {
    err = e
  }
  check('缺少模型 ID 时抛出明确错误（而不是发出 undefined）', () => {
    assert.ok(err, 'expected streamChat to throw')
    assert.match(err.message, /模型/)
  })
})()

// 4) the mock channel still sees capabilities through ctx.modelInfo
{
  const { events } = await call('mock', { id: 'mock-reasoning', name: 'Mock Reasoning', capabilities: ['text', 'reasoning'] }, {})
  check('本地演示 (Mock) 仍能读到 capabilities（思考过程块）', () => {
    assert.ok(events.some((e) => e.type === 'reasoning'), `events: ${events.map((e) => e.type).join(',')}`)
    assert.ok(events.some((e) => e.type === 'delta'))
  })
}

server.close()
console.log(`\n${fail ? `❌ ${fail} 项失败` : '✅ 全部通过'}\n`)
process.exit(fail ? 1 : 0)
