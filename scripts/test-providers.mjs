#!/usr/bin/env node
/**
 * 模型服务 + 主流智能体注册表 tests.
 *
 * Covers the three things this build changed:
 *   1. opencode-free is the factory-default provider (mock is not)
 *   2. its免-Key chain: 手填 Key → 本机 OpenCode CLI 凭据 → 无 Key
 *   3. the new Code CLI entries — DeepSeek Harness (@deepseek-ai/dsh, port 3080)
 *      and Hermes Agent (config.yaml writer, isolated + merged)
 *
 * Usage: node scripts/test-providers.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { load as yamlLoad } from 'js-yaml'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-studio-providers-'))

// Keep the store out of the real data dir so the tests can toggle overrides.
process.env.DATA_DIR = path.join(tmp, 'data')
delete process.env.OPENCODE_DATA_HOME
delete process.env.OPENCODE_HOME

const { effectiveProviders, defaultModel, availableModels, getProvider, saveProviderOverride, removeProvider } =
  await import('../server/services/providers.js')
const { openCodeAuth, openCodeAuthStatus } = await import('../server/services/openCodeAuth.js')
const { CODE_CLI_TOOLS } = await import('../server/config/codeCliTools.js')

let fail = 0
const check = async (name, fn) => {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    fail++
    console.log(`❌ ${name}\n   ${String(e.message).split('\n').slice(0, 4).join('\n   ')}`)
  }
}

/* ------------------------------------------------------- 1. 默认服务商 */
await check('opencode-free 是出厂默认，且是唯一启用的服务商', () => {
  const ps = effectiveProviders()
  assert.equal(ps[0].id, 'opencode-free', 'should sort first (enabled providers are pinned)')
  assert.deepEqual(ps.filter((p) => p.enabled).map((p) => p.id), ['opencode-free'])
  assert.equal(ps.find((p) => p.id === 'mock').enabled, false, 'mock 不再默认启用')
})

await check('默认模型落在 opencode-free 的免费模型上', () => {
  const d = defaultModel()
  assert.equal(d.providerId, 'opencode-free')
  assert.match(d.modelId, /-free$|^big-pickle$/)
  assert.equal(availableModels()[0].provider, 'opencode-free')
})

await check('opencode-free 记录本身：免 Key、OpenAI 兼容、只列免费模型', () => {
  const p = getProvider('opencode-free')
  assert.equal(p.keyOptional, true)
  assert.equal(p.keyChain, 'opencode-cli')
  // GET /models answers without a key on Zen, so a models-based 检查 would
  // report 连通 for a channel that cannot chat — the flag forces a real probe.
  assert.equal(p.checkViaChat, true)
  assert.equal(p.type, 'openai')
  assert.equal(p.apiHost, 'https://opencode.ai/zen/v1')
  assert.ok(p.models.length >= 7, `${p.models.length} models`)
  assert.ok(p.models.every((m) => /-free$|^big-pickle$/.test(m.id)), 'shipped list must stay free-tier')
  assert.ok(p.note.includes('403'), 'note should warn about the free-tier gate')
})

/* ------------------------------------------------------- 2. 免 Key 链路 */
await check('没有显式 Key 时，keySource 跟随本机凭据探测结果', () => {
  const a = openCodeAuth(true)
  assert.equal(getProvider('opencode-free').keySource, a.key ? 'opencode-cli' : 'none')
})

await check('读取本机 OpenCode CLI 的 auth.json（api key 优先于 oauth 条目）', () => {
  const dir = path.join(tmp, 'oc-data')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'auth.json'),
    JSON.stringify({ anthropic: { type: 'oauth', access: 'ignore-me' }, opencode: { type: 'api', key: 'sk-reused-1234' } })
  )
  process.env.OPENCODE_DATA_HOME = dir
  const a = openCodeAuth(true)
  assert.equal(a.key, 'sk-reused-1234')
  assert.equal(a.source, 'opencode-cli')
  assert.equal(a.entry, 'opencode')
  assert.equal(getProvider('opencode-free').keySource, 'opencode-cli')
  assert.equal(getProvider('opencode-free').keyFile, path.join(dir, 'auth.json'))
  const status = openCodeAuthStatus()
  assert.equal(status.available, true)
  assert.ok(status.keyPreview.startsWith('sk-reu'), 'preview is masked, not the full secret')
})

