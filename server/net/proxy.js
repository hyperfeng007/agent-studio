/**
 * 网络与代理 —— 让 Node 服务端的出站请求像 Cherry Studio（Electron）一样能跟随系统代理。
 *
 * 为什么要这个文件：Node 内置 fetch（undici）**既不读操作系统代理，也不读
 * HTTP_PROXY / HTTPS_PROXY 环境变量**。所以在需要代理才能访问海外模型 API 的机器上，
 * 每一个模型调用都会以 undici 的裸 "fetch failed" 失败（真实原因只存在于 err.cause 里），
 * 表现为「无论在智能助手还是主流智能体里，所有大模型都请求失败」。
 *
 * 这里用 undici 的 dispatcher 把它补齐，并对齐 Cherry Studio「设置 → 系统 → 代理模式」的三个选项：
 *   系统代理（默认，跟随 Windows / macOS 的网络设置）
 *   自定义代理（手填地址 + 代理绕过规则，默认 localhost,127.0.0.1,::1）
 *   不使用代理（强制直连）
 * 额外提供「强制 IPv4」：IPv6 路由不通时 undici 同样只报 fetch failed。
 *
 * 设置保存后立即生效（setGlobalDispatcher 是进程级的），不需要重启服务。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import dns from 'node:dns'
import { Agent, EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'

const run = promisify(execFile)

export const DEFAULT_BYPASS = 'localhost,127.0.0.1,::1'
/** Cherry Studio 的三种代理模式。 */
export const PROXY_MODES = ['system', 'custom', 'off']

/** 当前进程里真正生效的网络配置（给 UI / 诊断 / 错误提示用）。 */
let current = {
  mode: 'system',
  url: '',
  bypass: DEFAULT_BYPASS,
  forceIPv4: false,
  source: '尚未应用',
  detail: '',
  error: '',
  appliedAt: null
}

/* ------------------------------------------------------------------ *
 * URL / 绕过规则归一化
 * ------------------------------------------------------------------ */

/** `127.0.0.1:7890` → `http://127.0.0.1:7890`；已经是 URL 的原样返回。 */
export function normalizeProxyUrl(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s.replace(/\/+$/, '')
  if (/^\/+|[^A-Za-z0-9._\-[\]:]/.test(s)) return s // 明显不是 host:port，交给上层报错
  return `http://${s}`.replace(/\/+$/, '')
}

/** 绕过规则：接受逗号/分号/空白分隔，去重去空。`<local>` 展开成本机三件套。 */
export function normalizeBypass(raw) {
  const parts = String(raw || '')
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const out = []
  for (const p of parts) {
    if (p === '<local>') out.push('localhost', '127.0.0.1', '::1')
    else out.push(p.replace(/^\*\./, '.'))
  }
  const uniq = [...new Set(out)]
  return uniq.length ? uniq.join(',') : DEFAULT_BYPASS
}

/* ------------------------------------------------------------------ *
 * 系统代理探测
 * ------------------------------------------------------------------ */

/**
 * Windows：读当前用户的 Internet Settings 注册表键。
 * ProxyServer 可能是 `host:port`，也可能是 `http=h:p;https=h:p;socks=h:p`。
 * ProxyOverride 用分号分隔，`<local>` 表示本机地址。
 * PAC（AutoConfigURL）无法在 Node 侧求值，只作为提示返回。
 */
export function parseWindowsInternetSettings(stdout) {
  const value = (name) => {
    const m = stdout.match(new RegExp(`^\\s*${name}\\s+REG_(SZ|DWORD|EXPAND_SZ)\\s+(.+)$`, 'im'))
    return m ? m[2].trim() : ''
  }
  const enable = value('ProxyEnable')
  const pac = value('AutoConfigURL')
  const server = value('ProxyServer')
  const override = value('ProxyOverride')
  const pacNote = pac ? `检测到 PAC 自动配置脚本（${pac}）。Node 侧无法执行 PAC，请在「自定义代理」里填写真实代理端口。` : ''

  if (!/^(0x1|1)$/i.test(enable)) {
    return { url: '', bypass: '', source: 'Windows 系统代理', detail: pacNote || '系统代理未开启（ProxyEnable=0），将回退到环境变量或直连。' }
  }
  let url = ''
  if (server) {
    if (server.includes('=')) {
      const map = {}
      for (const seg of server.split(';')) {
        const [k, v] = seg.split('=')
        if (k && v) map[k.trim().toLowerCase()] = v.trim()
      }
      const pick = map.https || map.http || map.socks
      if (pick) url = normalizeProxyUrl(map.socks && !map.https && !map.http ? `socks5://${pick}` : pick)
    } else {
      url = normalizeProxyUrl(server)
    }
  }
  return {
    url,
    bypass: override ? override.split(';').map((s) => s.trim()).filter(Boolean).join(',') : '',
    source: 'Windows 系统代理（注册表 Internet Settings）',
    detail: [url ? '' : 'ProxyEnable=1 但 ProxyServer 为空。', pacNote].filter(Boolean).join(' ')
  }
}

