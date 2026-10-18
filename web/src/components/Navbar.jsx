import { useDispatch, useSelector } from 'react-redux'
import { useNavigate, useLocation } from 'react-router-dom'
import { Tooltip } from 'antd'
import {
  MessageOutlined, AppstoreOutlined, CodeOutlined, SettingOutlined,
  MoonOutlined, SunOutlined, DatabaseOutlined
} from '@ant-design/icons'
import { setDark, saveSettings } from '../store'

const ITEMS = [
  { key: '/chat', label: '对话', icon: <MessageOutlined /> },
  { key: '/minapps', label: '小程序', icon: <AppstoreOutlined /> },
  { key: '/codecli', label: '主流智能体', icon: <CodeOutlined /> },
  { key: '/knowledge', label: '知识库', icon: <DatabaseOutlined /> }
]

export default function Navbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const dispatch = useDispatch()
  const dark = useSelector((s) => s.settings.dark)
  const active = '/' + (location.pathname.split('/')[1] || 'chat')

  const toggleTheme = () => {
    const next = !dark
    dispatch(setDark(next))
    dispatch(saveSettings({ theme: next ? 'dark' : 'light' }))
  }

  return (
    <nav className="navbar">
      <Tooltip title="Agent Studio" placement="right">
        <div className="navbar-logo" onClick={() => navigate('/chat')}>🤖</div>
      </Tooltip>

      {ITEMS.map((item) => (
        <div
          key={item.key}
          className={`navbar-item ${active === item.key ? 'active' : ''}`}
          onClick={() => navigate(item.key)}
        >
          {item.icon}
          <span className="tip">{item.label}</span>
        </div>
      ))}

      <div className="navbar-spacer" />

      <div className="navbar-item" onClick={toggleTheme}>
        {dark ? <SunOutlined /> : <MoonOutlined />}
        <span className="tip">{dark ? '浅色模式' : '深色模式'}</span>
      </div>
      <div
        className={`navbar-item ${active === '/settings' ? 'active' : ''}`}
        onClick={() => navigate('/settings/model-service')}
      >
        <SettingOutlined />
        <span className="tip">设置</span>
      </div>
    </nav>
  )
}
