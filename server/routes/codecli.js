import { portableToolEnv, toolConfigDir, workspaceDir, inside, safePortableFile } from '../codecli/portable.js'
import express from 'express'
import { proxyEnv } from '../net/proxy.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { findRow, upsertRow, table, getSettings, DATA_DIR } from '../store.js'
import { CODE_CLI_TOOLS, builtinTool, resolveEndpoint } from '../config/codeCliTools.js'
import { resetPathCaches, executableEnvironment, toolOperationRunning } from '../codecli/manager.js'
import { commandLineFor, isPosixShell } from '../codecli/winShell.js'
import { getProvider, effectiveProviders } from '../services/providers.js'
import { detectTool, installTool, uninstallTool, listTerminals, resolveManagedBin, managedDir } from '../codecli/manager.js'
import { createSession, getSession, listSessions, killSession, listDir, homeDir, ptyAvailable } from '../codecli/terminal.js'

export const codecliRouter = express.Router()
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(e.status || 500).json({ error: e.message }))

const detectionCache = new Map()
const DETECTION_TTL = 30_000

async function detection(toolId, force = false) {
  const cached = detectionCache.get(toolId)
  if (!force && cached && Date.now() - cached.at < DETECTION_TTL) return cached.result
  // A forced re-detect means "look again from scratch": the PATH / npm-prefix /
  // install-directory caches must go too, or a CLI installed after the server
  // started stays invisible.
  if (force) resetPathCaches()
  const tool = builtinTool(toolId)
  if (!tool) return null
  const result = await detectTool(tool)
  detectionCache.set(toolId, { at: Date.now(), result })
  return result
}

function config(toolId) {
  const c = findRow('codecli', toolId)
  return c ? {...c,binPath:'',isolatedHome:true,terminal:'direct',workDir:path.relative(DATA_DIR,workspaceDir(c.workDir))} : null
}

function saveConfig(toolId, patch) {
  const existing = config(toolId) || { id: toolId, gatewayId: toolId }
  const defaults = {}
  for (const p of builtinTool(toolId)?.params || []) defaults[p.key] = p.default
  const next = { ...defaults, ...existing, ...patch, id: toolId, toolId, gatewayId: toolId, updatedAt: Date.now() }
  next.binPath=''; next.isolatedHome=true; next.terminal='direct'; next.workDir=path.relative(DATA_DIR,workspaceDir(next.workDir))
  upsertRow('codecli', next)
  return next
}

codecliRouter.get('/meta', (req, res) => {
  res.json({ ptyAvailable, homeDir: workspaceDir(), portableOnly:true, platform: process.platform, managedRoot: managedDir('_') })
})

/** Registry + saved config + cached detection (fast first paint). */
codecliRouter.get('/tools', wrap(async (req, res) => {
  const refresh = req.query.refresh === '1'
  // Detect in parallel: 11 tools x (spawn --version + npm view) is slow enough
  // sequentially that the page looks like detection never finished.
  const tools = await Promise.all(
    CODE_CLI_TOOLS.map(async (tool) => {
      const cfg = config(tool.id)
      const det = await detection(tool.id, refresh)
      return {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        website: tool.website,
        docs: tool.docs,
        npmPackage: tool.npmPackage,
        bin: tool.bin,
        altBins: tool.altBins || [],
        runMode: tool.runMode || 'terminal',
        // servicePort: the port a runMode:'service' tool's own Web UI listens on
        // (dsh web -> 3080); configMode tells the UI whether connecting writes a
        // config file instead of only exporting env vars.
        servicePort: tool.servicePort,
        configMode: tool.configMode || 'env',
        available: tool.available !== false,
        unavailableReason: tool.unavailableReason,
        interfaces: tool.interfaces,
        gatewayInterfaces: tool.gatewayInterfaces,
        loginMode: tool.loginMode,
        defaultMode: tool.defaultMode || null,
        isDefault: !!tool.isDefault,
        accountLoginHint: tool.accountLoginHint,
        params: tool.params,
        detection: det,
        config: cfg
          ? {
              ...cfg,
              apiKey: cfg.apiKey ? maskKey(cfg.apiKey) : '',
              hasApiKey: !!cfg.apiKey
            }
          : null
      }
    })
  )
  res.json(tools)
}))

codecliRouter.get('/tools/:id/detect', wrap(async (req, res) => {
  const det = await detection(req.params.id, true)
  if (!det) return res.status(404).json({ error: '工具不存在' })
  res.json(det)
}))

