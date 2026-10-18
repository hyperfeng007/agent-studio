/**
 * llmFetch —— 出站请求的唯一入口，负责把 Node/undici 的裸错误翻译成人能看懂、能照着修的话。
 *
 * 背景：undici 在网络层失败时只会抛 `TypeError: fetch failed`，真正的原因
 * （ENOTFOUND / ECONNREFUSED / ETIMEDOUT / 证书 / 代理不可用 …）藏在 `err.cause` 里。
 * 界面上于是只有一句「请求失败 fetch failed」，用户根本不知道该修代理、修 DNS 还是修 apiHost。
 * 这里把 cause 展开，并附上当前生效的代理状态与下一步动作。
 */
import { ApiError } from './errors.js'
import { networkHint } from '../net/proxy.js'

/** cause 错误码 → 中文解释 + 针对性建议。 */
const CAUSE_HINTS = {
  ENOTFOUND: ['DNS 解析不到这个域名', '检查域名是否拼错（apiHost 要写到主机名，不要带 /chat/completions）；换 DNS（如 223.5.5.5 / 1.1.1.1）；或这台机器需要代理才能解析海外域名。'],
  EAI_AGAIN: ['DNS 服务器暂时没有响应', '稍后重试；或换一个 DNS（223.5.5.5 / 1.1.1.1）；企业网络下通常需要走代理。'],
  ECONNREFUSED: ['连接被拒绝（目标端口没有服务在听）', '如果配了代理，多半是代理软件没启动或端口填错（常见 7890 / 10809 / 1080）；如果是本地服务商（Ollama / LM Studio / vLLM），确认它已经启动并监听该端口。'],
  ECONNABORTED: ['连接被中断', '重试；若持续出现，检查本机安全软件是否拦截了 node.exe 的出站连接。'],
  ECONNRESET: ['连接被对端重置', '常见于防火墙 / 中间设备打断长连接，或代理不稳定；换成「系统代理」或换一个代理节点后重试。'],
  ETIMEDOUT: ['连接超时', '目标地址不可达（被墙 / 路由不通 / 需要代理）。请在「设置 → 常规设置 → 网络代理」启用系统代理或填写自定义代理。'],
  UND_ERR_CONNECT_TIMEOUT: ['连接超时（undici 连接阶段 15 秒上限）', '同上：多半需要代理，或目标端口被防火墙丢弃。'],
  UND_ERR_HEADERS_TIMEOUT: ['等待响应头超时（180 秒）', '服务商长时间没有返回首个字节；换一个模型或服务商，或检查代理链路是否过慢。'],
  UND_ERR_SOCKET: ['底层 socket 出错', '代理或网络链路中断；重试，必要时换代理节点。'],
  UND_ERR_PROXY: ['代理返回了错误', '检查代理地址/端口/鉴权；不用代理时请把代理模式改为「不使用代理」。'],
  EHOSTUNREACH: ['主机不可达', '路由 / VPN / IPv6 问题；可开启「强制 IPv4」再试。'],
  ENETUNREACH: ['网络不可达', '本机没有到该网段的路由（常见于只有 IPv6 记录但 IPv6 不通）；可开启「强制 IPv4」再试。'],
  EACCES: ['权限被拒绝', 'Windows 上常见于安全软件（360 / 火绒 / Defender）拦截 node.exe 出站；把 node.exe 加入白名单后重试。'],
  EPERM: ['操作不被允许', '同上：检查防火墙 / 安全软件是否拦截了 node.exe 的出站连接。'],
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: ['TLS 证书链验证失败（缺少中间证书）', '常见于公司网关 / 抓包工具（Fiddler、Charles、mitmproxy）替换了证书。可把企业根证书路径设进环境变量 NODE_EXTRA_CA_CERTS 后重启服务。'],
  SELF_SIGNED_CERT_IN_CHAIN: ['证书链里出现自签证书', '同上：公司网关或抓包工具；设置 NODE_EXTRA_CA_CERTS 指向其根证书。'],
  DEPTH_ZERO_SELF_SIGNED_CERT: ['对端使用自签证书', '内网自建网关常见；设置 NODE_EXTRA_CA_CERTS，或改用受信证书的地址。'],
  CERT_HAS_EXPIRED: ['对端证书已过期', '联系服务商，或检查系统时间是否准确（时间偏差也会导致证书校验失败）。'],
  ERR_TLS_CERT_ALTNAME_INVALID: ['证书域名与访问的域名不匹配', '检查 apiHost 是否写错，或代理是否把请求转发到了别的主机。'],
  EPROTO: ['TLS / HTTP 协议错误', '可能是代理不支持 CONNECT 隧道，或对方只接受更高版本的 TLS；换代理或换地址。'],
  ERR_INVALID_URL: ['这不是一个合法的 URL', '检查该服务商的 API 地址（apiHost）：要形如 https://api.example.com（可带 /v1），不能留空、不能有多余空格或中文。']
}

function hostOf(url) {
  try {
    const u = new URL(url)
    return { host: u.hostname, port: u.port || (u.protocol === 'https:' ? '443' : '80'), protocol: u.protocol }
  } catch {
    return { host: String(url).slice(0, 80), port: '', protocol: '' }
  }
}

function deepestCause(err) {
  let c = err?.cause || err
  let guard = 0
  while (c?.cause && guard++ < 6) c = c.cause
  return c
}

/** 把 fetch 失败翻译成带原因、带下一步动作的 ApiError。 */
export function describeNetworkError(err, url) {
  const { host, port } = hostOf(url)
  const cause = deepestCause(err)
  const code = cause?.code || (cause?.message || '').match(/\b(E[A-Z]+|UND_ERR_[A-Z_]+|ERR_[A-Z_]+)\b/)?.[1] || ''
  const raw = cause?.message || err?.message || String(err)
  const known = CAUSE_HINTS[code]

  // 请求被主动取消（用户点了停止 / 关闭页面）不算网络故障，原样抛出让上层识别。
  if (err?.name === 'AbortError' || code === 'ABORT_ERR' || cause?.name === 'AbortError') return err

  const title = known ? `${known[0]}（${code}）` : code ? `网络请求失败（${code}）` : '网络请求失败'
  const advice = known ? (Array.isArray(known[1]) ? known[1].join(' ') : known[1]) : ''
  const where = `目标：${host}${port ? `:${port}` : ''}`
  const msg = `${where} — ${title}。${advice}\n${networkHint()}\n原始错误：${raw}`
  const e = new ApiError(msg, 0)
  e.code = code
  e.causeMessage = raw
  e.isNetworkError = true
  return e
}

/**
 * fetch 的包装：只改错误信息，不改行为（同样的 URL / init / 返回值）。
 * 所有模型适配器（openai / anthropic / gemini / responses）与模型列表拉取都走这里。
 */
export async function llmFetch(url, init = {}) {
  let res
  try {
    res = await fetch(url, init)
  } catch (err) {
    throw describeNetworkError(err, url)
  }
  return res
}
