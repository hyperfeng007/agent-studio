import { knowledgeRouter } from './routes/knowledge.js'
import { mcpRouter } from './routes/mcp.js'
import { recoverKnowledgeJobs } from './knowledge/service.js'
import { shutdownMcp } from './mcp/service.js'
import { ASSISTANT_PRESETS } from './config/assistantPresets.js'
import express from 'express'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { customAlphabet } from 'nanoid'

import { loadDb, insertRow, table, saveNow, getSettings, updateSettings } from './store.js'
import { seedMinApps } from './routes/minapps.js'
import { settingsRouter } from './routes/settings.js'
import { providersRouter } from './routes/providers.js'
import { chatDataRouter } from './routes/chatData.js'
import { chatRouter } from './routes/chat.js'
import { filesRouter } from './routes/files.js'
import { minappsRouter } from './routes/minapps.js'
import { codecliRouter } from './routes/codecli.js'
import { gatewayRouter } from './gateway/index.js'
import { getSession, listSessions, killSession } from './codecli/terminal.js'
import { createDesktopRouter } from './routes/desktop.js'
import { defaultModel } from './services/providers.js'
import { applyNetworkSettings } from './net/proxy.js'
import { networkRouter } from './routes/network.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const RELEASE = JSON.parse(fs.readFileSync(path.join(ROOT, 'app-release.json'), 'utf8'))
const DIST = path.join(ROOT, 'web', 'dist')
const PORT = Number(process.env.PORT || 3000)
const HOST = process.env.HOST || '127.0.0.1'
const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12)
const INSTANCE_ID = process.env.AGENT_STUDIO_LAUNCH_ID || nanoid()

const app = express()
app.disable('x-powered-by')
app.set('port', PORT)
app.use(express.json({ limit: '50mb' }))

// Local app by default. Reject cross-site browser requests; never expose private
// documents, provider keys or mutation APIs through a wildcard CORS policy.
app.use((req, res, next) => {
  try {
    const host = new URL(`http://${req.headers.host}`)
    const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', ...Object.values(os.networkInterfaces()).flat().filter(Boolean).map(n=>n.address), ...(process.env.ALLOWED_HOSTS || '').split(',').filter(Boolean)])
    if (!allowedHosts.has(host.hostname) && !host.hostname.endsWith('.e2b.app')) return res.status(403).json({error:'不允许的访问域名'})
    if (req.headers.origin) {
      const origin = new URL(req.headers.origin)
      if (origin.host !== host.host || !['http:', 'https:'].includes(origin.protocol)) return res.status(403).json({error:'拒绝跨站访问；请从当前 Agent Studio 页面操作'})
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin)
      res.setHeader('Vary', 'Origin')
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({error:'拒绝跨站访问'})
  } catch { return res.status(403).json({error:'无效请求来源'}) }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.get('/api/health', (req, res) => res.json({ ok: true, version: RELEASE.version, build: RELEASE.build, instanceId: INSTANCE_ID, uptime: process.uptime(), node: process.version }))

app.use('/api/desktop', createDesktopRouter({root: ROOT, instanceId: INSTANCE_ID, pid: process.pid, shutdown: shutdownApplication}))

app.use('/api/settings', settingsRouter)
app.use('/api/providers', providersRouter)
app.use('/api/chat', chatRouter)
app.use('/api/files', filesRouter)
app.use('/api/minapps', minappsRouter)
app.use('/api/codecli', codecliRouter)
app.use('/api/network', networkRouter)
app.use('/api/knowledge', knowledgeRouter)
app.use('/api/mcp', mcpRouter)
app.use('/api', chatDataRouter)
app.use('/gateway', gatewayRouter)

if (fs.existsSync(DIST)) {
  app.use((req, res, next) => {
    if (req.path === '/' || req.path.endsWith('.html')) res.setHeader('Cache-Control', 'no-store')
    next()
  })
  app.use(express.static(DIST, { index: 'index.html', maxAge: 0 }))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/gateway')) return next()
    res.sendFile(path.join(DIST, 'index.html'))
  })
} else {
  app.get('/', (req, res) =>
    res
      .status(503)
      .type('html')
      .send('<h3>前端尚未构建</h3><p>请先运行 <code>npm run build</code>，然后重新访问。</p>')
  )
}

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: '请求体过大' })
  console.error('[api]', err)
  res.status(500).json({ error: err.message || '服务器内部错误' })
})

/* ------------------------------------------------------------------ seed */

