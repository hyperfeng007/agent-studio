// Bootstrap uses Node built-ins only: it must work before npm install.
const { spawnSync } = require('node:child_process')
function installEnv(parent, proxy) {
  const env = { ...parent }
  for (const key of Object.keys(env)) {
    if (/^(https?_proxy|all_proxy|no_proxy|npm_config_(https?[-_]proxy|proxy|noproxy))$/i.test(key)) delete env[key]
  }
  // Empty npm configuration overrides stale user .npmrc proxy entries for this child only.
  env.npm_config_proxy = proxy.http || ''
  env.npm_config_https_proxy = proxy.https || ''
  env.HTTP_PROXY = proxy.http || ''
  env.HTTPS_PROXY = proxy.https || ''
  env.NO_PROXY = 'localhost,127.0.0.1,::1'
  env.npm_config_noproxy = env.NO_PROXY
  return env
}
function parseResult(text) {
  const result = JSON.parse(text.replace(/^\uFEFF/, '').trim())
  for (const key of ['http', 'https']) {
    if (typeof result[key] !== 'string') throw Error('Invalid system proxy response')
    if (result[key]) {
      const u = new URL(result[key])
      if (!['http:', 'https:'].includes(u.protocol)) throw Error('System proxy protocol not supported by this installer')
    }
  }
  return result
}
function main() {
  if (process.platform !== 'win32') throw Error('This installer helper is for Windows only')
  const npm = args => spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ' + args], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
  const registry = npm('config get registry')
  if (registry.status !== 0) throw Error('Unable to read npm registry configuration')
  const url = new URL(registry.stdout.trim())
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('Unsupported npm registry URL')
  // Resolve using Windows/.NET system proxy API, not a guessed port. PAC support
  // depends on Windows/.NET configuration; use the decision for this registry.
  const script = `$ErrorActionPreference='Stop'; $p=[System.Net.WebRequest]::GetSystemWebProxy(); $u=[Uri]$env:AS_NPM_REGISTRY; function Resolve-Proxy($target) { if($p.IsBypassed($target)){return ''}; $r=$p.GetProxy($target); if($r -eq $target){return ''}; return $r.AbsoluteUri }; $h=[UriBuilder]::new($u); $h.Scheme='http'; $h.Port=-1; @{http=(Resolve-Proxy $h.Uri); https=(Resolve-Proxy $u)} | ConvertTo-Json -Compress`
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 20000, env: { ...process.env, AS_NPM_REGISTRY: url.href } })
  if (ps.error || ps.status !== 0) throw Error('Windows system proxy detection failed or timed out; installation stopped. Check Windows proxy/PAC settings.')
  const proxy = parseResult(ps.stdout)
  for (const key of ['http', 'https']) console.log(`[PROXY] ${key.toUpperCase()}: ${proxy[key] ? new URL(proxy[key]).host : 'DIRECT'} (Windows system settings)`)
  console.log('[INFO] System proxy decision is resolved for the npm registry; PAC rules for other download hosts may differ.')
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') console.warn('[WARN] Inherited NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS verification. This launcher did not set it; configure trusted CA certificates instead.')
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm install --no-audit --no-fund --foreground-scripts'], { stdio: 'inherit', env: installEnv(process.env, proxy), windowsHide: process.env.AGENT_STUDIO_GUI === '1' })
  if (result.error) throw result.error
  process.exitCode = result.status === 0 ? 0 : 1
}
module.exports = { installEnv, parseResult }
if (require.main === module) { try { main() } catch (error) { console.error('[ERROR] ' + error.message); process.exitCode = 1 } }
