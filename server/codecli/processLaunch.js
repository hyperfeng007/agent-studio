import fs from 'node:fs'
import path from 'node:path'
import crossSpawn from 'cross-spawn'

// Prefer the npm JS entry belonging to the running Node installation. This
// avoids npm.cmd, cmd.exe parsing and an ambiguous second Node on PATH.
export function npmInvocation(args, { platform = process.platform, execPath = process.execPath, exists = fs.existsSync } = {}) {
  if (platform === 'win32') {
    const cli = path.win32.join(path.win32.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (exists(cli)) return { command: execPath, args: [cli, ...args], direct: true }
  }
  return { command: 'npm', args: [...args], direct: false }
}

export function spawnCli(command, args = [], options = {}) {
  const invocation = String(command).toLowerCase() === 'npm' ? npmInvocation(args) : { command, args }
  // cross-spawn handles PATHEXT/.cmd escaping + windowsVerbatimArguments as a
  // pair. Do not pre-quote executable names before passing them to this API.
  return crossSpawn(invocation.command, invocation.args, { ...options, shell: false, windowsHide: true })
}

export function npmNetworkEnv(base, network) {
  const env = { ...base }
  if (network.mode === 'off' || network.url) {
    for (const key of Object.keys(env)) if (/^(https?_proxy|all_proxy|no_proxy|npm_config_(proxy|https_proxy|noproxy))$/i.test(key)) delete env[key]
    const url = network.mode === 'off' ? '' : network.url
    env.HTTP_PROXY = env.HTTPS_PROXY = env.npm_config_proxy = env.npm_config_https_proxy = url
    env.NO_PROXY = env.npm_config_noproxy = network.bypass || 'localhost,127.0.0.1,::1'
  }
  return env
}
