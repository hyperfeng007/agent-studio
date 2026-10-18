import KnowledgePage from './pages/knowledge/KnowledgePage'
import { useEffect, useMemo } from 'react'
import { useSelector } from 'react-redux'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider, App as AntApp, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import Navbar from './components/Navbar'
import ChatPage from './pages/chat/ChatPage'
import MinAppsPage from './pages/minapps/MinAppsPage'
import CodeCliPage from './pages/codecli/CodeCliPage'
import SettingsPage from './pages/settings/SettingsPage'
import { lightTokens, darkTokens, components, cssVars } from './theme'

export default function App() {
  const dark = useSelector((s) => s.settings.dark)
  const fontSize = useSelector((s) => s.settings.data.fontSize) || 14

  useEffect(() => {
    const vars = cssVars(dark)
    const root = document.documentElement
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
    root.style.setProperty('--cs-primary', dark ? '#ff5f56' : '#f5222d')
    root.style.setProperty('color-scheme', dark ? 'dark' : 'light')
    root.style.fontSize = `${fontSize}px`
    document.body.style.background = dark ? '#141414' : '#ffffff'
    document.body.style.color = vars['--text-1']
  }, [dark, fontSize])

  const themeConfig = useMemo(
    () => ({
      algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: { ...(dark ? darkTokens : lightTokens), fontSize },
      components
    }),
    [dark, fontSize]
  )

  return (
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <AntApp>
        <HashRouter>
          <div className="app-shell">
            <Navbar />
            <Routes>
              <Route path="/" element={<Navigate to="/chat" replace />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/knowledge" element={<KnowledgePage />} />
              <Route path="/mcp" element={<Navigate to="/settings/mcp" replace />} />
              <Route path="/minapps" element={<MinAppsPage />} />
              <Route path="/codecli" element={<CodeCliPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/:section" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/chat" replace />} />
            </Routes>
          </div>
        </HashRouter>
      </AntApp>
    </ConfigProvider>
  )
}
