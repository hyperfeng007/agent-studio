/**
 * Reuse the local OpenCode CLI login for the `opencode-free` provider.
 *
 * OpenCode Zen gates its free model tier behind the official client, so a
 * keyless request answers HTTP 403. Users who already ran `opencode auth login`
 * have a usable key sitting in OpenCode's data directory — Agent Studio reads
 * it instead of asking the user to copy/paste the same secret twice.
 *
 * The file is OpenCode's `auth.json`, shaped like:
 *   { "opencode": { "type": "api", "key": "..." }, "anthropic": { "type": "oauth", ... } }
 * Only `type: "api"` entries carry a key that can be sent as `Authorization: Bearer`.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TTL_MS = 10_000
let cache = { at: 0, value: null }

/** Every place OpenCode is known to keep auth.json (cross-platform guesses + env overrides). */
export function authFileCandidates() {
  const home = os.homedir()
  const env = process.env
  const dirs = []
  if (env.OPENCODE_DATA_HOME) dirs.push(env.OPENCODE_DATA_HOME)
  if (env.OPENCODE_HOME) dirs.push(env.OPENCODE_HOME)
  if (env.XDG_DATA_HOME) dirs.push(path.join(env.XDG_DATA_HOME, 'opencode'))
  dirs.push(path.join(home, '.local', 'share', 'opencode'))
  dirs.push(path.join(home, '.config', 'opencode'))
  dirs.push(path.join(home, '.opencode'))
  if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'opencode'))
  if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'opencode'))
  if (process.platform === 'darwin') dirs.push(path.join(home, 'Library', 'Application Support', 'opencode'))
  return [...new Set(dirs)].map((d) => path.join(d, 'auth.json'))
}

function readAuth(file) {
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!json || typeof json !== 'object') return null
    // Prefer OpenCode's own entry, then any api-key entry from another provider.
    const entries = Object.entries(json).filter(([, v]) => v && typeof v === 'object')
    const sorted = entries.sort((a, b) => (a[0] === 'opencode' ? -1 : b[0] === 'opencode' ? 1 : 0))
    for (const [name, v] of sorted) {
      const key = v.key || v.apiKey || v.api_key
      if (key && (v.type === 'api' || name === 'opencode')) return { name, key: String(key) }
    }
    return null
  } catch {
    return null // missing, unreadable or hand-edited — fall back to keyless
  }
}

/**
 * @returns {{key:string|null, source:string|null, file:string|null}}
 *   key    — bearer token to send, or null when the user must supply one
 *   source — 'opencode-cli' when it came from the local OpenCode install
 *   file   — which auth.json it came from (shown in the UI so it is not magic)
 */
export function openCodeAuth(force = false) {
  if (!force && cache.value && Date.now() - cache.at < TTL_MS) return cache.value
  for (const file of authFileCandidates()) {
    const found = readAuth(file)
    if (found) {
      cache = { at: Date.now(), value: { key: found.key, source: 'opencode-cli', file, entry: found.name } }
      return cache.value
    }
  }
  cache = { at: Date.now(), value: { key: null, source: null, file: null, entry: null } }
  return cache.value
}

/** Cheap key for the settings page: "本机 OpenCode 已登录（可复用）" vs "需要自己填 Key". */
export function openCodeAuthStatus() {
  const a = openCodeAuth()
  return a.key
    ? { available: true, source: a.source, file: a.file, entry: a.entry, keyPreview: `${a.key.slice(0, 6)}…${a.key.slice(-4)}` }
    : { available: false, searched: authFileCandidates() }
}
