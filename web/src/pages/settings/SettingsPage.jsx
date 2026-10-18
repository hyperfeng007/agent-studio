import McpPage from '../mcp/McpPage'
import { useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Badge, Button, Checkbox, Divider, Empty, Form, Input, InputNumber, Modal,
  Popconfirm, Segmented, Select, Space, Spin, Switch, Tabs, Tag, Tooltip, message, Upload
} from 'antd'
import {
  PlusOutlined, SearchOutlined, DeleteOutlined, CheckCircleOutlined,
  CloseCircleOutlined, ReloadOutlined, ApiOutlined, KeyOutlined, SettingOutlined,
  BgColorsOutlined, CloudDownloadOutlined, CloudUploadOutlined, InfoCircleOutlined,
  GlobalOutlined, ExportOutlined, EditOutlined, SafetyOutlined, DatabaseOutlined
} from '@ant-design/icons'
import { loadProviders, loadProviderMeta, saveProvider, checkProvider, loadSettings, saveSettings, setDark } from '../../store'
import api from '../../api'

const CAP_LABEL = {
  text: '文本', vision: '视觉', reasoning: '推理', embedding: '嵌入', rerank: '重排序',
  'image-generation': '绘图', tts: 'TTS', stt: 'STT', 'web-search': '联网', 'function_calling': '工具', free: '免费'
}

function initials(name = '') {
  return name.replace(/[^\w\u4e00-\u9fa5]/g, '').slice(0, 2).toUpperCase() || '?'
}

/* ------------------------------------------------------------------ 模型服务 */

