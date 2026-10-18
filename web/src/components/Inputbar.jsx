import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Popover, Slider, InputNumber, Select, Switch, Tooltip, Upload, message } from 'antd'
import {
  ArrowUpOutlined, PauseCircleOutlined, PaperClipOutlined, ClearOutlined,
  SettingOutlined, PictureOutlined, ThunderboltOutlined
} from '@ant-design/icons'
import api from '../api'

const SHORTCUTS = [
  { value: 'Enter', label: 'Enter 发送 / Shift+Enter 换行' },
  { value: 'Ctrl+Enter', label: 'Ctrl+Enter 发送 / Enter 换行' },
  { value: 'Shift+Enter', label: 'Shift+Enter 发送 / Enter 换行' }
]

function ParamsPanel({ settings, onChange, contextTokens }) {
  const set = (key, value) => onChange({ ...settings, [key]: value })
  return (
    <div style={{ width: 300 }}>
      <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>温度 temperature · {settings.temperature ?? 0.7}</div>
      <Slider min={0} max={2} step={0.1} value={settings.temperature ?? 0.7} onChange={(v) => set('temperature', v)} />
      <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>Top P · {settings.topP ?? 1}</div>
      <Slider min={0} max={1} step={0.05} value={settings.topP ?? 1} onChange={(v) => set('topP', v)} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)', width: 88 }}>最大 tokens</span>
        <InputNumber
          size="small" min={0} max={200000} step={512} value={settings.maxTokens || 0}
          onChange={(v) => set('maxTokens', v || 0)} style={{ width: 110 }}
        />
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>0 = 不限</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)', width: 88 }}>上下文数量</span>
        <Slider min={0} max={50} value={settings.contextCount ?? 12} onChange={(v) => set('contextCount', v)} style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text-1)', width: 24, textAlign: 'right' }}>{settings.contextCount ?? 12}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)', width: 88 }}>思考强度</span>
        <Select
          size="small" style={{ flex: 1 }} value={settings.reasoningEffort || ''}
          onChange={(v) => set('reasoningEffort', v)}
          options={[
            { value: '', label: '跟随模型默认' },
            { value: 'low', label: '低' },
            { value: 'medium', label: '中' },
            { value: 'high', label: '高' },
            { value: 'none', label: '关闭' }
          ]}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)', width: 88 }}>流式输出</span>
        <Switch size="small" checked={settings.streamOutput !== false} onChange={(v) => set('streamOutput', v)} />
      </div>
      <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text-3)' }}>
        当前上下文约 {contextTokens ?? 0} tokens
      </div>
    </div>
  )
}

