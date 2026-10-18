import express from 'express'
import path from 'node:path'
import { requireLocalMcp } from '../mcp/security.js'

// Local launcher coordination only. Never kill a PID supplied by a request.
export function createDesktopRouter({ root, instanceId, pid, shutdown }) {
  const router = express.Router()
  const canonical = value => {
    const resolved = path.resolve(value)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  let stopping = false
  router.use(requireLocalMcp)
  router.get('/identity', (req, res) => res.json({ root: path.resolve(root), instanceId, pid }))
  router.post('/stop', (req, res) => {
    if (typeof req.body?.root !== 'string' || req.body.instanceId !== instanceId || canonical(req.body.root) !== canonical(root)) {
      return res.status(409).json({ error: '实例身份不匹配，未停止任何进程' })
    }
    if (!stopping) {
      stopping = true
      res.once('finish', () => setTimeout(() => void Promise.resolve().then(shutdown).catch(error => console.error('Desktop shutdown failed:', error)), 100))
    }
    res.status(202).json({ ok: true, stopping: true })
  })
  return router
}
