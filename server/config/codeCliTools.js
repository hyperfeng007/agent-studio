/**
 * 主流智能体 (Code CLI) tool registry.
 *
 * Each record describes how Cherry Studio manages one coding CLI:
 *   - how to detect / install / update / remove it
 *   - which model-service interface types are compatible (the provider picker
 *     in the UI is filtered by `interfaces`, incompatible providers are not listed)
 *   - whether the tool uses its own account login instead of a provider
 *   - the extra per-tool options shown in the 配置 panel
 *   - how to turn (provider + model + options) into env vars and CLI arguments
 *
 * `interfaces` uses the same adapter names as server/config/providers.js.
 */

import fs from 'node:fs'
import os from 'node:os'
import { load as yamlLoad, dump as yamlDump } from 'js-yaml'
import path from 'node:path'

const stripV1 = (u = '') => u.replace(/\/+$/, '').replace(/\/v1$/, '')

/**
 * OpenClaw keeps its config in ~/.openclaw/openclaw.json, which the docs write
 * as JSON5 (line comments, block comments, trailing commas). JSON.parse is not
 * enough — but blindly rewriting the file would destroy a hand-written config,
 * so this stripper is deliberately conservative: comments are only removed
 * outside string literals, and if the result still does not parse the caller
 * leaves the user's file untouched and says so in the terminal.
 */
function parseJson5ish(text) {
  let out = ''
  let i = 0
  const identStart = (c) => /[A-Za-z_$]/.test(c)
  const identPart = (c) => /[\w$]/.test(c)

  while (i < text.length) {
    const c = text[i]

    // --- string literal: keep double quotes, convert single quotes ---
    if (c === '"' || c === "'") {
      const q = c
      i++
      let body = ''
      while (i < text.length && text[i] !== q) {
        if (text[i] === '\\') {
          body += text[i] + (text[i + 1] === undefined ? '' : text[i + 1])
          i += 2
          continue
        }
        body += text[i]
        i++
      }
      i++ // closing quote
      out += q === '"' ? `"${body}"` : `"${body.replace(/\\'/g, "'").replace(/"/g, '\\"')}"`
      continue
    }

    // --- comments ---
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }

    // --- bare identifier: an object key gets quoted, literals pass through ---
    if (identStart(c)) {
      let j = i
      while (j < text.length && identPart(text[j])) j++
      const word = text.slice(i, j)
      let k = j
      while (k < text.length && /\s/.test(text[k])) k++
      out += text[k] === ':' && !['true', 'false', 'null'].includes(word) ? `"${word}"` : word
      i = j
      continue
    }

    out += c
    i++
  }

  // trailing commas are legal in JSON5 but not in JSON
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

