import { partsOf } from './message.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Offline demo channel. Streams a deterministic reply so the whole chat stack
 * (SSE transport, incremental rendering, token metrics, multi-model compare,
 * thinking blocks) can be exercised without any API key.
 * Clearly labelled 本地演示 (Mock) in the provider list and can be disabled.
 */
export async function streamMock(ctx) {
  const { params, signal } = ctx
  // streamChat() normalises ctx.model to the string id; the record (with
  // capabilities) travels as ctx.modelInfo.
  const model = ctx.modelInfo && typeof ctx.modelInfo === 'object' ? ctx.modelInfo : { id: ctx.model }
  const messages = ctx.messages || []
  const last = [...messages].reverse().find((m) => m.role === 'user')
  const { text, images } = partsOf(last?.content)
  const question = (text || '').trim().slice(0, 200) || '(空消息)'
  const isReasoning = Array.isArray(model.capabilities) && model.capabilities.includes('reasoning')
  const isVision = Array.isArray(model.capabilities) && model.capabilities.includes('vision')

  if (isReasoning) {
    const thinking = [
      '用户的问题是：',
      question,
      '。',
      '我先拆解需求，再给出结论与示例。',
      '（这是本地演示通道的模拟思考过程）'
    ].join('')
    for (const piece of chunkText(thinking, 6)) {
      if (signal?.aborted) return
      ctx.emit({ type: 'reasoning', text: piece })
      await sleep(12)
    }
  }

  const reply = buildReply({ question, model, images, params, isVision })
  let chars = 0
  for (const piece of chunkText(reply, 5)) {
    if (signal?.aborted) return
    ctx.emit({ type: 'delta', text: piece })
    chars += piece.length
    await sleep(14)
  }

  const inputTokens = Math.max(1, Math.round(JSON.stringify(messages).length / 4))
  const outputTokens = Math.max(1, Math.round(chars / 4))
  ctx.emit({
    type: 'usage',
    usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens }
  })
  ctx.emit({ type: 'finish_reason', value: 'stop' })
}

function* chunkText(text, size) {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size)
}

function buildReply({ question, model, images, params, isVision }) {
  const lines = []
  lines.push(`**本地演示通道**已收到你的消息，当前模型：\`${model.id}\`。`)
  lines.push('')
  if (images.length && isVision) {
    lines.push(`我注意到你附带了 ${images.length} 张图片（该模型声明了 vision 能力）。`)
    lines.push('')
  } else if (images.length) {
    lines.push(`你附带了 ${images.length} 张图片，但当前模型未声明 vision 能力，图片会被忽略。`)
    lines.push('')
  }
  lines.push('> ' + question)
  lines.push('')
  lines.push('这是一段用于验证 Markdown 渲染的示例内容：')
  lines.push('')
  lines.push('- 列表项一：**加粗**、*斜体*、~~删除线~~、`行内代码`')
  lines.push('- 列表项二：[链接](https://example.com)')
  lines.push('- 列表项三：数学式与表格见下')
  lines.push('')
  lines.push('| 参数 | 值 |')
  lines.push('| --- | --- |')
  lines.push(`| temperature | ${params.temperature ?? '默认'} |`)
  lines.push(`| maxTokens | ${params.maxTokens ?? '默认'} |`)
  lines.push(`| 思考强度 | ${params.reasoningEffort || '未设置'} |`)
  lines.push('')
  lines.push('```ts')
  lines.push('// 代码高亮验证')
  lines.push('export async function streamChat(model: string, prompt: string) {')
  lines.push('  const res = await fetch(`/api/chat/completions`, {')
  lines.push('    method: "POST",')
  lines.push('    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] })')
  lines.push('  })')
  lines.push('  return res.body!')
  lines.push('}')
  lines.push('```')
  lines.push('')
  lines.push('在「设置 → 模型服务」里填入真实服务商的 API 密钥并打开开关后，对话会走真实模型。')
  return lines.join('\n')
}

export async function listModelsMock() {
  return [
    { id: 'mock-chat', name: 'Mock Chat', capabilities: ['text'] },
    { id: 'mock-vision', name: 'Mock Vision', capabilities: ['text', 'vision'] },
    { id: 'mock-reasoning', name: 'Mock Reasoning', capabilities: ['text', 'reasoning'] }
  ]
}
