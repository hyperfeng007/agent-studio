#!/usr/bin/env node
/**
 * 网络与代理 tests — 这一套守住的 bug 是：
 *
 *   「所有的大模型都请求失败 fetch failed」（无论在智能助手还是主流智能体里）
 *
 * 根因：Node 内置 fetch（undici）**既不跟随系统代理，也不读 HTTP_PROXY / HTTPS_PROXY**，
 * 而设置页里的「网络代理」开关以前只是把字段存进 db.json，服务端从来没应用过。
 * 于是需要代理才能出网的机器上，每一次模型调用都只剩 undici 的一句 "fetch failed"
 * （真实原因在 err.cause 里，从没被打出来）。
 *
 * 这里覆盖：代理地址/绕过规则归一化、Windows 注册表与 macOS scutil 的真实输出解析、
 * 三档代理模式是否真的改变了出站行为（用「指向死端口的代理」证明）、强制直连是否无视
 * 环境变量、错误翻译是否给出可执行的原因，以及 DNS→TCP→TLS→HTTP 四步诊断。
 *
 * Usage: node scripts/test-net.mjs
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import dns from 'node:dns'

const {
  DEFAULT_BYPASS,
  normalizeProxyUrl,
  normalizeBypass,
  parseWindowsInternetSettings,
  parseMacScutilProxy,
  resolveNetworkSettings,
  applyNetworkSettings,
  networkStatus,
  networkHint,
  proxyEnv
} = await import('../server/net/proxy.js')
const { llmFetch, describeNetworkError } = await import('../server/llm/net.js')
const { diagnoseNetwork } = await import('../server/net/diagnose.js')
const { parseJsonResponse } = await import('../server/llm/sse.js')

let fail = 0
const check = async (name, fn) => {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    fail++
    console.log(`❌ ${name}\n   ${String(e.message).split('\n').slice(0, 5).join('\n   ')}`)
  }
}

/* ---------------- 本地假服务商：/v1/models 返回两个模型 ---------------- */
const local = http.createServer((req, res) => {
  if (req.url?.startsWith('/html')) {
    // 模拟「apiHost 填成了站点首页」：HTTP 200 但正文是一整页 HTML
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<!doctype html><html><body><h1>Welcome</h1></body></html>')
    return
  }
  if (req.url?.includes('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'local-a' }, { id: 'local-b' }] }))
    return
  }
  res.writeHead(401, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: { message: 'bad key' } }))
})
await new Promise((r) => local.listen(0, '127.0.0.1', r))
const localPort = local.address().port
const localHost = `http://127.0.0.1:${localPort}`
const DEAD_PROXY = 'http://127.0.0.1:1' // 端口 1 上不会有人监听

/* ------------------------------------------------------------------ 归一化 */

await check('代理地址归一化：补 scheme、去尾斜杠、保留 socks5', () => {
  assert.equal(normalizeProxyUrl('127.0.0.1:7890'), 'http://127.0.0.1:7890')
  assert.equal(normalizeProxyUrl('http://127.0.0.1:7890/'), 'http://127.0.0.1:7890')
  assert.equal(normalizeProxyUrl('socks5://127.0.0.1:1080'), 'socks5://127.0.0.1:1080')
  assert.equal(normalizeProxyUrl('  '), '')
})

await check('绕过规则：<local> 展开、*.example.com 归一、去重、空值回默认', () => {
  assert.equal(normalizeBypass('<local>'), 'localhost,127.0.0.1,::1')
  assert.equal(normalizeBypass('*.example.com; a.test , a.test'), '.example.com,a.test')
  assert.equal(normalizeBypass(''), DEFAULT_BYPASS)
  assert.equal(normalizeBypass('localhost,127.0.0.1,::1'), DEFAULT_BYPASS)
})

/* ------------------------------------------------- 系统代理输出解析（真实格式） */

await check('Windows 注册表：ProxyEnable=1 + http=/https= 形式 + ProxyOverride + PAC 提示', () => {
  const stdout = [
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
    '    AutoConfigURL    REG_SZ    http://pac.corp.example/proxy.pac',
    '    ProxyEnable    REG_DWORD    0x1',
    '    ProxyOverride    REG_SZ    localhost;127.*;<local>',
    '    ProxyServer    REG_SZ    http=127.0.0.1:7890;https=127.0.0.1:7890',
    ''
  ].join('\r\n')
  const r = parseWindowsInternetSettings(stdout)
  assert.equal(r.url, 'http://127.0.0.1:7890')
  assert.match(r.bypass, /<local>/)
  assert.match(r.detail, /PAC/)
  assert.equal(normalizeBypass(r.bypass), 'localhost,127.*,localhost,127.0.0.1,::1'.split(',').filter((v, i, a) => a.indexOf(v) === i).join(','))
})

