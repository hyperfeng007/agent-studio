import AssistantTopics from '../../components/AssistantTopics'
import release from '../../../../app-release.json'
import AssistantEditor from '../../components/AssistantEditor'
import AssistantLibrary from '../../components/AssistantLibrary'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  App, Button, Dropdown, Empty, Input, Modal,
  Select, Tooltip, message
} from 'antd'
import {
  PlusOutlined, SearchOutlined, MoreOutlined, EditOutlined, DeleteOutlined,
  CopyOutlined, RobotOutlined, PushpinOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import {
  fetchAssistants, selectAssistant, selectTopic, createAssistant, createTopic,
  clearTopic, sendMessage, regenerateMessage, deleteMessage, updateMessage,
  patchAssistant, patchTopic, removeAssistant, removeTopic, setCompareModels, stopStream
} from '../../store/chat'
import { saveSettings } from '../../store'
import ModelSelector from '../../components/ModelSelector'
import Inputbar from '../../components/Inputbar'
import MessageItem from '../../components/MessageItem'
import api from '../../api'



export default function ChatPage() {
  const { modal } = App.useApp()
  const dispatch = useDispatch()
  const { assistants, activeAssistantId, topics, activeTopicId, messages, sending, compareModels } = useSelector((s) => s.chat)
  const providers = useSelector((s) => s.providers.list)
  const globalSettings = useSelector((s) => s.settings.data)
  const messageStyle = globalSettings.messageStyle || 'bubble'

  const [assistantKeyword, setAssistantKeyword] = useState('')
  const [editingAssistant, setEditingAssistant] = useState(null)
  const [topicBusy, setTopicBusy] = useState(false)
  const topicLock = useRef(false)
  const [newTopicOpen, setNewTopicOpen] = useState(false)
  const [newTopicName, setNewTopicName] = useState('')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [assistantGroup, setAssistantGroup] = useState('全部')
  const groups = [...new Set(assistants.map(a => a.group).filter(Boolean))]
  const openCustom = (preset = {}) => setEditingAssistant({ isNew: true, name: '', prompt: '', description: '', emoji: '⭐️', ...preset })
  const scrollerRef = useRef(null)
  const stickToBottom = useRef(true)

  const assistant = useMemo(() => assistants.find((a) => a.id === activeAssistantId) || null, [assistants, activeAssistantId])
  const topic = useMemo(() => topics.find((t) => t.id === activeTopicId) || null, [topics, activeTopicId])

  useEffect(() => { dispatch(fetchAssistants()) }, [dispatch])

  useEffect(() => {
    if (!activeAssistantId && assistants.length) dispatch(selectAssistant(assistants[0].id))
  }, [activeAssistantId, assistants, dispatch])

  // Group assistant answers that belong to the same multi-model comparison.
  const rendered = useMemo(() => {
    const out = []
    let i = 0
    while (i < messages.length) {
      const m = messages[i]
      if (m.groupId) {
        const group = []
        while (i < messages.length && messages[i].groupId === m.groupId) group.push(messages[i++])
        out.push({ kind: 'group', id: m.groupId, items: group })
      } else {
        out.push({ kind: 'single', id: m.id, item: m })
        i++
      }
    }
    return out
  }, [messages])

  useEffect(() => {
    const el = scrollerRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages, rendered.length])

  const onScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const filteredAssistants = useMemo(() => {
    const kw = assistantKeyword.trim().toLowerCase()
    return assistants.filter(a => (!kw || `${a.name} ${a.description || ''} ${a.prompt || ''}`.toLowerCase().includes(kw)) && (assistantGroup === '全部' || (a.group || '未分组') === assistantGroup))
      .sort((a,b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.createdAt || 0) - (a.createdAt || 0))
  }, [assistants, assistantKeyword, assistantGroup])

  const updateAssistant = async (patch) => {
    if (!assistant) return
    const saved = await api.assistants.save(assistant.id, patch)
    dispatch(patchAssistant(saved))
    return saved
  }

  const updateSettings = async settings => {
    if (!assistant) return
    try { dispatch(patchAssistant(await api.assistants.save(assistant.id, { settings }))) } catch (e) { message.error(e.message) }
  }

  const handleSend = async ({ content, files }) => {
    stickToBottom.current = true
    const models = compareModels.length > 1 ? compareModels : assistant?.model ? [{ providerId: assistant.model.provider, modelId: assistant.model.id }] : []
    if (!models.length) {
      message.warning('请先在右上角选择模型')
      throw new Error('未选择模型')
    }
    await dispatch(sendMessage({ content, files, models })).unwrap()
  }

  const handleStop = () => {
    for (const m of messages) if (m.status === 'sending' || m.status === 'pending') stopStream(m.id)
  }

  const openNewTopic = () => { setNewTopicName(''); setNewTopicOpen(true) }
  const submitTopic = async () => {
    if (topicLock.current || !activeAssistantId) return
    topicLock.current = true; setTopicBusy(true)
    try {
      await dispatch(createTopic({assistantId: activeAssistantId, name: newTopicName.trim() || '新话题'})).unwrap()
      setNewTopicOpen(false); stickToBottom.current = true
    } catch(e) { message.error(e.message) }
    finally { topicLock.current = false; setTopicBusy(false) }
  }

  const renameTopic = (t) => {
    let value = t.name
    modal.confirm({
      title: '重命名话题',
      icon: null,
      content: <Input defaultValue={t.name} onChange={(e) => (value = e.target.value)} />,
      okText: '保存',
      cancelText: '取消',
      onOk: async () => {
        const saved = await api.topics.save(t.id, { name: value.trim() || t.name })
        dispatch(patchTopic(saved))
      }
    })
  }


  return (
    <div className="page" style={{ position: 'relative' }}>
      {/* ------------------------------------------------------- assistants */}
      {globalSettings.showAssistants !== false && (
        <div className="sidebar-col split-sidebar">
          <section className="assistant-list-section" aria-label="已添加的智能助手">
          <div className="sidebar-head">
            <span className="sidebar-title">智能助手 <small style={{fontSize:10, fontWeight:400, color:'var(--text-3)'}} title={release.build}>v{release.version}</small></span>
            <Tooltip title="添加智能助手">
              <Button
                size="small" type="text" icon={<PlusOutlined />}
                aria-label="添加智能助手" onClick={() => setLibraryOpen(true)}
              />
            </Tooltip>
          </div>
          <div style={{ padding: '8px 10px 0' }}>
            <Input
              size="small" allowClear prefix={<SearchOutlined style={{ color: 'var(--text-3)' }} />}
              placeholder="搜索智能助手" value={assistantKeyword} onChange={(e) => setAssistantKeyword(e.target.value)}
            />
          </div>
          <div style={{ padding: '8px 10px' }}><Select aria-label="助手分组" size="small" style={{width:'100%'}} value={assistantGroup} onChange={setAssistantGroup} options={['全部', ...groups, '未分组'].map(value => ({value, label:value}))} /></div>
          <div className="sidebar-body">
            {!filteredAssistants.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={assistants.length ? '没有匹配的助手' : '还没有智能助手'}><Button onClick={() => setLibraryOpen(true)}>添加智能助手</Button></Empty>}
            {filteredAssistants.map((a) => (
              <div key={a.id} className="assistant-branch">
              <div
                className={`list-row ${a.id === activeAssistantId ? 'active' : ''}`}
                onClick={() => { if (a.id !== activeAssistantId) dispatch(selectAssistant(a.id)) }}
              >
                <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{a.emoji || '⭐️'}</span>
                <span className="row-title" title={a.description || a.name}><span>{a.pinned && <PushpinOutlined style={{marginRight:4}} />}{a.name}</span>{a.description && <small className="assistant-row-description">{a.description}</small>}</span>
                <span className="row-actions">
                  <span className="row-action" onClick={(e) => { e.stopPropagation(); setEditingAssistant({ ...a }) }}>
                    <EditOutlined />
                  </span>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: 'pin', icon: <PushpinOutlined />, label: a.pinned ? '取消置顶' : '置顶助手' },
                        { key: 'copy', icon: <CopyOutlined />, label: '创建副本' },
                        { key: 'delete', icon: <DeleteOutlined />, label: '删除智能助手', danger: true }
                      ],
                      onClick: async ({ key, domEvent }) => {
                        domEvent.stopPropagation()
                        if (key === 'pin') {
                          try { dispatch(patchAssistant(await api.assistants.save(a.id, {pinned: !a.pinned}))) } catch (e) { message.error(e.message) }
                        }
                        if (key === 'copy') {
                          const c = await api.assistants.copy(a.id)
                          dispatch(fetchAssistants()).then(() => dispatch(selectAssistant(c.id)))
                        }
                        if (key === 'delete') {
                          modal.confirm({
                            title: `删除智能助手「${a.name}」？`,
                            content: '该智能助手下的所有话题与消息都会被删除，且无法恢复。',
                            okText: '删除', okButtonProps: { danger: true }, cancelText: '取消',
                            onOk: async () => {
                              await api.assistants.remove(a.id)
                              dispatch(removeAssistant(a.id))
                              const rest = assistants.filter((x) => x.id !== a.id)
                              if (rest.length) dispatch(selectAssistant(rest[0].id))
                            }
                          })
                        }
                      }
                    }}
                  >
                    <span className="row-action" onClick={(e) => e.stopPropagation()}><MoreOutlined /></span>
                  </Dropdown>
                </span>
              </div>
              </div>
            ))}
          </div>
          </section>
          <section className="topic-list-section" aria-label="当前助手的话题">
            <div className="sidebar-head"><span className="sidebar-title">话题</span><span className="topic-assistant-name" title={assistant?.name}>{assistant?.name || '未选择助手'}</span></div>
            <div className="sidebar-body">
              {assistant ? <AssistantTopics
                topics={topics} activeTopicId={activeTopicId} onNew={openNewTopic} onRename={renameTopic}
                onSelect={id => { stickToBottom.current = true; dispatch(selectTopic(id)) }}
                onPin={async t => { try { dispatch(patchTopic(await api.topics.save(t.id, {pinned: !t.pinned}))) } catch(e) { message.error(e.message) } }}
                onDelete={async t => {
                  await api.topics.remove(t.id)
                  dispatch(removeTopic(t.id))
                  if (t.id === activeTopicId) {
                    const rest = topics.filter(x => x.id !== t.id)
                    if (rest.length) await dispatch(selectTopic(rest[0].id)).unwrap()
                  }
                }}
              /> : <div className="topic-empty">请先选择或添加智能助手</div>}
            </div>
          </section>
        </div>
      )}

      {/* -------------------------------------------------------------- chat */}
      <div className="chat-main">
        <div className="chat-header">
          <span style={{ fontSize: 17 }}>{assistant?.emoji || '⭐️'}</span>
          <span className="title">{assistant?.name}</span>
          <Tooltip title="智能助手设置">
            <Button size="small" type="text" icon={<EditOutlined />} disabled={!assistant} onClick={() => setEditingAssistant({...assistant})} />
          </Tooltip>
          <div style={{ width: 1, height: 18, background: 'var(--panel-border)' }} />
          <ModelSelector
            value={assistant?.model ? { providerId: assistant.model.provider, modelId: assistant.model.id } : null}
            onChange={async ({ providerId, modelId }) => {
              const p = providers.find((x) => x.id === providerId)
              const m = p?.models.find((x) => x.id === modelId)
              await updateAssistant({ model: { id: modelId, provider: providerId, name: m?.name || modelId, capabilities: m?.capabilities } })
            }}
            compareModels={compareModels}
            onCompareChange={(v) => dispatch(setCompareModels(v))}
          />
          <div className="spacer" />
          <Tooltip title="在当前助手下新建话题"><Button size="small" type="text" aria-label="新建话题" disabled={!assistant} icon={<PlusOutlined />} onClick={openNewTopic} /></Tooltip>
          <span style={{ fontSize: 12.5, color: 'var(--text-3)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {topic?.name}
          </span>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'assistants', label: globalSettings.showAssistants === false ? '显示智能助手栏' : '隐藏智能助手栏' },
                { type: 'divider' },
                { key: 'style', label: `消息样式：${messageStyle === 'plain' ? '朴素' : '气泡'}` }
              ],
              onClick: ({ key }) => {
                if (key === 'assistants') dispatch(saveSettings({ showAssistants: globalSettings.showAssistants === false }))
                if (key === 'style') dispatch(saveSettings({ messageStyle: messageStyle === 'plain' ? 'bubble' : 'plain' }))
              }
            }}
          >
            <Button size="small" type="text" icon={<MoreOutlined />} />
          </Dropdown>
        </div>

        <div className={`messages style-${messageStyle}`} ref={scrollerRef} onScroll={onScroll}>
          <div className="messages-inner">
            {!messages.length && (
              <div className="empty-state" style={{ minHeight: 300 }}>
                <div className="big">{assistant?.emoji || '🤖'}</div>
                <div className="t">{assistant?.name || '创建你的第一个智能助手'}</div>
                {!assistant && <Button type="primary" onClick={() => setLibraryOpen(true)}>添加智能助手</Button>}
                {assistant?.description && <p className="assistant-muted" style={{maxWidth:460,textAlign:'center'}}>{assistant.description}</p>}
                {assistant?.prompt && (
                  <div style={{ maxWidth: 460, fontSize: 12.5, color: 'var(--text-3)', textAlign: 'center', lineHeight: 1.7 }}>
                    {assistant.prompt.slice(0, 160)}
                    {assistant.prompt.length > 160 ? '…' : ''}
                  </div>
                )}
              </div>
            )}

            {rendered.map((entry, idx) => {
              if (entry.kind === 'single') {
                const m = entry.item
                return (
                  <MessageItem
                    key={m.id}
                    msg={m}
                    index={idx}
                    isLast={idx === rendered.length - 1}
                    isStreaming={sending && (m.status === 'sending' || m.status === 'pending')}
                    onRegenerate={(target) => dispatch(regenerateMessage(target.id))}
                    onDelete={(target) => dispatch(deleteMessage(target.id))}
                    onEdit={(id, patch) => dispatch(updateMessage({ id, patch }))}
                  />
                )
              }
              const cols = Math.min(4, entry.items.length)
              return (
                <div key={entry.id} className={`msg-group cols-${cols}`}>
                  {entry.items.map((m) => (
                    <MessageItem
                      key={m.id}
                      msg={m}
                      index={idx}
                      isLast={idx === rendered.length - 1}
                      isStreaming={sending && (m.status === 'sending' || m.status === 'pending')}
                      onRegenerate={(target) => dispatch(regenerateMessage(target.id))}
                      onDelete={(target) => dispatch(deleteMessage(target.id))}
                      onEdit={(id, patch) => dispatch(updateMessage({ id, patch }))}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        </div>

        {(assistant?.knowledgeBaseIds?.length > 0 || assistant?.mcpGrants?.some(g=>g.tools?.length)) && <div className="chat-resource-badge" onClick={()=>setEditingAssistant({...assistant})} role="button" tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')setEditingAssistant({...assistant})}}>
          知识库 {assistant.knowledgeBaseIds?.length || 0} 个 · MCP 工具 {(assistant.mcpGrants||[]).reduce((n,g)=>n+(g.tools?.length||0),0)} 个 · 点击管理授权
        </div>}
        <Inputbar
          assistant={assistant}
          settings={assistant?.settings || {}}
          onSettingsChange={updateSettings}
          onSend={handleSend}
          onStop={handleStop}
          sending={sending}
          disabled={!assistant || !topic}
          onClearContext={() => topic && dispatch(clearTopic(topic.id))}
          globalSettings={globalSettings}
          onGlobalSettingsChange={(patch) => dispatch(saveSettings(patch))}
        />
      </div>

      {libraryOpen && <AssistantLibrary assistants={assistants} onClose={() => setLibraryOpen(false)} onCustom={openCustom} onAdded={() => dispatch(fetchAssistants()).unwrap()} onOpenChat={id => { setAssistantKeyword(''); setAssistantGroup('全部'); dispatch(selectAssistant(id)) }} />}
      {editingAssistant && <AssistantEditor key={editingAssistant.id || 'new'} resource={editingAssistant} groups={groups} defaults={globalSettings} onClose={() => setEditingAssistant(null)} onSave={async payload => {
        if (editingAssistant.isNew) {
          setAssistantKeyword(''); setAssistantGroup('全部')
          const created = await dispatch(createAssistant(payload)).unwrap()
          await dispatch(selectAssistant(created.id)).unwrap()
        } else {
          const saved = await api.assistants.save(editingAssistant.id, payload)
          dispatch(patchAssistant(saved))
        }
      }} />}

      <Modal
        open={newTopicOpen}
        destroyOnHidden
        title="新建话题"
        okText="创建"
        cancelText="取消"
        onCancel={() => setNewTopicOpen(false)}
        onOk={submitTopic}
        confirmLoading={topicBusy}
        cancelButtonProps={{disabled:topicBusy}}
        closable={!topicBusy}
        maskClosable={!topicBusy}
        keyboard={!topicBusy}
      >
        <Input placeholder="话题名称（留空则自动生成）" value={newTopicName} onChange={(e) => setNewTopicName(e.target.value)} maxLength={120} onPressEnter={submitTopic} />
      </Modal>

      {/* ------------------------------------------------ assistant settings */}

    </div>
  )
}