/** 安装 / 更新 — streamed as SSE so the UI shows npm output live. */
for (const action of ['install', 'update', 'reinstall']) {
  codecliRouter.post(`/tools/:id/${action}`, wrap(async (req, res) => {
    const tool = builtinTool(req.params.id)
    if (!tool) return res.status(404).json({ error: '工具不存在' })
    if (tool.available === false) return res.status(400).json({ error: tool.unavailableReason || '该工具暂不可安装' })
    if (toolOperationRunning(tool.id) || listSessions().some(s => s.toolId === tool.id && s.exitCode == null)) return res.status(409).json({error:'该智能体正在安装或运行，请等待安装完成／先终止会话再操作'})

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    res.flushHeaders?.()
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)

    send({ type: 'start', action, package: tool.npmPackage })
    let cancelled = false
    res.on('close', () => (cancelled = true))

    const result = await installTool(tool, (line) => {
      if (!cancelled) send(line)
    }, {action})
    detectionCache.delete(tool.id)
    const det = await detection(tool.id, true)
    send({ type: 'done', ...result, detection: det })
    res.end()
  }))
}

codecliRouter.post('/tools/:id/uninstall', wrap((req, res) => {
  const tool = builtinTool(req.params.id)
  if (!tool) return res.status(404).json({ error: '工具不存在' })
  if (listSessions().some(s=>s.toolId===tool.id && s.exitCode==null)) return res.status(409).json({error:'请先终止该智能体的运行会话'})
  const r = uninstallTool(tool)
  detectionCache.delete(tool.id)
  res.json(r)
}))

/** Compatible providers for a tool — filtered by required interface type. */
codecliRouter.get('/tools/:id/providers', (req, res) => {
  const tool = builtinTool(req.params.id)
  if (!tool) return res.status(404).json({ error: '工具不存在' })
  const providers = effectiveProviders()
    .filter((p) => p.enabled)
    .filter((p) => tool.interfaces.includes(p.type))
    .map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      apiHost: p.apiHost,
      hasKey: !!p.apiKey || (p.apiKeys || []).length > 0,
      models: p.models.filter((m) => m.status !== 3 && !(m.capabilities || []).includes('embedding')).map((m) => ({ id: m.id, name: m.name, capabilities: m.capabilities }))
    }))
  res.json({ interfaces: tool.interfaces, providers, gatewayInterfaces: tool.gatewayInterfaces })
})

codecliRouter.get('/configs/:id', (req, res) => {
  const cfg = config(req.params.id)
  if (!cfg) return res.json({})
  res.json({ ...cfg, apiKey: cfg.apiKey ? maskKey(cfg.apiKey) : '', hasApiKey: !!cfg.apiKey })
})

codecliRouter.put('/configs/:id', (req, res) => {
  const tool = builtinTool(req.params.id)
  if (!tool) return res.status(404).json({ error: '工具不存在' })
  const body = { ...req.body }
  // The UI sends a masked placeholder when the key was not edited.
  if (body.apiKey && String(body.apiKey).includes('•')) delete body.apiKey
  res.json({ ...saveConfig(req.params.id, body), apiKey: undefined, hasApiKey: !!config(req.params.id)?.apiKey })
})

codecliRouter.get('/terminals', wrap(async (req, res) => {
  res.json([{id:'direct',name:'盘内 CLI（直接启动）',isDefault:true}])
}))

codecliRouter.get('/sessions', (req, res) => res.json(listSessions()))

/**
 * 终止进程 — kills the CLI's whole process tree and reports what happened.
 * Always answers 200 with an explicit result: a bare 500 (or a dead server) is
 * what made this look like "终止失败 + Agent Studio 自己退出了".
 */
codecliRouter.post('/sessions/:id/kill', wrap(async (req, res) => {
  const result = await killSession(req.params.id)
  res.json(result)
}))

/** Directory browser backing the 工作目录 picker. */
codecliRouter.get('/fs/list', (req, res) => {
  const target = path.resolve(DATA_DIR, String(req.query.path || workspaceDir()))
  if (!inside(DATA_DIR,target) || !safePortableFile(target)) return res.status(403).json({error:'便携模式只能浏览当前应用 data 内的目录'})
  const result = listDir(target)
  if (result.parent && !inside(DATA_DIR,result.parent)) result.parent = null
  if (result.error) return res.status(400).json(result)
  res.json(result)
})

function maskKey(key) {
  const k = String(key)
  if (k.length <= 8) return '•'.repeat(k.length)
  return `${k.slice(0, 4)}${'•'.repeat(8)}${k.slice(-4)}`
}