await check('Windows 注册表：ProxyEnable=0 时不返回代理地址（回退直连）', () => {
  const r = parseWindowsInternetSettings('    ProxyEnable    REG_DWORD    0x0\r\n    ProxyServer    REG_SZ    127.0.0.1:7890\r\n')
  assert.equal(r.url, '')
  assert.match(r.detail, /未开启/)
})

await check('Windows 注册表：裸 host:port 与 socks-only 两种写法', () => {
  assert.equal(parseWindowsInternetSettings('    ProxyEnable    REG_DWORD    0x1\r\n    ProxyServer    REG_SZ    10.0.0.5:8080\r\n').url, 'http://10.0.0.5:8080')
  assert.equal(
    parseWindowsInternetSettings('    ProxyEnable    REG_DWORD    1\r\n    ProxyServer    REG_SZ    socks=10.0.0.5:1080\r\n').url,
    'socks5://10.0.0.5:1080'
  )
})

await check('macOS scutil --proxy：HTTPS 优先，其次 SOCKS，未开启则为空', () => {
  const on = '<dictionary> {\n  HTTPEnable : 0\n  HTTPSEnable : 1\n  HTTPSProxy : 127.0.0.1\n  HTTPSPort : 7890\n  ExceptionsList : <array> {\n    0 : *.local\n    1 : 169.254/16\n  }\n}'
  const r = parseMacScutilProxy(on)
  assert.equal(r.url, 'http://127.0.0.1:7890')
  assert.equal(r.bypass, '*.local,169.254/16')
  assert.equal(parseMacScutilProxy('<dictionary> {\n  HTTPEnable : 0\n  HTTPSEnable : 0\n  SOCKSEnable : 1\n  SOCKSProxy : 127.0.0.1\n  SOCKSPort : 1080\n}').url, 'socks5://127.0.0.1:1080')
  assert.equal(parseMacScutilProxy('<dictionary> {\n  HTTPEnable : 0\n  HTTPSEnable : 0\n}').url, '')
})

await check('设置解析：默认系统代理；旧的 proxyEnabled+proxyUrl 等价于自定义', () => {
  assert.equal(resolveNetworkSettings({}).mode, 'system')
  assert.equal(resolveNetworkSettings({ proxyMode: 'off' }).mode, 'off')
  const legacy = resolveNetworkSettings({ proxyEnabled: true, proxyUrl: '127.0.0.1:7890' })
  assert.equal(legacy.mode, 'custom')
  assert.equal(legacy.url, 'http://127.0.0.1:7890')
  assert.equal(resolveNetworkSettings({ proxyMode: 'custom', proxyUrl: 'http://p:1' }).bypass, DEFAULT_BYPASS)
})

/* ------------------------------------------------- 代理是否真的改变了出站行为 */

await check('自定义代理指向死端口时，请求确实走代理并失败（证明 dispatcher 生效）', async () => {
  // 绕过规则默认包含 localhost/127.0.0.1（这是正确行为，下一项专门断言它），
  // 所以这里把绕过列表换成别的域名，才能让本地请求真的走那个死代理。
  await applyNetworkSettings({ proxyMode: 'custom', proxyUrl: DEAD_PROXY, proxyBypass: 'example.com' })
  const st = networkStatus()
  assert.equal(st.mode, 'custom')
  assert.equal(st.url, DEAD_PROXY)
  let err
  try {
    await llmFetch(`${localHost}/v1/models`)
  } catch (e) {
    err = e
  }
  assert.ok(err, '经死代理访问本地服务应该失败')
  assert.equal(err.code, 'ECONNREFUSED')
  assert.match(err.message, /127\.0\.0\.1:1/, '错误里要能看出是代理端口连不上')
  assert.match(err.message, /代理/, '错误里要给出代理相关的下一步')
})

await check('代理绕过规则生效：127.0.0.1 在绕过列表里时本地请求直连成功', async () => {
  await applyNetworkSettings({ proxyMode: 'custom', proxyUrl: DEAD_PROXY, proxyBypass: '127.0.0.1,localhost' })
  const res = await llmFetch(`${localHost}/v1/models`)
  assert.equal(res.status, 200)
  const json = await res.json()
  assert.equal(json.data.length, 2)
})

await check('不使用代理：即使环境变量里设了 HTTPS_PROXY 也强制直连', async () => {
  const prev = process.env.HTTPS_PROXY
  process.env.HTTPS_PROXY = DEAD_PROXY
  try {
    await applyNetworkSettings({ proxyMode: 'off' })
    assert.equal(networkStatus().url, '')
    const res = await llmFetch(`${localHost}/v1/models`)
    assert.equal(res.status, 200, 'off 模式必须无视环境变量')
  } finally {
    if (prev === undefined) delete process.env.HTTPS_PROXY
    else process.env.HTTPS_PROXY = prev
  }
})

