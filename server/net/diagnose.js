/**
 * 网络诊断 —— 把「fetch failed」拆成 DNS / TCP / TLS / HTTP 四步，逐步告诉你卡在哪。
 *
 * 直连步骤（DNS/TCP/TLS）故意不走代理：它们用来判断「这台机器本身能不能到达对方」，
 * 而最后的 HTTP 步骤走进程当前的 dispatcher（也就是真实链路，可能经代理）。
 * 两组结果对比就能区分「需要代理」和「代理本身坏了」。
 */
import dns from 'node:dns'
import net from 'node:net'
import tls from 'node:tls'
import { networkStatus } from './proxy.js'
import { getProvider } from '../services/providers.js'
import { fetchProviderModels } from '../llm/index.js'

const STEP_TIMEOUT = 6000

function step(name, ok, ms, detail, extra = {}) {
  return { name, ok, ms: ms == null ? null : Math.round(ms), detail, ...extra }
}

async function timed(fn) {
  const t0 = Date.now()
  try {
    const value = await fn()
    return { value, ms: Date.now() - t0, error: null }
  } catch (error) {
    return { value: null, ms: Date.now() - t0, error }
  }
}

function splitHostPort(apiHost) {
  const u = new URL(apiHost)
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80
  return { host: u.hostname, port, secure: u.protocol === 'https:', pathname: u.pathname }
}

/**
 * @param {{ providerId?: string, host?: string }} target
 */