export default function Inputbar({
  assistant, settings, onSettingsChange, onSend, onStop, onClearContext,
  sending, disabled, globalSettings, onGlobalSettingsChange
}) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [tokens, setTokens] = useState(0)
  const areaRef = useRef(null)

  const shortcut = globalSettings?.sendMessageShortcut || 'Enter'
  const canVision = (assistant?.model?.capabilities || []).includes('vision')

  useEffect(() => {
    areaRef.current?.focus?.()
  }, [assistant?.id])

  // Rough token estimate for the whole context window shown in the toolbar.
  useEffect(() => {
    const t = setTimeout(() => {
      const chars = text.length + files.reduce((n, f) => n + 200, 0)
      setTokens(Math.ceil(chars / 3.2))
    }, 300)
    return () => clearTimeout(t)
  }, [text, files])

  const submit = async () => {
    const content = text.trim()
    if (!content && !files.length) return
    if (sending) return
    setText('')
    const payload = { content, files }
    setFiles([])
    try {
      await onSend(payload)
    } catch (err) {
      message.error(err.message || '发送失败')
      setText(content)
      setFiles(payload.files)
    }
  }

  const onKeyDown = (e) => {
    if (e.key !== 'Enter') return
    const isCtrl = e.ctrlKey || e.metaKey
    const isShift = e.shiftKey
    if (shortcut === 'Enter' && !isCtrl && !isShift) {
      e.preventDefault()
      submit()
    } else if (shortcut === 'Ctrl+Enter' && isCtrl) {
      e.preventDefault()
      submit()
    } else if (shortcut === 'Shift+Enter' && isShift) {
      e.preventDefault()
      submit()
    }
  }

  const uploadFiles = async (list) => {
    setUploading(true)
    try {
      for (const file of list) {
        if (file.size > 20 * 1024 * 1024) {
          message.error(`${file.name} 超过 20MB`)
          continue
        }
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
        const rec = await api.files.upload({ name: file.name, mime: file.type, data: dataUrl })
        if (rec.mime.startsWith('image/') && !canVision) {
          message.warning('当前模型不支持视觉，图片仍会上传但模型可能忽略')
        }
        setFiles((prev) => [...prev, rec])
      }
    } catch (err) {
      message.error(err.message || '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const onPaste = async (e) => {
    const items = [...(e.clipboardData?.items || [])]
    const imgs = items.filter((i) => i.type?.startsWith('image/'))
    if (imgs.length) {
      e.preventDefault()
      const list = imgs.map((i) => i.getAsFile()).filter(Boolean)
      await uploadFiles(list)
      return
    }
    // 长文本粘贴转文件（与原版一致的可选项）
    const textItem = items.find((i) => i.type === 'text/plain')
    if (textItem && globalSettings?.pasteLongTextAsFile) {
      const str = textItem.getAsData?.() ?? e.clipboardData.getData('text/plain')
      const threshold = globalSettings?.pasteLongTextThreshold ?? 1500
      if (str && str.length > threshold) {
        e.preventDefault()
        const blob = new Blob([str], { type: 'text/plain' })
        await uploadFiles([new File([blob], `pasted-${Date.now()}.txt`, { type: 'text/plain' })])
        message.success('长文本已转为附件')
      }
    }
  }

  const onDrop = async (e) => {
    const list = [...(e.dataTransfer?.files || [])]
    if (!list.length) return
    e.preventDefault()
    await uploadFiles(list)
  }

  const tokenHint = useMemo(() => (tokens ? `~${tokens} tokens` : ''), [tokens])

  return (
    <div className="inputbar">
      <div className="inputbar-inner" onPaste={onPaste} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
        {files.length > 0 && (
          <div className="attach-chips">
            {files.map((f) => (
              <span className="attach-chip" key={f.id}>
                {f.mime.startsWith('image/') && <img src={api.files.rawUrl(f.id)} alt="" />}
                <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.origin_name}</span>
                <span style={{ opacity: 0.6 }}>{(f.size / 1024).toFixed(0)}KB</span>
                <span
                  style={{ cursor: 'pointer', opacity: 0.6 }}
                  onClick={async () => {
                    setFiles((prev) => prev.filter((x) => x.id !== f.id))
                    await api.files.remove(f.id).catch(() => {})
                  }}
                >
                  ✕
                </span>
              </span>
            ))}
          </div>
        )}

        <Input.TextArea
          ref={areaRef}
          variant="borderless"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={disabled ? '请先选择智能助手与话题' : `给 ${assistant?.name || '智能助手'} 发消息…（可粘贴/拖拽图片）`}
          autoSize={{ minRows: 2, maxRows: 12 }}
          disabled={disabled}
        />

        <div className="inputbar-toolbar">
          <Popover
            trigger="click"
            placement="topLeft"
            arrow={false}
            content={<ParamsPanel settings={settings} onChange={onSettingsChange} contextTokens={tokens} />}
          >
            <Tooltip title="模型参数">
              <Button size="small" type="text" icon={<SettingOutlined />} />
            </Tooltip>
          </Popover>

          <Upload
            multiple
            showUploadList={false}
            beforeUpload={(file) => {
              uploadFiles([file])
              return false
            }}
          >
            <Tooltip title={canVision ? '上传图片' : '上传附件（当前模型不支持视觉）'}>
              <Button size="small" type="text" icon={uploading ? <ThunderboltOutlined spin /> : <PictureOutlined />} />
            </Tooltip>
          </Upload>

          <Tooltip title="清除上下文（保留话题，后续对话不再引用之前的消息）">
            <Button size="small" type="text" icon={<ClearOutlined />} onClick={onClearContext} disabled={disabled} />
          </Tooltip>

          <Popover
            trigger="click"
            placement="topLeft"
            arrow={false}
            content={
              <div style={{ width: 250 }}>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 6 }}>发送快捷键</div>
                <Select
                  size="small" style={{ width: '100%' }} value={shortcut}
                  options={SHORTCUTS}
                  onChange={(v) => onGlobalSettingsChange?.({ sendMessageShortcut: v })}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                  <Switch
                    size="small"
                    checked={!!globalSettings?.pasteLongTextAsFile}
                    onChange={(v) => onGlobalSettingsChange?.({ pasteLongTextAsFile: v })}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>长文本粘贴为附件</span>
                </div>
                {globalSettings?.pasteLongTextAsFile && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-2)' }}>阈值</span>
                    <InputNumber
                      size="small" min={200} step={100} value={globalSettings?.pasteLongTextThreshold ?? 1500}
                      onChange={(v) => onGlobalSettingsChange?.({ pasteLongTextThreshold: v || 1500 })}
                    />
                  </div>
                )}
              </div>
            }
          >
            <span className="token-hint" style={{ cursor: 'pointer', padding: '0 4px' }}>{tokenHint}</span>
          </Popover>

          <div className="spacer" />

          {sending ? (
            <Tooltip title="停止生成">
              <Button size="small" danger icon={<PauseCircleOutlined />} onClick={onStop}>停止</Button>
            </Tooltip>
          ) : (
            <Tooltip title={SHORTCUTS.find((s) => s.value === shortcut)?.label}>
              <Button size="small" type="primary" shape="circle" icon={<ArrowUpOutlined />} onClick={submit} disabled={disabled || (!text.trim() && !files.length)} />
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}
