import { useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import { Button, Empty, Input, Popover, Switch, Tag, Tooltip } from 'antd'
import { DownOutlined, SearchOutlined, SwapOutlined, CloseOutlined } from '@ant-design/icons'

const CAP_LABEL = {
  vision: '视觉', reasoning: '推理', 'web-search': '联网', 'image-generation': '绘图',
  tts: 'TTS', stt: 'STT', free: '免费', function_calling: '工具'
}

function ModelRow({ model, active, onClick, compareMode, selected }) {
  const caps = (model.capabilities || []).filter((c) => c !== 'text')
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, cursor: 'pointer',
        background: active ? 'var(--active-bg)' : 'transparent'
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--hover-bg)' }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      {compareMode && (
        <span style={{ width: 16, textAlign: 'center', color: selected ? 'var(--cs-primary)' : 'var(--text-3)' }}>
          {selected ? '✓' : ''}
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, color: 'var(--text-1)' }}>
        {model.name || model.id}
      </span>
      {model.free && <Tag color="green" style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: '16px' }}>免费</Tag>}
      {caps.slice(0, 2).map((c) => (
        <Tag key={c} style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: '16px' }}>{CAP_LABEL[c] || c}</Tag>
      ))}
    </div>
  )
}

export default function ModelSelector({ value, onChange, compareModels = [], onCompareChange, size = 'small' }) {
  const providers = useSelector((s) => s.providers.list)
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [compareMode, setCompareMode] = useState(false)

  const grouped = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return providers
      .filter((p) => p.enabled)
      .map((p) => ({
        provider: p,
        models: p.models.filter(
          (m) =>
            m.status !== 3 &&
            !(m.capabilities || []).includes('embedding') &&
            !(m.capabilities || []).includes('rerank') &&
            (!kw || `${m.id} ${m.name} ${p.name}`.toLowerCase().includes(kw))
        )
      }))
      .filter((g) => g.models.length)
  }, [providers, keyword])

  const current = useMemo(() => {
    if (!value) return null
    const p = providers.find((x) => x.id === value.providerId)
    const m = p?.models.find((x) => x.id === value.modelId)
    return m ? { ...m, providerName: p.name } : { id: value.modelId, providerName: p?.name || value.providerId }
  }, [providers, value])

  const pick = (providerId, modelId) => {
    if (compareMode) {
      const key = `${providerId}:${modelId}`
      const exists = compareModels.some((m) => `${m.providerId}:${m.modelId}` === key)
      let next
      if (exists) next = compareModels.filter((m) => `${m.providerId}:${m.modelId}` !== key)
      else if (compareModels.length >= 4) next = compareModels
      else next = [...compareModels, { providerId, modelId }]
      onCompareChange?.(next)
      if (!value || `${value.providerId}:${value.modelId}` !== key) onChange?.({ providerId, modelId })
    } else {
      onChange?.({ providerId, modelId })
      onCompareChange?.([])
      setOpen(false)
    }
  }

  const selectedKeys = new Set([
    ...(compareMode ? compareModels.map((m) => `${m.providerId}:${m.modelId}`) : []),
    value ? `${value.providerId}:${value.modelId}` : ''
  ])

  const panel = (
    <div style={{ width: 330 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <Input
          size="small"
          allowClear
          prefix={<SearchOutlined style={{ color: 'var(--text-3)' }} />}
          placeholder="搜索模型或服务商"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ flex: 1 }}
        />
        <Tooltip title="多模型对比：勾选多个模型，同一条提问并排回答">
          <Switch
            size="small"
            checked={compareMode}
            onChange={(v) => {
              setCompareMode(v)
              if (v && value && !compareModels.length) onCompareChange?.([{ ...value }])
              if (!v) onCompareChange?.([])
            }}
            checkedChildren="对比"
            unCheckedChildren="对比"
          />
        </Tooltip>
      </div>
      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        {grouped.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可用模型，请先在设置中启用服务商" />}
        {grouped.map(({ provider, models }) => (
          <div key={provider.id} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', padding: '4px 8px', fontWeight: 600 }}>
              {provider.name} <span style={{ fontWeight: 400 }}>· {models.length}</span>
            </div>
            {models.map((m) => {
              const key = `${provider.id}:${m.id}`
              return (
                <ModelRow
                  key={key}
                  model={m}
                  compareMode={compareMode}
                  selected={selectedKeys.has(key)}
                  active={!compareMode && value && value.providerId === provider.id && value.modelId === m.id}
                  onClick={() => pick(provider.id, m.id)}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )

  const label = current ? `${current.providerName} · ${current.name || current.id}` : '选择模型'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Popover open={open} onOpenChange={setOpen} content={panel} trigger="click" placement="bottomLeft" arrow={false}>
        <Button size={size} type="text" icon={<SwapOutlined />} style={{ maxWidth: 290 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5 }}>{label}</span>
          <DownOutlined style={{ fontSize: 9, opacity: 0.5 }} />
        </Button>
      </Popover>
      {compareModels.length > 1 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {compareModels.map((m) => (
            <Tag
              key={`${m.providerId}:${m.modelId}`}
              color="red"
              closable
              closeIcon={<CloseOutlined style={{ fontSize: 9 }} />}
              onClose={() => onCompareChange?.(compareModels.filter((x) => x !== m))}
              style={{ marginInlineEnd: 0, fontSize: 11 }}
            >
              {m.modelId}
            </Tag>
          ))}
        </div>
      )}
    </div>
  )
}
