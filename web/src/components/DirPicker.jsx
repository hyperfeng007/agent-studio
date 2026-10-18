import { useEffect, useState } from 'react'
import { Button, Input, Modal, Spin, message } from 'antd'
import { FolderOutlined, HomeOutlined, ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons'
import api from '../api'

/**
 * Server-side directory browser. The web build has no native folder dialog, so
 * 工作目录 is chosen through this modal (the Electron original would call
 * dialog.showOpenDialog instead).
 */
export default function DirPicker({ open, value, onCancel, onOk }) {
  const [cwd, setCwd] = useState(value || '')
  const [entries, setEntries] = useState([])
  const [parent, setParent] = useState('')
  const [loading, setLoading] = useState(false)

  const load = async (target) => {
    setLoading(true)
    try {
      const res = await api.codecli.fsList(target || value || '')
      setCwd(res.path)
      setEntries(res.dirs || [])
      setParent(res.parent)
    } catch (err) {
      message.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) load(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Modal
      open={open}
      title="选择工作目录"
      width={560}
      okText="选择该目录"
      cancelText="取消"
      onCancel={onCancel}
      onOk={() => onOk(cwd)}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' }}>
        <Button size="small" type="text" icon={<ArrowLeftOutlined />} onClick={() => load(parent)} disabled={!parent || parent === cwd} />
        <Input
          size="small"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          onPressEnter={() => load(cwd)}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
        <Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => load(cwd)} />
      </div>

      <Spin spinning={loading}>
        <div className="dir-picker-list">
          {entries.length === 0 && (
            <div style={{ padding: 18, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>该目录下没有子文件夹</div>
          )}
          {entries.map((d) => (
            <div className="dir-item" key={d.path} onDoubleClick={() => load(d.path)} onClick={() => setCwd(d.path)}>
              <FolderOutlined style={{ color: '#e8b339' }} />
              <span style={{ flex: 1 }}>{d.name}</span>
              <Button size="small" type="link" onClick={() => load(d.path)}>进入</Button>
            </div>
          ))}
        </div>
      </Spin>

      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button size="small" icon={<HomeOutlined />} onClick={() => load('~')}>用户主目录</Button>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>双击进入目录，单击选中</span>
      </div>
      <div className="dir-path" style={{ marginTop: 8 }}>{cwd}</div>
    </Modal>
  )
}