export async function windowsSystemProxy() {
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
  const { stdout } = await run('reg', ['query', key], { timeout: 8000, windowsHide: true })
  return parseWindowsInternetSettings(stdout)
}

/** macOS：`scutil --proxy`。优先 HTTPS，其次 HTTP，再次 SOCKS。 */
export function parseMacScutilProxy(stdout) {
  const num = (k) => {
    const m = stdout.match(new RegExp(`^\\s*${k}\\s*:\\s*(\\d+)\\s*$`, 'm'))
    return m ? Number(m[1]) : 0
  }
  const str = (k) => {
    const m = stdout.match(new RegExp(`^\\s*${k}\\s*:\\s*(.+?)\\s*$`, 'm'))
    return m ? m[1].trim() : ''
  }
  let url = ''
  if (num('HTTPSEnable') && str('HTTPSProxy')) url = `http://${str('HTTPSProxy')}${num('HTTPSPort') ? `:${num('HTTPSPort')}` : ''}`
  else if (num('HTTPEnable') && str('HTTPProxy')) url = `http://${str('HTTPProxy')}${num('HTTPPort') ? `:${num('HTTPPort')}` : ''}`
  else if (num('SOCKSEnable') && str('SOCKSProxy')) url = `socks5://${str('SOCKSProxy')}${num('SOCKSPort') ? `:${num('SOCKSPort')}` : ''}`

  // ExceptionsList : <array> { 0 : *.local  1 : 169.254/16 }
  const exBlock = stdout.match(/ExceptionsList\s*:\s*<array>\s*\{([\s\S]*?)\}/)
  const bypass = exBlock
    ? [...exBlock[1].matchAll(/^\s*\d+\s*:\s*(.+?)\s*$/gm)].map((m) => m[1]).join(',')
    : ''
  return {
    url,
    bypass,
    source: 'macOS 系统代理（scutil --proxy）',
    detail: url ? '' : '系统代理未开启，将回退到环境变量或直连。'
  }
}

export async function macSystemProxy() {
  const { stdout } = await run('scutil', ['--proxy'], { timeout: 8000 })
  return parseMacScutilProxy(stdout)
}

/** 环境变量代理（npm / git / curl 都认这套；undici 默认不认，所以由我们显式接管）。 */
export function envProxy() {
  const e = process.env
  const url = e.HTTPS_PROXY || e.https_proxy || e.HTTP_PROXY || e.http_proxy || e.ALL_PROXY || e.all_proxy || ''
  const bypass = e.NO_PROXY || e.no_proxy || ''
  if (!url) return null
  return { url: normalizeProxyUrl(url), bypass, source: '环境变量 HTTPS_PROXY / HTTP_PROXY / ALL_PROXY', detail: '' }
}

/**
 * 读取「系统代理」。返回 null 表示这台机器/这个平台没有可用的系统代理配置。
 * 顺序：平台原生设置 → 环境变量。任何一步失败都不抛错（探测不到就当没有）。
 */
export async function readSystemProxy() {
  const attempts = []
  try {
    if (process.platform === 'win32') {
      const r = await windowsSystemProxy()
      attempts.push(r)
      if (r.url) return r
    } else if (process.platform === 'darwin') {
      const r = await macSystemProxy()
      attempts.push(r)
      if (r.url) return r
    }
  } catch (err) {
    attempts.push({ url: '', bypass: '', source: '系统代理探测', detail: `探测失败：${err.message}` })
  }
  const env = envProxy()
  if (env) return env
  const detail = attempts.map((a) => a.detail).filter(Boolean).join(' ')
  return { url: '', bypass: '', source: '未发现系统代理', detail: detail || '系统与环境变量里都没有代理配置，使用直连。' }
}

/* ------------------------------------------------------------------ *
 * 应用
 * ------------------------------------------------------------------ */

/**
 * 把设置对象（含旧字段 proxyEnabled / proxyUrl）解析成网络配置。
 * 旧数据兼容：只填过 proxyEnabled+proxyUrl 的库等价于「自定义代理」。
 */
export function resolveNetworkSettings(settings = {}) {
  const legacyCustom = settings.proxyMode === undefined && settings.proxyEnabled && settings.proxyUrl
  const mode = PROXY_MODES.includes(settings.proxyMode) ? settings.proxyMode : legacyCustom ? 'custom' : 'system'
  return {
    mode,
    url: normalizeProxyUrl(settings.proxyUrl || ''),
    bypass: normalizeBypass(settings.proxyBypass || DEFAULT_BYPASS),
    forceIPv4: !!settings.forceIPv4
  }
}

