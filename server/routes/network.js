import express from 'express'
import { networkStatus, applyNetworkSettings } from '../net/proxy.js'
import { diagnoseNetwork } from '../net/diagnose.js'
import { getSettings } from '../store.js'

export const networkRouter = express.Router()

/** 当前进程里真正生效的网络配置（模式 / 代理地址 / 来源 / 绕过规则 / IPv4）。 */
networkRouter.get('/status', (req, res) => {
  res.json(networkStatus())
})

/**
 * 重新读取系统代理并应用。
 * 场景：用户刚打开加速器 / 换了节点，但服务是之前启动的 —— 不必重启服务。
 */
networkRouter.post('/reapply', async (req, res) => {
  try {
    const status = await applyNetworkSettings(getSettings(), { log: true })
    res.json({ ok: true, network: status })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

/** 逐步诊断：DNS → TCP → TLS → HTTP（真实链路）。 */
networkRouter.post('/diagnose', async (req, res) => {
  const { providerId, host } = req.body || {}
  if (!providerId && !host) return res.status(400).json({ error: '需要提供 providerId 或 host' })
  try {
    const result = await diagnoseNetwork({ providerId, host })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})
