import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { customAlphabet } from 'nanoid'
import { FILES_DIR, table, findRow, insertRow, deleteRow } from '../store.js'

export const filesRouter = express.Router()
const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12)

const MAX_BYTES = 20 * 1024 * 1024

/**
 * Files are uploaded as base64 JSON (no multipart dependency) and stored on
 * disk under data/files, mirroring Cherry Studio's local file storage.
 */
filesRouter.post('/upload', (req, res) => {
  const { name, mime, data } = req.body || {}
  if (!data) return res.status(400).json({ error: '缺少文件数据' })
  const buf = Buffer.from(String(data).replace(/^data:[^;]+;base64,/, ''), 'base64')
  if (buf.length > MAX_BYTES) return res.status(413).json({ error: '文件超过 20MB 限制' })
  const id = nanoid()
  const ext = path.extname(name || '').slice(0, 10) || ''
  const file = path.join(FILES_DIR, `${id}${ext}`)
  fs.writeFileSync(file, buf)
  const record = {
    id,
    name: id + ext,
    origin_name: name || `${id}${ext}`,
    size: buf.length,
    mime: mime || 'application/octet-stream',
    path: file,
    ext,
    createdAt: Date.now()
  }
  insertRow('files', record)
  res.json({ ...record, path: undefined })
})

filesRouter.get('/', (req, res) => {
  res.json(table('files').map(({ path: _p, ...rest }) => rest).sort((a, b) => b.createdAt - a.createdAt))
})

filesRouter.get('/:id/raw', (req, res) => {
  const rec = findRow('files', req.params.id)
  if (!rec || !fs.existsSync(rec.path)) return res.status(404).json({ error: '文件不存在' })
  res.setHeader('Content-Type', rec.mime || 'application/octet-stream')
  res.setHeader('Cache-Control', 'public, max-age=86400')
  fs.createReadStream(rec.path).pipe(res)
})

filesRouter.delete('/:id', (req, res) => {
  const rec = findRow('files', req.params.id)
  if (rec && fs.existsSync(rec.path)) {
    try {
      fs.unlinkSync(rec.path)
    } catch {}
  }
  deleteRow('files', req.params.id)
  res.json({ ok: true })
})