export const CODE_CLI_TOOLS = [
  {
    id: 'opencode',
    name: 'OpenCode',
    description:
      'OpenCode 官方终端编码代理（opencode-ai）。内置 OpenCode Zen 免费通道：安装后直接 /models 选择 Big Pickle、MiMo-V2.5 Free、Nemotron Free 等模型即可使用，无需任何 API Key（官方标注为限时免费）。也可通过 Agent Studio 统一网关使用其他服务商。npm 包会在安装时下载对应平台的二进制（约 100MB）。',
    website: 'https://opencode.ai/',
    docs: 'https://opencode.ai/docs/',
    npmPackage: 'opencode-ai',
    // Wrapper only; the platform binary is placed by installer.postInstall (see manager.js),
    // instead of opencode's own postinstall which spawns the fresh exe to verify it and fails
    // under Windows Defender / EPERM while the file is still being scanned.
    ignoreInstallScripts: true,
    platformBinary: { win32: { x64: ['opencode-windows-x64', 'opencode-windows-x64-baseline'], arm64: ['opencode-windows-arm64'] }, linux: { x64: ['opencode-linux-x64', 'opencode-linux-x64-baseline'], arm64: ['opencode-linux-arm64'] }, darwin: { x64: ['opencode-darwin-x64'], arm64: ['opencode-darwin-arm64'] } },
    bin: 'opencode',
    interfaces: ['openai', 'anthropic'],
    gatewayInterfaces: ['openai'],
    loginMode: 'both',
    defaultMode: 'account',
    isDefault: true,
    accountLoginHint:
      '免 Key 模式（默认）：已预设免费模型 Big Pickle，启动后直接对话；输入 /models，选择带 (free) 的模型（Big Pickle / MiMo-V2.5 Free 等）直接使用。如需 Zen 付费模型，运行 /connect 选择 OpenCode Zen 粘贴 Key。',
    params: [],
    /**
     * OpenCode reads providers from opencode.json. In gateway mode we write an
     * isolated config (OPENCODE_CONFIG) declaring Agent Studio as an
     * OpenAI-compatible provider; in account mode nothing is written so the
     * built-in Zen free tier is used as-is. Credentials/state live under the
     * portable XDG dirs set by portableToolEnv (~/.local/share/opencode).
     */
    configMode: 'file',
    writeConfig({ dir, endpoint, apiKey, model, cfg = {} }) {
      fs.mkdirSync(dir, { recursive: true })
      if (cfg.mode === 'account' || !endpoint) {
        // Out-of-the-box: preselect Zen's free model so the first launch needs no key and no picker.
        const file = path.join(dir, 'opencode.json')
        fs.writeFileSync(file, JSON.stringify({ $schema: 'https://opencode.ai/config.json', model: 'opencode/big-pickle', autoupdate: false }, null, 2))
        return { env: { OPENCODE_CONFIG: file, OPENCODE_CONFIG_DIR: dir }, args: null }
      }
      const modelId = model || 'default'
      const config = {
        $schema: 'https://opencode.ai/config.json',
        model: `agent-studio/${modelId}`,
        autoupdate: false,
        provider: {
          'agent-studio': {
            npm: '@ai-sdk/openai-compatible',
            name: 'Agent Studio Gateway',
            options: { baseURL: `${endpoint}/v1`, apiKey: apiKey || 'agent-studio-gateway' },
            models: { [modelId]: { name: modelId } }
          }
        }
      }
      const file = path.join(dir, 'opencode.json')
      fs.writeFileSync(file, JSON.stringify(config, null, 2))
      return { env: { OPENCODE_CONFIG: file, OPENCODE_CONFIG_DIR: dir }, args: null }
    },
    buildLaunch() {
      return { env: {}, args: [] }
    }
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Anthropic 官方终端编码代理。',
    website: 'https://docs.anthropic.com/en/docs/claude-code',
    npmPackage: '@anthropic-ai/claude-code',
    bin: 'claude',
    altBins: ['claude-code'],
    interfaces: ['anthropic'],
    gatewayInterfaces: ['anthropic'],
    loginMode: 'both',
    accountLoginHint: '不选服务商时，启动后在 CLI 内执行 /login 使用 Claude 订阅账号登录。',
    params: [
      {
        key: 'thinkingLevel',
        label: '思考强度',
        type: 'select',
        default: 'medium',
        options: [
          { value: 'off', label: '关闭' },
          { value: 'low', label: '低' },
          { value: 'medium', label: '中' },
          { value: 'high', label: '高' }
        ]
      },
      {
        key: 'permissionMode',
        label: '权限模式',
        type: 'select',
        default: 'default',
        options: [
          { value: 'default', label: '默认（每次确认）' },
          { value: 'acceptEdits', label: '自动接受文件修改' },
          { value: 'plan', label: '计划模式（只读）' },
          { value: 'bypassPermissions', label: '跳过确认（危险）' }
        ]
      },
      { key: 'smallModel', label: '快速小模型', type: 'model', default: '', hint: '用于补全标题等轻量任务' }
    ],
    buildLaunch({ cfg, endpoint, providerType }) {
      const env = {
        ANTHROPIC_BASE_URL: endpoint,
        ANTHROPIC_MODEL: cfg.model,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        DISABLE_TELEMETRY: '1',
        DISABLE_AUTOUPDATER: '1',
        DISABLE_BUG_COMMAND: '1',
        DISABLE_COST_WARNINGS: '1',
        DISABLE_ERROR_REPORTING: '1'
      }
      // A model that is not in Claude Code's built-in catalog (i.e. anything
      // reached through the gateway) makes it warn and guess a 200k window.
      if (providerType !== 'anthropic') {
        env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT = '1'
      }
      if (cfg.apiKey) env.ANTHROPIC_AUTH_TOKEN = cfg.apiKey
      if (cfg.smallModel) env.ANTHROPIC_SMALL_FAST_MODEL = cfg.smallModel
      const thinkingTokens = { off: '0', low: '4000', medium: '10000', high: '31999' }[cfg.thinkingLevel || 'medium']
      if (thinkingTokens) env.MAX_THINKING_TOKENS = thinkingTokens
      const args = []
      if (cfg.model) args.push('--model', cfg.model)
      if (cfg.permissionMode && cfg.permissionMode !== 'default') args.push('--permission-mode', cfg.permissionMode)
      return { env, args }
    }
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    description: 'OpenAI 官方终端编码代理（Responses 接口）。',
    website: 'https://developers.openai.com/codex',
    npmPackage: '@openai/codex',
    bin: 'codex',
    interfaces: ['openai-response', 'openai'],
    gatewayInterfaces: ['openai-response'],
    loginMode: 'both',
    accountLoginHint: '不选服务商时，启动后执行 codex login 使用 ChatGPT 账号登录。',
    params: [
      {
        key: 'reasoningEffort',
        label: '推理强度',
        type: 'select',
        default: 'medium',
        options: [
          { value: 'minimal', label: '极简' },
          { value: 'low', label: '低' },
          { value: 'medium', label: '中' },
          { value: 'high', label: '高' }
        ]
      },
      {
        key: 'sandboxMode',
        label: '沙箱权限',
        type: 'select',
        default: 'workspace-write',
        options: [
          { value: 'read-only', label: '只读' },
          { value: 'workspace-write', label: '工作区写入' },
          { value: 'danger-full-access', label: '完全访问（危险）' }
        ]
      },
      {
        key: 'approvalPolicy',
        label: '审批策略',
        type: 'select',
        default: 'on-request',
        options: [
          { value: 'untrusted', label: '仅信任命令' },
          { value: 'on-failure', label: '失败时询问' },
          { value: 'on-request', label: '按需询问' },
          { value: 'never', label: '从不询问' }
        ]
      }
    ],
    configMode: 'file',
    /**
     * Codex >= 0.4x ignores OPENAI_BASE_URL and resolves endpoints from
     * config.toml model_providers, so the gateway is written into an isolated
     * CODEX_HOME instead of the user's own ~/.codex.
     */
    writeConfig({ dir, endpoint, apiKey, model, cfg, provider }) {
      if (cfg.mode === 'account') return {env:{CODEX_HOME:dir},args:null}
      fs.mkdirSync(dir, { recursive: true })
      const useGateway = cfg.mode === 'gateway'
      const wireApi = useGateway ? 'responses' : provider?.type === 'openai-response' ? 'responses' : 'chat'
      const baseUrl = /\/v\d+$/.test(endpoint || '') ? endpoint : `${endpoint}/v1`
      const lines = [
        `model = "${model || ''}"`,
        'model_provider = "agent-studio"',
        cfg.reasoningEffort ? `model_reasoning_effort = "${cfg.reasoningEffort}"` : null,
        cfg.sandboxMode ? `sandbox_mode = "${cfg.sandboxMode}"` : null,
        cfg.approvalPolicy ? `approval_policy = "${cfg.approvalPolicy}"` : null,
        '',
        '[model_providers.agent-studio]',
        'name = "Agent Studio Gateway"',
        `base_url = "${baseUrl}"`,
        `wire_api = "${wireApi}"`,
        'env_key = "OPENAI_API_KEY"',
        ''
      ]
      fs.writeFileSync(path.join(dir, 'config.toml'), lines.filter((l) => l !== null).join('\n'))
      return {
        env: { CODEX_HOME: dir, OPENAI_API_KEY: apiKey || 'agent-studio-gateway' },
        args: []
      }
    },
    buildLaunch({ cfg, endpoint }) {
      // config.toml (written by writeConfig) carries model/provider/effort/sandbox;
      // these env vars stay as a fallback for older Codex builds that honour them.
      const env = { OPENAI_BASE_URL: endpoint }
      if (cfg.apiKey) env.OPENAI_API_KEY = cfg.apiKey
      const args = []
      if (cfg.sandboxMode) args.push('--sandbox', cfg.sandboxMode)
      return { env, args }
    }
  },
  {
    id: 'pi',
    name: 'Pi Agent',
    description: 'Pi 官方终端编码代理（earendil-works/pi），需要 Node.js ≥ 22.19。',
    website: 'https://github.com/earendil-works/pi',
    npmPackage: '@earendil-works/pi-coding-agent',
    legacyNpmPackages: ['@mariozechner/pi-coding-agent'],
    ignoreInstallScripts: true,
    bin: 'pi',
    altBins: ['pi-coding-agent'],
    interfaces: ['openai', 'anthropic'],
    gatewayInterfaces: ['openai'],
    loginMode: 'provider',
    params: [],
    /**
     * Pi resolves providers from models.json instead of env vars, so the
     * connection is written into a managed agent dir (isolated from the user's
     * own ~/.pi) and passed via PI_CODING_AGENT_DIR.
     */
    configMode: 'file',
    writeConfig({ dir, endpoint, apiKey, model, cfg = {} }) {
      if (cfg.mode === 'account') return {env:{PI_CODING_AGENT_DIR:dir},args:null}
      fs.mkdirSync(dir, { recursive: true })
      const config = {
        providers: {
          openai: {
            baseUrl: endpoint,
            models: [
              {
                id: model,
                name: model,
                api: 'openai-completions',
                baseUrl: endpoint,
                reasoning: false,
                input: ['text'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 200000,
                maxTokens: 8192
              }
            ]
          }
        }
      }
      fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify(config, null, 2))
      return {
        env: { PI_CODING_AGENT_DIR: dir, OPENAI_API_KEY: apiKey || 'agent-studio-gateway' },
        // Pi parses --model as `provider/model` (or a bare model id), not `provider:model`.
        args: ['--model', `openai/${model}`]
      }
    },
    buildLaunch({ cfg, endpoint }) {
      const env = { OPENAI_BASE_URL: endpoint }
      if (cfg.apiKey) env.OPENAI_API_KEY = cfg.apiKey
      const args = []
      if (cfg.model) args.push('--model', cfg.model)
      return { env, args }
    }
  },
  {
    id: 'deepseek-harness',
    name: 'DeepSeek Harness (DSH)',
    description:
      'DeepSeek 官方 Agent 运行框架（Cordis 微内核，一切皆插件）。`dsh web` 启动它自带的 Web UI（默认 http://127.0.0.1:3080），模型与密钥在它的 Settings → Models 里配置；另有 headless / tui profile。需要 Node.js ≥ 22.19（建议 24+）。',
    website: 'https://github.com/deepseek-ai/deepseek-harness',
    docs: 'https://deepseek-harness.github.io/deepseek-harness/',
    // npm 上的 `deepseek-harness` 只是保留空包（v0.0.1、无 bin），真身是 @deepseek-ai/dsh；
    // Python SDK（pip install deepseek-harness-sdk）同样会装出 dsh 命令，所以多留几个别名。
    npmPackage: '@deepseek-ai/dsh',
    bin: 'dsh',
    altBins: ['deepseek-harness', 'deepseek', 'dsh-tui'],
    runMode: 'service',
    servicePort: 3080,
    interfaces: ['openai'],
    gatewayInterfaces: [],
    loginMode: 'account',
    accountLoginHint:
      '模型与密钥在它自带的 Web UI（Settings → Models）里配置；也支持 ~/.dsh/settings.yaml 中的 OpenAI 兼容 provider、~/.dsh/.credentials.yaml 与 DEEPSEEK_API_KEY 环境变量。',
    params: [
      {
        key: 'port',
        label: 'Web UI 端口',
        type: 'number',
        default: 3080,
        hint: 'dsh web 默认监听 127.0.0.1:3080。这里只用于生成「打开 Web UI」的链接；要改端口请在 dsh 自己的配置里改。'
      },
      {
        key: 'profile',
        label: '启动 profile',
        type: 'select',
        default: 'web',
        options: [
          { value: 'web', label: 'web（自带浏览器 UI，推荐）' },
          { value: 'headless', label: 'headless（一次性任务，打印结果后退出）' },
          { value: 'tui', label: 'tui（需先 dsh plugin --profile tui add 一个 TUI 插件）' }
        ]
      }
    ],
    buildLaunch({ cfg }) {
      const env = {}
      if (cfg.apiKey) env.DEEPSEEK_API_KEY = cfg.apiKey
      const profile = cfg.profile || 'web'
      // `dsh web` 就是 `dsh --profile web` 的别名，其余 profile 用统一写法。
      return { env, args: profile === 'web' ? ['web'] : ['--profile', profile] }
    }
  },
  {
    id: 'hermes-agent',
    name: 'Hermes Agent',
    description:
      'Nous Research 的自改进 Agent：从经验中生成 skills，并在使用中持续改进。npm 包 hermes-agent 是社区桥接版——安装时需要 Git，它会自动准备由 uv 管理的隔离 Python 运行时，宿主机不必装 Python（Node ≥ 20）。',
    website: 'https://github.com/NousResearch/hermes-agent',
    docs: 'https://hermes-agent.nousresearch.com/docs/',
    npmPackage: 'hermes-agent',
    bin: 'hermes',
    altBins: ['hermes-agent'],
    interfaces: ['openai', 'anthropic'],
    gatewayInterfaces: ['openai'],
    loginMode: 'both',
    accountLoginHint:
      '账号模式请在终端里运行 `hermes setup`（或 `hermes model`）自行选择 provider；配置落在当前盘内 tool-config/hermes-agent。',
    params: [], // Portable mode cannot opt into the host home directory.
    /**
     * Hermes takes model routing from config.yaml (upstream removed LLM_MODEL
     * from .env — config.yaml is the single source of truth), so the gateway is
     * written as a custom OpenAI-compatible provider. OPENAI_BASE_URL /
     * OPENAI_API_KEY are exported as well because upstream still honours them
     * for its built-in `openai-api` provider.
     */
    configMode: 'file',
    writeConfig({ dir, endpoint, apiKey, model, cfg }) {
      const home = path.join(dir, 'hermes-home')
      if (cfg.mode === 'account' || !endpoint) return { env: {HERMES_HOME:home}, args: null }
      fs.mkdirSync(home, { recursive: true })
      const file = path.join(home, 'config.yaml')

      let doc = {}
      if (fs.existsSync(file)) {
        try {
          doc = yamlLoad(fs.readFileSync(file, 'utf8')) || {}
        } catch {
          doc = {} // unreadable/hand-written YAML: start clean rather than crash the launch
        }
      }
      const modelId = model || doc?.model?.default || ''
      doc.model = { ...(doc.model || {}), provider: 'agent-studio', default: modelId }
      doc.providers = {
        ...(doc.providers || {}),
        'agent-studio': {
          type: 'openai',
          base_url: `${endpoint}/v1`,
          key_env: 'AGENT_STUDIO_GATEWAY_KEY',
          default_model: modelId,
          models: modelId ? [modelId] : []
        }
      }
      fs.writeFileSync(file, yamlDump(doc, { lineWidth: -1, noRefs: true }))

      const key = apiKey || 'agent-studio-gateway'
      return {
        env: { HERMES_HOME: home, AGENT_STUDIO_GATEWAY_KEY: key, OPENAI_BASE_URL: `${endpoint}/v1`, OPENAI_API_KEY: key },
        args: null
      }
    },
    buildLaunch() {
      // Everything Hermes needs is in config.yaml + env (see writeConfig).
      return { env: {}, args: [] }
    }
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    description:
      'OpenClaw 基金会出品的开源个人 AI 助手：一个 Gateway 接管 Discord / Telegram / WhatsApp / Slack 等 20+ 渠道，模型与 agent harness（Claude、Codex、本地模型）都是可换的插件。终端里默认用 `openclaw tui --local` 直接跑内嵌 agent，不必先起 Gateway。要求 Node.js ≥ 24.16（或 ≥ 26.1），安装包约 200MB。',
    website: 'https://openclaw.ai',
    docs: 'https://docs.openclaw.ai',
    npmPackage: 'openclaw',
    bin: 'openclaw',
    // 旧名 clawdbot / moltbot 的命令仍被 alias 保留
    altBins: ['clawdbot'],
    interfaces: ['openai', 'anthropic'],
    gatewayInterfaces: ['openai'],
    loginMode: 'both',
    accountLoginHint:
      '账号模式请自己跑 `openclaw onboard`（初始化向导）或在 TUI 里用 /auth 选择 provider；配置写在 ~/.openclaw/openclaw.json。',
    params: [
      {
        key: 'launchMode',
        label: '启动方式',
        type: 'select',
        default: 'tui-local',
        options: [
          { value: 'tui-local', label: 'tui --local（内嵌 agent，推荐）' },
          { value: 'tui', label: 'tui（连接已运行的 Gateway）' },
          { value: 'gateway', label: 'gateway run（前台起 Gateway + Control UI）' },
          { value: 'onboard', label: 'onboard（首次初始化向导）' },
          { value: 'doctor', label: 'doctor（体检与修复建议）' }
        ]
      },
      {
        key: 'gatewayPort',
        label: 'Gateway 端口',
        type: 'number',
        default: 18789,
        hint: '仅「gateway run」用得到；Control UI 在 http://127.0.0.1:<端口>/，也可用 openclaw dashboard 打开。'
      }
    ],
    /**
     * OpenClaw reads models from ~/.openclaw/openclaw.json. Two things are
     * required or it answers "model not allowed": the provider block under
     * models.providers AND the allowlist entry under agents.defaults.models,
     * keyed by the fully-qualified "<provider>/<model>" name. The key is written
     * as ${AGENT_STUDIO_GATEWAY_KEY} because OpenClaw supports env substitution
     * in SecretRefs — the gateway secret never lands in the file.
     */
    configMode: 'file',
    writeConfig({ dir, endpoint, apiKey, model, cfg }) {
      const home = path.join(dir, 'openclaw-home')
      const file = path.join(home, 'openclaw.json')
      const env = { OPENCLAW_STATE_DIR:home, OPENCLAW_CONFIG_PATH:file, AGENT_STUDIO_GATEWAY_KEY: apiKey || 'agent-studio-gateway' }
      if (cfg.mode === 'account' || !endpoint) return { env, args: null }
      const modelId = model || 'mock-chat'
      const qualified = `agent-studio/${modelId}`

      let doc = {}
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8')
        try {
          doc = parseJson5ish(raw) || {}
        } catch {
          // Never clobber a config we cannot parse faithfully.
          return {
            env,
            args: null,
            warning:
              `没有改写 ${file}：它是 JSON5（含注释/单引号等），自动合并有风险。` +
              '请手动加一段 models.providers["agent-studio"]（baseUrl ' +
              `${endpoint}/v1、api "openai-completions"、apiKey "\${AGENT_STUDIO_GATEWAY_KEY}"），` +
              `并把 ${qualified} 加进 agents.defaults.models 白名单；或改用「账号模式」。`
          }
        }
      }
      fs.mkdirSync(home, { recursive: true })

      doc.models = {
        ...(doc.models || {}),
        mode: doc.models?.mode || 'merge',
        providers: {
          ...(doc.models?.providers || {}),
          'agent-studio': {
            baseUrl: `${endpoint}/v1`,
            apiKey: '${AGENT_STUDIO_GATEWAY_KEY}',
            api: 'openai-completions',
            models: [
              {
                id: modelId,
                name: modelId,
                reasoning: false,
                input: ['text'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 8192
              }
            ]
          }
        }
      }
      doc.agents = {
        ...(doc.agents || {}),
        defaults: {
          ...(doc.agents?.defaults || {}),
          model: { ...(doc.agents?.defaults?.model || {}), primary: qualified },
          // 白名单：少了这一条 OpenClaw 会回 "model not allowed"
          models: { ...(doc.agents?.defaults?.models || {}), [qualified]: { alias: modelId } }
        }
      }
      fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`)
      return { env, args: null }
    },
    buildLaunch({ cfg }) {
      const mode = cfg.launchMode || 'tui-local'
      const port = cfg.gatewayPort || 18789
      const args =
        mode === 'gateway'
          ? ['gateway', 'run', '--port', String(port), '--bind', 'loopback']
          : mode === 'tui'
            ? ['tui']
            : mode === 'onboard'
              ? ['onboard']
              : mode === 'doctor'
                ? ['doctor']
                : ['tui', '--local']
      return { env: {}, args }
    }
  }
]

/**
 * Resolve the endpoint a CLI should talk to.
 *
 * `mode: 'gateway'` -> Cherry-Studio-style unified gateway running inside this
 *                      server, which translates the CLI's protocol into
 *                      whichever provider/model was configured.
 * `mode: 'direct'`  -> the provider's own API host.
 */
export function resolveEndpoint({ tool, cfg, provider, gatewayBase }) {
  if (cfg.mode === 'account' || !provider) return null
  if (cfg.mode === 'gateway') {
    const iface = (tool.gatewayInterfaces && tool.gatewayInterfaces[0]) || 'openai'
    return `${gatewayBase}/gateway/${iface}/${cfg.gatewayId}`
  }
  const host = stripV1(cfg.apiHost || provider.apiHost)
  if (provider.type === 'anthropic') return host
  if (provider.type === 'gemini') return host
  return `${host}/v1`
}

export function builtinTool(id) {
  return CODE_CLI_TOOLS.find((t) => t.id === id) || null
}

/** Tools that are compatible with a given provider type (used to filter the picker). */
export function toolsAcceptingProviderType(type) {
  return CODE_CLI_TOOLS.filter((t) => t.interfaces.includes(type)).map((t) => t.id)
}