await check('系统代理模式：环境变量 HTTPS_PROXY 会被接管（undici 默认不读）', async () => {
  const prev = process.env.HTTPS_PROXY
  process.env.HTTPS_PROXY = DEAD_PROXY
  try {
    await applyNetworkSettings({ proxyMode: 'system' })
    assert.equal(networkStatus().url, DEAD_PROXY, '环境变量应当被识别为系统代理')
    let err
    try {
      await llmFetch(`${localHost}/v1/models`) // 127.0.0.1 默认在绕过列表里
    } catch (e) {
      err = e
    }
    assert.ok(!err, `绕过规则默认包含 127.0.0.1，本地请求应直连成功，却得到 ${err?.message}`)
  } finally {
    if (prev === undefined) delete process.env.HTTPS_PROXY
    else process.env.HTTPS_PROXY = prev
  }
})

await check('自定义模式没填地址：报错并安全退回直连（不会让整个服务发不出请求）', async () => {
  const st = await applyNetworkSettings({ proxyMode: 'custom', proxyUrl: '' })
  assert.match(st.error, /没有填代理地址/)
  assert.equal(st.url, '')
  const res = await llmFetch(`${localHost}/v1/models`)
  assert.equal(res.status, 200)
})

await check('强制 IPv4：DNS 结果顺序改为 ipv4first，状态里可见', async () => {
  await applyNetworkSettings({ proxyMode: 'off', forceIPv4: true })
  assert.equal(networkStatus().forceIPv4, true)
  if (typeof dns.getDefaultResultOrder === 'function') assert.equal(dns.getDefaultResultOrder(), 'ipv4first')
  await applyNetworkSettings({ proxyMode: 'off', forceIPv4: false })
  if (typeof dns.getDefaultResultOrder === 'function') assert.equal(dns.getDefaultResultOrder(), 'verbatim')
})

/* ------------------------------------------------------------- 错误翻译 */

const netErr = (code, message) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(message), { code }) })

await check('ENOTFOUND → 说明 DNS 解析失败，并提示代理 / apiHost 拼写', () => {
  const e = describeNetworkError(netErr('ENOTFOUND', 'getaddrinfo ENOTFOUND api.openai.com'), 'https://api.openai.com/v1/chat/completions')
  assert.equal(e.code, 'ENOTFOUND')
  assert.match(e.message, /DNS 解析不到这个域名/)
  assert.match(e.message, /api\.openai\.com:443/)
  assert.match(e.message, /网络代理/)
  assert.match(e.message, /getaddrinfo ENOTFOUND/)
})