function ModelManager({ provider, onClose, onChanged }) {
  const capabilities = useSelector((s) => s.providers.capabilities)
  const [fetched, setFetched] = useState([])
  const [selected, setSelected] = useState([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [newModelId, setNewModelId] = useState('')
  const models = provider?.models || []

  const doFetch = async () => {
    setLoading(true)
    try {
      const res = await api.providers.fetchModels(provider.id)
      setFetched(res.models || [])
      setSelected([])
      message.success(`获取到 ${res.count} 个模型`)
    } catch (err) {
      message.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const existing = new Set(models.map((m) => m.id))
  const candidates = fetched.filter((m) => !existing.has(m.id) && (!keyword || m.id.toLowerCase().includes(keyword.toLowerCase())))

  const addSelected = async () => {
    if (!selected.length) return message.warning('请先勾选模型')
    const merged = [...models, ...selected.map((id) => {
      const src = fetched.find((m) => m.id === id) || {}
      return { id, name: src.name || id, capabilities: src.capabilities || ['text'], contextLength: src.contextLength, maxTokens: src.maxTokens, status: 1 }
    })]
    await api.providers.saveModels(provider.id, merged)
    message.success(`已添加 ${selected.length} 个模型`)
    setSelected([])
    setFetched((f) => f.filter((m) => !selected.includes(m.id)))
    onChanged?.()
  }

  const addCustom = async () => {
    const id = newModelId.trim()
    if (!id) return message.warning('请输入模型 ID')
    try {
      await api.providers.addModel(provider.id, { id, capabilities: ['text'] })
      setNewModelId('')
      message.success('已添加')
      onChanged?.()
    } catch (err) {
      message.error(err.message)
    }
  }

  const toggleStatus = async (model, status) => {
    await api.providers.updateModel(provider.id, model.id, { status })
    onChanged?.()
  }

  const toggleCapability = async (model, cap) => {
    const caps = new Set(model.capabilities || ['text'])
    if (caps.has(cap)) caps.delete(cap)
    else caps.add(cap)
    await api.providers.updateModel(provider.id, model.id, { capabilities: [...caps] })
    onChanged?.()
  }

  const removeModel = async (model) => {
    await api.providers.removeModel(provider.id, model.id)
    onChanged?.()
  }

  return (
    <Modal open title={`模型管理 · ${provider?.name}`} width={760} footer={null} onCancel={onClose}>
      <Tabs
        items={[
          {
            key: 'added',
            label: `已添加 (${models.length})`,
            children: (
              <div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <Input size="small" placeholder="手动添加模型 ID，如 gpt-4o-mini" value={newModelId} onChange={(e) => setNewModelId(e.target.value)} onPressEnter={addCustom} />
                  <Button size="small" type="primary" icon={<PlusOutlined />} onClick={addCustom}>添加</Button>
                </div>
                <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                  {models.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有添加模型" />}
                  {models.map((m) => (
                    <div className="model-row" key={m.id}>
                      <Switch size="small" checked={m.status !== 3} onChange={(v) => toggleStatus(m, v ? 1 : 3)} />
                      <span className="model-id" title={m.id}>{m.id}</span>
                      <Select
                        size="small" mode="multiple" variant="borderless" style={{ maxWidth: 250 }}
                        value={(m.capabilities || ['text']).filter((c) => c !== 'text')}
                        placeholder="能力"
                        onChange={async (vals) => {
                          await api.providers.updateModel(provider.id, m.id, { capabilities: ['text', ...vals] })
                          onChanged?.()
                        }}
                        options={capabilities.filter((c) => c.value !== 'text').map((c) => ({ value: c.value, label: c.label }))}
                        maxTagCount={2}
                      />
                      {m.contextLength ? <Tag style={{ fontSize: 10, marginInlineEnd: 0 }}>{Math.round(m.contextLength / 1000)}K</Tag> : null}
                      <Popconfirm title="删除该模型？" okText="删除" cancelText="取消" onConfirm={() => removeModel(m)}>
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </div>
                  ))}
                </div>
              </div>
            )
          },
          {
            key: 'fetch',
            label: '获取模型列表',
            children: (
              <div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                  <Button size="small" type="primary" icon={<CloudDownloadOutlined />} loading={loading} onClick={doFetch}>
                    从服务商获取
                  </Button>
                  <Input size="small" allowClear style={{ width: 200 }} prefix={<SearchOutlined />} placeholder="过滤模型" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                  <div style={{ flex: 1 }} />
                  <Checkbox
                    checked={candidates.length > 0 && selected.length === candidates.length}
                    indeterminate={selected.length > 0 && selected.length < candidates.length}
                    onChange={(e) => setSelected(e.target.checked ? candidates.map((m) => m.id) : [])}
                  >
                    全选
                  </Checkbox>
                  <Button size="small" onClick={addSelected} disabled={!selected.length}>添加所选 ({selected.length})</Button>
                </div>
                <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                  {fetched.length === 0 && (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? '获取中…' : '点击「从服务商获取」拉取模型清单'} />
                  )}
                  {candidates.map((m) => (
                    <div className="model-row" key={m.id} onClick={() => setSelected((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id]))} style={{ cursor: 'pointer' }}>
                      <Checkbox checked={selected.includes(m.id)} />
                      <span className="model-id">{m.id}</span>
                      {m.owned_by && <Tag style={{ fontSize: 10, marginInlineEnd: 0 }}>{m.owned_by}</Tag>}
                      {m.contextLength ? <Tag style={{ fontSize: 10, marginInlineEnd: 0 }}>{Math.round(m.contextLength / 1000)}K</Tag> : null}
                    </div>
                  ))}
                  {fetched.length > 0 && candidates.length === 0 && (
                    <div style={{ padding: 12, color: 'var(--text-3)', fontSize: 12.5 }}>没有匹配的模型（已添加的不会重复出现）</div>
                  )}
                </div>
              </div>
            )
          }
        ]}
      />
    </Modal>
  )
}

function ProviderDetail({ provider, onChanged }) {
  const dispatch = useDispatch()
  const settings = useSelector((s) => s.settings.data)
  const allProviders = useSelector((s) => s.providers.list)
  const types = useSelector((s) => s.providers.types)
  const checkResult = useSelector((s) => s.providers.checkResults[provider.id])
  const [checking, setChecking] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  const [form] = Form.useForm()

  useEffect(() => {
    form.setFieldsValue({
      name: provider.name,
      type: provider.type,
      // A key reused from the local OpenCode CLI is never sent to the browser —
      // the field stays empty and the status banner below explains where it came from.
      apiKey: provider.keySource === 'opencode-cli' ? '' : provider.apiKey || '',
      apiHost: provider.apiHost || '',
      apiVersion: provider.apiVersion || '',
      customHeaders: provider.customHeaders ? JSON.stringify(provider.customHeaders, null, 2) : ''
    })
  }, [provider.id, provider.apiKey, provider.apiHost, provider.name, provider.type, provider.keySource, form])

  const save = async (patch) => {
    try {
      await dispatch(saveProvider({ id: provider.id, patch })).unwrap()
      onChanged?.()
      return true
    } catch (err) {
      message.error(err.message)
      return false
    }
  }

  const onSaveForm = async () => {
    const v = await form.validateFields()
    let customHeaders = null
    if (v.customHeaders?.trim()) {
      try {
        customHeaders = JSON.parse(v.customHeaders)
      } catch {
        return message.error('自定义请求头不是合法 JSON')
      }
    }
    const ok = await save({ name: v.name, type: v.type, apiKey: v.apiKey, apiHost: v.apiHost, apiVersion: v.apiVersion, customHeaders })
    if (ok) message.success('已保存')
  }

  const doCheck = async () => {
    await onSaveFormSilent()
    setChecking(true)
    try {
      const r = await dispatch(checkProvider({ id: provider.id, modelId: provider.models[0]?.id })).unwrap()
      if (r.valid) message.success(`连接成功 · ${r.modelCount ?? 0} 个模型 · ${r.latencyMs}ms`)
      else message.error(r.error || '连接失败')
    } catch (err) {
      message.error(err.message)
    } finally {
      setChecking(false)
    }
  }

  // Check should test what is on screen, so persist before probing.
  const onSaveFormSilent = async () => {
    const v = form.getFieldsValue()
    await dispatch(saveProvider({ id: provider.id, patch: { apiKey: v.apiKey, apiHost: v.apiHost, name: v.name, type: v.type, apiVersion: v.apiVersion } }))
  }

  // 默认 = the provider new chats land on: the explicit default model, else the
  // first enabled provider (the registry ships opencode-free first).
  const firstEnabled = allProviders.find((p) => p.enabled)?.id
  const isDefault = settings.defaultModel ? settings.defaultModel.providerId === provider.id : firstEnabled === provider.id

  return (
    <div className="provider-detail">
      <div className="settings-inner">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div className="provider-logo" style={{ width: 32, height: 32, flexBasis: 32, fontSize: 13 }}>{initials(provider.name)}</div>
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-1)' }}>{provider.name}</h3>
          {provider.isSystem ? <Tag>内置</Tag> : <Tag color="blue">自定义</Tag>}
          {provider.keyOptional && <Tag color="green">免 API Key</Tag>}
          <Tag>{types.find((t) => t.value === provider.type)?.label || provider.type}</Tag>
          {isDefault && <Tag color="red">默认</Tag>}
          <div style={{ flex: 1 }} />
          <Switch
            checked={provider.enabled}
            checkedChildren="已启用"
            unCheckedChildren="已停用"
            onChange={(v) => save({ enabled: v })}
          />
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {provider.website && <a href={provider.website} target="_blank" rel="noreferrer"><ExportOutlined /> 官网</a>}
          {provider.docs && <a href={provider.docs} target="_blank" rel="noreferrer"><ExportOutlined /> API 文档</a>}
          {provider.apiKeyUrl && <a href={provider.apiKeyUrl} target="_blank" rel="noreferrer"><KeyOutlined /> 获取 API 密钥</a>}
        </div>

        {provider.note && <Alert type="info" showIcon message={provider.note} style={{ marginBottom: 14 }} />}

        {provider.keyChain === 'opencode-cli' && (
          <Alert
            style={{ marginBottom: 14 }}
            showIcon
            type={provider.keySource === 'opencode-cli' ? 'success' : provider.keySource === 'user' ? 'info' : 'warning'}
            message={
              provider.keySource === 'opencode-cli'
                ? '已自动复用本机 OpenCode CLI 的登录凭据，无需填写 API Key'
                : provider.keySource === 'user'
                  ? '使用你在下方填写的 API Key'
                  : '没有找到本机 OpenCode 凭据，将以「无 Key」方式请求'
            }
            description={
              provider.keySource === 'opencode-cli' ? (
                <span style={{ fontSize: 12 }}>
                  来源：<code style={{ fontSize: 11.5 }}>{provider.keyFile}</code>（密钥不会显示在这里）。要更换就运行{' '}
                  <code style={{ fontSize: 11.5 }}>opencode auth login</code>，或在下方填 Key 覆盖它。
                </span>
              ) : provider.keySource === 'user' ? (
                <span style={{ fontSize: 12 }}>留空则回退到本机 OpenCode 凭据；再没有就不带 Key 请求。</span>
              ) : (
                <span style={{ fontSize: 12 }}>
                  免费层对第三方客户端返回 403「OpenCode's free tier can only be used from within OpenCode」。两种解决办法：到{' '}
                  <a href={provider.apiKeyUrl} target="_blank" rel="noreferrer">
                    opencode.ai/auth
                  </a>{' '}
                  免费注册一个 Zen API Key 填到下方；或本机运行 <code style={{ fontSize: 11.5 }}>opencode auth login</code> 登录一次，Agent Studio
                  会自动读取凭据。「检查」按钮会真实发一次对话来验证。
                </span>
              )
            }
          />
        )}

        <div className="section-card">
          <Form form={form} layout="vertical">
            <Form.Item name="name" label="服务商名称">
              <Input disabled={provider.isSystem} style={{ maxWidth: 320 }} />
            </Form.Item>

            {provider.isCustom && (
              <Form.Item name="type" label="渠道类型（决定请求协议）">
                <Select style={{ maxWidth: 320 }} options={types} />
              </Form.Item>
            )}

            <Form.Item
              name="apiKey"
              label={
                <Space size={6}>
                  API 密钥
                  <Tooltip title="支持多密钥轮询：填入多个密钥后按请求轮换，可摊薄速率限制">
                    <Button size="small" type="link" icon={<SafetyOutlined />} onClick={() => setKeysOpen(true)} style={{ padding: 0 }}>
                      多密钥轮询{provider.apiKeys?.length ? ` (${provider.apiKeys.length})` : ''}
                    </Button>
                  </Tooltip>
                </Space>
              }
            >
              <Input.Password style={{ maxWidth: 460 }} placeholder={provider.keyOptional ? '可留空（免 Key 通道）' : provider.id === 'mock' ? '本地演示通道无需密钥' : provider.id === 'ollama' || provider.id === 'lmstudio' ? '本地服务通常留空' : 'sk-…'} autoComplete="off" />
            </Form.Item>

            <Form.Item name="apiHost" label="API 地址">
              <Input style={{ maxWidth: 460, fontFamily: 'monospace', fontSize: 12.5 }} placeholder="https://api.example.com" />
            </Form.Item>

            {provider.type === 'azure' && (
              <Form.Item name="apiVersion" label="API 版本">
                <Input style={{ maxWidth: 320 }} placeholder="2025-04-01-preview" />
              </Form.Item>
            )}

            <Form.Item name="customHeaders" label="自定义请求头（JSON，可选）">
              <Input.TextArea rows={3} style={{ maxWidth: 460, fontFamily: 'monospace', fontSize: 12 }} placeholder='{"X-Custom": "value"}' />
            </Form.Item>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button type="primary" onClick={onSaveForm}>保存</Button>
              <Button icon={<CheckCircleOutlined />} loading={checking} onClick={doCheck}>检查</Button>
              <Button icon={<SettingOutlined />} onClick={() => setManagerOpen(true)}>
                管理模型 ({provider.models.length})
              </Button>
              {provider.models.length > 0 && (
                <Button icon={<SafetyOutlined />} onClick={async () => { await dispatch(saveProvider({ id: provider.id, patch: {} })); const s = await api.settings.save({ defaultModel: { providerId: provider.id, modelId: provider.models[0].id } }); dispatch(loadSettings()); message.success(`已将 ${provider.models[0].id} 设为默认模型`) }}>
                  设为默认模型
                </Button>
              )}
              {provider.isCustom ? (
                <Popconfirm title="删除该自定义服务商？" okText="删除" okButtonProps={{ danger: true }} cancelText="取消" onConfirm={async () => { await api.providers.remove(provider.id); dispatch(loadProviders()); onChanged?.() }}>
                  <Button danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>
              ) : (
                <Popconfirm title="重置为内置默认配置？（会清除密钥与自定义模型）" okText="重置" cancelText="取消" onConfirm={async () => { await api.providers.remove(provider.id); dispatch(loadProviders()); onChanged?.() }}>
                  <Button icon={<ReloadOutlined />}>重置</Button>
                </Popconfirm>
              )}
            </div>

            {checkResult && (
              <div style={{ marginTop: 12 }}>
                {checkResult.valid ? (
                  <Alert type="success" showIcon message={`连接成功 · 检测到 ${checkResult.modelCount ?? 0} 个模型 · 耗时 ${checkResult.latencyMs}ms`} />
                ) : (
                  <Alert type="error" showIcon message="连接失败" description={checkResult.error} />
                )}
              </div>
            )}
          </Form>
        </div>

        <div className="section-card">
          <div className="section-title">已启用模型 <span style={{ fontSize: 11.5, color: 'var(--text-3)', fontWeight: 400 }}>（关闭开关即从对话的模型选择器中隐藏）</span></div>
          {provider.models.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未添加模型">
              <Button type="primary" size="small" onClick={() => setManagerOpen(true)}>管理模型</Button>
            </Empty>
          ) : (
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {provider.models.map((m) => (
                <div className="model-row" key={m.id}>
                  <Switch size="small" checked={m.status !== 3} onChange={async (v) => { await api.providers.updateModel(provider.id, m.id, { status: v ? 1 : 3 }); dispatch(loadProviders()) }} />
                  <span className="model-id">{m.id}</span>
                  {(m.capabilities || []).filter((c) => c !== 'text').map((c) => (
                    <Tag key={c} style={{ fontSize: 10, marginInlineEnd: 0 }}>{CAP_LABEL[c] || c}</Tag>
                  ))}
                  {m.contextLength ? <Tag style={{ fontSize: 10, marginInlineEnd: 0 }}>{Math.round(m.contextLength / 1000)}K 上下文</Tag> : null}
                </div>
              ))}
            </div>
          )}
        </div>

        {managerOpen && <ModelManager provider={provider} onClose={() => setManagerOpen(false)} onChanged={() => dispatch(loadProviders())} />}

        <Modal
          open={keysOpen}
          title={`多密钥轮询 · ${provider.name}`}
          okText="保存"
          cancelText="取消"
          onCancel={() => setKeysOpen(false)}
          onOk={async () => {
            const raw = form.getFieldValue('multiKeys') || ''
            const keys = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
            await save({ apiKeys: keys, apiKey: keys[0] || provider.apiKey })
            setKeysOpen(false)
            message.success(keys.length ? `已保存 ${keys.length} 个密钥，将按请求轮换` : '已清空密钥列表')
          }}
        >
          <Form form={form} layout="vertical">
            <Form.Item name="multiKeys" label="每行一个 API 密钥" initialValue={(provider.apiKeys || []).join('\n')}>
              <Input.TextArea rows={7} placeholder={'sk-aaa\nsk-bbb\nsk-ccc'} style={{ fontFamily: 'monospace', fontSize: 12 }} />
            </Form.Item>
            <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.8 }}>
              轮询在服务端按请求顺序进行（内存游标），可用来摊薄单密钥的速率限制。留空则只使用上方的单个密钥。
            </div>
          </Form>
        </Modal>
      </div>
    </div>
  )
}

