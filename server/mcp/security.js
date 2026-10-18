/** MCP is local-only until authenticated remote administration is implemented. */
export function isLocalMcpRequest(req) {
  const ip=req.socket?.remoteAddress || ''
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip))return false
  const allowed=['localhost','127.0.0.1','[::1]']
  try {
    const host=new URL(`http://${req.headers.host}`)
    if(!allowed.includes(host.hostname))return false
    if(req.headers.origin) {
      const origin=new URL(req.headers.origin)
      if(!allowed.includes(origin.hostname) || origin.host!==host.host)return false
    }
    if(req.headers['sec-fetch-site']==='cross-site')return false
    return true
  } catch {return false}
}
export function requireLocalMcp(req,res,next) {
  if(!isLocalMcpRequest(req))return res.status(403).json({error:'MCP 执行与管理仅允许在服务端本机通过 localhost 访问。尚未开放远程授权，请勿绕过此限制。'})
  next()
}
