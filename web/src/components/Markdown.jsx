import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { message } from 'antd'
import { CopyOutlined, CheckOutlined } from '@ant-design/icons'

function CodeBlock({ className, children, ...rest }) {
  const [copied, setCopied] = useState(false)
  const text = String(children ?? '').replace(/\n$/, '')
  const lang = /language-(\w+)/.exec(className || '')?.[1] || ''
  // react-markdown v9 renders fenced code as <pre><code>, inline code as bare <code>
  const inline = !className && !text.includes('\n')
  if (inline) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    )
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      message.error('复制失败')
    }
  }
  return (
    <div>
      <div className="code-head">
        <span className="lang">{lang || 'text'}</span>
        <button onClick={copy}>{copied ? <CheckOutlined /> : <CopyOutlined />} {copied ? '已复制' : '复制'}</button>
      </div>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  )
}

function Markdown({ content, streaming = false }) {
  return (
    <div className={`md ${streaming ? 'cursor-blink' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code: CodeBlock,
          a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />
        }}
      >
        {content || ''}
      </ReactMarkdown>
    </div>
  )
}

export default memo(Markdown)
