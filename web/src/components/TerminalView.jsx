import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

/**
 * xterm.js view bridged to a server-side PTY session over WebSocket.
 * The CLI process keeps running after a page refresh; reconnecting replays the
 * scrollback the server kept for the session.
 */
export default function TerminalView({ sessionId, onClose, title, onKill }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const [killing, setKilling] = useState(false)
  const wsRef = useRef(null)
  const [status, setStatus] = useState('connecting')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!sessionId || !hostRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      // 字体栈里必须带中文字体：Consolas / SF Mono 都没有 CJK 字形，缺字时浏览器会
      // 逐字回退到默认中文字体（非等宽），字形宽度和 xterm 的两格宽对不上，中文看起来
      // 就会错位/挤在一起。拉丁字符仍然由前面的等宽字体渲染，度量不受影响。
      fontFamily:
        "'SF Mono', Menlo, Consolas, 'Cascadia Mono', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans Mono CJK SC', 'Source Han Mono SC', 'Courier New', monospace",
      lineHeight: 1.25,
      scrollback: 8000,
      allowProposedApi: true,
      theme: {
        background: '#101010',
        foreground: '#e6e6e6',
        cursor: '#ff5f56',
        selectionBackground: 'rgba(255,95,86,0.28)',
        black: '#1a1a1a', red: '#ff5f56', green: '#5af78e', yellow: '#f3f99d',
        blue: '#57c7ff', magenta: '#ff6ac1', cyan: '#9aedfe', white: '#e6e6e6'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    try {
      fit.fit()
    } catch {}
    termRef.current = term

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/terminal?session=${encodeURIComponent(sessionId)}`)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }
    ws.onmessage = (ev) => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.type === 'hello') {
        term.reset()
        if (msg.history) term.write(msg.history)
        if (msg.exited) setStatus('exited')
        try {
          doFit()
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
        } catch {}
      } else if (msg.type === 'output') {
        term.write(msg.data)
      } else if (msg.type === 'exit') {
        term.write(`\r\n\x1b[2m[进程已退出，code=${msg.code}]\x1b[0m\r\n`)
        setStatus('exited')
      } else if (msg.type === 'error') {
        setError(msg.message)
        setStatus('error')
      }
    }
    ws.onerror = () => {
      setError('终端连接失败（WebSocket）')
      setStatus('error')
    }
    ws.onclose = () => setStatus((s) => (s === 'connected' ? 'closed' : s))

    const dataSub = term.onData((data) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'input', data }))
    })
    const resizeSub = term.onResize(({ cols, rows }) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'resize', cols, rows }))
    })

    /* ---------------- 中文输入法（IME）导致的位移 ----------------
     * 现象：在终端里打中文，整个窗口会向左跳一下（像被缩进）。
     * 原因有两个，都在这一层修掉：
     *  1) xterm 的隐藏输入框 .xterm-helper-textarea 平时停在 left:-9999em，
     *     输入法开始组合时浏览器要「把获得焦点的元素滚进可视区」，于是滚动最近的
     *     可滚动祖先。祖先即使写了 overflow:hidden 也**仍然可以被程序/焦点滚动**，
     *     横向就被拽过去了。→ 捕获阶段监听 scroll，把终端祖先链上的横向滚动一律归零
     *     （纵向页面滚动是合法的，不动）；同时把留在屏幕外的输入框夹回盒子内。
     *  2) 组合期间 DOM 尺寸抖动触发 ResizeObserver → fit() 反复重排，TUI 会按新宽度
     *     重画，看起来也像窗口在动。→ fit 去抖 80ms，组合期间不重排，组合结束再 fit 一次。
     */
    const host = hostRef.current
    let composing = false
    let fitTimer = null

    const doFit = () => {
      try {
        fit.fit()
      } catch {}
    }
    const scheduleFit = () => {
      clearTimeout(fitTimer)
      fitTimer = setTimeout(() => {
        if (composing) return // 组合结束后 onCompEnd 会再调一次
        doFit()
      }, 80)
    }

    const ancestors = []
    for (let el = host; el; el = el.parentElement) ancestors.push(el)

    const clampHorizontalScroll = () => {
      for (const el of ancestors) {
        if (el && el.scrollLeft) el.scrollLeft = 0
      }
      const viewport = host.querySelector('.xterm-viewport')
      if (viewport && viewport.scrollLeft) viewport.scrollLeft = 0
    }

    const clampTextarea = () => {
      const ta = host.querySelector('.xterm-helper-textarea')
      if (!ta) return
      // xterm 组合时会自己把它移到光标处（合法）；只处理「留在屏幕外」的情况。
      const l = parseFloat(ta.style.left)
      if (!Number.isFinite(l) || l < 0 || l > host.clientWidth) ta.style.left = '0px'
      const t = parseFloat(ta.style.top)
      if (!Number.isFinite(t) || t < 0 || t > host.clientHeight) ta.style.top = '0px'
    }

    const onScrollCapture = (e) => {
      const t = e.target
      if (t instanceof Element && t.classList && t.classList.contains('xterm-viewport')) {
        if (t.scrollLeft) t.scrollLeft = 0 // 纵向滚动合法，横向不允许
        return
      }
      clampHorizontalScroll()
    }
    const onCompStart = () => {
      composing = true
      clampTextarea()
    }
    const onCompEnd = () => {
      composing = false
      clampHorizontalScroll()
      scheduleFit()
    }
    const onFocusIn = () => clampTextarea()

    document.addEventListener('scroll', onScrollCapture, true)
    host.addEventListener('compositionstart', onCompStart, true)
    host.addEventListener('compositionend', onCompEnd, true)
    host.addEventListener('focusin', onFocusIn, true)

    const observer = new ResizeObserver(scheduleFit)
    observer.observe(host)

    const focusTimer = setTimeout(() => {
      clampTextarea()
      term.focus()
    }, 120)

    return () => {
      clearTimeout(focusTimer)
      clearTimeout(fitTimer)
      document.removeEventListener('scroll', onScrollCapture, true)
      host.removeEventListener('compositionstart', onCompStart, true)
      host.removeEventListener('compositionend', onCompEnd, true)
      host.removeEventListener('focusin', onFocusIn, true)
      observer.disconnect()
      dataSub.dispose()
      resizeSub.dispose()
      try {
        ws.close()
      } catch {}
      term.dispose()
      termRef.current = null
    }
  }, [sessionId])

  const statusText = {
    connecting: '连接中…',
    connected: '已连接',
    exited: '进程已退出',
    closed: '连接已断开',
    error: error || '连接异常'
  }[status]

  return (
    <div className="terminal-panel">
      <div className="terminal-head">
        <span style={{ fontWeight: 600 }}>{title || '终端'}</span>
        <span
          style={{
            fontSize: 11, padding: '1px 7px', borderRadius: 10,
            background: status === 'connected' ? 'rgba(90,247,142,.16)' : 'rgba(255,255,255,.08)',
            color: status === 'connected' ? '#5af78e' : '#aaa'
          }}
        >
          {statusText}
        </span>
        <div style={{ flex: 1 }} />
        <button
          className="msg-tool"
          style={{ color: killing ? '#666' : '#bbb', cursor: killing ? 'wait' : 'pointer' }}
          disabled={killing}
          onClick={async () => {
            // 只走 HTTP：它会返回「进程树是否真的没了」，WebSocket 那条没有回执，
            // 两条一起发还会重复终止。失败时把服务端给的原因显示出来。
            setKilling(true)
            try {
              await onKill?.()
            } finally {
              setKilling(false)
            }
          }}
        >
          {killing ? '终止中…' : '终止进程'}
        </button>
        <button className="msg-tool" style={{ color: '#bbb' }} onClick={() => termRef.current?.clear?.()}>清屏</button>
        <button className="msg-tool" style={{ color: '#bbb' }} onClick={onClose}>返回配置</button>
      </div>
      <div className="terminal-body" ref={hostRef} />
    </div>
  )
}