function AddProviderModal({ open, onClose, onCreated }) {
  const types = useSelector((s) => s.providers.types)
  const providers = useSelector((s) => s.providers.list)
  const [form] = Form.useForm()

  return (
    <Modal
      open={open}
      title="添加服务商"
      okText="添加"
      cancelText="取消"
      onCancel={onClose}
      onOk={async () => {
        const v = await form.validateFields()
        try {
          const created = await api.providers.create({
            id: `custom-${Date.now().toString(36)}`,
            name: v.name.trim(),
            type: v.type,
            apiHost: v.apiHost.trim(),
            apiKey: v.apiKey?.trim() || ''
          })
          message.success('已添加')
          form.resetFields()
          onCreated?.(created)
        } catch (err) {
          message.error(err.message)
        }
      }}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }} initialValues={{ type: 'openai' }}>
        <Form.Item name="name" label="服务商名称" rules={[{ required: true, message: '请输入名称' }]}>
          <Input placeholder="如：我的中转站" />
        </Form.Item>
        <Form.Item name="type" label="渠道类型">
          <Select options={types} />
        </Form.Item>
        <Form.Item name="apiHost" label="API 地址" rules={[{ required: true, message: '请输入 API 地址' }]}>
          <Input placeholder="https://api.example.com" style={{ fontFamily: 'monospace', fontSize: 12.5 }} />
        </Form.Item>
        <Form.Item name="apiKey" label="API 密钥">
          <Input.Password placeholder="可稍后填写" autoComplete="off" />
        </Form.Item>
        <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.8 }}>
          已有 {providers.length} 个服务商。选择「OpenAI」类型可接入绝大多数兼容 OpenAI 协议的中转站；添加后在「管理模型」里获取或手动填写模型。
        </div>
      </Form>
    </Modal>
  )
}

