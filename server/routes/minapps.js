import express from 'express'
import { customAlphabet } from 'nanoid'
import { MINAPPS } from '../config/minapps.js'
import { table, findRow, insertRow, upsertRow, deleteRow, loadDb } from '../store.js'

export const minappsRouter = express.Router()
const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12)

/**
 * Seed the built-in catalogue into the local store once, and pick up any newly
 * added built-ins on later boots. Keeping them in the same table as custom apps
 * is what makes reorder / hide / pin work uniformly, like the original.
 */
export function seedMinApps() {
  const db = loadDb()
  const existing = new Set(db.minapps.map((m) => m.id))
  let order = db.minapps.length
  for (const app of MINAPPS) {
    if (existing.has(app.id)) continue
    db.minapps.push({
      id: app.id,
      name: app.name,
      url: app.url,
      logo: app.logo || '',
      isBuiltin: true,
      pinned: false,
      hidden: false,
      openExternal: false,
      order: order++,
      addTime: Date.now()
    })
  }
  db.minapps.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.addTime ?? 0) - (b.addTime ?? 0))
}

function publicList() {
  return table('minapps').slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.order ?? 0) - (b.order ?? 0))
}

minappsRouter.get('/', (req, res) => {
  const includeHidden = req.query.all === '1'
  res.json(publicList().filter((m) => includeHidden || !m.hidden))
})

minappsRouter.get('/:id', (req, res) => {
  const app = findRow('minapps', req.params.id)
  if (!app) return res.status(404).json({ error: '小程序不存在' })
  res.json(app)
})

minappsRouter.post('/', (req, res) => {
  const { name, url, logo } = req.body || {}
  if (!name || !url) return res.status(400).json({ error: '名称和网址必填' })
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return res.status(400).json({ error: '网址格式不正确' })
  }
  const app = {
    id: nanoid(),
    name: String(name).slice(0, 40),
    url: parsed.toString(),
    logo: logo || '',
    isBuiltin: false,
    pinned: false,
    hidden: false,
    openExternal: false,
    order: table('minapps').length,
    addTime: Date.now()
  }
  insertRow('minapps', app)
  res.json(app)
})

minappsRouter.put('/:id', (req, res) => {
  const app = findRow('minapps', req.params.id)
  if (!app) return res.status(404).json({ error: '小程序不存在' })
  const patch = {}
  for (const key of ['name', 'url', 'logo', 'pinned', 'hidden', 'openExternal', 'embed', 'style', 'order']) {
    if (req.body[key] !== undefined) patch[key] = req.body[key]
  }
  if (patch.url) {
    try {
      patch.url = new URL(patch.url).toString()
    } catch {
      return res.status(400).json({ error: '网址格式不正确' })
    }
  }
  upsertRow('minapps', { ...app, ...patch })
  res.json(findRow('minapps', app.id))
})

/** Built-ins are hidden rather than deleted; custom apps are removed. */
minappsRouter.delete('/:id', (req, res) => {
  const app = findRow('minapps', req.params.id)
  if (!app) return res.status(404).json({ error: '小程序不存在' })
  if (app.isBuiltin) {
    upsertRow('minapps', { ...app, hidden: true })
    return res.json({ ok: true, hidden: true })
  }
  deleteRow('minapps', req.params.id)
  res.json({ ok: true })
})

minappsRouter.post('/reorder', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : []
  const rows = table('minapps')
  ids.forEach((id, index) => {
    const row = rows.find((r) => r.id === id)
    if (row) row.order = index
  })
  res.json(publicList())
})

minappsRouter.post('/:id/restore', (req, res) => {
  const app = findRow('minapps', req.params.id)
  if (!app) return res.status(404).json({ error: '小程序不存在' })
  upsertRow('minapps', { ...app, hidden: false })
  res.json(findRow('minapps', app.id))
})
