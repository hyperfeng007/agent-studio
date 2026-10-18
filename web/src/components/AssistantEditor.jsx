import AssistantResources from './AssistantResources'
import { useRef, useState } from 'react'
import { App, Alert, AutoComplete, Button, Form, Input, InputNumber, Modal, Slider, Tabs, Select } from 'antd'
import ModelSelector from './ModelSelector'

const EMOJIS = ['⭐️', '🍒', '🤖', '💡', '📚', '🧑‍💻', '🌐', '🎨', '📝', '🔍', '🚀', '🧠', '📊', '🛠️', '🎯', '🐱']

/** A local draft: cancellation never writes partial settings to the server. */
export default function AssistantEditor({ resource, groups, defaults, onSave, onClose }) {
  const { message, modal } = App.useApp()
  const [draft, setDraft] = useState(() => ({ ...resource, settings: { contextCount: defaults.contextCount ?? 12, temperature: defaults.temperature ?? 0.7, topP: defaults.topP ?? 1, maxTokens: 0, streamOutput: true, ...resource.settings } }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const lock = useRef(false)
  const patch = p => { setDraft(d => ({ ...d, ...p })); setDirty(true) }
  const setting = p => { setDraft(d => ({ ...d, settings: { ...d.settings, ...p } })); setDirty(true) }
  const close = () => {
    if (busy) return
    if (!dirty) return onClose()
    modal.confirm({ title: '放弃未保存的修改？', content: '已保存的助手和聊天记录不会受影响。', okText: '放弃修改', cancelText: '继续编辑', onOk: onClose })
  }
  const save = async () => {
    if (lock.current) return
    if (!draft.name?.trim()) { setError('请填写智能助手名称'); return }
    lock.current = true; setBusy(true); setError('')
    try {
      const { name, emoji, description, prompt, group, model, settings, presetId, knowledgeBaseIds, mcpGrants } = draft
      await onSave({ name: name.trim(), emoji: emoji || '⭐️', description: description || '', prompt: prompt || '', group: group || '', model, settings, presetId, knowledgeBaseIds: knowledgeBaseIds || [], mcpGrants: mcpGrants || [] })
      message.success(resource.isNew ? '智能助手已创建' : '智能助手已保存')
      onClose()
    } catch (e) { setError(e.message || '保存失败，请重试') }
    finally { lock.current = false; setBusy(false) }
  }
  const basic = <Form layout="vertical">
    <Form.Item label="名称" required><Input autoFocus maxLength={80} showCount value={draft.name} placeholder="为智能助手起个名字" onChange={e => patch({ name: e.target.value })} /></Form.Item>
    <Form.Item label="图标"><div className="assistant-emojis">{EMOJIS.map(emoji => <Button key={emoji} aria-label={`图标 ${emoji}`} aria-pressed={draft.emoji === emoji} type={draft.emoji === emoji ? 'primary' : 'text'} onClick={() => patch({ emoji })}>{emoji}</Button>)}</div></Form.Item>
    <Form.Item label="描述"><Input.TextArea rows={2} maxLength={500} showCount value={draft.description} placeholder="这个助手擅长什么？用于列表介绍，不作为系统提示发送。" onChange={e => patch({ description: e.target.value })} /></Form.Item>
    <Form.Item label="分组"><AutoComplete options={groups.map(value => ({ value }))} value={draft.group || ''} maxLength={40} onChange={group => patch({ group })} placeholder="选择现有分组，或输入新分组；留空为未分组" /></Form.Item>
    <Form.Item label="默认模型" extra="未选择时，新助手使用全局默认模型；可在对话页随时切换。"><ModelSelector size="middle" value={draft.model ? { providerId: draft.model.provider, modelId: draft.model.id } : null} onChange={({providerId, modelId}) => patch({model: {provider: providerId, id: modelId}})} /></Form.Item>
  </Form>
  const prompt = <Form layout="vertical"><Form.Item label="系统提示词" extra="定义角色、任务、输出格式和限制。留空即为通用对话；不会自动获得执行命令或文件访问能力。"><Input.TextArea rows={13} maxLength={30000} showCount value={draft.prompt || ''} onChange={e => patch({prompt: e.target.value})} placeholder="例如：你是一位专业翻译。保留代码与专有名词，只输出译文。" /></Form.Item></Form>
  const parameters = <Form layout="vertical">
    <Form.Item label={`上下文消息数量 · ${draft.settings.contextCount}`} extra="0 表示不按消息条数裁剪，仍受模型上下文容量限制。"><Slider min={0} max={50} value={draft.settings.contextCount} onChange={contextCount => setting({contextCount})} /></Form.Item>
    <Form.Item label={`温度 · ${draft.settings.temperature}`}><Slider min={0} max={2} step={0.1} value={draft.settings.temperature} onChange={temperature => setting({temperature})} /></Form.Item>
    <Form.Item label={`Top P · ${draft.settings.topP}`}><Slider min={0} max={1} step={0.05} value={draft.settings.topP} onChange={topP => setting({topP})} /></Form.Item>
    <Form.Item label="最大输出 tokens" extra="0 表示使用接口默认值，并非无限输出。"><InputNumber min={0} max={200000} value={draft.settings.maxTokens} onChange={maxTokens => setting({maxTokens: maxTokens || 0})} /></Form.Item>
    <Form.Item label="思考强度"><Select value={draft.settings.reasoningEffort || ''} options={[{value:'',label:'跟随模型默认'},{value:'low',label:'低'},{value:'medium',label:'中'},{value:'high',label:'高'},{value:'none',label:'关闭'}]} onChange={reasoningEffort => setting({reasoningEffort})} /></Form.Item>
  </Form>
  return <Modal open width={640} title={resource.isNew ? '新建智能助手' : `编辑智能助手 · ${resource.name}`} onCancel={close} onOk={save} confirmLoading={busy} closable={!busy} maskClosable={false} keyboard={!busy} cancelButtonProps={{disabled:busy}} okText={resource.isNew ? '创建并开始对话' : '保存修改'} cancelText="取消">
    {error && <Alert type="error" showIcon message={error} style={{marginBottom:12}} />}
    <div className="assistant-editor-body"><Tabs defaultActiveKey="basic" items={[{key:'basic',label:'基本信息',children:basic},{key:'prompt',label:'提示词',children:prompt},{key:'parameters',label:'模型参数',children:parameters},{key:'resources',label:'知识库与工具',children:<AssistantResources draft={draft} onChange={patch} />}]} /></div>
  </Modal>
}
