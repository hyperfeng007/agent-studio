import { useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  Alert, Badge, Button, Empty, Input, InputNumber, Modal, Segmented, Select,
  Spin, Switch, Tag, Tooltip, message
} from 'antd'
import {
  DownloadOutlined, SyncOutlined, DeleteOutlined, PlayCircleOutlined,
  FolderOpenOutlined, ReloadOutlined, LinkOutlined, CodeOutlined,
  CloudServerOutlined, KeyOutlined, ApiOutlined, InfoCircleOutlined
} from '@ant-design/icons'
import { loadCodeCli, appendInstallLog, clearInstallLog, patchTool, setSessions } from '../../store'
import api, { streamLogs } from '../../api'
import DirPicker from '../../components/DirPicker'

/** How the detector found the executable — shown next to 重新检测. */
const VIA_LABEL = {
  managed: '托管目录',
  where: 'PATH 查询 (where)',
  'login-shell': '登录 shell',
  'path-scan': '安装目录扫描'
}
import TerminalView from '../../components/TerminalView'

function StatusTag({ tool }) {
  const d = tool.detection
  if (!d || !d.source) return <Tag>未安装</Tag>
  if (d.source === 'managed') {
    return (
      <Badge dot={d.updateAvailable} color={d.updateAvailable ? 'orange' : 'transparent'} offset={[2, -2]}>
        <Tag color="green">托管 {d.version || ''}</Tag>
      </Badge>
    )
  }
  return (
    <Badge dot={d.updateAvailable} color={d.updateAvailable ? 'orange' : 'transparent'} offset={[2, -2]}>
      <Tag color="blue">系统 {d.version || ''}</Tag>
    </Badge>
  )
}

function ParamField({ param, value, onChange, models }) {
  if (param.type === 'select') {
    return <Select size="small" style={{ width: '100%' }} value={value ?? param.default} options={param.options} onChange={onChange} />
  }
  if (param.type === 'number') {
    return <InputNumber size="small" style={{ width: 160 }} value={value ?? param.default} onChange={onChange} />
  }
  if (param.type === 'switch') {
    return <Switch size="small" checked={!!(value ?? param.default)} onChange={onChange} />
  }
  if (param.type === 'model') {
    return (
      <Select
        size="small" style={{ width: '100%' }} allowClear showSearch value={value || undefined}
        placeholder="跟随主模型" options={(models || []).map((m) => ({ value: m.id, label: m.name || m.id }))}
        onChange={(v) => onChange(v || '')}
      />
    )
  }
  return <Input size="small" value={value ?? param.default ?? ''} placeholder={param.placeholder} onChange={(e) => onChange(e.target.value)} />
}