function ModelService() {
  const dispatch = useDispatch()
  const providers = useSelector((s) => s.providers.list)
  const loading = useSelector((s) => s.providers.loading)
  const [keyword, setKeyword] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [onlyEnabled, setOnlyEnabled] = useState(false)

  useEffect(() => {
    if (!providers.length) dispatch(loadProviders())
  }, [providers.length, dispatch])

  useEffect(() => {
    if (!activeId && providers.length) setActiveId(providers[0].id)
  }, [providers, activeId])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return providers.filter((p) => (!onlyEnabled || p.enabled) && (!kw || `${p.name} ${p.id}`.toLowerCase().includes(kw)))
  }, [providers, keyword, onlyEnabled])

  const active = providers.find((p) => p.id === activeId)

  return (
    <div style={{ display: 'flex', height: '100%', margin: '-20px -26px' }}>
      <div className="provider-list">
        <div style={{ padding: 10, borderBottom: '1px solid var(--panel-border)' }}>
          <Input
            size="small" allowClear prefix={<SearchOutlined style={{ color: 'var(--text-3)' }} />}
            placeholder="搜索服务商" value={keyword} onChange={(e) => setKeyword(e.target.value)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <Checkbox checked={onlyEnabled} onChange={(e) => setOnlyEnabled(e.target.checked)}>
              <span style={{ fontSize: 12 }}>只看已启用</span>
            </Checkbox>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{filtered.length}/{providers.length}</span>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
          {loading && !providers.length && <Spin />}
          {filtered.map((p) => (
            <div key={p.id} className={`provider-row ${p.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(p.id)}>
              <div className="provider-logo">{initials(p.name)}</div>
              <span className="provider-name">{p.name}</span>
              {p.models.filter((m) => m.status !== 3).length > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{p.models.filter((m) => m.status !== 3).length}</span>
              )}
              <Switch size="small" checked={p.enabled} onClick={(_, e) => e.stopPropagation()} onChange={(v) => dispatch(saveProvider({ id: p.id, patch: { enabled: v } }))} />
            </div>
          ))}
          {filtered.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的服务商" style={{ marginTop: 30 }} />}
        </div>
        <div style={{ padding: 8, borderTop: '1px solid var(--panel-border)' }}>
          <Button block type="primary" ghost icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>添加服务商</Button>
        </div>
      </div>

      {active ? (
        <ProviderDetail key={active.id} provider={active} onChanged={() => dispatch(loadProviders())} />
      ) : (
        <div className="provider-detail"><Empty description="选择左侧的服务商" style={{ marginTop: 80 }} /></div>
      )}

      <AddProviderModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(p) => {
          setAddOpen(false)
          dispatch(loadProviders()).then(() => setActiveId(p.id))
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ 其他设置 */

function GeneralSettings() {
  const dispatch = useDispatch()
  const s = useSelector((st) => st.settings.data)
  const set = (patch) => dispatch(saveSettings(patch))

  return (
    <div className="settings-inner">
      <div className="section-card">
        <div className="section-title"><GlobalOutlined /> 通用</div>
        <div className="field-row">
          <span className="field-label">语言</span>
          <div className="field-control">
            <Select size="small" style={{ width: 200 }} value={s.language || 'zh-CN'} onChange={(v) => set({ language: v })}
              options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en-US', label: 'English' }]} />
          </div>
        </div>
        <div className="field-row">
          <span className="field-label">发送快捷键</span>
          <div className="field-control">
            <Select size="small" style={{ width: 260 }} value={s.sendMessageShortcut || 'Enter'} onChange={(v) => set({ sendMessageShortcut: v })}
              options={[
                { value: 'Enter', label: 'Enter 发送 / Shift+Enter 换行' },
                { value: 'Ctrl+Enter', label: 'Ctrl+Enter 发送 / Enter 换行' },
                { value: 'Shift+Enter', label: 'Shift+Enter 发送 / Enter 换行' }
              ]} />
          </div>
        </div>
        <div className="field-row">
          <span className="field-label">话题自动命名</span>
          <div className="field-control">
            <Switch size="small" checked={s.autoRenameTopic !== false} onChange={(v) => set({ autoRenameTopic: v })} />
            <div className="field-hint">首轮对话结束后用当前模型生成不超过 20 字的标题。</div>
          </div>
        </div>
        <div className="field-row">
          <span className="field-label">长文本粘贴为附件</span>
          <div className="field-control">
            <Space>
              <Switch size="small" checked={!!s.pasteLongTextAsFile} onChange={(v) => set({ pasteLongTextAsFile: v })} />
              <InputNumber size="small" min={200} step={100} value={s.pasteLongTextThreshold ?? 1500}
                onChange={(v) => set({ pasteLongTextThreshold: v || 1500 })} suffix="字符" />
            </Space>
          </div>
        </div>
      </div>

      <div className="section-card">
        <div className="section-title"><BgColorsOutlined /> 显示</div>
        <div className="field-row">
          <span className="field-label">主题</span>
          <div className="field-control">
            <Segmented size="small" value={s.theme || 'auto'} onChange={(v) => { set({ theme: v }); const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches; dispatch(setDark(v === 'dark' || (v === 'auto' && prefersDark))) }}
              options={[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }, { value: 'auto', label: '跟随系统' }]} />
          </div>
        </div>
        <div className="field-row">
          <span className="field-label">字体大小</span>
          <div className="field-control">
            <Space>
              <InputNumber size="small" min={12} max={20} value={s.fontSize || 14} onChange={(v) => set({ fontSize: v || 14 })} />
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>px</span>
            </Space>
          </div>
        </div>
        <div className="field-row">
          <span className="field-label">消息样式</span>
          <div className="field-control">
            <Segmented size="small" value={s.messageStyle || 'bubble'} onChange={(v) => set({ messageStyle: v })}
              options={[{ value: 'bubble', label: '气泡' }, { value: 'plain', label: '朴素' }]} />
          </div>
        </div>
        <div className="field-row">
          <span className="field-label">显示智能助手栏</span>
          <div className="field-control"><Switch size="small" checked={s.showAssistants !== false} onChange={(v) => set({ showAssistants: v })} /></div>
        </div>
        
      </div>

      <div className="section-card">
        <div className="section-title"><ApiOutlined /> 默认对话参数</div>
        <div className="field-row">
          <span className="field-label">上下文数量</span>
          <div className="field-control">
            <InputNumber size="small" min={0} max={100} value={s.contextCount ?? 12} onChange={(v) => set({ contextCount: v ?? 12 })} />
            <div className="field-hint">0 表示携带全部历史。新建智能助手时作为默认值。</div>
          </div>
        </div>
        <div className="field-row">
          <span className="field-label">温度</span>
          <div className="field-control"><InputNumber size="small" min={0} max={2} step={0.1} value={s.temperature ?? 0.7} onChange={(v) => set({ temperature: v ?? 0.7 })} /></div>
        </div>
      </div>
    </div>
  )
}

function ProxySettings() {
  const dispatch = useDispatch()
  const s = useSelector((st) => st.settings.data)
  const providers = useSelector((st) => st.providers.list) || []
  const set = (patch) => dispatch(saveSettings(patch))
  const net = s.network || {}
  const DEFAULT_BYPASS = 'localhost,127.0.0.1,::1'
  const [url, setUrl] = useState(s.proxyUrl || '')
  const [bypass, setBypass] = useState(s.proxyBypass || DEFAULT_BYPASS)
  const [target, setTarget] = useState('')
  const [diag, setDiag] = useState(null)
  const [busy, setBusy] = useState('')

  useEffect(() => {
    setUrl(s.proxyUrl || '')
    setBypass(s.proxyBypass || DEFAULT_BYPASS)
  }, [s.proxyUrl, s.proxyBypass])

  // 诊断目标默认选当前默认模型所在的服务商，其次第一个启用的服务商。
  useEffect(() => {
    if (target || !providers.length) return
    const dflt = s.defaultModel?.providerId
    setTarget(dflt && providers.some((p) => p.id === dflt) ? dflt : providers.find((p) => p.enabled)?.id || providers[0].id)
  }, [providers, s.defaultModel, target])

  const mode = s.proxyMode || 'system'
  const usingProxy = !!net.url

  const runDiagnose = async () => {
    if (!target) return message.warning('请先选择要诊断的服务商')
    setBusy('diagnose')
    setDiag(null)
    try {
      const r = await api.network.diagnose({ providerId: target })
      setDiag(r)
    } catch (err) {
      message.error(`诊断失败：${err.message}`)
    } finally {
      setBusy('')
    }
  }

  const reapply = async () => {
    setBusy('reapply')
    try {
      const r = await api.network.reapply()
      await dispatch(loadSettings())
      message.success(r?.network?.url ? `已重新读取系统代理：${r.network.url}` : '已重新探测：系统里没有代理，使用直连')
    } catch (err) {
      message.error(`重新探测失败：${err.message}`)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="settings-inner">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        message="所有模型调用都由 Node 服务端发起，而 Node 的出站请求默认既不跟随系统代理、也不读 HTTP_PROXY 环境变量"
        description="这就是「无论在智能助手还是主流智能体里，所有模型都报 fetch failed」最常见的原因。在这里把代理模式设为「系统代理」（默认）或填入自定义地址，保存后立即生效、不需要重启服务。"
      />

      <div className="section-card">
        <div className="section-title"><GlobalOutlined /> 网络代理</div>

        <div className="field-row">
          <span className="field-label">代理模式</span>
          <div className="field-control">
            <Segmented
              size="small"
              value={mode}
              onChange={(v) => set({ proxyMode: v })}
              options={[
                { value: 'system', label: '系统代理' },
                { value: 'custom', label: '自定义代理' },
                { value: 'off', label: '不使用代理' }
              ]}
            />
            <div className="field-hint">
              {mode === 'system' && '跟随操作系统的网络 / 代理设置（Windows 读注册表 Internet Settings，macOS 读 scutil --proxy，其它情况回退到 HTTPS_PROXY 等环境变量）；电脑上开了全局加速器就会自动使用。'}
              {mode === 'custom' && '手动填写代理地址，并可用「代理绕过规则」指定哪些地址不走代理。'}
              {mode === 'off' && '强制直连，即使系统或环境变量里配了代理也不使用。'}
            </div>
          </div>
        </div>

        <div className="field-row">
          <span className="field-label">代理地址</span>
          <div className="field-control">
            <Space>
              <Input
                size="small"
                style={{ width: 300 }}
                placeholder="http://127.0.0.1:7890"
                disabled={mode !== 'custom'}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onPressEnter={() => mode === 'custom' && set({ proxyUrl: url }).then(() => message.success('已保存并生效'))}
              />
              <Button size="small" type="primary" disabled={mode !== 'custom'} onClick={async () => { await set({ proxyUrl: url }); message.success('已保存并生效') }}>保存</Button>
            </Space>
            <div className="field-hint">
              支持 http:// https:// socks5://；只写 127.0.0.1:7890 会自动补成 http://。常见本地端口：Clash 7890、v2rayN 10809、Sing-box 2080。
            </div>
          </div>
        </div>

        <div className="field-row">
          <span className="field-label">代理绕过规则</span>
          <div className="field-control">
            <Space>
              <Input
                size="small"
                style={{ width: 300 }}
                placeholder={DEFAULT_BYPASS}
                value={bypass}
                onChange={(e) => setBypass(e.target.value)}
              />
              <Button size="small" onClick={async () => { await set({ proxyBypass: bypass }); message.success('已保存并生效') }}>保存</Button>
              <Button size="small" type="text" onClick={() => { setBypass(DEFAULT_BYPASS); set({ proxyBypass: DEFAULT_BYPASS }) }}>恢复默认</Button>
            </Space>
            <div className="field-hint">
              逗号分隔，默认 {DEFAULT_BYPASS}。支持子域后缀（*.example.com 或 .example.com）与 host:port；填 * 表示全部直连。注意：CIDR 网段（如 192.168.0.0/16）不会按网段匹配，需要写成具体主机名或子域。
            </div>
          </div>
        </div>

        <div className="field-row">
          <span className="field-label">强制 IPv4</span>
          <div className="field-control">
            <Switch size="small" checked={!!s.forceIPv4} onChange={(v) => set({ forceIPv4: v })} />
            <div className="field-hint">
              IPv6 路由不通时，Node 同样只会报 fetch failed（真实原因是 ENETUNREACH / EHOSTUNREACH）。开启后 DNS 优先返回 IPv4 且连接只走 IPv4。
            </div>
          </div>
        </div>

        <div className="field-row">
          <span className="field-label">当前生效</span>
          <div className="field-control">
            <Space size={6} wrap>
              <Tag color={usingProxy ? 'blue' : 'default'}>{usingProxy ? '经代理' : '直连'}</Tag>
              {net.url ? <code style={{ fontSize: 12 }}>{net.url}</code> : null}
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>来源：{net.source || '尚未应用'}</span>
              {net.forceIPv4 ? <Tag color="orange">IPv4 优先</Tag> : null}
              <Button size="small" icon={<ReloadOutlined />} loading={busy === 'reapply'} onClick={reapply}>重新探测系统代理</Button>
            </Space>
            {net.detail ? <div className="field-hint">{net.detail}</div> : null}
            {net.error ? <Alert type="error" showIcon style={{ marginTop: 8 }} message={`代理设置未能生效：${net.error}`} /> : null}
            {net.appliedAt ? <div className="field-hint">应用于 {new Date(net.appliedAt).toLocaleString()}</div> : null}
          </div>
        </div>
      </div>

      <div className="section-card">
        <div className="section-title"><SafetyOutlined /> 网络诊断</div>
        <div className="field-row">
          <span className="field-label">诊断目标</span>
          <div className="field-control">
            <Space>
              <Select
                size="small"
                style={{ width: 260 }}
                showSearch
                optionFilterProp="label"
                value={target || undefined}
                onChange={setTarget}
                placeholder="选择服务商"
                options={providers.map((p) => ({ value: p.id, label: `${p.name}${p.enabled ? '' : '（未启用）'}` }))}
              />
              <Button size="small" type="primary" loading={busy === 'diagnose'} onClick={runDiagnose}>开始诊断</Button>
            </Space>
            <div className="field-hint">
              按 DNS → TCP → TLS → HTTP 四步逐个探测。前三步是「直连」结果（用来看这台机器本身能不能到达对方），最后一步走当前代理设置、也就是真实链路。两组对比就能区分「需要代理」和「代理本身坏了」。
            </div>
          </div>
        </div>

        {diag ? (
          <div style={{ marginTop: 10 }}>
            <Alert
              type={diag.ok ? 'success' : 'error'}
              showIcon
              message={diag.verdict || (diag.ok ? '链路正常' : '链路异常')}
              description={diag.target?.apiHost ? `目标 ${diag.target.apiHost}（${diag.target.host}:${diag.target.port}）` : ''}
            />
            <div style={{ marginTop: 10, border: '1px solid var(--panel-border)', borderRadius: 8, overflow: 'hidden' }}>
              {(diag.steps || []).map((st, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex', gap: 10, padding: '7px 10px', fontSize: 12.5,
                    borderBottom: i === diag.steps.length - 1 ? 'none' : '1px solid var(--panel-border)',
                    background: st.ok ? 'transparent' : 'rgba(255,77,79,.06)'
                  }}
                >
                  <span style={{ width: 18, textAlign: 'center', color: st.ok ? '#52c41a' : '#ff4d4f' }}>
                    {st.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                  </span>
                  <span style={{ width: 150, flex: '0 0 150px', color: 'var(--text-2)' }}>{st.name}</span>
                  <span style={{ width: 56, flex: '0 0 56px', color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
                    {st.ms == null ? '' : `${st.ms} ms`}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word', color: 'var(--text-1)' }}>
                    {st.detail}
                    {st.message && st.message !== st.detail ? (
                      <div style={{ marginTop: 4, color: 'var(--text-3)', whiteSpace: 'pre-wrap' }}>{st.message}</div>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
            {(diag.hints || []).length ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>下一步</div>
                {diag.hints.map((h, i) => (
                  <div key={i} style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 4 }}>· {h}</div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function BackupSettings() {
  const [stats, setStats] = useState(null)
  const load = () => api.settings.stats().then(setStats).catch(() => {})
  useEffect(() => { load() }, [])

  const doImport = async (file) => {
    const text = await file.text()
    try {
      const json = JSON.parse(text)
      await fetch('/api/settings/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) })
      message.success('导入成功，即将刷新页面')
      setTimeout(() => window.location.reload(), 900)
    } catch (err) {
      message.error(`导入失败：${err.message}`)
    }
    return false
  }

  return (
    <div className="settings-inner">
      <div className="section-card">
        <div className="section-title"><DatabaseOutlined /> 数据统计</div>
        {stats ? (
          <div className="stat-row">
            {[['智能助手', stats.assistants], ['话题', stats.topics], ['消息', stats.messages], ['小程序', stats.minapps], ['服务商配置', stats.providers], ['主流智能体配置', stats.codecli]].map(([k, v]) => (
              <div className="stat-card" key={k}><div className="v">{v}</div><div className="k">{k}</div></div>
            ))}
          </div>
        ) : <Spin />}
        <div className="field-hint" style={{ marginTop: 10 }}>
          所有数据保存在服务端 data/db.json，文件与图片在 data/files/，托管的 CLI 在 data/codecli/。
        </div>
      </div>

      <div className="section-card">
        <div className="section-title"><CloudDownloadOutlined /> 备份与恢复</div>
        <Space wrap>
          <Button icon={<CloudDownloadOutlined />} href="/api/settings/export" target="_blank">导出数据 (JSON)</Button>
          <Upload beforeUpload={doImport} showUploadList={false} accept="application/json">
            <Button icon={<CloudUploadOutlined />}>导入数据</Button>
          </Upload>
          <Popconfirm
            title="清空所有对话数据？"
            description="智能助手、话题与消息都会被删除，服务商配置保留。"
            okText="清空" okButtonProps={{ danger: true }} cancelText="取消"
            onConfirm={async () => { await api.settings.reset(); message.success('已清空，刷新页面生效'); setTimeout(() => window.location.reload(), 800) }}
          >
            <Button danger icon={<DeleteOutlined />}>清空对话数据</Button>
          </Popconfirm>
        </Space>
      </div>
    </div>
  )
}

function AboutSettings() {
  return (
    <div className="settings-inner">
      <div className="section-card">
        <div className="section-title"><InfoCircleOutlined /> 关于</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 2 }}>
          <div>🤖 <b>Agent Studio</b> · Cherry Studio 的 Node.js 功能复刻</div>
          <div>已复刻模块：对话（含多模型对比）、小程序、主流智能体（含统一网关与 PTY 终端）、设置 → 模型服务。</div>
          <div>技术栈：Node.js + Express + ws + node-pty ／ React 18 + Ant Design 5 + Redux Toolkit + Vite。</div>
          <div>数据：全部保存在本地 <code>data/</code>，不经过任何第三方服务器。</div>
          <Divider style={{ margin: '12px 0' }} />
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            本项目为按公开文档与界面行为从零实现的功能复刻，未复制 Cherry Studio 源码。
            Cherry Studio 社区版采用 AGPL-3.0 许可证；若你直接 fork 官方仓库进行二次开发，衍生产物需继续以 AGPL-3.0 开源。
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ 页面 */

const SECTIONS = [
  { key: 'general', label: '常规设置', icon: <SettingOutlined /> },
  { key: 'model-service', label: '模型服务', icon: <ApiOutlined /> },
  { key: 'mcp', label: 'MCP 工具', icon: <ApiOutlined /> },
  { key: 'proxy', label: '网络代理', icon: <GlobalOutlined /> },
  { key: 'backup', label: '备份与恢复', icon: <DatabaseOutlined /> },
  { key: 'about', label: '关于', icon: <InfoCircleOutlined /> }
]

export default function SettingsPage() {
  const { section } = useParams()
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const active = section || 'model-service'

  useEffect(() => {
    dispatch(loadProviders())
    dispatch(loadProviderMeta())
    dispatch(loadSettings())
  }, [dispatch])

  return (
    <div className="page">
      <div className="settings-wrap">
        <div className="settings-nav">
          <div style={{ padding: '6px 10px 12px', fontWeight: 600, fontSize: 14, color: 'var(--text-1)' }}>设置</div>
          {SECTIONS.map((s) => (
            <div
              key={s.key}
              className={`list-row ${active === s.key ? 'active' : ''}`}
              onClick={() => navigate(`/settings/${s.key}`)}
            >
              <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>{s.icon}</span>
              <span className="row-title">{s.label}</span>
            </div>
          ))}
        </div>
        <div className="settings-body">
          {active === 'general' && <GeneralSettings />}
          {active === 'model-service' && <ModelService />}
          {active === 'mcp' && <McpPage embedded />}
          {active === 'proxy' && <ProxySettings />}
          {active === 'backup' && <BackupSettings />}
          {active === 'about' && <AboutSettings />}
        </div>
      </div>
    </div>
  )
}