await check('ETIMEDOUT / ECONNREFUSED / 证书 / 非法 URL 各自有针对性建议', () => {
  assert.match(describeNetworkError(netErr('ETIMEDOUT', 'connect ETIMEDOUT'), 'https://a.b/').message, /连接超时/)
  assert.match(describeNetworkError(netErr('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:7890'), 'https://a.b/').message, /代理软件没启动|端口/)
  assert.match(describeNetworkError(netErr('UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'x'), 'https://a.b/').message, /NODE_EXTRA_CA_CERTS/)
  assert.match(describeNetworkError(netErr('EACCES', 'x'), 'https://a.b/').message, /白名单|安全软件/)
  assert.match(describeNetworkError(Object.assign(new TypeError('Invalid URL'), { cause: Object.assign(new Error('Invalid URL'), { code: 'ERR_INVALID_URL' }) }), 'undefined/v1/chat/completions').message, /合法的 URL/)
})

await check('未知错误码也会带上原始信息与当前代理状态', () => {
  const e = describeNetworkError(netErr('EWEIRD', 'something odd'), 'https://a.b/x')
  assert.match(e.message, /网络请求失败（EWEIRD）/)
  assert.match(e.message, /something odd/)
  assert.match(e.message, /当前生效/)
  assert.ok(networkHint().length > 10)
})

await check('用户主动中止（AbortError）原样抛出，不算网络故障', () => {
  const abort = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
  assert.equal(describeNetworkError(abort, 'https://a.b/'), abort)
})

await check('llmFetch 成功路径不受影响；HTTP 4xx 仍由适配器处理', async () => {
  await applyNetworkSettings({ proxyMode: 'off' })
  const ok = await llmFetch(`${localHost}/v1/models`)
  assert.equal(ok.status, 200)
  const unauthorized = await llmFetch(`${localHost}/v1/chat/completions`, { method: 'POST', body: '{}' })
  assert.equal(unauthorized.status, 401, '4xx 应该原样返回，让适配器去读服务商的错误正文')
})

await check('llmFetch 对解析不到的域名抛 ApiError（不再是裸 fetch failed）', async () => {
  let err
  try {
    await llmFetch('https://no-such-host.invalid/v1/models')
  } catch (e) {
    err = e
  }
  assert.equal(err?.name, 'ApiError')
  assert.equal(err.code, 'ENOTFOUND')
  assert.ok(!/^\s*fetch failed\s*$/.test(err.message), '消息不能只是 fetch failed')
})

/* ------------------------------------------------------------- 四步诊断 */

await check('诊断本地服务商：DNS/TCP/HTTP 全绿，并认出模型数量', async () => {
  const r = await diagnoseNetwork({ host: localHost })
  assert.equal(r.ok, true, JSON.stringify(r.steps))
  const names = r.steps.map((s) => s.name)
  assert.ok(names.includes('DNS 解析') && names.includes('TCP 连接（直连）') && names.includes('HTTP 请求（真实链路）'))
  assert.ok(!names.includes('TLS 握手（直连）'), 'http:// 目标不需要 TLS 步骤')
  assert.match(r.steps.find((s) => s.name === 'HTTP 请求（真实链路）').detail, /2 个模型/)
  assert.match(r.verdict, /正常/)
})

await check('诊断解析不到的域名：卡在 DNS 一步，并给出可执行建议', async () => {
  const r = await diagnoseNetwork({ host: 'https://no-such-host.invalid' })
  assert.equal(r.ok, false)
  const dnsStep = r.steps.find((s) => s.name === 'DNS 解析')
  assert.equal(dnsStep.ok, false)
  assert.equal(dnsStep.code, 'ENOTFOUND')
  assert.match(r.verdict, /DNS 解析/)
  assert.ok(r.hints.join(' ').match(/DNS|代理/))
})

await check('诊断缺少 apiHost：直接指出问题，不做无意义的探测', async () => {
  const r = await diagnoseNetwork({ host: '' })
  assert.equal(r.ok, false)
  assert.equal(r.steps[0].name, '目标地址')
  assert.match(r.steps[0].detail, /没有填写 API 地址/)
})

await check('诊断结果里带当前代理状态（模式/地址/绕过）', async () => {
  await applyNetworkSettings({ proxyMode: 'custom', proxyUrl: DEAD_PROXY, proxyBypass: '127.0.0.1' })
  const r = await diagnoseNetwork({ host: localHost })
  const proxyStep = r.steps.find((s) => s.name === '代理配置')
  assert.match(proxyStep.detail, /127\.0\.0\.1:1/)
  assert.match(proxyStep.detail, /绕过/)
  await applyNetworkSettings({ proxyMode: 'off' })
})

await check('正文不是 JSON：说明「地址指向了网页」而不是抛 SyntaxError', async () => {
  const html = new Response('<!doctype html><html><body>not an api</body></html>', { status: 200 })
  let err
  try {
    await parseJsonResponse(html)
  } catch (e) {
    err = e
  }
  assert.equal(err?.name, 'ApiError')
  assert.equal(err.status, 200)
  assert.match(err.message, /不是 JSON/)
  assert.match(err.message, /网页|\/v1/)
  assert.ok(!/Unexpected token/.test(err.message), '不能把原始 SyntaxError 直接甩给用户')
  const good = new Response(JSON.stringify({ data: [{ id: 'x' }] }), { status: 200 })
  assert.equal((await parseJsonResponse(good)).data[0].id, 'x')
})

await check('诊断把「HTTP 200 但不是 JSON」判成网络通、地址填错', async () => {
  const r = await diagnoseNetwork({ host: `${localHost}/html` })
  const http = r.steps.find((s) => s.name === 'HTTP 请求（真实链路）')
  assert.equal(http.status, 200)
  assert.match(r.verdict, /网络通/)
  assert.match(r.hints.join(' '), /网页|\/v1/)
})

await check('代理会透传给智能体子进程（账号模式下 CLI 自己直连上游）', async () => {
  await applyNetworkSettings({ proxyMode: 'custom', proxyUrl: DEAD_PROXY, proxyBypass: 'localhost,127.0.0.1' })
  const env = proxyEnv()
  assert.equal(env.HTTPS_PROXY, DEAD_PROXY)
  assert.equal(env.https_proxy, DEAD_PROXY)
  assert.equal(env.HTTP_PROXY, DEAD_PROXY)
  assert.equal(env.NO_PROXY, 'localhost,127.0.0.1')
  await applyNetworkSettings({ proxyMode: 'off' })
  assert.deepEqual(proxyEnv(), {}, '直连模式不应该注入任何代理变量')
})

local.close()
await applyNetworkSettings({ proxyMode: 'system' })
console.log(`\n${fail ? `❌ ${fail} 项失败` : '✅ 全部通过'}\n`)
process.exit(fail ? 1 : 0)
