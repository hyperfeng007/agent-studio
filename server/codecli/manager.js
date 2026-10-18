import { portableToolEnv, safePortableFile, ensurePortableDir } from './portable.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnCli, npmNetworkEnv, npmInvocation } from './processLaunch.js'
import { networkStatus } from '../net/proxy.js'
import { DATA_DIR } from '../store.js'
import { CODE_CLI_TOOLS, builtinTool } from '../config/codeCliTools.js'

const RELEASE = JSON.parse(fs.readFileSync(new URL('../../app-release.json', import.meta.url), 'utf8'))
const MANAGED_ROOT = path.join(DATA_DIR, 'codecli')
const IS_WIN = process.platform === 'win32'

export function managedDir(toolId) {
  return path.join(MANAGED_ROOT, toolId)
}

/** Runnable Windows extensions, matching Cherry discovery order. npm shims use .cmd. */
const WIN_EXTS = ['.exe', '.cmd', '.bat']

export function managedBin(tool, name = tool.bin) {
  const dir = managedDir(tool.id)
  const binDir = path.join(dir, 'node_modules', '.bin')
  return IS_WIN ? path.join(binDir, `${name}.cmd`) : path.join(binDir, name)
}

/** Every executable name a tool may be installed under. */
function binNames(tool) {
  return [...new Set([tool.bin, ...(tool.altBins || [])].filter(Boolean))]
}

/**
 * Resolve the managed executable. Falls back to the bin names the installed
 * package actually declares, so a registry entry whose bin name drifted from
 * upstream still works.
 */
export function resolveManagedBin(tool) {
  const dir = managedDir(tool.id)
  const binDir = path.join(dir, 'node_modules', '.bin')
  if (!fs.existsSync(binDir)) return null

  let declared = []
  try {
    const bin = JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', tool.npmPackage, 'package.json'), 'utf8')).bin
    declared = !bin ? [] : typeof bin === 'string' ? [tool.npmPackage.split('/').pop()] : Object.keys(bin)
  } catch {
    declared = []
  }

  for (const name of [...binNames(tool), ...declared]) {
    for (const ext of IS_WIN ? WIN_EXTS : ['']) {
      const candidate = path.join(binDir, `${name}${ext}`)
      if (isFile(candidate) && safePortableFile(candidate)) return candidate
    }
  }
  return null
}

export function isManagedInstalled(tool) {
  return !!resolveManagedBin(tool)
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function run(cmd, args, { cwd, env, timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    const child = spawnCli(cmd, args, { cwd, env: env || process.env })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
    child.stdout?.on('data', (d) => (out += d.toString()))
    child.stderr?.on('data', (d) => (err += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, out, err: `${err}\n${e.message}`.trim() })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out, err })
    })
  })
}

function parseVersion(text) {
  const m = String(text || '').match(/(\d+\.\d+\.\d+[A-Za-z0-9.\-+]*)/)
  return m ? m[1] : ''
}

/** `--version` first, `-v` only when the tool rejected the long flag. */
async function probeVersion(bin) {
  const env = await executableEnvironment()
  const r = await run(bin, ['--version'], { timeout: 9000, env })
  const v = parseVersion(r.out || r.err)
  if (v) return v
  if (r.code === 0) return ''
  const r2 = await run(bin, ['-v'], { timeout: 5000, env })
  return parseVersion(r2.out || r2.err)
}

/* --------------------------------------------------------- PATH discovery */

const pathCache = new Map()

/**
 * Drop the cached PATH / npm-prefix / directory scans. Called whenever the user
 * explicitly re-detects or an install finishes — otherwise a CLI installed
 * after the server started stays invisible until the process restarts.
 */
export function resetPathCaches() {
  pathCache.clear()
}

/** Windows environment names are case-insensitive; keep unknown references intact. */
export function expandWindowsVars(value, env = process.env) {
  return String(value).replace(/%([^%]+)%/g, (original, name) => {
    const key = Object.keys(env).find(k => k.toLowerCase() === name.toLowerCase())
    return key ? env[key] : original
  })
}

export function windowsEnvironment(base, registryPath) {
  const env = { ...base }
  const inherited = Object.entries(base).find(([k]) => k.toLowerCase() === 'path')?.[1] || ''
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key]
  env.PATH = registryPath ? expandWindowsVars(registryPath, base) : inherited
  return env
}