await check('只有 oauth 登录（拿不到 api key）时不误报可用', () => {
  const dir = path.join(tmp, 'oc-oauth')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({ anthropic: { type: 'oauth', access: 'x' } }))
  process.env.OPENCODE_DATA_HOME = dir
  assert.equal(openCodeAuth(true).key, null)
  assert.equal(openCodeAuthStatus().available, false)
})

await check('auth.json 损坏 / 缺失都不抛异常，静默回退到无 Key', () => {
  const dir = path.join(tmp, 'oc-bad')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'auth.json'), '{ not json')
  process.env.OPENCODE_DATA_HOME = dir
  assert.equal(openCodeAuth(true).key, null)
  delete process.env.OPENCODE_DATA_HOME
  assert.equal(openCodeAuth(true).key, null)
})

await check('手填 Key 优先级最高，清掉后回落到凭据链', () => {
  process.env.OPENCODE_DATA_HOME = path.join(tmp, 'oc-data')
  openCodeAuth(true)
  saveProviderOverride('opencode-free', { apiKey: 'sk-user-typed' })
  assert.equal(getProvider('opencode-free').keySource, 'user')
  assert.equal(getProvider('opencode-free').apiKey, 'sk-user-typed')
  removeProvider('opencode-free') // built-in providers reset instead of delete
  assert.equal(getProvider('opencode-free').keySource, 'opencode-cli')
  delete process.env.OPENCODE_DATA_HOME
  openCodeAuth(true)
})

/* --------------------------------------- 3. 主流智能体：DeepSeek Harness */
await check('DeepSeek Harness 指向真实包 @deepseek-ai/dsh（不是 npm 上的保留空包）', () => {
  const d = CODE_CLI_TOOLS.find((t) => t.id === 'deepseek-harness')
  assert.equal(d.npmPackage, '@deepseek-ai/dsh')
  assert.equal(d.bin, 'dsh')
  assert.equal(d.runMode, 'service')
  assert.equal(d.servicePort, 3080, 'dsh web listens on 127.0.0.1:3080')
  assert.notEqual(d.available, false, 'must be installable now')
  assert.ok(d.altBins.includes('deepseek-harness'), 'Python SDK ships the same command name')
  assert.deepEqual(d.buildLaunch({ cfg: { profile: 'web' } }).args, ['web'])
  assert.deepEqual(d.buildLaunch({ cfg: { profile: 'headless' } }).args, ['--profile', 'headless'])
  assert.equal(d.buildLaunch({ cfg: { apiKey: 'sk-x' } }).env.DEEPSEEK_API_KEY, 'sk-x')
})

/* ------------------------------------------- 4. 主流智能体：Hermes Agent */
await check('Hermes Agent 注册项：npm 包名 / 命令名 / 文件式配置', () => {
  const h = CODE_CLI_TOOLS.find((t) => t.id === 'hermes-agent')
  assert.ok(h, 'hermes-agent missing from the registry')
  assert.equal(h.npmPackage, 'hermes-agent')
  assert.equal(h.bin, 'hermes')
  assert.equal(h.configMode, 'file')
  assert.equal(h.loginMode, 'both')
  assert.ok(h.gatewayInterfaces.includes('openai'))
})