function seed() {
  loadDb()
  seedMinApps()
  const settings = getSettings()
  if (!settings.defaultModel) {
    const dm = defaultModel()
    if (dm) updateSettings({ defaultModel: dm })
  }
  if (!table('assistants').length && !settings.assistantsInitialized) {
    const now = Date.now()
    const dm = defaultModel()
    const baseSettings = { contextCount: 12, temperature: 0.7, topP: 1, maxTokens: 0, streamOutput: true, reasoningEffort: '' }

    /**
     * 出厂智能助手（UI 里这一栏叫「智能助手」）。每个都带一个可用的人设提示词，
     * 第一个是空白通用智能助手，其余按日常开发场景分工。
     */
    const presets = ASSISTANT_PRESETS

    for (const p of presets) {
      const a = {
        id: nanoid(),
        name: p.name,
        prompt: p.prompt,
        emoji: p.emoji,
        description: p.description || '',
        group: p.group,
        presetId: p.presetId,
        type: 'assistant',
        model: dm ? { id: dm.modelId, provider: dm.providerId } : null,
        topics: [],
        settings: { ...baseSettings },
        createdAt: now,
        updatedAt: now
      }
      const t = { id: nanoid(), assistantId: a.id, name: '默认话题', messages: [], createdAt: now, updatedAt: now }
      insertRow('topics', t)
      a.topics = [t.id]
      insertRow('assistants', a)
    }
  }
  // Attach catalog metadata to unchanged legacy built-ins only; never rewrite prompts or model choices.
  for (const a of table('assistants')) {
    if (a.presetId) continue
    const preset = ASSISTANT_PRESETS.find(p => p.name === a.name && p.prompt === a.prompt)
    if (preset) {
      a.presetId = preset.presetId
      if (a.group === undefined) a.group = preset.group
    }
  }
  if (!settings.assistantsInitialized) updateSettings({ assistantsInitialized: true })
  saveNow()
}

/* --------------------------------------------------------- http + ws */

const server = http.createServer(app)
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname !== '/ws/terminal') {
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const sessionId = url.searchParams.get('session')
    const session = sessionId ? getSession(sessionId) : null
    if (!session) {
      ws.send(JSON.stringify({ type: 'error', message: '会话不存在或已退出' }))
      ws.close()
      return
    }
    session.attach(ws)
  })
})

seed()
recoverKnowledgeJobs()

/**
 * 出站网络：Node 的 fetch 不跟随系统代理，也不读 HTTP_PROXY / HTTPS_PROXY。
 * 这里按「设置 → 常规设置 → 网络代理」把 dispatcher 装上（默认「系统代理」），
 * 否则在需要代理的机器上所有模型调用都只会得到一句 undici 的 "fetch failed"。
 */
await applyNetworkSettings(getSettings(), { log: true })

server.once('error', err => {
  console.error(`[START FAILED] ${err.code || ''}: ${err.message}. Check whether another Agent Studio is already running.`)
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  const ip = (() => {
    const nets = os.networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) return net.address
      }
    }
    return '127.0.0.1'
  })()
  console.log(`🤖 Agent Studio ${RELEASE.version} (${RELEASE.build}) 已启动`)
  console.log(`   folder:  ${ROOT}`)
  console.log(`   local:   http://localhost:${PORT}`)
  console.log(HOST === '127.0.0.1' ? '   network: disabled (localhost only by default)' : `   network: http://${ip}:${PORT} (trusted network only; no remote login)`)
  console.log(`   gateway: http://127.0.0.1:${PORT}/gateway/<iface>/<toolId>/...`)
  console.log(`   data:    ${path.join(ROOT, 'data')}`)
})

/**
 * 崩溃兜底：一个库里的意外抛错（例如 node-pty 在 Windows 上把 socket 错误
 * rethrow 出来）不应该让整个 Agent Studio 消失。记录到控制台与 data/crash.log
 * 后继续服务；只有 SIGINT/SIGTERM 才是正常退出。
 */
function recordCrash(kind, err) {
  const line = `[${new Date().toISOString()}] ${kind}: ${err?.stack || err}\n`
  console.error(`\n⚠ ${kind}（服务已继续运行，详情见 data/crash.log）\n${line}`)
  try {
    fs.appendFileSync(path.join(ROOT, 'data', 'crash.log'), line)
  } catch {}
}
process.on('uncaughtException', (err) => recordCrash('uncaughtException', err))
process.on('unhandledRejection', (reason) => recordCrash('unhandledRejection', reason))

let shuttingDown = false
async function shutdownApplication() {
  if (shuttingDown) return
  shuttingDown = true
  saveNow()
  const deadline = setTimeout(() => { saveNow(); process.exit(0) }, 3500)
  try {
    await Promise.allSettled([shutdownMcp(), ...listSessions().map(s => killSession(s.id))])
    saveNow()
  } finally { clearTimeout(deadline); process.exit(0) }
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, shutdownApplication)