/** Refresh Windows PATH from the registry before resolving or launching a CLI. */
export async function executableEnvironment() {
  // Portable mode: never merge host registry PATH; the launcher passes bundled Node + system dirs only.
  if (!IS_WIN || process.env.AGENT_STUDIO_PORTABLE === '1') return { ...process.env }
  if (pathCache.has('environment')) return pathCache.get('environment')
  const promise = (async () => {
    const values = []
    const keys = ['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 'HKCU\\Environment']
    const reg = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe')
    for (const key of keys) {
      const result = await run(reg, ['query', key, '/v', 'Path'], { timeout: 5000 })
      const match = result.out.match(/\bREG_(?:EXPAND_)?SZ\s+([^\r\n]*)/i)
      if (result.code === 0 && match?.[1]?.trim()) values.push(match[1].trim())
    }
    return windowsEnvironment(process.env, values.join(';'))
  })()
  pathCache.set('environment', promise)
  return promise
}

async function registryPathDirs() {
  if (!IS_WIN) return []
  const env = await executableEnvironment()
  return env.PATH.split(';').map(p => p.trim().replace(/^"|"$/g, '')).filter(Boolean)
}

/** `npm prefix -g` — where globally installed CLIs land. */
async function npmGlobalPrefix() {
  if (pathCache.has('npm')) return pathCache.get('npm')
  const promise = executableEnvironment().then(env => run('npm', ['prefix', '-g'], { timeout: 12000, env })).then((r) =>
    r.code === 0 ? String(r.out).trim().split(/\r?\n/).pop().trim() : ''
  )
  pathCache.set('npm', promise)
  return promise
}

/**
 * Expand one `*` segment into concrete directories, e.g.
 * `%APPDATA%\Python\Python3*\Scripts` (pip --user installs) — Python puts a
 * version number in the middle of the path, so a plain join cannot reach it.
 */
export function expandGlob(dir) {  // exported for tests
  const raw = String(dir)
  if (!raw.includes('*')) return [raw]
  const parts = raw.split(/[\/]/)
  const idx = parts.findIndex((x) => x.includes('*'))
  const parent = parts.slice(0, idx).join(path.sep) || path.sep
  const rest = parts.slice(idx + 1)
  const re = new RegExp(`^${parts[idx].replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i')
  let entries = []
  try {
    entries = fs.readdirSync(parent)
  } catch {
    return []
  }
  return entries.filter((e) => re.test(e)).map((e) => path.join(parent, e, ...rest))
}

/** Directories scanned when PATH lookup finds nothing. Cached for the process. */
export async function candidateDirs() {
  if (pathCache.has('dirs')) return pathCache.get('dirs')
  const promise = (async () => {
    const home = os.homedir()
    const env = await executableEnvironment()
    const dirs = []
    const add = (p) => {
      if (!p) return
      const dir = path.normalize(String(p))
      if (!dirs.includes(dir)) dirs.push(dir)
    }

    for (const p of String(env.PATH || env.Path || '').split(path.delimiter)) add(p)
    for (const p of await registryPathDirs()) add(p)

    const prefix = await npmGlobalPrefix()
    if (prefix) add(IS_WIN ? prefix : path.join(prefix, 'bin'))

    if (IS_WIN) {
      add(env.APPDATA && path.join(env.APPDATA, 'npm'))
      add(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'npm'))
      add(env.ProgramFiles && path.join(env.ProgramFiles, 'nodejs'))
      add(env.NVM_SYMLINK) // nvm-windows points Program Files\nodejs here
      add(env.NVM_HOME)
      add(env.CARGO_HOME || path.join(home, '.cargo', 'bin'))
      add(path.join(home, 'scoop', 'shims'))
      add(env.ProgramData && path.join(env.ProgramData, 'chocolatey', 'bin'))
      add(path.join(home, '.volta', 'bin'))
      add(path.join(home, '.bun', 'bin'))
      add(path.join(home, '.deno', 'bin'))
      add(path.join(home, 'go', 'bin'))
      add(path.join(home, '.local', 'bin'))
      add(path.join(home, '.claude', 'local')) // Claude Code native installer
      add(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'AnthropicClaude'))
      add(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'Gemini CLI'))
      add(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'pnpm'))
      add(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Yarn', 'bin'))
      add(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps'))
      add(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'uv'))
      // pip --user / py launcher installs hide behind a versioned directory
      add(env.APPDATA && path.join(env.APPDATA, 'Python', 'Python3*', 'Scripts'))
      add(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'Python', 'Python3*', 'Scripts'))
      add(path.join(home, '.hermes', 'bin')) // Hermes Agent keeps a managed uv runtime here
      add(path.join(home, '.dsh', 'bin'))
    } else {
      add(path.join(home, '.local', 'bin'))
      add(path.join(home, '.bun', 'bin'))
      add(path.join(home, '.deno', 'bin'))
      add(path.join(home, '.volta', 'bin'))
      add(path.join(home, '.cargo', 'bin'))
      add(path.join(home, 'go', 'bin'))
      add(path.join(home, '.npm-global', 'bin'))
      add(path.join(home, 'Library', 'pnpm'))
      add(path.join(home, '.local', 'share', 'pnpm'))
      add(path.join(home, '.yarn', 'bin'))
      add(path.join(home, '.hermes', 'bin'))
      add(path.join(home, '.dsh', 'bin'))
      add('/usr/local/bin')
      add('/opt/homebrew/bin')
      add('/usr/bin')
      add('/bin')
    }
    const expanded = []
    for (const d of dirs) for (const e of expandGlob(d)) if (!expanded.includes(path.normalize(e))) expanded.push(path.normalize(e))
    return expanded.filter((d) => {
      try {
        return fs.statSync(d).isDirectory()
      } catch {
        return false
      }
    })
  })()
  pathCache.set('dirs', promise)
  return promise
}

/** First existing file among names × dirs × (Windows) extensions. Exported for tests. */
export function findInDirs(names, dirs) {
  for (const name of names) {
    for (const dir of dirs) {
      for (const ext of IS_WIN ? WIN_EXTS : ['']) {
        const candidate = path.join(dir, `${name}${ext}`)
        if (isFile(candidate)) return candidate
      }
    }
  }
  return null
}

/**
 * Detect a tool the way the original does: managed copy first, then the login
 * shell environment (so versions installed by nvm/brew/asdf are found), then a
 * scan of every plausible install directory. Never overwrites a system install.
 */
/** Read the installed version from the managed package.json: no child process, sub-millisecond. */
function managedVersion(tool, bin) {
  try {
    const pkg = path.join(managedDir(tool.id), 'node_modules', ...tool.npmPackage.split('/'), 'package.json')
    return parseVersion(JSON.parse(fs.readFileSync(pkg, 'utf8')).version)
  } catch { return '' }
}
export async function detectTool(tool) {
  const result = { id: tool.id, source: null, path: null, version: '', latest: null, updateAvailable: false, via: null }
  const names = binNames(tool)
  const managed = resolveManagedBin(tool)
  if (managed) {
    result.source = 'managed'
    result.path = managed
    result.via = 'portable-managed'
    result.version = managedVersion(tool, managed) || ''
    if (!result.version) {
      const r = await run(managed, ['--version'], {env:{...process.env,...portableToolEnv(tool.id)},timeout:8000})
      result.version = parseVersion(r.out || r.err)
    }
  } else {
    result.search = {
      names, extensions: IS_WIN ? WIN_EXTS : [''],
      pathLookup:'仅当前应用 data/codecli 内托管版本',
      dirsTried:1, dirs:[path.join(managedDir(tool.id),'node_modules','.bin')],
      hint:'仅检测盘内托管版本；不会读取宿主 PATH、全局 npm 或手动路径。请点击安装到当前目录。'
    }
  }

  if (result.source) {
    // Never block detection on the registry: answer with the cached value and
    // refresh it in the background, so the page paints from local state only.
    const cached = npmCache.get(tool.npmPackage)
    result.latest = typeof cached === 'string' ? cached : null
    result.updateAvailable = !!result.latest && !!result.version && cmpVersion(result.latest, result.version) > 0
    if (cached === undefined) npmLatest(tool.npmPackage).catch(() => null)
  }
  return result
}

/** Resolve binaries through the user's login shell / `where`, accepting alternates. */
export async function whichInLoginShell(bins) {
  const names = Array.isArray(bins) ? bins.filter(Boolean) : [bins].filter(Boolean)
  if (!names.length) return null

  if (IS_WIN) {
    // Resolve executable files directly using the refreshed environment, not
    // `where` output decoded through the console's potentially legacy code page.
    return findInDirs(names, await registryPathDirs())
  }

  const shell = process.env.SHELL || '/bin/bash'
  for (const bin of names) {
    const r = await run(shell, ['-lc', `command -v ${bin}`], { timeout: 6000 })
    const fromLogin = (r.out || '').trim().split(/\r?\n/).pop()
    if (fromLogin && fs.existsSync(fromLogin)) return fromLogin
  }

  const r2 = await run('/usr/bin/env', ['which', ...names], { timeout: 5000 })
  const fromWhich = (r2.out || '').trim().split(/\r?\n/).find((l) => l && fs.existsSync(l))
  if (fromWhich) return fromWhich

  // Deliberately no directory scan here: detectTool() runs that as a separate
  // step so the reported `via` tells the truth about how the binary was found.
  return null
}

/** Shells available for the 终端 picker (only detected ones are listed). */
export async function listTerminals() {
  const shells = IS_WIN
    ? [
        { id: 'pwsh', name: 'PowerShell 7', bin: 'pwsh.exe' },
        { id: 'powershell', name: 'PowerShell', bin: 'powershell.exe' },
        { id: 'cmd', name: '命令提示符', bin: 'cmd.exe' }
      ]
    : [
        { id: 'bash', name: 'Bash', bin: '/bin/bash' },
        { id: 'zsh', name: 'Zsh', bin: '/bin/zsh' },
        { id: 'fish', name: 'Fish', bin: '/usr/bin/fish' },
        { id: 'sh', name: 'sh (POSIX)', bin: '/bin/sh' }
      ]
  const found = []
  for (const s of shells) {
    const exists = IS_WIN ? !!(await whichInLoginShell(s.bin)) : fs.existsSync(s.bin)
    if (exists) found.push({ ...s, path: s.bin, isDefault: s.id === (process.env.SHELL || '').split('/').pop() })
  }
  if (IS_WIN && found.length && !found.some((f) => f.isDefault)) {
    const preferred = found.find((f) => f.id === 'powershell') || found.find((f) => f.id === 'cmd') || found[0]
    preferred.isDefault = true
  }
  if (!found.length) {
    found.push(
      IS_WIN
        ? { id: 'cmd', name: '命令提示符', bin: 'cmd.exe', path: 'cmd.exe', isDefault: true }
        : { id: 'sh', name: 'sh', bin: '/bin/sh', path: '/bin/sh', isDefault: true }
    )
  }
  return found
}

const npmCache = new Map()
export const cachedLatest = pkg => { const v = npmCache.get(pkg); return typeof v === 'string' ? v : null }
export async function npmLatest(pkg) {
  if (!pkg) return null
  if (npmCache.has(pkg)) return npmCache.get(pkg)
  const promise = executableEnvironment().then(env => run('npm', ['view', pkg, 'version'], { timeout: 15000, env: npmNetworkEnv({...env,...portableToolEnv('installer')}, networkStatus()) })).then((r) =>
    r.code === 0 ? String(r.out).trim() || null : null
  ).then((v) => {
    npmCache.set(pkg, v)
    setTimeout(() => npmCache.delete(pkg), 10 * 60_000).unref?.()
    return v
  })
  npmCache.set(pkg, promise)
  return promise
}

function cmpVersion(a, b) {
  const pa = String(a).split(/[.\-+]/).map((x) => (Number.isNaN(+x) ? x : +x))
  const pb = String(b).split(/[.\-+]/).map((x) => (Number.isNaN(+x) ? x : +x))
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x > y ? 1 : -1
    return String(x) > String(y) ? 1 : -1
  }
  return 0
}

/**
 * Install / update a managed copy.
 * npm installs into data/codecli/<toolId>, so the system install is untouched.
 */
const toolOperations = new Set()
export const toolOperationRunning = id => toolOperations.has(id)
export function prepareManagedReinstall(dir) {
  // Never remove the tool root: it can contain isolated CLI credentials/config.
  fs.rmSync(path.join(dir, 'node_modules'), {recursive:true, force:true})
  fs.rmSync(path.join(dir, 'package-lock.json'), {force:true})
}
export async function installTool(tool, onLog, { action = 'install' } = {}) {
  if (toolOperations.has(tool.id)) return {ok:false,error:'该智能体正在安装或更新，请等待完成'}
  toolOperations.add(tool.id)
  try {
    const direct = npmInvocation([]).direct
    onLog({type:'log',text:`[Agent Studio ${RELEASE.version}] ${tool.name} · ${action}\n执行方式：${direct ? 'Node → npm-cli.js（不经 cmd）' : 'cross-spawn（自动处理 PATH 与脚本转义）'}\n`})
    ensurePortableDir(managedDir(tool.id))
    portableToolEnv(tool.id) // migrate old config before rebuilding dependencies
    if (action === 'reinstall') {
      onLog({type:'log',text:'重新安装：仅清理托管依赖与锁文件，保留工具配置、凭据和项目。\n'})
      prepareManagedReinstall(managedDir(tool.id))
    }
    return await performInstall(tool,onLog)
  } catch(error) {
    onLog({type:'log',text:`安装失败：${error.message}\n`})
    return {ok:false,error:error.message}
  } finally { toolOperations.delete(tool.id); resetPathCaches() }
}
export function migrateLegacyPackages(file, tool) {
  if (!tool.legacyNpmPackages?.length || !fs.existsSync(file)) return false
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
  let changed = false
  for (const section of ['dependencies','devDependencies','optionalDependencies']) {
    for (const name of tool.legacyNpmPackages) {
      if (manifest[section] && Object.hasOwn(manifest[section], name)) { delete manifest[section][name]; changed = true }
    }
  }
  if (changed) fs.writeFileSync(file, JSON.stringify(manifest, null, 2)+'\n')
  return changed
}
/**
 * opencode-ai style packages: the wrapper's bin is a shell stub, the real exe ships in a
 * per-platform optional dependency. Install that dependency with --ignore-scripts and copy
 * the binary in place ourselves; retry the copy because a freshly written 180 MB exe is
 * often locked by Windows Defender for a few seconds (EPERM/EBUSY).
 */
async function installPlatformBinary(tool, dir, env, onLog) {
  const candidates = tool.platformBinary?.[process.platform]?.[process.arch] || []
  if (!candidates.length) return { ok: false, error: `没有适用于 ${process.platform}/${process.arch} 的 ${tool.name} 二进制` }
  const wrapperDir = path.join(dir, 'node_modules', tool.npmPackage)
  let version = 'latest'
  try { version = JSON.parse(fs.readFileSync(path.join(wrapperDir, 'package.json'), 'utf8')).version || 'latest' } catch {}
  const target = path.join(wrapperDir, 'bin', IS_WIN ? 'opencode.exe' : 'opencode')
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  let lastError = ''
  for (const name of candidates) {
    onLog({ type: 'log', text: `正在安装平台二进制 ${name}@${version}（约 180MB）…\n` })
    const args = ['install', '--no-audit', '--no-fund', '--loglevel=warn', '--ignore-scripts', '--no-save', `${name}@${version}`]
    const r = await new Promise(resolve => {
      const c = spawnCli('npm', args, { cwd: dir, env }); let err = ''
      c.stderr.on('data', d => { err += d; onLog({ type: 'log', text: `! ${String(d).trimEnd()}\n` }) })
      c.on('error', e => resolve({ code: -1, err: e.message })); c.on('close', code => resolve({ code, err }))
    })
    if (r.code !== 0) { lastError = `npm 安装 ${name} 失败（退出码 ${r.code}）`; continue }
    const source = path.join(dir, 'node_modules', name, 'bin', IS_WIN ? 'opencode.exe' : 'opencode')
    if (!fs.existsSync(source)) { lastError = `${name} 中没有找到二进制`; continue }
    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.copyFileSync(source, target + '.tmp'); fs.renameSync(target + '.tmp', target)
        if (!IS_WIN) fs.chmodSync(target, 0o755)
        break
      } catch (e) {
        lastError = `复制二进制失败：${e.code || e.message}`
        if (attempt === 8) return { ok: false, error: lastError + '（文件可能被杀毒软件占用，请稍后重试或将 data 目录加入白名单）' }
        onLog({ type: 'log', text: `! ${lastError}，${attempt * 2} 秒后重试（可能是杀毒扫描占用）\n` }); await sleep(attempt * 2000)
      }
    }
    // Verify with retries too: Defender may still hold the exe right after the copy.
    for (let attempt = 1; attempt <= 6; attempt++) {
      const v = await run(target, ['--version'], { env: { ...process.env, ...portableToolEnv(tool.id) }, timeout: 20000 })
      if (v.code === 0) { onLog({ type: 'log', text: `平台二进制就绪：${name} ${parseVersion(v.out || v.err) || ''}\n` }); return { ok: true } }
      lastError = `二进制无法启动（退出码 ${v.code}）：${String(v.err || v.out).trim().slice(0, 200)}`
      if (attempt < 6) await sleep(attempt * 2000)
    }
    onLog({ type: 'log', text: `! ${name} ${lastError}，尝试下一候选\n` })
  }
  return { ok: false, error: lastError || '未能安装平台二进制' }
}
async function performInstall(tool, onLog) {
  const dir = managedDir(tool.id)
  ensurePortableDir(dir)
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `agent-studio-managed-${tool.id}`, private: true, version: '1.0.0' }, null, 2))
  }

  if (migrateLegacyPackages(path.join(dir, 'package.json'), tool)) onLog({type:'log',text:`托管包声明已迁移到 ${tool.npmPackage}；未修改系统安装或工具配置。\n`})
  const args = ['install', '--no-audit', '--no-fund', '--loglevel=warn', ...(tool.ignoreInstallScripts ? ['--ignore-scripts'] : []), `${tool.npmPackage}@latest`]
  onLog({ type: 'log', text: `$ npm ${args.join(' ')}\n  cwd: ${dir}\n` })

  const env = npmNetworkEnv({...await executableEnvironment(),...portableToolEnv(tool.id)}, networkStatus())
  const child = spawnCli('npm', args, { cwd: dir, env })
  const pipe = (stream, tag) => {
    let buf = ''
    stream.on('data', (d) => {
      buf += d.toString()
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) if (line.trim()) onLog({ type: 'log', text: `${tag}${line}\n` })
    })
    stream.on('end', () => {
      if (buf.trim()) onLog({ type: 'log', text: `${tag}${buf}\n` })
    })
  }
  pipe(child.stdout, '')
  pipe(child.stderr, '! ')

  return new Promise((resolve) => {
    child.on('error', (err) => {
      onLog({ type: 'log', text: `! 启动 npm 失败：${err.message}\n` })
      resolve({ ok: false, error: err.message })
    })
    child.on('close', async (code) => {
      if (code === 0 && tool.platformBinary) {
        const r = await installPlatformBinary(tool, dir, env, onLog)
        if (!r.ok) { onLog({ type: 'log', text: `\n安装失败：${r.error}\n` }); return resolve({ ok: false, error: r.error }) }
      }
      if (code === 0) {
        const installed = isManagedInstalled(tool)
        const info = installed ? await detectTool(tool) : null
        onLog({ type: 'log', text: installed ? `\n安装完成，版本 ${info?.version || '未知'}\n` : '\n安装结束，但未找到可执行文件\n' })
        resolve({ ok: installed, version: info?.version || '', detection: info })
      } else {
        onLog({ type: 'log', text: `\n安装失败（npm 退出码 ${code}）\n` })
        resolve({ ok: false, error: `npm exit ${code}` })
      }
    })
  })
}

export function uninstallTool(tool) {
  if (toolOperations.has(tool.id)) throw Object.assign(new Error('该智能体正在安装或更新，请稍后移除'),{status:409})
  const dir = managedDir(tool.id)
  if (!fs.existsSync(dir)) return { ok: true, removed: false }
  fs.rmSync(dir, { recursive: true, force: true })
  return { ok: true, removed: true }
}

export function listTools() {
  return CODE_CLI_TOOLS
}

export function getTool(id) {
  return builtinTool(id)
}