await check('Hermes：隔离 HERMES_HOME 写出 hermes 能读的 config.yaml', () => {
  const h = CODE_CLI_TOOLS.find((t) => t.id === 'hermes-agent')
  const dir = path.join(tmp, 'hermes-managed')
  const r = h.writeConfig({
    dir,
    endpoint: 'http://127.0.0.1:3000/gateway/openai/hermes-agent',
    apiKey: 'agent-studio-gateway',
    model: 'big-pickle',
    cfg: { mode: 'gateway' }
  })
  assert.equal(r.env.HERMES_HOME, path.join(dir, 'hermes-home'))
  assert.equal(r.env.OPENAI_BASE_URL, 'http://127.0.0.1:3000/gateway/openai/hermes-agent/v1')
  const doc = yamlLoad(fs.readFileSync(path.join(dir, 'hermes-home', 'config.yaml'), 'utf8'))
  assert.equal(doc.model.provider, 'agent-studio')
  assert.equal(doc.model.default, 'big-pickle')
  assert.equal(doc.providers['agent-studio'].type, 'openai')
  assert.match(doc.providers['agent-studio'].base_url, /\/v1$/)
  assert.deepEqual(doc.providers['agent-studio'].models, ['big-pickle'])
  assert.equal(doc.providers['agent-studio'].key_env, 'AGENT_STUDIO_GATEWAY_KEY')
})

await check('Hermes：旧非隔离开关不再改写宿主配置', () => {
  const home = path.join(tmp, 'fake-home')
  fs.mkdirSync(path.join(home, '.hermes'), { recursive: true })
  fs.writeFileSync(
    path.join(home, '.hermes', 'config.yaml'),
    'model:\n  provider: nous\n  default: hermes-4\ndelegation:\n  enabled: true\n'
  )
  const savedHome = process.env.HOME
  const savedProfile = process.env.USERPROFILE
  process.env.HOME = home
  process.env.USERPROFILE = home
  try {
    // Guard: if the platform ignores the env override we would write to the
    // real ~/.hermes — fail loudly instead.
    assert.equal(os.homedir(), home, 'homedir() not redirected by env')
    const h = CODE_CLI_TOOLS.find((t) => t.id === 'hermes-agent')
    h.writeConfig({
      dir: path.join(tmp, 'unused'),
      endpoint: 'http://127.0.0.1:3000/gateway/openai/hermes-agent',
      apiKey: 'k',
      model: 'mimo-v2.5-free',
      cfg: { mode: 'gateway', isolatedHome: false }
    })
    const doc = yamlLoad(fs.readFileSync(path.join(home, '.hermes', 'config.yaml'), 'utf8'))
    assert.equal(doc.model.provider, 'nous')
    assert.equal(doc.model.default, 'hermes-4')
    assert.deepEqual(doc.delegation, { enabled: true }, 'host file must remain unchanged')
    const portable=yamlLoad(fs.readFileSync(path.join(tmp,'unused','hermes-home','config.yaml'),'utf8'))
    assert.equal(portable.model.default,'mimo-v2.5-free')
    assert.ok(portable.providers['agent-studio'])
  } finally {
    process.env.HOME = savedHome
    process.env.USERPROFILE = savedProfile
  }
})

await check('Hermes：账号模式不写网关配置', () => {
  const h = CODE_CLI_TOOLS.find((t) => t.id === 'hermes-agent')
  const dir = path.join(tmp, 'account-mode')
  const r = h.writeConfig({ dir, endpoint: null, apiKey: undefined, model: '', cfg: { mode: 'account' } })
  assert.equal(r.env.HERMES_HOME, path.join(dir,'hermes-home'))
  assert.equal(fs.existsSync(path.join(dir, 'hermes-home', 'config.yaml')), false)
})