/**
 * 构造并安装全局 dispatcher；同时按需要调整 DNS 结果顺序。
 * @returns 当前生效状态（也会缓存在模块里，供错误提示与诊断读取）
 */
export async function applyNetworkSettings(settings = {}, { log = false } = {}) {
  const want = resolveNetworkSettings(settings)
  const connect = { timeout: 15000 }
  if (want.forceIPv4) connect.family = 4

  // 流式生成可能几十秒不出字节（思考型模型），关掉 body 空闲超时；连接阶段仍然有超时。
  const agentOpts = { connect, headersTimeout: 180_000, bodyTimeout: 0, keepAliveTimeout: 30_000 }

  let url = ''
  let bypass = want.bypass
  let source = ''
  let detail = ''
  let error = ''

  try {
    if (want.mode === 'custom') {
      if (!want.url) throw Object.assign(new Error('代理模式是「自定义代理」但没有填代理地址'), { status: 400 })
      url = want.url
      source = '自定义代理'
    } else if (want.mode === 'system') {
      const sys = await readSystemProxy()
      url = sys.url
      bypass = normalizeBypass([sys.bypass, want.bypass].filter(Boolean).join(','))
      source = sys.source
      detail = sys.detail
      if (!url) source = `${sys.source}（无代理，直连）`
    } else {
      source = '不使用代理（强制直连）'
      detail = '即使系统或环境变量里配了代理也不会使用。'
    }

    if (url) {
      setGlobalDispatcher(new EnvHttpProxyAgent({ httpProxy: url, httpsProxy: url, noProxy: bypass, ...agentOpts }))
    } else {
      // 直连：用不带环境变量的 Agent，保证「不使用代理」真的不被 env 影响。
      setGlobalDispatcher(new Agent(agentOpts))
    }
    dns.setDefaultResultOrder(want.forceIPv4 ? 'ipv4first' : 'verbatim')
  } catch (err) {
    error = err.message
    // 配置有问题时退回直连，至少本机服务（网关回调等）还能用。
    try {
      setGlobalDispatcher(new Agent(agentOpts))
    } catch {}
    source = `配置失败，已退回直连：${err.message}`
  }

  current = {
    mode: want.mode,
    url,
    bypass,
    forceIPv4: want.forceIPv4,
    source,
    detail,
    error,
    appliedAt: new Date().toISOString()
  }
  if (log) {
    console.log(`🌐 网络：${current.source}${current.url ? ` → ${current.url}` : ''}${current.forceIPv4 ? '（IPv4 优先）' : ''}`)
  }
  return current
}

/** 当前生效的网络状态（不含敏感信息）。 */
export function networkStatus() {
  return { ...current }
}

/**
 * 给子进程（智能体 CLI）用的代理环境变量。
 *
 * 走统一网关时，上游请求由服务端发出，已经被 dispatcher 接管；但「账号模式」下 CLI 是
 * 自己直连上游的，而 Node 写的 CLI 基本只认 HTTPS_PROXY / HTTP_PROXY / NO_PROXY
 * （Claude Code、Codex 都是这套）。所以把当前生效的代理一并透传给子进程，
 * 否则会出现「Chat 里能用了、智能体里还是 fetch failed」。
 */
export function proxyEnv() {
  const c = current
  if (!c.url) return {}
  const env = {
    HTTP_PROXY: c.url,
    http_proxy: c.url,
    HTTPS_PROXY: c.url,
    https_proxy: c.url,
    ALL_PROXY: c.url,
    all_proxy: c.url
  }
  if (c.bypass) {
    env.NO_PROXY = c.bypass
    env.no_proxy = c.bypass
  }
  return env
}

/** 给错误提示用的一句话摘要。 */
export function networkHint() {
  const c = current
  const using = c.url ? `${c.source} → ${c.url}` : /直连|无代理/.test(c.source) ? c.source : `${c.source}（直连）`
  const advice = c.url
    ? '如果代理本身没启动或端口不对，会同样报 fetch failed；可在「设置 → 常规设置 → 网络代理」改成「不使用代理」或换一个地址，并用「网络诊断」定位。'
    : 'Node 的出站请求默认不走系统代理：如果这台机器需要代理才能访问该 API，请把「设置 → 常规设置 → 网络代理」的代理模式改为「系统代理」或填入自定义地址（如 http://127.0.0.1:7890），保存后立即生效。'
  return `当前生效：${using}。${advice}`
}
