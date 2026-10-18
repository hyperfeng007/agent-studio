import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../store.js'

export function inside(root, value) {
  const rel = path.relative(path.resolve(root), path.resolve(value))
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))
}
export function safePortableFile(file) {
  try { return inside(fs.realpathSync(DATA_DIR), fs.realpathSync(file)) } catch { return false }
}
export function ensurePortableDir(dir) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!inside(DATA_DIR, dir)) throw new Error('目录必须位于当前应用 data 下')
  let parent = path.resolve(dir)
  while (!fs.existsSync(parent)) parent = path.dirname(parent)
  if (!safePortableFile(parent)) throw new Error('盘内目录不能链接到外部位置')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
export function toolConfigDir(id) {
  const dir = path.join(DATA_DIR, 'tool-config', id)
  const legacy = path.join(DATA_DIR, 'codecli', id, 'agent-studio-config')
  if (!fs.existsSync(dir) && fs.existsSync(legacy) && safePortableFile(legacy)) {
    ensurePortableDir(path.dirname(dir))
    fs.renameSync(legacy, dir)
  }
  ensurePortableDir(dir)
  if (!safePortableFile(dir)) throw new Error('盘内工具配置目录不能链接到外部位置')
  return dir
}
export function workspaceDir(value = '') {
  const fallback = path.join(DATA_DIR, 'workspaces')
  ensurePortableDir(fallback)
  if (value) {
    const candidate = path.resolve(DATA_DIR, value)
    try { if (inside(DATA_DIR, candidate) && safePortableFile(candidate) && fs.statSync(candidate).isDirectory()) return candidate } catch {}
  }
  return fallback
}
export function portableToolEnv(id) {
  const home = path.join(DATA_DIR, 'homes', id)
  const config = toolConfigDir(id)
  const tmp = path.join(DATA_DIR, 'temp', id)
  const cache = path.join(DATA_DIR, 'cache')
  const dirs = [home, tmp, cache, path.join(home, 'AppData', 'Roaming'), path.join(home, 'AppData', 'Local'), path.join(DATA_DIR, 'runtime', 'npm'), path.join(DATA_DIR, 'config')]
  for (const dir of dirs) ensurePortableDir(dir)
  const env = {
    HOME: home, USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'), XDG_STATE_HOME: path.join(home, '.local', 'state'),
    TEMP: tmp, TMP: tmp, TMPDIR: tmp,
    npm_config_cache: path.join(cache, 'npm'), npm_config_prefix: path.join(DATA_DIR, 'runtime', 'npm'),
    npm_config_userconfig: path.join(DATA_DIR, 'config', 'npmrc'), npm_config_globalconfig: path.join(DATA_DIR, 'config', 'npm-globalrc'),
    npm_config_update_notifier: 'false',
    PIP_CACHE_DIR: path.join(cache, 'pip'), PYTHONUSERBASE: path.join(home, 'python'),
    UV_CACHE_DIR: path.join(cache, 'uv'), UV_PYTHON_INSTALL_DIR: path.join(DATA_DIR, 'runtime', 'uv-python'),
    UV_TOOL_DIR: path.join(home, 'uv-tools'), UV_TOOL_BIN_DIR: path.join(home, 'bin'),
    CARGO_HOME: path.join(home, '.cargo'), RUSTUP_HOME: path.join(home, '.rustup'),
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    NODE_REPL_HISTORY: path.join(home, '.node_repl_history'), AGENT_STUDIO_PORTABLE_TOOLS: '1'
  }
  if (process.platform === 'win32') { env.HOMEDRIVE = path.parse(home).root.slice(0, 2); env.HOMEPATH = home.slice(2) }
  if (id === 'claude-code') env.CLAUDE_CONFIG_DIR = path.join(config, 'claude')
  if (id === 'codex') env.CODEX_HOME = config
  if (id === 'pi') env.PI_CODING_AGENT_DIR = config
  if (id === 'opencode') env.OPENCODE_CONFIG_DIR = config
  if (id === 'hermes-agent') env.HERMES_HOME = path.join(config, 'hermes-home')
  if (id === 'openclaw') { env.OPENCLAW_STATE_DIR = path.join(config, 'openclaw-home'); env.OPENCLAW_CONFIG_PATH = path.join(env.OPENCLAW_STATE_DIR, 'openclaw.json') }
  return env
}