export default function CodeCliPage() {
  const dispatch = useDispatch()
  const { tools, terminals, sessions, meta, loading, installLogs } = useSelector((s) => s.codecli)
  const providers = useSelector((s) => s.providers.list)

  const [activeId, setActiveId] = useState(null)
  const [diagId, setDiagId] = useState(null)
  const [killingId, setKillingId] = useState(null)
  const [cfg, setCfg] = useState({})
  const [compatible, setCompatible] = useState({ providers: [], interfaces: [] })
  const [installing, setInstalling] = useState(null)
  const [logOpen, setLogOpen] = useState(false)
  const [dirOpen, setDirOpen] = useState(false)
  const [preview, setPreview] = useState(null)
  const [session, setSession] = useState(null)
  const saveTimer = useRef(null)

  const tool = useMemo(() => tools.find((t) => t.id === activeId) || null, [tools, activeId])

  useEffect(() => {
    if (!tools.length) dispatch(loadCodeCli({}))
  }, [tools.length, dispatch])

  useEffect(() => {
    if (!activeId && tools.length) setActiveId((tools.find((t) => t.isDefault) || tools[0]).id)
  }, [tools, activeId])

  useEffect(() => {
    if (!tool) return
    let cancelled = false
    ;(async () => {
      const [full, compat] = await Promise.all([api.codecli.config(tool.id), api.codecli.providers(tool.id).catch(() => ({ providers: [], interfaces: [] }))])
      if (cancelled) return
      const defaults = {}
      for (const p of tool.params || []) defaults[p.key] = p.default
      setCfg({
        mode: full?.mode || tool.defaultMode || (tool.loginMode === 'account' ? 'account' : 'gateway'),
        providerId: full?.providerId || compat.providers?.[0]?.id || '',
        modelId: full?.modelId || compat.providers?.find((p) => p.id === (full?.providerId || compat.providers?.[0]?.id))?.models?.[0]?.id || '',
        terminal: full?.terminal || terminals.find((t) => t.isDefault)?.id || terminals[0]?.id || 'bash',
        workDir: full?.workDir || meta.homeDir || '',
        extraArgs: full?.extraArgs || '',
        apiKey: full?.apiKey || '',
        ...defaults,
        ...full
      })
      setCompatible(compat)
      setPreview(null)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, terminals.length, meta.homeDir])

  const persist = (patch, immediate = false) => {
    const next = { ...cfg, ...patch }
    setCfg(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const run = () => api.codecli.saveConfig(tool.id, next).catch((e) => message.error(e.message))
    if (immediate) run()
    else saveTimer.current = setTimeout(run, 500)
  }

  const compatibleProviders = useMemo(() => {
    const list = compatible.providers?.length
      ? compatible.providers
      : providers.filter((p) => p.enabled && (tool?.interfaces || []).includes(p.type))
    return list
  }, [compatible, providers, tool])

  const providerModels = useMemo(() => {
    const p = compatibleProviders.find((x) => x.id === cfg.providerId)
    return p?.models || providers.find((x) => x.id === cfg.providerId)?.models || []
  }, [compatibleProviders, providers, cfg.providerId])

  const autoLaunch = useRef(false)
  const doInstall = (action = 'install', { launchAfter = false } = {}) => {
    if (!tool) return
    autoLaunch.current = launchAfter
    setInstalling(action)
    setLogOpen(true)
    dispatch(clearInstallLog(tool.id))
    const stop = streamLogs(api.codecli.installUrl(tool.id, action), (evt) => {
      if (evt.type === 'log') dispatch(appendInstallLog({ id: tool.id, text: evt.text }))
      if (evt.type === 'done') {
        setInstalling(null)
        if (evt.ok) message.success(`${tool.name} 已${action === 'reinstall' ? '重新安装' : action === 'install' ? '安装' : '更新'}${evt.version ? ` · v${evt.version}` : ''}`)
        else message.error(evt.error || '安装失败，详见日志')
        if (evt.detection) dispatch(patchTool({ id: tool.id, detection: evt.detection }))
        if (evt.ok && autoLaunch.current) { autoLaunch.current = false; setTimeout(doLaunch, 300) }
      }
      if (evt.type === 'error') {
        setInstalling(null)
        dispatch(appendInstallLog({ id: tool.id, text: `\n! ${evt.message}\n` }))
      }
    })
    return stop
  }

  const doDetect = async () => {
    const d = await api.codecli.detect(tool.id)
    dispatch(patchTool({ id: tool.id, detection: d }))
    message.success(d.source ? `检测到 ${d.source === 'managed' ? 'Agent Studio 托管' : '盘内托管'} 版本 ${d.version || '未知'}` : '未检测到已安装的副本')
  }

  const doUninstall = () => {
    Modal.confirm({
      title: `移除 ${tool.name} 的托管副本？`,
      content: '只会删除 Agent Studio 托管的安装，不会触碰系统 PATH 中的版本。',
      okText: '移除', okButtonProps: { danger: true }, cancelText: '取消',
      onOk: async () => {
        await api.codecli.uninstall(tool.id)
        const d = await api.codecli.detect(tool.id)
        dispatch(patchTool({ id: tool.id, detection: d }))
        message.success('已移除托管副本')
      }
    })
  }

  const refreshPreview = async () => {
    try {
      const p = await api.codecli.preview(tool.id, cfg)
      setPreview(p)
    } catch (err) {
      setPreview({ error: err.message })
    }
  }

  /** 终止一个会话，并把服务端的真实结果告诉用户（进程树是否已消失）。 */
  const killSessionById = async (id) => {
    let r
    try {
      r = await api.codecli.kill(id)
    } catch (err) {
      message.error(`终止失败：${err.message}`)
      return { ok: false }
    }
    if (!r?.ok) {
      message.warning(r?.error || '会话不存在或已退出')
    } else if (r.killed) {
      message.success(
        `已终止进程树（${(r.method || []).join(' → ')}）${r.exitCode !== null && r.exitCode !== undefined ? ` · 退出码 ${r.exitCode}` : ''}`
      )
    } else {
      message.warning(`已发出终止信号但进程未确认退出：${r.error || '原因未知'}（${(r.method || []).join(' → ')}）`)
    }
    dispatch(setSessions(await api.codecli.sessions().catch(() => [])))
    return r
  }

  const doLaunch = async () => {
    try {
      const res = await api.codecli.launch(tool.id, { config: cfg, cols: 110, rows: 32 })
      setSession({ id: res.sessionId, title: `${tool.name} · ${res.cwd}`, commandLine: res.commandLine, usingPty: res.usingPty })
      dispatch(setSessions(await api.codecli.sessions()))
    } catch (err) {
      Modal.error({ title: '启动失败', content: err.message })
    }
  }

  if (loading && !tools.length) {
    return (
      <div className="page">
        <div className="empty-state" style={{ flex: 1 }}><Spin size="large" /></div>
      </div>
    )
  }

  return (
    <div className="page" style={{ position: 'relative' }}>
      {/* --------------------------------------------------------- tool list */}
      <div className="tool-list">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px 10px' }}>
          <CodeOutlined style={{ color: 'var(--cs-primary)' }} />
          <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-1)', flex: 1 }}>主流智能体</span>
          <Tooltip title="重新检测安装状态">
            <Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => dispatch(loadCodeCli({ refresh: true }))} />
          </Tooltip>
        </div>
        {tools.map((t) => (
          <div key={t.id} className={`tool-item ${t.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(t.id)}>
            <div className="t-name">
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}{t.isDefault && <Tag color="green" style={{ marginLeft: 6, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>默认 · 免Key</Tag>}</span>
              <StatusTag tool={t} />
            </div>
            <div className="t-sub">{t.npmPackage}</div>
          </div>
        ))}
        <div style={{ padding: '10px 8px', fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.7 }}>
          {meta.ptyAvailable ? '✓ 已启用真实 PTY（支持 TUI 程序）' : '⚠ 未启用 PTY，回退到管道模式'}
          <br />
          托管安装目录：data/codecli/
        </div>
      </div>

      {/* ----------------------------------------------------------- detail */}
      <div className="tool-detail">
        {!tool ? (
          <Empty description="选择左侧的工具" style={{ marginTop: 80 }} />
        ) : (
          <div className="tool-detail-inner">
            {tool.isDefault && (
              <Alert type="success" showIcon style={{ marginBottom: 12 }}
                message="开箱即用：OpenCode + OpenCode Zen 免费模型（无需 API Key）"
                description={tool.detection?.source
                  ? '已安装。点击「启动」即可对话，默认模型 Big Pickle（免费）；在终端里输入 /models 可切换其他免费模型。'
                  : '一键安装到当前 U 盘并直接启动，默认使用免费模型 Big Pickle。免费模型由 OpenCode 官方限时提供。'}
                action={tool.detection?.source
                  ? <Button type="primary" icon={<PlayCircleOutlined />} onClick={doLaunch}>启动</Button>
                  : <Button type="primary" icon={<DownloadOutlined />} loading={!!installing} onClick={() => doInstall('install', { launchAfter: true })}>安装并启动</Button>}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <h3 style={{ margin: 0, fontSize: 17, color: 'var(--text-1)' }}>{tool.name}</h3>
              <StatusTag tool={tool} />
              {tool.detection?.updateAvailable && (
                <Tag color="orange">可更新到 {tool.detection.latest}</Tag>
              )}
              {tool.runMode === 'service' && (
                <Tooltip title={tool.servicePort ? `它自带的 Web UI 默认监听 127.0.0.1:${tool.servicePort}` : '该工具启动后自带 Web UI'}>
                  <Tag color="purple">服务型（Web UI{tool.servicePort ? ` · ${tool.servicePort}` : ''}）</Tag>
                </Tooltip>
              )}
              <div style={{ flex: 1 }} />
              {tool.website && (
                <Button size="small" type="text" icon={<LinkOutlined />} onClick={() => window.open(tool.website, '_blank', 'noopener')}>
                  官网
                </Button>
              )}
              {tool.docs && (
                <Button size="small" type="text" icon={<LinkOutlined />} onClick={() => window.open(tool.docs, '_blank', 'noopener')}>
                  文档
                </Button>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 14 }}>{tool.description}</div>

            {tool.available === false && (
              <Alert type="warning" showIcon icon={<InfoCircleOutlined />} message="暂不可安装" description={tool.unavailableReason} style={{ marginBottom: 14 }} />
            )}

            {/* ------------------------------------------------ 安装与检测 */}
            <div className="section-card">
              <div className="section-title">
                <DownloadOutlined /> 安装
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11.5, color: 'var(--text-3)', fontWeight: 400 }}>
                  {tool.detection?.path || '未检测到可执行文件'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button
                  type="primary" icon={<DownloadOutlined />} loading={installing === 'install' || installing === 'reinstall'}
                  disabled={tool.available === false || tool.detection?.source === 'managed'}
                  onClick={() => tool.detection?.source ? Modal.confirm({title:`重新安装 ${tool.name}？`,content:'仅重建 Agent Studio 托管依赖，保留工具配置、凭据与项目；不会卸载系统安装的版本。',okText:'重新安装',cancelText:'取消',onOk:()=>{doInstall('reinstall')}}) : doInstall('install')}
                >
                  {tool.detection?.source ? '重新安装' : '安装'}
                </Button>
                <Button
                  icon={<SyncOutlined />} loading={installing === 'update'}
                  disabled={tool.available === false || !tool.detection?.source}
                  onClick={() => doInstall('update')}
                >
                  更新
                </Button>
                <Button icon={<ReloadOutlined />} onClick={doDetect}>重新检测</Button>
                <Button danger icon={<DeleteOutlined />} disabled={!tool.detection?.source || tool.detection.source !== 'managed'} onClick={doUninstall}>
                  移除托管副本
                </Button>
                <Button type="text" onClick={() => setLogOpen((v) => !v)}>{logOpen ? '收起日志' : '查看日志'}</Button>
              </div>
              {logOpen && (
                <div className="install-log" style={{ marginTop: 10 }}>
                  {installLogs[tool.id] || (installing ? '' : '（暂无日志）')}
                  {installing && <span className="cursor-blink" />}
                </div>
              )}

              <Alert style={{marginTop:12}} type="info" showIcon message="仅使用当前盘内的智能体" description="只检测 data/codecli 内的托管版本。安装、更新和重装均在当前目录；不扫描宿主 PATH，不使用旧的手动可执行路径。" />
              <Button style={{marginTop:8}} size="small" icon={<ReloadOutlined />} onClick={doDetect}>重新检测盘内版本</Button>

            </div>

            {/* ------------------------------------------------ 模型连接 */}
            <div className="section-card">
              <div className="section-title"><ApiOutlined /> 模型连接</div>

              <div className="field-row">
                <span className="field-label">连接方式</span>
                <div className="field-control">
                  <Segmented
                    size="small"
                    value={cfg.mode}
                    onChange={(v) => persist({ mode: v })}
                    options={[
                      { value: 'gateway', label: '统一网关', icon: <CloudServerOutlined /> },
                      { value: 'direct', label: '服务商直连', icon: <ApiOutlined /> },
                      ...(tool.loginMode !== 'provider' ? [{ value: 'account', label: '工具自有账号', icon: <KeyOutlined /> }] : [])
                    ]}
                    disabled={tool.loginMode === 'account' && cfg.mode !== 'account'}
                  />
                  <div className="field-hint">
                    {cfg.mode === 'gateway' && `由本地网关（${tool.gatewayInterfaces?.[0] || 'openai'} 协议）转发到你配置的服务商与模型，CLI 无需知道真实密钥。`}
                    {cfg.mode === 'direct' && '把服务商的 API 地址与密钥直接交给 CLI（需接口类型兼容）。'}
                    {cfg.mode === 'account' && tool.accountLoginHint}
                  </div>
                </div>
              </div>

              {cfg.mode !== 'account' && (
                <>
                  <div className="field-row">
                    <span className="field-label">模型服务</span>
                    <div className="field-control">
                      <Select
                        size="small" style={{ width: '100%' }} showSearch optionFilterProp="label"
                        placeholder={compatibleProviders.length ? '选择服务商' : `没有兼容的服务商（需要 ${tool.interfaces.join(' / ')} 类型且已启用）`}
                        value={cfg.providerId || undefined}
                        onChange={(v) => {
                          const p = compatibleProviders.find((x) => x.id === v)
                          persist({ providerId: v, modelId: p?.models?.[0]?.id || '' })
                        }}
                        options={compatibleProviders.map((p) => ({ value: p.id, label: `${p.name}（${p.type}）` }))}
                        notFoundContent={<span style={{ fontSize: 12 }}>请先在「设置 → 模型服务」中启用兼容的服务商</span>}
                      />
                      <div className="field-hint">仅列出接口类型兼容且已启用的服务商。</div>
                    </div>
                  </div>
                  <div className="field-row">
                    <span className="field-label">模型</span>
                    <div className="field-control">
                      <Select
                        size="small" style={{ width: '100%' }} showSearch optionFilterProp="label" value={cfg.modelId || undefined}
                        placeholder="选择模型" onChange={(v) => persist({ modelId: v })}
                        options={providerModels.map((m) => ({ value: m.id, label: m.name || m.id }))}
                      />
                    </div>
                  </div>
                </>
              )}

              {(tool.params || []).map((p) => (
                <div className="field-row" key={p.key}>
                  <span className="field-label">{p.label}</span>
                  <div className="field-control">
                    <ParamField param={p} value={cfg[p.key]} models={providerModels} onChange={(v) => persist({ [p.key]: v })} />
                    {p.hint && <div className="field-hint">{p.hint}</div>}
                  </div>
                </div>
              ))}

              <div className="field-row">
                <span className="field-label">附加参数</span>
                <div className="field-control">
                  <Input size="small" placeholder="追加到命令行的参数，如 --verbose" value={cfg.extraArgs || ''} onChange={(e) => persist({ extraArgs: e.target.value })} />
                </div>
              </div>
            </div>

            {/* ------------------------------------------------ 运行环境 */}
            <div className="section-card">
              <div className="section-title"><PlayCircleOutlined /> 运行环境</div>
              <div className="field-row">
                <span className="field-label">工作目录</span>
                <div className="field-control">
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Input size="small" value={cfg.workDir || ''} onChange={(e) => persist({ workDir: e.target.value })} style={{ fontFamily: 'monospace', fontSize: 12 }} />
                    <Button size="small" icon={<FolderOpenOutlined />} onClick={() => setDirOpen(true)}>浏览</Button>
                  </div>
                  <div className="field-hint">默认 data/workspaces；仅接受当前 data 内的目录，保存为相对路径以适应盘符变化。</div>
                </div>
              </div>
              <div className="field-row">
                <span className="field-label">终端</span>
                <div className="field-control">
                  <Select
                    size="small" style={{ width: 220 }} value={cfg.terminal}
                    onChange={(v) => persist({ terminal: v })}
                    options={terminals.map((t) => ({ value: t.id, label: `${t.name}${t.isDefault ? '（默认）' : ''}` }))}
                  />
                  <div className="field-hint">直接启动盘内 CLI，不加载宿主 shell 配置；终端由内嵌 xterm.js 承载。</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14 }}>
                <Button type="primary" icon={<PlayCircleOutlined />} onClick={doLaunch} disabled={!tool.detection?.source}>
                  启动
                </Button>
                {tool.runMode === 'service' && (
                  <Button icon={<PlayCircleOutlined />} disabled={!tool.detection?.source} onClick={async () => {
                    try {
                      const r = await fetch(api.codecli.installUrl(tool.id, 'service').replace('/install', '/service'), {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: cfg })
                      })
                      const data = await r.json()
                      if (!r.ok) throw new Error(data.error)
                      setSession({ id: data.sessionId, title: `${tool.name} · service`, commandLine: data.webUi })
                    } catch (err) {
                      message.error(err.message)
                    }
                  }}>
                    以服务模式启动
                  </Button>
                )}
                <Button icon={<InfoCircleOutlined />} onClick={refreshPreview}>预览启动命令</Button>
                {!tool.detection?.source && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>需先安装或检测到系统版本</span>}
              </div>

              {preview && (
                <div style={{ marginTop: 12 }}>
                  {preview.error ? (
                    <Alert type="error" showIcon message={preview.error} />
                  ) : (
                    <>
                      <div className="cmd-preview">{preview.commandLine}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.8 }}>
                        工作目录 {preview.cwd} · 安装来源 {preview.source === 'managed' ? 'Agent Studio 托管' : '系统 PATH'} ·
                        连接方式 {preview.mode === 'gateway' ? '统一网关' : preview.mode === 'direct' ? '服务商直连' : '工具自有账号'}
                        {preview.provider ? ` · ${preview.provider} / ${preview.model}` : ''}
                        <br />
                        环境变量：{Object.entries(preview.env || {}).map(([k, v]) => `${k}=${v}`).join('  ')}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ------------------------------------------------ 活动会话 */}
            {sessions.length > 0 && (
              <div className="section-card">
                <div className="section-title">
                  活动会话
                  <span style={{ flex: 1 }} />
                  <Button size="small" type="text" icon={<ReloadOutlined />} onClick={async () => dispatch(setSessions(await api.codecli.sessions()))} />
                </div>
                {sessions.map((s) => (
                  <div className="model-row" key={s.id}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--text-1)' }}>{s.label}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-3)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.command} {(s.args || []).join(' ')} · {s.cwd}
                      </div>
                    </span>
                    <Tag color={s.exitCode === null ? 'green' : 'default'}>
                      {s.exitCode === null ? `运行中 · ${s.clients} 个窗口` : `已退出 (${s.exitCode})`}
                    </Tag>
                    {s.exitCode === null && (
                      <Button size="small" onClick={() => setSession({ id: s.id, title: s.label })}>接入</Button>
                    )}
                    {s.exitCode === null && (
                      <Button size="small" danger loading={killingId === s.id} onClick={async () => { setKillingId(s.id); await killSessionById(s.id); setKillingId(null) }}>
                        终止
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <DirPicker open={dirOpen} value={cfg.workDir} onCancel={() => setDirOpen(false)} onOk={(p) => { persist({ workDir: p }, true); setDirOpen(false) }} />

      {session && tool && (
        <TerminalView
          sessionId={session.id}
          title={session.title}
          onClose={async () => {
            setSession(null)
            dispatch(setSessions(await api.codecli.sessions()))
          }}
          onKill={() => killSessionById(session.id)}
        />
      )}

      {/* ---------------------------------------------- 检测诊断：搜过什么 */}
      {(() => {
        const t = tools.find((x) => x.id === diagId)
        const search = t?.detection?.search
        return (
          <Modal open={!!diagId} title={t ? `为什么没检测到 ${t.name}` : ''} onCancel={() => setDiagId(null)} footer={null} width={600}>
            {t && (
              <div className="diag">
                <p style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                  检测范围：仅 <code>当前目录/data/codecli</code>，不检测宿主安装（版本号来自盘内安装记录，最新版本在后台查询）。
                </p>
                <ol style={{ fontSize: 12.5, color: 'var(--text-2)', paddingLeft: 20, lineHeight: 2 }}>
                  <li>
                    找过这些命令名：
                    {(search?.names || []).map((n) => (
                      <Tag key={n}>{n}</Tag>
                    ))}
                    {search?.extensions?.length ? <div>Windows 后缀优先级：{search.extensions.join(' → ')}</div> : null}
                  </li>
                  <li>
                    PATH 查询方式：<code>{search?.pathLookup || '-'}</code>
                  </li>
                  <li>
                    另外扫描了 {search?.dirsTried ?? 0} 个真实存在的目录：
                    <pre className="diag-dirs">{(search?.dirs || []).join('\n') || '（无）'}</pre>
                  </li>
                </ol>
                {search?.hint && <Alert type="info" showIcon message={search.hint} style={{ marginBottom: 10 }} />}
                {t.available === false ? (
                  <Alert type="warning" showIcon message={t.unavailableReason || '该工具当前不支持自动安装。'} />
                ) : (
                  <Alert type="warning" showIcon message={`还没装的话，可以直接点上面的「安装」让 Agent Studio 自动安装 ${t.npmPackage} 到托管目录。`} />
                )}
              </div>
            )}
          </Modal>
        )
      })()}
    </div>
  )
}
