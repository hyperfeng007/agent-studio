import { useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  Button, Empty, Form, Input, Modal, Switch, Tag, Tooltip, message, Popconfirm, Spin
} from 'antd'
import {
  PlusOutlined, SearchOutlined, ArrowLeftOutlined, ReloadOutlined, ExportOutlined,
  SettingOutlined, PushpinOutlined, EyeInvisibleOutlined, DeleteOutlined,
  ArrowUpOutlined, ArrowDownOutlined, UndoOutlined, GlobalOutlined, AppstoreOutlined
} from '@ant-design/icons'
import { loadMinApps, setMinApps } from '../../store'
import api from '../../api'

function AppLogo({ app, size = 46 }) {
  const [failed, setFailed] = useState(false)
  const origin = useMemo(() => {
    try {
      return new URL(app.url).origin
    } catch {
      return ''
    }
  }, [app.url])
  const letter = (app.name || '?').trim().charAt(0).toUpperCase()

  if (app.logo && !failed) {
    return (
      <div className="minapp-logo" style={{ width: size, height: size }}>
        <img src={app.logo} alt={app.name} onError={() => setFailed(true)} />
      </div>
    )
  }
  if (origin && !failed) {
    return (
      <div className="minapp-logo" style={{ width: size, height: size }}>
        <img src={`${origin}/favicon.ico`} alt={app.name} onError={() => setFailed(true)} />
      </div>
    )
  }
  return (
    <div className="minapp-logo" style={{ width: size, height: size }}>
      <span>{letter}</span>
    </div>
  )
}

function MinAppBrowser({ app, onClose }) {
  const frameRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [blocked, setBlocked] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setLoading(true)
    setBlocked(false)
    const timer = setTimeout(() => {
      // Cross-origin frames cannot be inspected; if load never fires the site
      // almost certainly refuses to be embedded (X-Frame-Options / frame-ancestors).
      setBlocked((b) => b || true)
      setLoading(false)
    }, 7000)
    return () => clearTimeout(timer)
  }, [app.id, tick])

  return (
    <div className="minapp-view">
      <div className="minapp-view-head">
        <Button size="small" type="text" icon={<ArrowLeftOutlined />} onClick={onClose}>返回</Button>
        <AppLogo app={app} size={20} />
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)' }}>{app.name}</span>
        <span style={{ fontSize: 12, color: 'var(--text-3)', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {app.url}
        </span>
        <div style={{ flex: 1 }} />
        {loading && <Spin size="small" />}
        <Tooltip title="刷新">
          <Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => setTick((t) => t + 1)} />
        </Tooltip>
        <Tooltip title="在系统浏览器中打开">
          <Button size="small" type="text" icon={<ExportOutlined />} onClick={() => window.open(app.url, '_blank', 'noopener')} />
        </Tooltip>
        <Button size="small" type="text" onClick={onClose}>关闭</Button>
      </div>

      {blocked ? (
        <div className="minapp-blocked">
          <GlobalOutlined style={{ fontSize: 30, opacity: 0.5 }} />
          <div style={{ fontSize: 14, color: 'var(--text-1)' }}>{app.name} 未能内嵌加载</div>
          <div style={{ maxWidth: 480, lineHeight: 1.8 }}>
            该站点通过 <code>X-Frame-Options</code> / <code>frame-ancestors</code> 禁止被网页内嵌。
            浏览器环境下无法绕过（原版 Cherry Studio 运行在 Electron 中，用 <code>webview</code> 标签加载，因此不受此限制）。
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button type="primary" icon={<ExportOutlined />} onClick={() => window.open(app.url, '_blank', 'noopener')}>
              在浏览器中打开
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => { setBlocked(false); setLoading(true); setTick((t) => t + 1) }}>
              再试一次
            </Button>
          </div>
        </div>
      ) : (
        <iframe
          key={`${app.id}-${tick}`}
          ref={frameRef}
          className="minapp-frame"
          src={app.url}
          title={app.name}
          referrerPolicy="no-referrer"
          allow="clipboard-read; clipboard-write; microphone; camera; fullscreen"
          onLoad={() => {
            setLoading(false)
          }}
        />
      )}
    </div>
  )
}