/**
 * 预览用的 env 打码：密钥一律打码；代理地址只在**带凭据**（http://user:pass@host）时打码，
 * 否则原样显示 —— 用户需要能看出「代理到底有没有传给 CLI」。
 */
function maskEnv(env = {}) {
  return Object.fromEntries(
    Object.entries(env).map(([k, v]) => [
      k,
      /KEY|TOKEN|SECRET/i.test(k) ? maskKey(v) : /PROXY/i.test(k) && String(v).includes('@') ? maskKey(v) : v
    ])
  )
}

/** Preview / launch. Returns the exact command line and env that will be used.
 *  `shellId` decides the quoting style, because the command line is typed into
 *  that shell (cmd.exe and PowerShell quote differently from POSIX shells). */
function buildLaunchPlan(tool, cfg, { port, shellId }) {
  const bin = resolveManagedBin(tool)
  if (!bin) return {error:`${tool.name} 在当前盘内尚未安装，请先点击安装；不会使用宿主版本或手动路径`}
  const source = 'managed'
  const isolatedEnv = portableToolEnv(tool.id)
  const settings = getSettings()
  const gatewayBase = settings.gatewayHost || `http://127.0.0.1:${port}`
  const mode = cfg.mode || tool.defaultMode || (tool.loginMode === 'account' ? 'account' : 'gateway')

  let provider = null
  if (mode !== 'account' && cfg.providerId) provider = getProvider(cfg.providerId)
  if (mode !== 'account' && !provider) {
    return { error: tool.loginMode === 'account' ? '请先完成该工具的原生登录配置' : '请先选择服务商' }
  }

  const endpoint = resolveEndpoint({ tool, cfg: { ...cfg, mode, apiHost: provider?.apiHost }, provider, gatewayBase })

  // Direct connection only works when the provider speaks a protocol the CLI
  // understands; otherwise the unified gateway must be used.
  if (mode === 'direct' && provider && !(tool.interfaces || []).includes(provider.type)) {
    return {
      error: `${tool.name} 直连需要 ${tool.interfaces.join(' / ')} 类型的服务商，而「${provider.name}」是 ${provider.type} 类型。请改用「统一网关」。`
    }
  }

  const apiKeyForCli =
    mode === 'account' ? undefined : mode === 'gateway' ? 'agent-studio-gateway' : provider?.apiKey || provider?.apiKeys?.[0] || ''

  const modelForCli = cfg.modelId || provider?.models?.[0]?.id || ''
  let configWarning = ''
  const built = tool.buildLaunch({
    cfg: { ...cfg, mode, apiKey: apiKeyForCli, apiHost: provider?.apiHost, model: modelForCli },
    endpoint,
    providerType: provider?.type
  })

  // Tools that configure themselves through files instead of env vars get a
  // managed config dir written on every launch.
  if (tool.writeConfig) {
    const configDir = toolConfigDir(tool.id)
    const written = tool.writeConfig({
      dir: configDir,
      endpoint,
      apiKey: apiKeyForCli,
      model: modelForCli,
      cfg,
      provider
    })
    Object.assign(built.env, written.env || {})
    if (written.args) built.args = written.args
    // A tool may refuse to touch a config file it cannot parse safely (OpenClaw's
    // JSON5) — that has to reach the user, not vanish.
    if (written.warning) configWarning = written.warning
  }

  const extra = String(cfg.extraArgs || '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const args = [...(built.args || []), ...extra]
  // 账号模式下 CLI 自己直连上游：把当前生效的代理透传给它（工具自带的 env 优先）。
  const env = { ...proxyEnv(), ...built.env, ...isolatedEnv }
  const commandLine = commandLineFor(bin, args, shellId)

  return { bin, args, env, source, commandLine, endpoint, mode, providerName: provider?.name, modelId: cfg.modelId, warning: configWarning }
}

codecliRouter.post('/tools/:id/preview', wrap((req, res) => {
  const tool = builtinTool(req.params.id)
  if (!tool) return res.status(404).json({ error: '工具不存在' })
  const cfg = { ...saveConfig(req.params.id, {}), ...(req.body || {}) }
  const plan = buildLaunchPlan(tool, cfg, { port: req.app.get('port'), shellId: process.platform === 'win32' ? 'cmd' : 'sh' })
  if (plan.error) return res.status(400).json({ error: plan.error })
  // `?raw=1` returns unmasked env + machine-readable bin/args so automation
  // (scripts/verify-clis.mjs) can launch exactly what the UI would launch.
  const raw = String(req.query.raw || '') === '1'
  res.json({
    commandLine: plan.commandLine,
    bin: plan.bin,
    args: plan.args,
    cwd: workspaceDir(cfg.workDir),
    mode: plan.mode,
    provider: plan.providerName,
    model: plan.modelId,
    endpoint: plan.endpoint,
    source: plan.source,
    warning: plan.warning || '',
    env: raw ? plan.env : maskEnv(plan.env)
  })
}))

/**
 * 启动 — runs the CLI inside the selected shell of a real PTY session.
 * The browser attaches over WebSocket and gets an xterm.js terminal.
 */
codecliRouter.post('/tools/:id/launch', wrap(async (req, res) => {
  const tool = builtinTool(req.params.id)
  if (!tool) return res.status(404).json({ error: '工具不存在' })

  const cfg = saveConfig(req.params.id, req.body?.config || {})

  await detection(tool.id, true)
  const executionEnv = await executableEnvironment()
  const shell = {id:process.platform === 'win32' ? 'cmd' : 'sh',name:'盘内 CLI（直接启动）'}
  const plan = buildLaunchPlan(tool, cfg, { port: req.app.get('port'), shellId: shell.id })
  if (plan.error) return res.status(400).json({ error: plan.error })

  // Make sure the managed bin is reachable from the shell we spawn.
  const env = {
    ...executionEnv,
    ...plan.env,
    PATH: [path.dirname(plan.bin), executionEnv.PATH || executionEnv.Path].filter(Boolean).join(path.delimiter),
    AGENT_STUDIO_MANAGED: '1'
  }
  const cwd = workspaceDir(cfg.workDir)

  const session = createSession({
    kind: 'tool',
    label: `${tool.name} · ${path.basename(cwd)}`,
    toolId: tool.id,
    command: plan.bin,
    args: plan.args,
    cwd,
    env,
    cols: req.body?.cols || 100,
    rows: req.body?.rows || 30
  })

  const banner = `\x1b[38;5;205m🤖 Agent Studio · 主流智能体\x1b[0m\n` +
    `\x1b[2m工具      ${tool.name} (${plan.source === 'managed' ? 'Agent Studio 托管' : plan.source === 'custom' ? '手动指定' : '系统 PATH'})\n` +
    `工作目录  ${cwd}\n终端      ${shell.name}\n服务商    ${plan.mode === 'account' ? '工具自有账号' : `${plan.providerName} / ${plan.modelId || '默认'}`}\n命令      ${plan.commandLine}\x1b[0m\n` +
    (plan.warning ? `\n\x1b[33m⚠ ${plan.warning}\x1b[0m\n` : '') +
    '\n'
  session.push(banner.replace(/\n/g, '\r\n'))

  // Type the command into the interactive shell so the user lands back at a
  // prompt after the CLI exits, exactly like launching a real terminal.
  // No host login shell/profile: the owned CLI is already running in the PTY.

  res.json({ sessionId: session.id, commandLine: plan.commandLine, cwd, usingPty: session.usingPty })
}))

/** DeepSeek Harness style tools run as a managed service with their own Web UI. */
codecliRouter.post('/tools/:id/service', wrap(async (req, res) => {
  const tool = builtinTool(req.params.id)
  if (!tool) return res.status(404).json({ error: '工具不存在' })
  if (tool.runMode !== 'service') return res.status(400).json({ error: '该工具不是服务类型' })
  const cfg = saveConfig(req.params.id, req.body?.config || {})

  await detection(tool.id, true)
  const executionEnv = await executableEnvironment()
  const shell = {id:process.platform === 'win32' ? 'cmd' : 'sh',name:'盘内 CLI（直接启动）'}
  const plan = buildLaunchPlan(tool, cfg, { port: req.app.get('port'), shellId: shell.id })
  if (plan.error) return res.status(400).json({ error: plan.error })
  const port = cfg.port || tool.servicePort || 8787
  const session = createSession({
    kind: 'tool',
    label: `${tool.name} (service :${port})`,
    toolId: tool.id,
    command: plan.bin,
    args: plan.args,
    cwd: workspaceDir(cfg.workDir),
    env: { ...executionEnv, ...plan.env, PATH: [path.dirname(plan.bin), executionEnv.PATH || executionEnv.Path].filter(Boolean).join(path.delimiter) },
    cols: 100,
    rows: 30
  })
  res.json({ sessionId: session.id, webUi: `http://127.0.0.1:${port}` })
}))

codecliRouter.get('/configs', (req, res) => {
  res.json(table('codecli').map((c) => ({ ...config(c.id), apiKey: c.apiKey ? maskKey(c.apiKey) : '', hasApiKey: !!c.apiKey })))
})
