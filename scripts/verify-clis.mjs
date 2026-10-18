#!/usr/bin/env node
/**
 * End-to-end verification of the unified gateway against the REAL coding CLIs.
 *
 * Every tool is pointed at the built-in offline `mock` provider, so this needs
 * no API keys and no network egress: whatever text comes back on the CLI's
 * stdout can only have travelled CLI -> gateway -> dialect translation -> mock.
 *
 * Usage: node scripts/verify-clis.mjs [--install] [--only=codex,pi]
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const BASE = process.env.AGENT_STUDIO_BASE || process.env.CHERRY_BASE || 'http://127.0.0.1:3000'
const MARKER = '模型服务' // deterministic fragment of the mock provider reply
const PROMPT = '请用一句话介绍你自己'
const install = process.argv.includes('--install')
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean)

const TOOLS = [
  { id: 'claude-code', iface: 'anthropic', dialect: 'Anthropic Messages', headless: ['-p', PROMPT] },
  { id: 'codex', iface: 'openai-response', dialect: 'OpenAI Responses', headless: ['exec', PROMPT, '--skip-git-repo-check'] },
  { id: 'pi', iface: 'openai', dialect: 'OpenAI Chat', headless: ['-p', PROMPT, '--no-session'] }
  // 主流智能体清单里剩下的三个没有可离线验证的无头通道，所以不在矩阵内：
  //   deepseek-harness  dsh --profile headless "<task>"（需要 Node >= 22.19，且要真实 DeepSeek 账号）
  //   openclaw          openclaw tui --local --message "<text>"（安装包约 200MB，Node >= 24.16）
  //   hermes-agent      官方文档没有非交互模式（hermes chat 是交互式 TUI）
].filter((t) => !only.length || only.includes(t.id))

const api = async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  try {
    return { status: res.status, json: JSON.parse(text) }
  } catch {
    return { status: res.status, json: null, text }
  }
}

const runCli = (bin, args, env, cwd, timeoutMs = 120000) =>
  new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, out: String(e.message || e) })
    })
  })

const strip = (s) => s.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '')
const results = []

for (const tool of TOOLS) {
  const row = { id: tool.id, dialect: tool.dialect }
  // GET /api/codecli/tools -> [{ id, detection: { source, path, version }, config, ... }]
  const list = await api('GET', '/api/codecli/tools')
  const meta = Array.isArray(list.json) ? list.json.find((t) => t.id === tool.id) : null
  if (!meta) {
    results.push({ ...row, status: 'MISSING', note: 'tool not in registry' })
    continue
  }
  if (!meta.detection?.path) {
    if (!install) {
      results.push({ ...row, status: 'SKIP', note: 'not installed (pass --install)' })
      continue
    }
    process.stdout.write(`  installing ${tool.id} ... `)
    const inst = await api('POST', `/api/codecli/tools/${tool.id}/install`, {})
    process.stdout.write(`${inst.status}\n`)
  }
  if (meta.detection?.version) row.version = meta.detection.version

  await api('PUT', `/api/codecli/configs/${tool.id}`, {
    mode: 'gateway',
    providerId: 'mock',
    modelId: 'mock-chat',
    gatewayId: tool.id,
    workDir: process.cwd(),
    manageAuth: true
  })

  const preview = await api('POST', `/api/codecli/tools/${tool.id}/preview?raw=1`, {})
  if (preview.status !== 200 || !preview.json?.bin) {
    results.push({ ...row, status: 'FAIL', note: `preview ${preview.status}: ${preview.json?.error || preview.text || ''}` })
    continue
  }
  const { bin, args, env, cwd } = preview.json
  if (!fs.existsSync(bin)) {
    results.push({ ...row, status: 'FAIL', note: `bin missing: ${bin}` })
    continue
  }
  const { code, out } = await runCli(bin, [...args, ...tool.headless], env, cwd)
  const clean = strip(out)
  const ok = clean.includes(MARKER)
  results.push({
    ...row,
    status: ok ? 'PASS' : 'FAIL',
    note: ok ? `exit ${code}` : `exit ${code}: ${clean.split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 160)}`
  })
}

console.log('\n统一网关 × 真实 CLI 验证（全部走离线 mock 服务商，无需 API 密钥）\n')
for (const r of results) {
  const icon = r.status === 'PASS' ? '✅' : r.status === 'SKIP' ? '⏭️ ' : r.status === 'MISSING' ? '❔' : '❌'
  const ver = r.version ? `v${r.version}`.padEnd(10) : ''.padEnd(10)
  console.log(`${icon} ${r.id.padEnd(12)} ${ver}${r.dialect.padEnd(24)} ${r.status.padEnd(6)} ${r.note || ''}`)
}
const passed = results.filter((r) => r.status === 'PASS').length
console.log(`\n${passed}/${results.length} 通过\n`)
process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0)