export default function MinAppsPage() {
  const dispatch = useDispatch()
  const { all } = useSelector((s) => s.minapps)
  const [keyword, setKeyword] = useState('')
  const [active, setActive] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [form] = Form.useForm()

  useEffect(() => {
    if (!all.length) dispatch(loadMinApps())
  }, [all.length, dispatch])

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return all.filter((m) => !m.hidden && (!kw || `${m.name} ${m.url}`.toLowerCase().includes(kw)))
  }, [all, keyword])

  const refresh = () => dispatch(loadMinApps())

  const patch = async (id, data) => {
    await api.minapps.save(id, data)
    refresh()
  }

  const move = async (index, dir) => {
    const list = all.slice()
    const target = index + dir
    if (target < 0 || target >= list.length) return
    ;[list[index], list[target]] = [list[target], list[index]]
    await api.minapps.reorder(list.map((m) => m.id))
    refresh()
  }

  /**
   * 点击卡片 = 在浏览器新标签页打开。
   *
   * 浏览器版无法绕过站点的 X-Frame-Options / frame-ancestors（原版靠 Electron
   * 的 webview 才能内嵌 ChatGPT、Claude 这类站点），内嵌十有八九是一片空白或
   * 「拒绝连接」。所以默认直接开新标签页；内嵌视图降级为卡片悬停时的次要入口，
   * 并在管理里提供「内嵌打开」开关给确实支持内嵌的站点。
   */
  const openApp = (app) => {
    if (app.embed && !app.openExternal) {
      setActive(app)
      return
    }
    const win = window.open(app.url, '_blank', 'noopener,noreferrer')
    if (!win) message.warning('浏览器拦截了新窗口，请允许本站弹出窗口后重试')
  }

  const embedApp = (app) => setActive(app)

  return (
    <div className="page" style={{ position: 'relative', flexDirection: 'column' }}>
      <div style={{ height: 48, flex: '0 0 48px', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', borderBottom: '1px solid var(--panel-border)', background: 'var(--panel-bg)' }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-1)' }}>小程序</span>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>点击卡片在新标签页打开 · 悬停卡片可内嵌预览</span>
        <div style={{ flex: 1 }} />
        <Input
          size="small" allowClear style={{ width: 210 }} value={keyword}
          prefix={<SearchOutlined style={{ color: 'var(--text-3)' }} />}
          placeholder="搜索小程序" onChange={(e) => setKeyword(e.target.value)}
        />
        <Tooltip title="管理（排序 / 隐藏 / 删除）">
          <Button size="small" type="text" icon={<SettingOutlined />} onClick={() => setManageOpen(true)} />
        </Tooltip>
        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setAddOpen(true) }}>
          添加
        </Button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {visible.length === 0 ? (
          <div className="empty-state">
            <div className="big">🧩</div>
            <div className="t">没有匹配的小程序</div>
          </div>
        ) : (
          <div className="minapps-grid">
            {visible.map((app) => (
              <div className="minapp-card" key={app.id} onClick={() => openApp(app)} title={`${app.name} — 在新标签页打开`}>
                {app.pinned && <span className="minapp-pin"><PushpinOutlined /></span>}
                <Tooltip title="在应用内内嵌打开">
                  <span
                    className="minapp-embed"
                    onClick={(e) => {
                      e.stopPropagation()
                      embedApp(app)
                    }}
                  >
                    <AppstoreOutlined />
                  </span>
                </Tooltip>
                <AppLogo app={app} />
                <span className="minapp-name">{app.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {active && <MinAppBrowser app={active} onClose={() => setActive(null)} />}

      {/* ------------------------------------------------------------ 添加 */}
      <Modal
        open={addOpen}
        title="添加小程序"
        okText="添加"
        cancelText="取消"
        onCancel={() => setAddOpen(false)}
        onOk={async () => {
          const values = await form.validateFields()
          try {
            await api.minapps.create(values)
            message.success('已添加')
            setAddOpen(false)
            refresh()
          } catch (err) {
            message.error(err.message)
          }
        }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：我的内部工具" maxLength={40} />
          </Form.Item>
          <Form.Item name="url" label="网址" rules={[{ required: true, message: '请输入网址' }, { type: 'url', message: '网址格式不正确' }]}>
            <Input placeholder="https://example.com" />
          </Form.Item>
          <Form.Item name="logo" label="图标地址（可选）">
            <Input placeholder="https://example.com/logo.png" />
          </Form.Item>
          <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.7 }}>
            提示：点击卡片默认在浏览器新标签页打开（多数 AI 站点禁止被内嵌）。
            如果目标站点允许内嵌，可在「管理」里为它打开「内嵌打开」开关。
          </div>
        </Form>
      </Modal>

      {/* ------------------------------------------------------------ 管理 */}
      <Modal open={manageOpen} title="小程序管理" width={620} footer={null} onCancel={() => setManageOpen(false)}>
        <div style={{ maxHeight: 460, overflowY: 'auto', marginTop: 8 }}>
          {all.map((app, index) => (
            <div key={app.id} className="model-row">
              <AppLogo app={app} size={26} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {app.name}
                  {app.isBuiltin && <Tag style={{ fontSize: 10, lineHeight: '16px', marginInlineEnd: 0 }}>内置</Tag>}
                  {app.hidden && <Tag color="default" style={{ fontSize: 10, lineHeight: '16px', marginInlineEnd: 0 }}>已隐藏</Tag>}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.url}</div>
              </span>
              <Tooltip title="内嵌打开（多数站点会拒绝内嵌，建议保持关闭）">
                <Switch size="small" checked={!!app.embed} onChange={(v) => patch(app.id, { embed: v })} />
              </Tooltip>
              <Tooltip title="上移">
                <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => move(index, -1)} />
              </Tooltip>
              <Tooltip title="下移">
                <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={index === all.length - 1} onClick={() => move(index, 1)} />
              </Tooltip>
              <Tooltip title="置顶">
                <Button size="small" type={app.pinned ? 'primary' : 'text'} ghost={app.pinned} icon={<PushpinOutlined />} onClick={() => patch(app.id, { pinned: !app.pinned })} />
              </Tooltip>
              <Tooltip title={app.hidden ? '显示' : '隐藏'}>
                <Button size="small" type="text" icon={app.hidden ? <UndoOutlined /> : <EyeInvisibleOutlined />} onClick={() => patch(app.id, { hidden: !app.hidden })} />
              </Tooltip>
              <Tooltip title="用系统浏览器打开">
                <Switch size="small" checked={!!app.openExternal} onChange={(v) => patch(app.id, { openExternal: v })} />
              </Tooltip>
              <Popconfirm
                title={app.isBuiltin ? '隐藏该内置小程序？' : '删除该自定义小程序？'}
                okText="确定"
                cancelText="取消"
                onConfirm={async () => {
                  await api.minapps.remove(app.id)
                  refresh()
                }}
              >
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}
