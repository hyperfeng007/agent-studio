/**
 * Built-in model service (模型服务) registry.
 *
 * Shape of every record mirrors the fields Cherry Studio keeps for a provider
 * and for a model, so the settings screen of this clone can be filled with the
 * same data the original ships with:
 *
 *   provider: { id, name, type, apiHost, website, docs, apiKeyUrl, searchUrl, isSystem, models[] }
 *   model:    { id, name, provider, group, capabilities[], contextLength, maxTokens, pricing }
 *
 * `type` selects the request adapter used by server/llm/index.js:
 *   openai            -> POST {apiHost}/chat/completions      (SSE)
 *   openai-response   -> POST {apiHost}/responses             (SSE)
 *   anthropic         -> POST {apiHost}/messages              (SSE)
 *   gemini            -> POST {apiHost}/models/{id}:streamGenerateContent
 *   azure             -> POST {apiHost}/openai/deployments/{id}/chat/completions?api-version=
 */

const M = (id, extra = {}) => ({
  id,
  name: id,
  capabilities: ['text'],
  contextLength: undefined,
  maxTokens: undefined,
  ...extra
})

const TEXT = ['text']
const THINK = ['text', 'reasoning']
const VISION = ['text', 'vision']
const VISION_THINK = ['text', 'vision', 'reasoning']