export async function diagnoseNetwork(target = {}) {
  const proxy = networkStatus()
  const steps = []
  const hints = []

  // 0) 解析目标
  let apiHost = String(target.host || '').trim()
  let provider = null
  if (target.providerId) {
    provider = getProvider(target.providerId)
    if (!provider) return { ok: false, error: `未找到服务商「${target.providerId}」`, steps, hints, proxy }
    apiHost = provider.apiHost || ''
  }
  if (!apiHost) {
    steps.push(step('目标地址', false, 0, '该服务商没有填写 API 地址（apiHost），请求根本发不出去。'))
    hints.push('到「设置 → 模型服务」里补全 API 地址，形如 https://api.example.com（可带 /v1）。')
    return { ok: false, target: { apiHost }, steps, hints, proxy, verdict: '缺少 API 地址' }
  }

  let parsed
  try {
    if (!/^https?:\/\//i.test(apiHost)) apiHost = `https://${apiHost.replace(/^\/+/, '')}`
    parsed = splitHostPort(apiHost)
    steps.push(step('目标地址', true, 0, `${apiHost} → 主机 ${parsed.host}，端口 ${parsed.port}${parsed.secure ? '（TLS）' : ''}`))
  } catch (err) {
    steps.push(step('目标地址', false, 0, `API 地址不是合法 URL：${apiHost}（${err.message}）`))
    hints.push('检查是否有多余空格、中文冒号或缺少 https:// 前缀。')
    return { ok: false, target: { apiHost }, steps, hints, proxy, verdict: 'API 地址格式错误' }
  }

  if (apiHost.startsWith('builtin://') || parsed.host === 'mock') {
    steps.push(step('网络链路', true, 0, '本地演示 (Mock) 服务商不联网，无需诊断。'))
    return { ok: true, target: { apiHost, ...parsed }, steps, hints, proxy, verdict: '内置 Mock，不走网络' }
  }

  // 1) 代理配置（信息项）
  steps.push(
    step(
      '代理配置',
      true,
      0,
      proxy.url
        ? `${proxy.mode === 'custom' ? '自定义代理' : '系统代理'} → ${proxy.url}（来源：${proxy.source}）；绕过：${proxy.bypass}`
        : `未使用代理（${proxy.source}）`,
      { proxyUrl: proxy.url || '', forceIPv4: !!proxy.forceIPv4 }
    )
  )
  if (proxy.error) hints.push(`代理配置有错误：${proxy.error}`)

  // 2) DNS
  const dnsRes = await timed(() => dns.promises.lookup(parsed.host, { all: true, verbatim: false }))
  if (dnsRes.error) {
    const code = dnsRes.error.code || ''
    steps.push(step('DNS 解析', false, dnsRes.ms, `${code || dnsRes.error.message} — 解析不到 ${parsed.host}`, { code }))
    hints.push(
      code === 'ENOTFOUND'
        ? '域名不存在或被 DNS 污染：核对 apiHost 拼写；换 DNS（223.5.5.5 / 1.1.1.1）；海外域名通常需要代理才能解析。'
        : 'DNS 服务器无响应：检查网络与 DNS 设置，或启用代理后重试。'
    )
    return finish(false, parsed, apiHost, steps, hints, proxy, 'DNS 解析失败')
  }
  const addrs = dnsRes.value || []
  const v6 = addrs.filter((a) => a.family === 6).length
  const v4 = addrs.filter((a) => a.family === 4).length
  steps.push(
    step('DNS 解析', true, dnsRes.ms, `${addrs.map((a) => a.address).join(', ') || '（无记录）'}（IPv4 ${v4} 条 / IPv6 ${v6} 条）`)
  )
  if (v4 === 0 && v6 > 0) hints.push('该域名只解析出 IPv6 地址：如果本机 IPv6 不通就会失败，可开启「强制 IPv4」或改用代理。')

  // 3) TCP（直连）
  const tcpRes = await timed(
    () =>
      new Promise((resolve, reject) => {
        const sock = net.connect({ host: parsed.host, port: parsed.port, family: proxy.forceIPv4 ? 4 : undefined })
        const fail = (err) => {
          sock.destroy()
          reject(err)
        }
        sock.setTimeout(STEP_TIMEOUT, () => fail(Object.assign(new Error('连接超时'), { code: 'ETIMEDOUT' })))
        sock.once('error', fail)
        sock.once('connect', () => {
          const addr = sock.address()
          sock.destroy()
          resolve(addr)
        })
      })
  )
  if (tcpRes.error) {
    const code = tcpRes.error.code || ''
    steps.push(step('TCP 连接（直连）', false, tcpRes.ms, `${code || tcpRes.error.message} — ${parsed.host}:${parsed.port}`, { code }))
    if (code === 'ECONNREFUSED') hints.push('端口上没有服务：本地服务商请确认已启动；走代理的话请确认代理软件在运行且端口正确。')
    else if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH')
      hints.push('直连到不了对方（被墙 / 路由不通 / IPv6 不通）：把代理模式改成「系统代理」或填写自定义代理，然后重试诊断。')
    else if (code === 'EACCES' || code === 'EPERM') hints.push('被本机安全软件或防火墙拦截：把 node.exe 加入白名单（360 / 火绒 / Windows Defender）。')
    // TCP 直连失败不代表经代理也失败 —— 继续跑 HTTP 步骤（真实链路）。
  } else {
    steps.push(step('TCP 连接（直连）', true, tcpRes.ms, `已连通 ${parsed.host}:${parsed.port}`))
  }

  // 4) TLS（直连，仅 https）
  if (parsed.secure) {
    const tlsRes = await timed(
      () =>
        new Promise((resolve, reject) => {
          const sock = tls.connect(
            { host: parsed.host, port: parsed.port, servername: parsed.host, family: proxy.forceIPv4 ? 4 : undefined, rejectUnauthorized: true },
            () => {
              const cert = sock.getPeerCertificate?.() || {}
              const info = {
                protocol: sock.getProtocol?.(),
                issuer: cert?.issuer?.O || cert?.issuer?.CN || '',
                validTo: cert?.valid_to || ''
              }
              sock.destroy()
              resolve(info)
            }
          )
          sock.setTimeout(STEP_TIMEOUT, () => {
            sock.destroy()
            reject(Object.assign(new Error('TLS 握手超时'), { code: 'ETIMEDOUT' }))
          })
          sock.once('error', (err) => {
            sock.destroy()
            reject(err)
          })
        })
    )
    if (tlsRes.error) {
      const code = tlsRes.error.code || ''
      steps.push(step('TLS 握手（直连）', false, tlsRes.ms, `${code || tlsRes.error.message}`, { code }))
      if (/CERT|SIGNATURE|ALTNAME|TLS|SSL/.test(code))
        hints.push('证书校验失败：常见于公司网关 / 抓包工具（Fiddler、Charles、mitmproxy）替换证书。把根证书路径写进环境变量 NODE_EXTRA_CA_CERTS 后重启服务即可。')
      else hints.push('TLS 握手失败通常意味着链路被中间设备打断，试着启用代理后重跑诊断。')
    } else {
      const i = tlsRes.value
      steps.push(step('TLS 握手（直连）', true, tlsRes.ms, `${i.protocol}${i.issuer ? `，签发：${i.issuer}` : ''}${i.validTo ? `，有效期至 ${i.validTo}` : ''}`))
    }
  }

  // 5) HTTP —— 真实链路（走当前 dispatcher，可能经代理）
  const httpRes = await timed(async () => {
    try {
      const models = await fetchProviderModels(provider || { id: 'custom', type: 'openai', apiHost, apiKey: '', models: [] })
      return { kind: 'ok', count: models.length }
    } catch (err) {
      const message = String(err.message || '').slice(0, 600)
      // 网络已经通了，剩下的是接口形态 / 鉴权 / 参数问题
      if (err?.badBody) return { kind: 'badbody', status: err.status, message }
      if (err?.status) return { kind: 'http', status: err.status, message }
      return { kind: 'net', code: err?.code || '', message }
    }
  })
  const h = httpRes.value || { kind: 'net', message: '未知错误' }
  if (h.kind === 'ok') {
    steps.push(step('HTTP 请求（真实链路）', true, httpRes.ms, `拉取模型列表成功，共 ${h.count} 个模型`))
  } else if (h.kind === 'badbody') {
    // HTTP 2xx 但正文不是 JSON：网络是通的，错在地址/接口形态（最常见：apiHost 填成了站点首页）。
    steps.push(
      step('HTTP 请求（真实链路）', false, httpRes.ms, `网络已连通，但 HTTP ${h.status} 的正文不是模型列表（返回了网页或其它内容）`, {
        status: h.status,
        message: h.message
      })
    )
    hints.push('API 地址大概率指向了网页而不是接口：改成形如 https://api.example.com（多数服务商还需要 /v1），并确认「渠道类型」与服务商一致。')
  } else if (h.kind === 'http') {
    // 有 HTTP 状态码就说明网络是通的，剩下的是鉴权/权限/参数问题。
    const auth = h.status === 401 || h.status === 403
    steps.push(
      step('HTTP 请求（真实链路）', false, httpRes.ms, `网络已连通，服务端返回 HTTP ${h.status}${auth ? '（鉴权/权限问题，不是网络问题）' : ''}`, {
        status: h.status,
        message: h.message
      })
    )
    if (auth) hints.push('网络链路正常：请在「设置 → 模型服务」里填写有效的 API Key（或检查该 Key 是否有此模型权限）。')
    else hints.push(`网络链路正常，服务端返回 HTTP ${h.status}：${String(h.message).split('\n')[0]}`)
  } else {
    // 表格里只放第一行（原因），完整消息（含代理状态与建议）放进 message 字段，UI 可展开。
    const firstLine = String(h.message || '').split('\n')[0]
    steps.push(step('HTTP 请求（真实链路）', false, httpRes.ms, `${h.code ? `${h.code} — ` : ''}${firstLine}`, { code: h.code, message: h.message }))
    hints.push(
      proxy.url
        ? '经代理仍然失败：确认代理软件已启动、端口正确、节点可用；也可以把代理模式改成「不使用代理」对比一次。'
        : '直连失败：把「设置 → 常规设置 → 网络代理」的代理模式改为「系统代理」（或填写自定义代理地址），保存后立即生效，再点一次诊断。'
    )
  }

  const okAll = steps.every((s) => s.ok)
  const verdict = okAll
    ? '链路正常（若对话仍失败，问题在 Key / 模型 / 参数）'
    : h.kind === 'badbody'
      ? '网络通，但 API 地址指向的不是模型接口'
      : h.kind === 'http'
        ? h.status === 401 || h.status === 403
          ? '网络通，是鉴权/权限问题（不是网络问题）'
          : `网络通，服务端返回 HTTP ${h.status}（不是网络问题）`
        : `网络不通：卡在「${steps.filter((s) => !s.ok).map((s) => s.name).join('、')}」`
  return finish(okAll, parsed, apiHost, steps, hints, proxy, verdict)
}

function finish(ok, parsed, apiHost, steps, hints, proxy, verdict) {
  return { ok, target: { apiHost, ...parsed }, steps, hints, proxy, verdict }
}
