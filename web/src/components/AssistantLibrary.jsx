import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Empty, Input, Modal, Segmented, Spin, Tag } from 'antd'
import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
import api from '../api'

export default function AssistantLibrary({ assistants, onAdded, onOpenChat, onCustom, onClose }) {
  const [presets, setPresets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState('全部')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(null)
  const [added, setAdded] = useState({})
  const locked = useRef(false)
  const load = async () => {
    setLoading(true); setError('')
    try { setPresets(await api.assistants.presets()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  const categories = ['全部', ...new Set(presets.map(p => p.group))]
  const matches = useMemo(() => presets.filter(p => (category === '全部' || p.group === category) && `${p.name} ${p.description} ${p.prompt}`.toLowerCase().includes(keyword.trim().toLowerCase())), [presets, category, keyword])
  const existing = preset => added[preset.presetId] || assistants.find(a => a.presetId === preset.presetId || (!a.presetId && a.name === preset.name && a.prompt === preset.prompt))?.id
  const add = async preset => {
    if (locked.current) return
    locked.current = true; setBusy(preset.presetId); setError('')
    try {
      const a = await api.assistants.create(preset)
      setAdded(prev => ({ ...prev, [preset.presetId]: a.id }))
      await onAdded(a)
    } catch (e) { setError(e.message) }
    finally { locked.current = false; setBusy(null) }
  }
  const action = preset => existing(preset)
    ? <Button onClick={() => { onOpenChat(existing(preset)); onClose() }}>进入对话</Button>
    : <Button type="primary" icon={<PlusOutlined />} disabled={!!busy} loading={busy === preset.presetId} onClick={() => add(preset)}>添加助手</Button>
  return <>
    <Modal open width={780} title="添加智能助手" footer={null} onCancel={() => !busy && onClose()} maskClosable={!busy} closable={!busy} keyboard={!busy}>
      <div className="assistant-library-toolbar"><span className="assistant-muted">从助手库添加，或创建自己的助手</span><Button icon={<PlusOutlined />} disabled={!!busy} onClick={() => { onClose(); onCustom() }}>自定义新建</Button></div>
      <Input allowClear prefix={<SearchOutlined />} aria-label="搜索助手库" placeholder="搜索名称、描述或提示词" value={keyword} onChange={e => setKeyword(e.target.value)} />
      <div className="assistant-category-tabs"><Segmented value={category} onChange={setCategory} options={categories} /></div>
      {error && <Alert type="error" showIcon message={error} action={<Button size="small" onClick={load}>重试</Button>} />}
      <div className="assistant-library-list">
        {loading ? <div style={{padding:60,textAlign:'center'}}><Spin /></div> : matches.length ? matches.map(p => <div className="assistant-preset-row" key={p.presetId}>
          <button className="assistant-preset-info" onClick={() => setPreview(p)} aria-label={`预览 ${p.name}`}><span className="assistant-preset-avatar">{p.emoji}</span><span className="assistant-preset-text"><strong>{p.name}</strong><span>{p.description || '通用对话助手'}</span></span></button>
          {existing(p) && <Tag color="green">已添加</Tag>}{action(p)}
        </div>) : <Empty description="没有匹配的助手，试试其他关键词" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      </div>
      <div className="assistant-muted" style={{paddingTop:12}}>共 {matches.length} 个 · 本项目内置模板，添加后可独立修改；不会覆盖已有助手。</div>
    </Modal>
    {preview && <Modal open width={660} title={<span>{preview.emoji} {preview.name}</span>} onCancel={() => !busy && setPreview(null)} maskClosable={!busy} closable={!busy} keyboard={!busy} footer={<><Button disabled={!!busy} onClick={() => { onClose(); onCustom({...preview, presetId:null}) }}>以此为模板新建</Button>{action(preview)}</>}>
      <div className="assistant-preview-body"><Tag>{preview.group}</Tag><h4>描述</h4><p>{preview.description}</p><h4>系统提示词</h4><pre className="assistant-prompt-preview">{preview.prompt || '无预设系统提示词，适用于通用对话。'}</pre></div>
      {error && <Alert type="error" message={error} />}
    </Modal>}
  </>
}