/* --------------------------------------------------- 5. 主流智能体清单收敛 */
await check('OpenCode：免 Key 模式预设 Zen 免费模型 big-pickle，网关模式写隔离 opencode.json', () => {
  const oc = CODE_CLI_TOOLS.find((t) => t.id === 'opencode')
  assert.equal(oc.npmPackage, 'opencode-ai'); assert.equal(oc.bin, 'opencode'); assert.equal(oc.ignoreInstallScripts, true); assert.ok(oc.platformBinary.win32.x64.includes('opencode-windows-x64'))
  const dir = path.join(tmp, 'oc-cfg')
  const a = oc.writeConfig({ dir, endpoint: null, apiKey: undefined, model: '', cfg: { mode: 'account' } })
  assert.equal(oc.isDefault, true); assert.equal(oc.defaultMode, 'account')
  assert.equal(JSON.parse(fs.readFileSync(a.env.OPENCODE_CONFIG, 'utf8')).model, 'opencode/big-pickle', '免 Key 模式预设免费模型')
  const g = oc.writeConfig({ dir, endpoint: 'http://127.0.0.1:3000/gateway/openai/opencode', apiKey: 'k', model: 'big-pickle', cfg: { mode: 'gateway' } })
  const doc = JSON.parse(fs.readFileSync(g.env.OPENCODE_CONFIG, 'utf8'))
  assert.equal(doc.model, 'agent-studio/big-pickle')
  assert.equal(doc.provider['agent-studio'].options.baseURL, 'http://127.0.0.1:3000/gateway/openai/opencode/v1')
  assert.equal(doc.provider['agent-studio'].npm, '@ai-sdk/openai-compatible')
})

await check('主流智能体 7 个（OpenCode 默认在首位）：opencode / claude-code / codex / pi / dsh / hermes / openclaw', () => {
  assert.deepEqual(
    CODE_CLI_TOOLS.map((t) => t.id),
    ['opencode', 'claude-code', 'codex', 'pi', 'deepseek-harness', 'hermes-agent', 'openclaw']
  )
  for (const gone of ['gemini-cli', 'qwen-code', 'kimi-code', 'qoder-cli', 'copilot-cli']) {
    assert.equal(CODE_CLI_TOOLS.some((t) => t.id === gone), false, `${gone} 应已删除`)
  }
  assert.equal(CODE_CLI_TOOLS.find((t) => t.id === 'pi').name, 'Pi Agent')
  assert.equal(CODE_CLI_TOOLS.find((t) => t.id === 'deepseek-harness').name, 'DeepSeek Harness (DSH)')
})

/* ------------------------------------------------------ 6. OpenClaw 注册项 */
const openclaw = CODE_CLI_TOOLS.find((t) => t.id === 'openclaw')

await check('OpenClaw 注册项：npm 包名 / 命令名 / 旧名别名 / 文件式配置', () => {
  assert.equal(openclaw.npmPackage, 'openclaw')
  assert.equal(openclaw.bin, 'openclaw')
  assert.ok(openclaw.altBins.includes('clawdbot'), 'legacy clawdbot command is still aliased upstream')
  assert.equal(openclaw.configMode, 'file')
  assert.equal(openclaw.loginMode, 'both')
  assert.ok(openclaw.gatewayInterfaces.includes('openai'))
})

await check('OpenClaw 启动方式参数：tui --local / tui / gateway run / onboard / doctor', () => {
  const args = (m) => openclaw.buildLaunch({ cfg: { launchMode: m, gatewayPort: 19000 } }).args
  assert.deepEqual(args('tui-local'), ['tui', '--local'])
  assert.deepEqual(args('tui'), ['tui'])
  assert.deepEqual(args('gateway'), ['gateway', 'run', '--port', '19000', '--bind', 'loopback'])
  assert.deepEqual(args('onboard'), ['onboard'])
  assert.deepEqual(args('doctor'), ['doctor'])
})

