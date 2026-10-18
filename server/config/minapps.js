/**
 * Built-in Mini Apps (小程序) registry.
 *
 * Same record shape Cherry Studio uses for a mini app:
 *   { id, name, logo, url, key?, openExternal?, style?, addTime? }
 *
 * Users can add their own (name + url + icon), reorder, hide or pin them;
 * custom entries live in the `minapps` table of the local store.
 */
export const MINAPPS = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/' },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  { id: 'kimi', name: 'Kimi', url: 'https://www.kimi.com/' },
  { id: 'doubao', name: '豆包', url: 'https://www.doubao.com/chat/' },
  { id: 'yuanbao', name: '腾讯元宝', url: 'https://yuanbao.tencent.com/' },
  { id: 'wenxin', name: '文心一言', url: 'https://yiyan.baidu.com/' },
  { id: 'tongyi', name: '通义千问', url: 'https://tongyi.aliyun.com/qianwen/' },
  { id: 'tiangong', name: '天工', url: 'https://www.tiangong.cn/' },
  { id: 'hailuo', name: '海螺 AI', url: 'https://hailuoai.com/' },
  { id: 'metaso', name: '秘塔 AI 搜索', url: 'https://metaso.cn/' },
  { id: 'zhida', name: '知乎直答', url: 'https://zhida.zhihu.com/' },
  { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/' },
  { id: 'grok', name: 'Grok', url: 'https://grok.com/' },
  { id: 'poe', name: 'Poe', url: 'https://poe.com/' },
  { id: 'notebooklm', name: 'NotebookLM', url: 'https://notebooklm.google.com/' },
  { id: 'copilot', name: 'GitHub Copilot', url: 'https://github.com/features/copilot' },
  { id: 'v0', name: 'v0 by Vercel', url: 'https://v0.app/' },
  { id: 'bolt', name: 'Bolt.new', url: 'https://bolt.new/' },
  { id: 'lovable', name: 'Lovable', url: 'https://lovable.dev/' },
  { id: 'replit', name: 'Replit', url: 'https://replit.com/' },
  { id: 'codesandbox', name: 'CodeSandbox', url: 'https://codesandbox.io/' },
  { id: 'stackblitz', name: 'StackBlitz', url: 'https://stackblitz.com/' },
  { id: 'jsfiddle', name: 'JSFiddle', url: 'https://jsfiddle.net/' },
  { id: 'codepen', name: 'CodePen', url: 'https://codepen.io/' },
  { id: 'huggingchat', name: 'HuggingChat', url: 'https://huggingface.co/chat/' },
  { id: 'mistral', name: 'Le Chat', url: 'https://chat.mistral.ai/' },
  { id: 'you', name: 'You.com', url: 'https://you.com/' },
  { id: 'devv', name: 'Devv', url: 'https://devv.ai/' },
  { id: 'thinkany', name: 'ThinkAny', url: 'https://thinkany.ai/' },
  { id: 'suno', name: 'Suno', url: 'https://suno.com/' },
  { id: 'midjourney', name: 'Midjourney', url: 'https://www.midjourney.com/' },
  { id: '302ai', name: '302.AI', url: 'https://302.ai/' }
]

export function builtinMinApp(id) {
  return MINAPPS.find((m) => m.id === id) || null
}
