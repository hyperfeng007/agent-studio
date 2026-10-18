import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
export const FILES_DIR = path.join(DATA_DIR, 'files')
const DB_FILE = path.join(DATA_DIR, 'db.json')

/**
 * Table names intentionally mirror Cherry Studio's renderer database
 * (assistants / topics / messages / settings / minapps / files) so the
 * persistence model of the clone matches the original one-to-one.
 */
const EMPTY_DB = () => ({
  settings: {},
  knowledgeBases: [],
  knowledgeDocuments: [],
  mcpServers: [],
  assistants: [],
  topics: [],
  messages: [],
  minapps: [],
  providers: [],
  codecli: [],
  files: []
})

let db = null
let writeTimer = null
const listeners = new Set()

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(FILES_DIR, { recursive: true })
}

export function loadDb() {
  if (db) return db
  ensureDirs()
  const base = EMPTY_DB()
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
      db = { ...base, ...raw }
    } else {
      db = base
    }
  } catch (err) {
    console.error('[store] db.json corrupted, backing up and starting fresh:', err.message)
    try {
      fs.renameSync(DB_FILE, `${DB_FILE}.broken.${Date.now()}`)
    } catch {}
    db = base
  }
  return db
}

function flush() {
  writeTimer = null
  const tmp = `${DB_FILE}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2))
  fs.renameSync(tmp, DB_FILE)
}

/** Debounced atomic persistence. */
export function save() {
  if (!db) return
  if (writeTimer) return
  writeTimer = setTimeout(() => {
    try {
      flush()
    } catch (err) {
      console.error('[store] write failed:', err.message)
    }
  }, 120)
}

export function saveNow() {
  if (!db) return
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  try {
    flush()
  } catch (err) {
    console.error('[store] write failed:', err.message)
  }
}

export function table(name) {
  const d = loadDb()
  if (!(name in d)) d[name] = []
  return d[name]
}

export function findRow(name, id) {
  return table(name).find((r) => r.id === id) || null
}

export function upsertRow(name, record) {
  const rows = table(name)
  const idx = rows.findIndex((r) => r.id === record.id)
  if (idx >= 0) rows[idx] = { ...rows[idx], ...record }
  else rows.push(record)
  save()
  return record
}

export function insertRow(name, record) {
  table(name).push(record)
  save()
  return record
}

export function deleteRow(name, id) {
  const rows = table(name)
  const idx = rows.findIndex((r) => r.id === id)
  if (idx >= 0) rows.splice(idx, 1)
  save()
  return idx >= 0
}

export function deleteWhere(name, predicate) {
  const rows = table(name)
  let n = 0
  for (let i = rows.length - 1; i >= 0; i--) {
    if (predicate(rows[i])) {
      rows.splice(i, 1)
      n++
    }
  }
  if (n) save()
  return n
}

export function getSettings() {
  return loadDb().settings
}

export function updateSettings(patch) {
  const d = loadDb()
  d.settings = { ...d.settings, ...patch }
  save()
  return d.settings
}

/** Server-sent events channel used to keep several browser tabs in sync. */
export function onChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function notify(event, payload) {
  for (const fn of listeners) {
    try {
      fn(event, payload)
    } catch (err) {
      console.error('[store] listener error', err.message)
    }
  }
}