await check('OpenClaw：仅写传入目录内的 openclaw-home/openclaw.json（provider + 白名单，密钥用 env 引用）', () => {
  const home = path.join(tmp, 'oc-home')
  const savedHome = process.env.HOME
  const savedProfile = process.env.USERPROFILE
  process.env.HOME = home
  process.env.USERPROFILE = home
  try {
    assert.equal(os.homedir(), home, 'homedir() not redirected by env')
    const r = openclaw.writeConfig({
      dir: path.join(tmp, 'unused'),
      endpoint: 'http://127.0.0.1:3000/gateway/openai/openclaw',
      apiKey: 'agent-studio-gateway',
      model: 'big-pickle',
      cfg: { mode: 'gateway' }
    })
    assert.equal(r.env.AGENT_STUDIO_GATEWAY_KEY, 'agent-studio-gateway')
    assert.equal(r.warning, undefined)
    assert.equal(fs.existsSync(path.join(home,'.openclaw')),false,'host OpenClaw home must not be written')
    assert.equal(r.env.OPENCLAW_STATE_DIR,path.join(tmp,'unused','openclaw-home'))
    const doc = JSON.parse(fs.readFileSync(path.join(tmp,'unused','openclaw-home','openclaw.json'), 'utf8'))
    const prov = doc.models.providers['agent-studio']
    assert.equal(prov.api, 'openai-completions')
    assert.equal(prov.baseUrl, 'http://127.0.0.1:3000/gateway/openai/openclaw/v1')
    // 密钥走 ${ENV} 引用，不落盘
    assert.equal(prov.apiKey, '${AGENT_STUDIO_GATEWAY_KEY}')
    assert.equal(prov.models[0].id, 'big-pickle')
    // 少了白名单 OpenClaw 会回 "model not allowed"
    assert.equal(doc.agents.defaults.model.primary, 'agent-studio/big-pickle')
    assert.ok(doc.agents.defaults.models['agent-studio/big-pickle'], 'allowlist entry missing')

    /* 再跑一次：JSON5（裸键 + 注释 + 单引号 + 尾逗号）必须被合并而不是覆盖 */
    const file = path.join(tmp,'unused','openclaw-home','openclaw.json')
    fs.writeFileSync(
      file,
      `{
  // 手写的配置
  gateway: { port: 18789, bind: 'loopback', },
  channels: { telegram: { enabled: true } },
  /* 块注释 */
  models: { mode: 'merge', providers: { ollama: { baseUrl: "http://127.0.0.1:11434" } } },
}`
    )
    const r2 = openclaw.writeConfig({
      dir: path.join(tmp, 'unused'),
      endpoint: 'http://127.0.0.1:3000/gateway/openai/openclaw',
      apiKey: 'k',
      model: 'mimo-v2.5-free',
      cfg: { mode: 'gateway' }
    })
    assert.equal(r2.warning, undefined, `JSON5 should parse, got: ${r2.warning}`)
    const merged = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.deepEqual(merged.gateway, { port: 18789, bind: 'loopback' }, 'user keys must survive')
    assert.deepEqual(merged.channels, { telegram: { enabled: true } })
    assert.ok(merged.models.providers.ollama, 'other providers must survive')
    assert.equal(merged.agents.defaults.model.primary, 'agent-studio/mimo-v2.5-free')

    /* 解析不了就绝不改写，并把原因带回终端 */
    fs.writeFileSync(file, '{ models: { providers: { x: { baseUrl: "http://y" } } ') // truncated
    const before = fs.readFileSync(file, 'utf8')
    const r3 = openclaw.writeConfig({
      dir: path.join(tmp, 'unused'),
      endpoint: 'http://127.0.0.1:3000/gateway/openai/openclaw',
      apiKey: 'k',
      model: 'm',
      cfg: { mode: 'gateway' }
    })
    assert.ok(r3.warning && r3.warning.includes('没有改写'), 'should refuse, not clobber')
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'file must be untouched')

    /* 账号模式：不写任何配置 */
    const r4 = openclaw.writeConfig({ dir: path.join(tmp, 'unused'), endpoint: null, apiKey: undefined, model: '', cfg: { mode: 'account' } })
    assert.equal(r4.env.OPENCLAW_STATE_DIR,path.join(tmp,'unused','openclaw-home'))
  } finally {
    process.env.HOME = savedHome
    process.env.USERPROFILE = savedProfile
  }
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${fail ? `❌ ${fail} 项失败` : '✅ 全部通过'}\n`)
process.exit(fail ? 1 : 0)
