import ChatEvidence from './ChatEvidence'
import { useState } from 'react'
import { Alert, Button, Input, Modal, Tooltip, message, Image } from 'antd'
import {
  CopyOutlined, ReloadOutlined, EditOutlined, DeleteOutlined,
  DownOutlined, RightOutlined, UserOutlined, ClockCircleOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import Markdown from './Markdown'
import api from '../api'

function Thinking({ text, durationMs, streaming }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  return (
    <div className="thinking">
      <div className="thinking-head" onClick={() => setOpen((v) => !v)}>
        {open ? <DownOutlined style={{ fontSize: 10 }} /> : <RightOutlined style={{ fontSize: 10 }} />}
        <span>{streaming ? '正在思考…' : '思考过程'}</span>
        {!streaming && durationMs > 0 && <span style={{ opacity: 0.6 }}>· {(durationMs / 1000).toFixed(1)}s</span>}
      </div>
      {open && <div className="thinking-body">{text}</div>}
    </div>
  )
}

export default function MessageItem({ msg, index, onRegenerate, onDelete, onEdit, isStreaming, isLast }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(msg.content || '')
  const [showMetrics, setShowMetrics] = useState(false)

  if (msg.type === 'clear') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0', color: 'var(--text-3)', fontSize: 12 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--panel-border)' }} />
        上下文已清除
        <div style={{ flex: 1, height: 1, background: 'var(--panel-border)' }} />
      </div>
    )
  }

  const isUser = msg.role === 'user'
  const streaming = isStreaming || msg.status === 'pending' || msg.status === 'sending'
  const images = (msg.files || []).filter((f) => (f.mime || '').startsWith('image/'))
  const metrics = msg.metrics || {}
  const usage = msg.usage || {}

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content || '')
      message.success('已复制')
    } catch {
      message.error('复制失败')
    }
  }

  const saveEdit = async () => {
    await onEdit?.(msg.id, { content: draft })
    setEditing(false)
  }

  return (
    <div className={`msg ${isUser ? 'user' : 'assistant'}`}>
      {!isUser && (
        <div className="msg-avatar">{isUser ? <UserOutlined /> : '🤖'}</div>
      )}
      <div className="msg-body">
        <div className="msg-meta">
          {isUser ? (
            <>
              <span>{dayjs(msg.createdAt).format('HH:mm')}</span>
              <UserOutlined />
            </>
          ) : (
            <>
              <Tooltip title={`${msg.providerId || ''} / ${msg.modelId || ''}`}>
                <span style={{ cursor: 'default' }}>{msg.modelId || '模型'}</span>
              </Tooltip>
              {msg.groupIndex > 0 && <span>#{msg.groupIndex + 1}</span>}
              <span>{dayjs(msg.createdAt).format('HH:mm')}</span>
              {(usage.total_tokens || usage.input_tokens) && (
                <span style={{ cursor: 'pointer' }} onClick={() => setShowMetrics((v) => !v)}>
                  <ClockCircleOutlined /> {usage.total_tokens || (usage.input_tokens || 0) + (usage.output_tokens || 0)}
                </span>
              )}
            </>
          )}
        </div>

        {showMetrics && !isUser && (
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 6, lineHeight: 1.8 }}>
            输入 {usage.input_tokens ?? '-'} tokens · 输出 {usage.output_tokens ?? '-'} tokens
            {usage.cache_read_tokens ? ` · 缓存命中 ${usage.cache_read_tokens}` : ''}
            <br />
            首字 {metrics.time_first_token_millsec != null ? `${metrics.time_first_token_millsec}ms` : '-'} ·
            思考 {metrics.thought_time_millsec ? `${(metrics.thought_time_millsec / 1000).toFixed(1)}s` : '0s'} ·
            总耗时 {metrics.time_completion_millsec ? `${(metrics.time_completion_millsec / 1000).toFixed(1)}s` : '-'} ·
            速度 {metrics.chars_per_second || '-'} 字/秒
          </div>
        )}

        {images.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
            <Image.PreviewGroup>
              {images.map((f) => (
                <Image key={f.id} src={api.files.rawUrl(f.id)} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 8 }} />
              ))}
            </Image.PreviewGroup>
          </div>
        )}

        <div className="msg-bubble">
          {!isUser && <Thinking text={msg.reasoningContent} durationMs={metrics.thought_time_millsec || 0} streaming={streaming && !msg.content} />}
          {editing ? (
            <div>
              <Input.TextArea value={draft} onChange={(e) => setDraft(e.target.value)} autoSize={{ minRows: 3, maxRows: 14 }} />
              <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                <Button size="small" onClick={() => { setEditing(false); setDraft(msg.content || '') }}>取消</Button>
                <Button size="small" type="primary" onClick={saveEdit}>保存</Button>
              </div>
            </div>
          ) : (
            <Markdown content={msg.content} streaming={streaming && isLast} />
          )}
          {msg.status === 'sending' && !msg.content && !msg.reasoningContent && (
            <span style={{ color: 'var(--text-3)', fontSize: 13 }}>正在请求模型…</span>
          )}
        </div>

        {!isUser && <ChatEvidence msg={msg} streaming={streaming} />}
        {msg.status === 'error' && (
          <Alert
            style={{ marginTop: 8 }}
            type="error"
            showIcon
            message="请求失败"
            description={msg.error || '未知错误'}
            action={<Button size="small" danger onClick={() => onRegenerate?.(msg)}>重试</Button>}
          />
        )}

        {!editing && (
          <div className="msg-tools" style={{ justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
            <Tooltip title="复制">
              <button className="msg-tool" onClick={copy}><CopyOutlined /></button>
            </Tooltip>
            <Tooltip title={isUser ? '编辑' : '编辑'}>
              <button className="msg-tool" onClick={() => { setDraft(msg.content || ''); setEditing(true) }}><EditOutlined /></button>
            </Tooltip>
            {!isUser && (
              <Tooltip title="重新生成">
                <button className="msg-tool" onClick={() => onRegenerate?.(msg)}><ReloadOutlined /></button>
              </Tooltip>
            )}
            <Tooltip title="删除">
              <button
                className="msg-tool"
                onClick={() =>
                  Modal.confirm({
                    title: '删除这条消息？',
                    content: msg.groupId ? '该消息属于多模型对比组，整组都会被删除。' : undefined,
                    okText: '删除',
                    okButtonProps: { danger: true },
                    cancelText: '取消',
                    onOk: () => onDelete?.(msg)
                  })
                }
              >
                <DeleteOutlined />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
      {isUser && <div className="msg-avatar"><UserOutlined /></div>}
    </div>
  )
}