export const PROVIDERS = [
  {
    id: 'opencode-free',
    name: 'OpenCode Zen（免费额度）',
    type: 'openai',
    apiHost: 'https://opencode.ai/zen/v1',
    website: 'https://opencode.ai/zen/',
    docs: 'https://opencode.ai/docs/zen/',
    apiKeyUrl: 'https://opencode.ai/auth',
    searchUrl: 'https://opencode.ai/zen/models/{model}',
    isSystem: true,
    /** 免 API Key：优先复用本机 OpenCode CLI 的登录凭据，没有就不带 Key 直接请求。 */
    keyOptional: true,
    keyChain: 'opencode-cli',
    /** GET /models 免 Key 也能通，用它「检查」会误报成功，所以连通性检查直接发一次 1 token 对话。 */
    checkViaChat: true,
    note:
      '默认服务商，无需填 API Key。OpenCode Zen 是 OpenAI 兼容网关，免费层模型（id 以 -free 结尾，以及 big-pickle）对第三方客户端返回 403「OpenCode\'s free tier can only be used from within OpenCode」——因此：① 本机装过 OpenCode CLI 并登录过的，Agent Studio 会自动读取 ~/.local/share/opencode/auth.json 复用凭据；② 否则请到 https://opencode.ai/auth 免费注册一个 Zen API Key 填进来；③ 只想离线试用可在下面开启「本地演示 (Mock)」。点「获取模型列表」可免 Key 拉取 Zen 的全部 71 个模型（非免费模型需要 Zen 余额）。',
    models: [
      M('big-pickle', { name: 'Big Pickle（免费）', capabilities: TEXT }),
      M('mimo-v2.5-free', { name: 'MiMo v2.5（免费）', capabilities: TEXT }),
      M('nemotron-3-ultra-free', { name: 'Nemotron 3 Ultra（免费）', capabilities: TEXT }),
      M('nemotron-3.5-lightning-free', { name: 'Nemotron 3.5 Lightning（免费）', capabilities: TEXT }),
      M('ling-3.0-flash-fin-free', { name: 'Ling 3.0 Flash Fin（免费）', capabilities: TEXT }),
      M('muse-spark-1.3-contributor-free', { name: 'Muse Spark 1.3 Contributor（免费）', capabilities: TEXT }),
      M('muse-spark-1.2-contributor-free', { name: 'Muse Spark 1.2 Contributor（免费）', capabilities: TEXT }),
      // 实测（2026-09）该模型上游返回 400「Model is unavailable」，保留在列表里等它恢复。
      M('deepseek-v4-flash-free', { name: 'DeepSeek V4 Flash（免费，上游暂不可用）', capabilities: TEXT })
    ]
  },
  {
    id: 'mock',
    name: '本地演示 (Mock)',
    type: 'openai',
    apiHost: 'builtin://mock',
    isSystem: true,
    note: '离线演示通道：不联网、不需要 API Key，用于在没有密钥时验证对话链路。可关闭。',
    models: [
      M('mock-chat', { name: 'Mock Chat', capabilities: TEXT, contextLength: 32768, maxTokens: 4096 }),
      M('mock-vision', { name: 'Mock Vision', capabilities: VISION, contextLength: 32768 }),
      M('mock-reasoning', { name: 'Mock Reasoning', capabilities: THINK, contextLength: 32768 })
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    apiHost: 'https://api.openai.com',
    website: 'https://openai.com',
    docs: 'https://platform.openai.com/docs/api-reference',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    searchUrl: 'https://platform.openai.com/docs/models/{model}',
    isSystem: true,
    models: [
      M('gpt-5.2', { capabilities: VISION_THINK, contextLength: 400000, maxTokens: 128000 }),
      M('gpt-5-mini', { capabilities: VISION_THINK, contextLength: 400000 }),
      M('gpt-4.1', { capabilities: VISION, contextLength: 1047576 }),
      M('gpt-4o', { capabilities: VISION, contextLength: 128000 }),
      M('o3', { capabilities: VISION_THINK, contextLength: 200000 }),
      M('text-embedding-3-large', { capabilities: ['embedding'], contextLength: 8191 }),
      M('gpt-image-1', { capabilities: ['image-generation'] }),
      M('gpt-4o-mini-tts', { capabilities: ['tts'] })
    ]
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'anthropic',
    apiHost: 'https://api.anthropic.com',
    website: 'https://anthropic.com',
    docs: 'https://docs.anthropic.com/en/api/messages',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    searchUrl: 'https://docs.anthropic.com/en/docs/about-claude/models/{model}',
    isSystem: true,
    models: [
      M('claude-opus-4-5', { capabilities: VISION_THINK, contextLength: 200000, maxTokens: 64000 }),
      M('claude-sonnet-4-5', { capabilities: VISION_THINK, contextLength: 200000, maxTokens: 64000 }),
      M('claude-haiku-4-5', { capabilities: VISION_THINK, contextLength: 200000 }),
      M('claude-3-7-sonnet-latest', { capabilities: VISION_THINK, contextLength: 200000 })
    ]
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    type: 'gemini',
    apiHost: 'https://generativelanguage.googleapis.com',
    website: 'https://ai.google.dev',
    docs: 'https://ai.google.dev/api',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    searchUrl: 'https://ai.google.dev/gemini-api/docs/models/{model}',
    isSystem: true,
    models: [
      M('gemini-3-pro-preview', { capabilities: VISION_THINK, contextLength: 1048576 }),
      M('gemini-3-flash-preview', { capabilities: VISION_THINK, contextLength: 1048576 }),
      M('gemini-2.5-pro', { capabilities: VISION_THINK, contextLength: 1048576 }),
      M('gemini-2.5-flash', { capabilities: VISION_THINK, contextLength: 1048576 }),
      M('gemini-2.5-flash-image', { capabilities: ['image-generation', 'vision'] }),
      M('gemini-embedding-001', { capabilities: ['embedding'] })
    ]
  },
  {
    id: 'azure',
    name: 'Azure OpenAI',
    type: 'azure',
    apiHost: 'https://{resource}.openai.azure.com',
    website: 'https://azure.microsoft.com/products/ai-services/openai-service',
    isSystem: true,
    models: [M('gpt-4o', { capabilities: VISION, contextLength: 128000 })]
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'openai',
    apiHost: 'https://api.deepseek.com',
    website: 'https://deepseek.com',
    docs: 'https://api-docs.deepseek.com',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    searchUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    isSystem: true,
    models: [
      M('deepseek-chat', { name: 'DeepSeek Chat (V3)', capabilities: TEXT, contextLength: 64000, maxTokens: 8192 }),
      M('deepseek-reasoner', { name: 'DeepSeek Reasoner (R1)', capabilities: THINK, contextLength: 64000 })
    ]
  },
  {
    id: 'silicon',
    name: '硅基流动',
    type: 'openai',
    apiHost: 'https://api.siliconflow.cn',
    website: 'https://www.siliconflow.cn',
    apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
    searchUrl: 'https://cloud.siliconflow.cn/model-market',
    isSystem: true,
    models: [
      M('deepseek-ai/DeepSeek-V3', { capabilities: TEXT, contextLength: 64000 }),
      M('deepseek-ai/DeepSeek-R1', { capabilities: THINK, contextLength: 64000 }),
      M('Qwen/Qwen3-Coder-480B-A35B-Instruct', { capabilities: TEXT, contextLength: 262144 }),
      M('Qwen/Qwen2.5-VL-72B-Instruct', { capabilities: VISION, contextLength: 131072 }),
      M('Pro/deepseek-ai/DeepSeek-R1', { capabilities: THINK, free: true })
    ]
  },
  {
    id: 'qwenlm',
    name: '阿里云百炼',
    type: 'openai',
    apiHost: 'https://dashscope.aliyuncs.com/compatible-mode',
    website: 'https://www.aliyun.com/product/bailian',
    apiKeyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    isSystem: true,
    models: [
      M('qwen-max', { capabilities: TEXT, contextLength: 32768 }),
      M('qwen-plus', { capabilities: TEXT, contextLength: 131072 }),
      M('qwen3-coder-plus', { capabilities: TEXT, contextLength: 262144 }),
      M('qwen-vl-max', { capabilities: VISION, contextLength: 32768 }),
      M('text-embedding-v3', { capabilities: ['embedding'] })
    ]
  },
  {
    id: 'moonshot',
    name: 'Kimi (月之暗面)',
    type: 'openai',
    apiHost: 'https://api.moonshot.cn',
    website: 'https://www.moonshot.cn',
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
    isSystem: true,
    models: [
      M('kimi-k2-turbo-preview', { capabilities: TEXT, contextLength: 262144 }),
      M('kimi-thinking-preview', { capabilities: THINK, contextLength: 262144 }),
      M('moonshot-v1-128k-vision-preview', { capabilities: VISION, contextLength: 128000 })
    ]
  },
  {
    id: 'zhipu',
    name: '智谱 AI',
    type: 'openai',
    apiHost: 'https://open.bigmodel.cn/api/paas',
    website: 'https://open.bigmodel.cn',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    isSystem: true,
    models: [
      M('glm-4.6', { capabilities: TEXT, contextLength: 200000 }),
      M('glm-4.5', { capabilities: TEXT, contextLength: 131072 }),
      M('glm-4v-plus', { capabilities: VISION, contextLength: 8192 }),
      M('embedding-3', { capabilities: ['embedding'] })
    ]
  },
  {
    id: 'hunyuan',
    name: '腾讯混元',
    type: 'openai',
    apiHost: 'https://api.lkeap.cloud.tencent.com/api/v3',
    website: 'https://cloud.tencent.com/product/hunyuan',
    isSystem: true,
    models: [
      M('hunyuan-turbo-latest', { capabilities: TEXT, contextLength: 131072 }),
      M('hunyuan-t1-latest', { capabilities: THINK, contextLength: 64000 })
    ]
  },
  {
    id: 'doubao',
    name: '豆包 (火山引擎)',
    type: 'openai',
    apiHost: 'https://ark.cn-beijing.volces.com/api/v3',
    website: 'https://www.volcengine.com/product/doubao',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    isSystem: true,
    models: [
      M('doubao-seed-1-6-251015', { capabilities: TEXT, contextLength: 262144 }),
      M('doubao-1-5-pro-32k', { capabilities: TEXT, contextLength: 32768 }),
      M('deepseek-v3-250324', { capabilities: TEXT, contextLength: 65536 })
    ]
  },
  {
    id: 'baichuan',
    name: '百川智能',
    type: 'openai',
    apiHost: 'https://api.baichuan-ai.com',
    website: 'https://www.baichuan-ai.com',
    isSystem: true,
    models: [M('Baichuan-M2', { capabilities: TEXT, contextLength: 128000 })]
  },
  {
    id: 'yi',
    name: '零一万物',
    type: 'openai',
    apiHost: 'https://api.lingyiwanwu.com',
    website: 'https://platform.lingyiwanwu.com',
    isSystem: true,
    models: [M('yi-lightning', { capabilities: TEXT, contextLength: 16384 })]
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    type: 'openai',
    apiHost: 'https://api.minimaxi.com',
    website: 'https://www.minimaxi.com',
    isSystem: true,
    models: [
      M('MiniMax-M2', { capabilities: TEXT, contextLength: 204800 }),
      M('abab6.5s-chat', { capabilities: TEXT, contextLength: 245760 })
    ]
  },
  {
    id: 'stepfun',
    name: '阶跃星辰',
    type: 'openai',
    apiHost: 'https://api.stepfun.com',
    website: 'https://platform.stepfun.com',
    isSystem: true,
    models: [M('step-2-16k', { capabilities: TEXT, contextLength: 16000 })]
  },
  {
    id: 'qianfan',
    name: '百度千帆',
    type: 'openai',
    apiHost: 'https://qianfan.baidubce.com/v2',
    website: 'https://console.bce.baidu.com/qianfan/overview',
    isSystem: true,
    models: [M('ernie-4.5-turbo-128k', { capabilities: TEXT, contextLength: 128000 })]
  },
  {
    id: 'modelscope',
    name: 'ModelScope 魔搭',
    type: 'openai',
    apiHost: 'https://api-inference.modelscope.cn/api',
    website: 'https://modelscope.cn',
    apiKeyUrl: 'https://modelscope.cn/my/myaccesstoken',
    isSystem: true,
    models: [M('Qwen/Qwen3-Coder-480B-A35B-Instruct', { capabilities: TEXT, free: true })]
  },
  {
    id: 'giteeai',
    name: 'Gitee AI',
    type: 'openai',
    apiHost: 'https://ai.gitee.com/api',
    website: 'https://ai.gitee.com',
    isSystem: true,
    models: [M('DeepSeek-R1', { capabilities: THINK, free: true })]
  },
  {
    id: 'xai',
    name: 'xAI',
    type: 'openai',
    apiHost: 'https://api.x.ai',
    website: 'https://x.ai',
    apiKeyUrl: 'https://console.x.ai',
    isSystem: true,
    models: [M('grok-4', { capabilities: TEXT, contextLength: 2000000 })]
  },
  {
    id: 'groq',
    name: 'Groq',
    type: 'openai',
    apiHost: 'https://api.groq.com/openai',
    website: 'https://groq.com',
    apiKeyUrl: 'https://console.groq.com/keys',
    isSystem: true,
    models: [
      M('llama-3.3-70b-versatile', { capabilities: TEXT, contextLength: 128000 }),
      M('gpt-oss-120b', { capabilities: THINK, contextLength: 128000 })
    ]
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openai',
    apiHost: 'https://openrouter.ai/api',
    website: 'https://openrouter.ai',
    apiKeyUrl: 'https://openrouter.ai/settings/keys',
    isSystem: true,
    models: [
      M('anthropic/claude-sonnet-4.5', { capabilities: VISION_THINK }),
      M('deepseek/deepseek-chat-v3', { capabilities: TEXT }),
      M('google/gemini-2.5-pro', { capabilities: VISION_THINK })
    ]
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    type: 'openai',
    apiHost: 'https://api.mistral.ai',
    website: 'https://mistral.ai',
    isSystem: true,
    models: [M('mistral-large-latest', { capabilities: TEXT, contextLength: 131072 })]
  },
  {
    id: 'together',
    name: 'Together AI',
    type: 'openai',
    apiHost: 'https://api.together.xyz',
    website: 'https://www.together.ai',
    isSystem: true,
    models: [M('deepseek-ai/DeepSeek-V3', { capabilities: TEXT })]
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    type: 'openai',
    apiHost: 'https://api.fireworks.ai/inference',
    website: 'https://fireworks.ai',
    isSystem: true,
    models: [M('accounts/fireworks/models/deepseek-v3', { capabilities: TEXT })]
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    type: 'openai',
    apiHost: 'https://integrate.api.nvidia.com',
    website: 'https://build.nvidia.com',
    isSystem: true,
    models: [M('deepseek-ai/deepseek-r1', { capabilities: THINK, free: true })]
  },
  {
    id: 'perplexity',
    name: 'Perplexity AI',
    type: 'openai',
    apiHost: 'https://api.perplexity.ai',
    website: 'https://www.perplexity.ai',
    isSystem: true,
    models: [M('sonar-pro', { capabilities: ['text', 'web-search'] })]
  },
  {
    id: 'ppio',
    name: 'PPIO 派欧云',
    type: 'openai',
    apiHost: 'https://api.ppio.com',
    website: 'https://www.ppio.com',
    isSystem: true,
    models: [M('deepseek/deepseek-v3.2-exp', { capabilities: TEXT })]
  },
  {
    id: 'infini',
    name: 'InfiniAI',
    type: 'openai',
    apiHost: 'https://cloud.infini-ai.com/maas',
    website: 'https://cloud.infini-ai.com',
    isSystem: true,
    models: [M('deepseek-ai/deepseek-r1', { capabilities: THINK })]
  },
  {
    id: 'aihubmix',
    name: 'AiHubMix',
    type: 'openai',
    apiHost: 'https://aihubmix.com',
    website: 'https://aihubmix.com',
    isSystem: true,
    models: [M('gpt-5.2', { capabilities: VISION_THINK })]
  },
  {
    id: 'newapi',
    name: 'New API',
    type: 'openai',
    apiHost: 'https://api.newapi.pro',
    website: 'https://docs.newapi.pro',
    isSystem: true,
    models: []
  },
  {
    id: '302ai',
    name: '302.AI',
    type: 'openai',
    apiHost: 'https://api.302.ai',
    website: 'https://302.ai',
    isSystem: true,
    models: []
  },
  {
    id: 'dmxapi',
    name: 'DMXAPI',
    type: 'openai',
    apiHost: 'https://www.dmxapi.cn',
    website: 'https://www.dmxapi.cn',
    isSystem: true,
    models: []
  },
  {
    id: 'ollama',
    name: 'Ollama',
    type: 'openai',
    apiHost: 'http://localhost:11434',
    website: 'https://ollama.com',
    docs: 'https://github.com/ollama/ollama/blob/main/docs/openai.md',
    isSystem: true,
    models: [
      M('qwen2.5:7b', { capabilities: TEXT }),
      M('llama3.1:8b', { capabilities: TEXT }),
      M('nomic-embed-text', { capabilities: ['embedding'] })
    ]
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    type: 'openai',
    apiHost: 'http://localhost:1234',
    website: 'https://lmstudio.ai',
    isSystem: true,
    models: []
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    type: 'openai',
    apiHost: 'https://api-inference.huggingface.co',
    website: 'https://huggingface.co',
    isSystem: true,
    models: [M('deepseek-ai/DeepSeek-R1', { capabilities: THINK, free: true })]
  },
  {
    id: 'jina',
    name: 'Jina AI',
    type: 'openai',
    apiHost: 'https://api.jina.ai',
    website: 'https://jina.ai',
    isSystem: true,
    models: [
      M('jina-embeddings-v3', { capabilities: ['embedding'] }),
      M('jina-reranker-v2', { capabilities: ['rerank'] })
    ]
  }
]

/** Provider types selectable when creating a custom provider (渠道类型). */
export const PROVIDER_TYPES = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'openai-response', label: 'OpenAI Responses' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'azure', label: 'Azure OpenAI' }
]

/** Model capability vocabulary shared by the settings screen and the chat UI. */
export const CAPABILITIES = [
  { value: 'text', label: '文本对话' },
  { value: 'vision', label: '视觉' },
  { value: 'reasoning', label: '推理' },
  { value: 'embedding', label: '嵌入' },
  { value: 'rerank', label: '重排序' },
  { value: 'image-generation', label: '图像生成' },
  { value: 'tts', label: '语音合成' },
  { value: 'stt', label: '语音识别' },
  { value: 'web-search', label: '联网搜索' },
  { value: 'function_calling', label: '函数调用' }
]

export function builtinProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || null
}

export function builtinModels(providerId) {
  return (builtinProvider(providerId)?.models || []).map((m) => ({ ...m, provider: providerId }))
}
