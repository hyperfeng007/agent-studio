# 🤖 Agent Studio · Cherry Studio 的 Node.js 功能复刻

## 1.3.4 · OpenCode 为默认智能体，免 Key 开箱即用

OpenCode 列在主流智能体首位并默认选中，默认模式为「工具自有账号」（免 Key）。详情页顶部提供「安装并启动」一键流程：安装到 U 盘后自动启动，预设 OpenCode Zen 免费模型 `opencode/big-pickle`（写入盘内隔离的 `opencode.json`），无需任何 API Key 即可对话；终端内 `/models` 可切换其他免费模型（MiMo-V2.5 Free、Nemotron Free 等）。免费模型由 OpenCode 官方标注为限时提供，可能调整；首次安装需联网下载约 180MB 二进制。

## 1.3.3 · OpenCode 安装方式改为安装器放置二进制

上游 `opencode-ai` 的 postinstall 会在写入 180MB 的 `opencode.exe` 后立刻启动它做校验，在 Windows 上常被 Defender 实时扫描占用而报 EPERM，导致安装失败。现在 Agent Studio 以 `--ignore-scripts` 安装包装包，再自行安装 `opencode-windows-x64`（失败则尝试 `-baseline`）平台包并复制二进制，复制与启动校验均带重试（最多约 1 分钟）以等待杀毒扫描释放。仍失败时请将 U 盘 `data` 目录加入杀毒白名单后重试。

## 1.3.2 · 新增 OpenCode 智能体

主流智能体增加 **OpenCode**（npm `opencode-ai`）。它内置 OpenCode Zen 免费通道：安装后启动，输入 `/models` 选择 Big Pickle / MiMo-V2.5 Free / Nemotron Free 等模型即可使用，**不需要任何 API Key**（官方标注限时免费，可能随时调整）。第三方客户端（含 Agent Studio 聊天页的 opencode-free 服务商）直连 Zen 免费模型会被拒绝，需在 opencode.ai/auth 免费注册 Key。OpenCode 安装时通过 postinstall 下载平台二进制（约 100MB），因此该工具不使用 `--ignore-scripts`。配置与凭据在盘内 `data/tool-config/opencode` 与 `data/homes/opencode`。

## 1.3.1 · 主流智能体页面响应

点击「主流智能体」时不再等待 npm 查询最新版本：已装版本直接读取盘内安装记录（不再逐个启动子进程），最新版本在后台查询并缓存 10 分钟，下一次进入时显示是否可更新。

## 1.3.0 · U 盘便携版（portable-usb-r1）

**运行方式**：整个目录放在 U 盘，双击 `Agent Studio.exe`。压缩包已包含随盘 Node.js 24（`runtime\node`）、生产依赖（`node_modules`）与已构建界面，首次启动不再联网安装依赖、不使用宿主 Node.js。

**全部落在当前目录 `data\`**：
- 六种智能体只检测、安装、更新、重装到 `data\codecli\<tool>`；不再扫描宿主 PATH／全局 npm，不再支持手动指定宿主可执行文件；旧配置里的手动路径与 `HERMES_HOME` 非隔离开关自动失效。
- 智能体运行时 HOME／USERPROFILE／APPDATA／LOCALAPPDATA／TEMP、npm／pip／uv／git 缓存与配置全部重定向到 `data\homes`、`data\cache`、`data\temp`、`data\tool-config`（Claude→CLAUDE_CONFIG_DIR，Codex→CODEX_HOME，Pi→PI_CODING_AGENT_DIR，Hermes→HERMES_HOME，OpenClaw→OPENCLAW_STATE_DIR／OPENCLAW_CONFIG_PATH）。工作目录只允许 `data` 内，默认 `data\workspaces`，保存为相对路径以适应盘符变化。
- 浏览器：使用宿主已安装的 Edge（备用 Chrome）程序本体，用户数据目录固定为 `data\browsers\msedge` 或 `data\browsers\chrome`（含缓存）。AI 官网的历史、Cookie、登录态保存在这里。
- 服务进程本身的 HOME／TEMP／npm 配置也指向 `data\host-home`、`data\temp\app`。

**退出**：关闭应用窗口后启动器等待所属进程全部退出并刷写日志，随后提示“可安全弹出”，再用 Windows「安全删除硬件」拔盘。不要在运行中直接拔盘。

**边界（如实说明）**：
- 这是应用级便携：不向宿主用户目录、注册表写入本应用数据；但 Windows 预取／事件日志、杀毒软件、企业审计、浏览器本体的机器级缓存等不由本应用控制，**不承诺宿主绝对零痕迹**。
- Edge／Chrome 的 Cookie、密码等受 Windows 用户 DPAPI 加密：**同一台电脑同一用户**可继续使用登录态；换电脑或换 Windows 账号需重新登录（历史记录、书签、站点设置仍在）。不会为“跨机免登录”关闭浏览器加密。
- 第三方智能体是否完全遵守以上环境变量，需以实际使用为准；已知 Hermes 依赖 Git 与 uv（已通过 UV_* 变量重定向），OpenClaw 体积约 200MB。宿主 Git 未随包附带。
- 本版未在真实 Windows／U 盘上运行验证；便携环境检查 69 项、六工具本地模拟安装 19 项等测试在 Linux 通过。

## 1.2.4 · Pi 官方仓库／包名更新

Pi 来源修正为 https://github.com/earendil-works/pi ，当前 CLI 包为 `@earendil-works/pi-coding-agent`，命令仍是 `pi`，上游要求 Node ≥22.19。依据当前上游 README，仅 Pi 安装添加 `--ignore-scripts`。其他五种工具不改变安装脚本策略。

安装／更新会移除托管 package.json 中旧的 `@mariozechner/pi-coding-agent` 直接依赖声明，交由 npm 重建依赖；保留其他声明与配置，不卸载系统 Pi。完整覆盖并保留 `data` 后重启 EXE，版本 **1.2.4 / pi-source-r1**。

这不修复用户机器的 DNS：`getaddrinfo ENOTFOUND proxyau.huawei.com` 指向代理主机无法解析，应检查公司网络／VPN／内部 DNS 或过期系统代理设置，不应通过关闭证书验证解决。应用不会擅自更换或绕过系统代理。日志 action=update 表示更新，独立重装为 reinstall。

核对来源：上游 `packages/coding-agent/package.json` 与 `packages/coding-agent/README.md`（2026-09-18）。新包声明／迁移测试 8/8，六工具本地模拟 npm 夹具 19/19；不等同于原生 Windows 或真实上游下载安装成功。以下为历史说明。

## 1.2.3 · 六种智能体共用 Windows 调用与重装修复

覆盖 Claude Code、Codex、Pi、DSH、Hermes、OpenClaw 的安装、检测、更新和重装。除共用安装器外，进一步移除终端／PTY 和 MCP stdio 的错误二次包装；cmd 转义和 windowsVerbatimArguments 成对传递，PTY 使用已转义原始参数字符串，官方 SDK 直接接收原始命令。

「重新安装」现在有独立操作和确认框：只重建托管目录中的 node_modules／package-lock.json，保留根目录配置、凭据和项目，不卸载系统版本。相同工具禁止并发安装；有该工具的运行会话时，需先终止会话再安装／更新／重装／移除。操作后刷新检测缓存。安装日志首行显示实际服务版本与执行方式。

完整覆盖并保留 `data` 后，请关闭旧应用并用新版 EXE 启动，确认版本 **1.2.3 / all-tools-windows-r1**。若日志仍没有 `[Agent Studio 1.2.3]`，请先确认是否仍连接旧服务。

六工具安装／更新／重装夹具 19/19（本地模拟 npm）、Windows 参数逻辑 14/14、CLI 启动回归 9/9，以及其余 npm test 通过。没有声称在原生 Windows 上实际下载并安装了六种上游工具；网络认证、证书和各工具自身依赖仍需实机验证。保留 Framework 4.8 编译修复。以下为历史说明。

## 1.2.2 · 修复 Windows DSH 安装／检测命令引号

修复主流智能体管理器手动包装 Windows `npm` 导致字面量引号进入命令名的问题。Windows 上优先通过当前 Node 的 `node_modules/npm/bin/npm-cli.js` 运行 npm；检测和安装的其他命令使用 cross-spawn 正确处理 `.cmd`、PATH 和参数，避免重复转义。托管安装刷新可执行环境并使用应用当前代理设置，不修改全局 npm 配置。

保留 1.2.1 的 Framework 4.8 编译和独立启动日志修复。完整覆盖并保留 `data` 后，用 EXE 重新启动；在「主流智能体」刷新检测，已有 DSH 不需要因误判立即重装。若确实未安装再点击安装。

版本 **1.2.2 / dsh-windows-spawn-r1**。启动回归 9/9（含真实本地子进程参数测试和模拟 Windows 解析）及现有测试通过；未原生 Windows 实测，也未验证真实 DSH 全量下载安装。修复的是 npm 启动前的命令错误，不保证后续代理认证、证书或上游安装步骤一定成功。以下为历史说明。

## 1.2.1 · 修复 EXE 入口 MissingMethodException

1.2.0 的交叉编译错误引用了 Mono 特有的 `String.TrimEnd(char)`、`Trim(char)`、`Split(char, StringSplitOptions)` 重载，Windows .NET Framework 无法解析，导致入口 JIT 阶段直接退出（`0xe0434352`），尚未来得及创建窗口或日志。这是交付兼容性缺陷，不是 Node／网络代理错误。

本版使用明确的 Framework 4.8 参考程序集、兼容的字符数组重载，并新增独立 Bootstrap 入口：先记录日志，再进入不可内联的 GUI 方法，早期错误使用原生对话框报告。全体 266 个外部方法／字段引用均可在目标参考程序集中解析，旧版同一检查有 3 项缺失。早期日志：`data/launcher/bootstrap-*.log`；写入失败时尝试 `%LOCALAPPDATA%/AgentStudio/launcher`。

请完整覆盖项目并保留 `data`，特别包括新的 **Agent Studio.exe** 和 **Agent Studio.exe.config**，然后双击 EXE。当前版本 **1.2.1 / windows-bootstrap-r2**。不需要为这个错误更换 Node 或代理。仍未完成原生 Windows 全生命周期验收。以下是历史版本说明。

## 1.2.0 · 无命令行窗口的 EXE 启动器

现在请双击根目录的 **`Agent Studio.exe`**，不再用 `start.bat` 作为日常入口。完整覆盖原目录并保留 `data`；首次从旧 BAT 版本升级请先关闭原来的服务窗口。

EXE 显示分阶段启动进度，启动中再次双击仅唤回进度窗口；已运行时再次双击会关闭本目录的旧实例并重新启动。优先 Edge、备用 Chrome，以专属用户目录运行 APP 窗口。浏览器窗口出现后隐藏进度，关闭本应用全部窗口后清理本次后台进程。Node/npm/构建在后台运行，失败用对话框和日志提示。源码在 `launcher/`。

当前版本 **1.2.0 / windows-exe-r1**。必须完整解压，EXE 不是单文件应用，仍需 Node.js（推荐 24 LTS）、Edge 或 Chrome，以及首次安装依赖所需网络。Windows 10/11 x64、.NET Framework 4.8 环境建议。

详细说明见 [EXE 启动器说明](docs/Windows-EXE启动器说明.md)，包括进程识别范围、日志、企业证书、旧版本兼容和验收清单。已完成编译和自动化逻辑测试，**尚未原生 Windows 实测**；未签名 EXE 可能触发 SmartScreen/企业安全策略，不建议关闭安全软件。以下是历史版本说明，其中 BAT 启动方式仅作为诊断备用。

## 1.1.3 · MCP 工具归入设置

MCP 管理入口改为「设置 → MCP 工具」，移除主导航的独立 MCP 图标。旧地址 `#/mcp` 自动跳转 `#/settings/mcp`。助手授权、调用确认、服务配置和数据不变。保留助手／话题上下分区。

完整覆盖原目录并保留 `data`；当前版本 **1.1.3 / mcp-settings-r1**。此前企业代理证书信任问题仍待验证，本轮仅调整导航。以下为历史说明。

## 1.1.2 · 助手与话题上下分区

同一左侧栏上半区显示已添加的智能助手，下半区显示当前选中助手的话题；两区独立滚动。切换助手同步切换话题，不增加中间列，不再将话题嵌套到助手行。保留话题新建、重命名、置顶和删除；不迁移或清空已有数据。

完整覆盖原目录并保留 `data`，启动后版本为 **1.1.2 / assistant-topic-split-r1**。保留 1.1.1 系统代理读取；此前公司网络证书信任问题尚未确认解决，本次不声称修复它。以下为历史说明。

## 1.1.1 · Windows 安装自动跟随系统代理

修正 1.1.0 的安装阶段未读取系统代理问题。启动器在 npm 安装前通过 Windows/.NET 系统代理接口解析当前 npm 仓库地址，自动将结果传给本次安装和子进程；无需填写代理端口，不修改系统设置或全局 `.npmrc`。未使用代理时打印 DIRECT。读取失败／超时会停止并明确提示，不猜端口，不关闭证书验证。已有环境或 npm 配置中的代理由本次系统检测结果覆盖，仅影响安装子进程。

PAC／自动发现取决于 Windows/.NET 的实际解析结果；安装器只把仓库对应的代理决策传给 npm，不能保证不同下载域名的逐 URL PAC 规则。集成 Windows 代理认证亦未验证。移除了失败后盲目跳过可选模块的重试，以保留真实错误并避免漏装构建所需依赖。

覆盖后健康检查版本应为 **1.1.1 / windows-system-proxy-r1**。测试覆盖配置传递、直连、旧代理清理和输入校验；原生 Windows 系统代理接口尚未在本环境实测。以下为此前版本说明。

## 当前版本：1.1.0 · knowledge-mcp-r1

在原项目上增加**多知识库、PDF／DOCX／MD／TXT 导入、可选 Embedding、助手资源绑定与来源展示，以及真实 MCP 工具确认执行**。没有另建应用；原六种主流智能体和助手二级话题保留。

**先看 [知识库与 MCP 使用／升级说明](docs/知识库与MCP使用说明.md)**：含配置步骤、安全边界、完整备份方式及测试记录。

覆盖升级：停止旧服务 → 备份并保留 `data` → 完整覆盖项目 → `start.bat`。新增依赖会按指纹检测安装，随后重新构建；浏览器只在确认本次服务实例就绪后自动打开。健康检查 `/api/health` 应为 **1.1.0 / knowledge-mcp-r1**。以下旧版本更新记录仅供追溯。

要求 **Node.js ≥ 20.19，推荐 24 LTS**。默认只监听 `127.0.0.1`；MCP 只能在服务端本机通过 localhost 管理／执行，尚无远程登录鉴权。扫描 PDF 需先 OCR；Rerank、OAuth、旧 MCP SSE、临时文件问答本轮未提供。原生 Windows 尚未实测。

按 **Cherry Studio V2 的功能** + **V1 的布局**（左侧图标导航栏），用 Node.js 从零复刻四个关键模块：

| 模块 | 复刻内容 |
| --- | --- |
| **对话** | **智能助手** / 话题 / 消息三层结构、**15 个出厂智能助手**（通用、翻译、代码审计、Bug 定位、单元测试生成、代码解释、重构建议、SQL、正则、命令行、技术文档、方案设计、学习导师、Git 提交与评审、前端 UI），流式输出、思考过程块、多模型同屏对比、上下文数量、消息操作（复制/编辑/重新生成/删除）、清除上下文、话题自动命名、图片附件、Markdown + 代码高亮渲染、token 与耗时指标 |
| **小程序** | 34 个内置 AI 网页应用、自定义添加（名称/网址/图标）、排序、置顶、隐藏；**点击卡片在浏览器新标签页打开**，卡片悬停提供「内嵌打开」，并可在「管理」里按应用记住偏好 |
| **主流智能体** | 6 个主流 CLI 智能体（Claude Code / OpenAI Codex / Pi Agent / DeepSeek Harness (DSH) / Hermes Agent / **OpenClaw**）、托管安装·更新·移除、**多路检测**（托管目录 → 登录 shell / `where` → npm 全局前缀 → 注册表用户 PATH → 常见安装目录扫描，含 pnpm / yarn / pip 的 `Python3*\Scripts` 通配目录 / WindowsApps / `~/.hermes/bin`，支持一个工具的多个命令名）、**「为什么没检测到？」诊断弹窗**（列出搜过的命令名、Windows 后缀优先级、PATH 查询方式与扫描过的目录）、**手动指定可执行文件路径**兜底、按接口类型筛选服务商、统一网关、工作目录与终端选择、**真实 PTY 终端**（xterm.js + WebSocket） |
| **设置 → 模型服务** | 38 个内置服务商 + 自定义服务商、5 种渠道协议、**网络代理（系统/自定义/不使用 + 绕过规则 + 强制 IPv4）与四步网络诊断**、**出厂默认服务商 `opencode-free`（OpenCode Zen 免费额度，免 API Key）**、API 密钥与多密钥轮询、API 地址、「检查」连通性、「管理模型」（拉取/勾选/自定义/能力标记/启停）、默认模型、自定义请求头 |

## 更新记录 · 第三轮（2 项）

1. **修复「所有大模型都请求失败 fetch failed」**（无论在智能助手还是主流智能体里）——根因是 **Node 的出站请求既不跟随系统代理、也不读 `HTTP_PROXY` / `HTTPS_PROXY`**，而设置页里那个「网络代理」开关以前**只是把字段存进 db.json，服务端从来没有应用过**（界面上那句"代理在服务端生效"是错的）。undici 失败时只抛一句 `fetch failed`，真实原因（`ENOTFOUND` / `ECONNREFUSED` / 证书 / 代理不可用）藏在 `err.cause` 里，从来没被打出来，所以看起来像"所有模型都坏了"。
   现在：① **代理模式真正生效**（对齐 Cherry Studio 设置 → 系统的三档：**系统代理**（默认，Windows 读注册表 `Internet Settings`、macOS 读 `scutil --proxy`、其余回退环境变量）/ **自定义代理**（地址 + **代理绕过规则**，默认 `localhost,127.0.0.1,::1`）/ **不使用代理**），保存后立即生效、无需重启；② 新增 **强制 IPv4**（IPv6 路由不通时同样只报 fetch failed）；③ **错误信息展开 `err.cause`**，给出目标域名、错误码、针对性建议与当前生效的代理；④ 新增 **网络诊断**（DNS → TCP → TLS → HTTP 四步，前三步直连、最后一步走真实链路，用来区分"需要代理"和"代理本身坏了"）；⑤ **代理透传给智能体子进程**（账号模式下 CLI 自己直连上游，只认 `HTTPS_PROXY` 这套环境变量）；⑥ 模型列表返回非 JSON（`apiHost` 填成了站点首页）时给出可读错误而不是 `Unexpected token '<'`。详见下面「所有模型都报 fetch failed」一节。
2. **修复终端里打中文时窗口向左跳/缩进**：xterm 的隐藏输入框平时停在 `left:-9999em`，输入法一开始组合，浏览器为了"把获得焦点的元素滚进可视区"就去滚动最近的可滚动祖先——而 `overflow:hidden` 的盒子**仍然可以被焦点/程序滚动**，于是整个终端被横向拽走；同时组合期间 DOM 抖动触发 `ResizeObserver → fit()` 反复重排，TUI 按新宽度重画，看起来也像窗口在动。现在 `.terminal-body` / `.terminal-panel` 改用 **`overflow: clip`**（真正不可滚动），并在捕获阶段把祖先链上的横向滚动一律归零、把留在屏幕外的输入框夹回盒子内、`fit()` 去抖且**组合期间不重排**；终端字体栈补上 CJK 字体（Consolas / SF Mono 没有中文字形，缺字回退到非等宽字体才是"中文错位"的另一半原因）；`start.bat` 开头 `chcp 65001` 把控制台代码页切到 UTF-8（子进程继承）。详见下面「终端里打中文」一节。

---

## 更新记录 · 第二轮（3 项）

1. **「助手」全面改名为「智能助手」**，出厂助手从 3 个扩到 **15 个**：通用智能助手、翻译助手、代码审计（原「代码审查」，提示词改为按严重程度定位到行的安全审计）、Bug 定位专家、单元测试生成、代码解释、重构建议、SQL 助手、正则表达式、命令行助手、技术文档写作、需求与方案设计、学习导师、Git 提交与评审、前端 UI 搭子。每个都带可直接用的人设提示词与一句话说明；只在首次启动（`assistants` 表为空）时播种，已有数据不会被覆盖。
2. **「编码搭档」改名为「主流智能体」，清单收敛到 6 个**：保留 Claude Code、OpenAI Codex、Pi Agent、DeepSeek Harness (DSH)、Hermes Agent，**新增 OpenClaw**；删除 Gemini CLI、OpenCode、Qwen Code、Kimi Code、Qoder、Copilot CLI。网关的 Gemini 方言与 `gemini` 类型服务商适配器**保留**（模型服务里仍可用），只是不再作为 CLI 工具出现。
   **OpenClaw**（`openclaw`，OpenClaw 基金会的开源个人 AI 助手：Gateway + 20 多个聊天渠道，模型与 agent harness 皆为插件）：终端里默认 `openclaw tui --local` 跑内嵌 agent，不必先起 Gateway；也可选 `tui`（连已运行的 Gateway）、`gateway run`（前台起 Gateway，Control UI 在 `http://127.0.0.1:18789/`）、`onboard`、`doctor`。走统一网关时写 `~/.openclaw/openclaw.json`：`models.providers["agent-studio"]`（`api: "openai-completions"`、`baseUrl` 指网关、`apiKey` 写成 `${AGENT_STUDIO_GATEWAY_KEY}`，**env 引用所以密钥不落盘**）**以及** `agents.defaults.models` 白名单（少了这条 OpenClaw 会回 `model not allowed`），并把 `agents.defaults.model.primary` 指到 `agent-studio/<model>`。该文件是 **JSON5**（裸键 / 注释 / 单引号 / 尾逗号），我们保守解析后**合并**写入，其它键原样保留；**解析不了就拒绝改写**，把原因打印到终端而不是清空用户配置。要求 Node.js ≥ 24.16（或 ≥ 26.1），安装包约 200MB；旧命令名 `clawdbot` 作为别名一并检测。
3. **修复「终止进程」把整个 Agent Studio 带崩**（详见下面「终止进程」一节）：现在终止的是**整棵进程树**，接口返回真实回执，UI 有「终止中…」状态与结果提示；服务端加了崩溃兜底，`start.bat` 退出时会打印退出码并指向 `data/crash.log`。

---

## 更新记录 · 第一轮（4 项）

1. **应用改名为 Agent Studio**：界面标题、导航栏、启动横幅、`start.bat`、托管安装目录名、生成的配置文件（Codex `config.toml` 里的 `[model_providers.agent-studio]`、`agent-studio-config/`）、备份文件名（`agent-studio-backup-*.json`）与托管包名（`agent-studio-managed-<tool>`）全部同步；对 Cherry Studio 的**出处与 AGPL-3.0 声明保留**。
2. **智能体检测修正**：DeepSeek Harness 之前指向 npm 上的**保留空包** `deepseek-harness`（v0.0.1、无 bin），所以装了也检测不到、也装不上。现改为真实包 **`@deepseek-ai/dsh`**（命令 `dsh`，别名 `deepseek-harness` / `deepseek` / `dsh-tui` 覆盖 Python SDK 安装的情况），Web UI 端口修正为 **3080**，`available` 打开（可托管安装），并新增启动 profile 选择（`web` / `headless` / `tui`）。检测面也一并加固：候选目录新增 pnpm、yarn、`%LOCALAPPDATA%\Microsoft\WindowsApps`、pip 的 `%APPDATA%\Python\Python3*\Scripts`（通配展开）、`~/.hermes/bin`、`~/.dsh/bin`；检测失败时后端回报「搜过哪些命令名 / 后缀 / 目录」，前端「为什么没检测到？」弹窗直接展示。
3. **新增 Hermes Agent**（Nous Research 自改进 Agent，npm 包 `hermes-agent`，命令 `hermes`，安装时需要 Git，会自带 uv 管理的隔离 Python 运行时）。统一网关通过 `writeConfig` 写 **`config.yaml`**（Hermes 的唯一配置源，上游已移除 `.env` 的 `LLM_MODEL`）：`model.provider/default` + `providers.agent-studio{type: openai, base_url, key_env, default_model, models}`。默认写进托管目录并用 `HERMES_HOME` 隔离（不碰你的 `~/.hermes`）；关掉「使用隔离的 HERMES_HOME」开关则**合并写入** `~/.hermes/config.yaml`，只改这两个键、其余原样保留。
4. **默认服务商改为 `opencode-free`（OpenCode Zen 免费额度）**，原先默认启用的「本地演示 (Mock)」改为**默认关闭**（仍可随时打开）。详见下面「默认服务商」一节——包含免费层的真实限制。

---

> 代码为**按公开文档与界面行为从零实现**，未复制 Cherry Studio 源码。Cherry Studio 社区版采用 **AGPL-3.0**：若你改为直接 fork 官方仓库二次开发，衍生产物必须继续以 AGPL-3.0 开源并保留版权与变更声明。

---

## 运行

```bash
npm install          # node-pty 为可选依赖，装不上会自动回退到管道模式
npm run build        # 构建前端到 web/dist
npm run dev          # 启动服务（默认 http://localhost:3000）
```

生产：`npm start`（= build + dev）。开发热更新：`npx vite --config web/vite.config.js`（前端 5173，已配 `/api`、`/gateway`、`/ws` 代理）。

测试与验证：

```bash
npm test                            # 六个单元测试（83 项）：线上请求体 / Windows 引号与 spawn / 安装检测 / 服务商与注册表 / 终止进程 / 网络与代理
npm run test:wire                   # 抓真实发出的 HTTP 请求体，断言四种协议的 model 都是字符串 id
npm run test:win                    # Windows 的引号风格与 .cmd spawn 规则（伪造 process.platform）
npm run test:detect                 # 主流智能体的检测优先级、备用命令名、通配目录展开、Windows .cmd 优先、失败时的诊断回报
npm run test:providers              # 默认服务商 / 免 Key 凭据链 / 6 个智能体注册项（DSH、Hermes、OpenClaw 的配置写入）
npm run test:kill                   # 终止进程：进程树、Windows 计划、Session 端到端、崩溃面
npm run test:net                    # 网络与代理：三档模式是否真的改变出站行为、绕过规则、系统代理输出解析、
                                    #   强制直连无视环境变量、错误翻译、DNS/TCP/TLS/HTTP 四步诊断、代理透传给子进程
npm run test:smoke                  # jsdom 驱动真实 UI，86 项断言全通过（需服务已在 3000 端口运行）
npm run verify:cli                  # 用真实 CLI 二进制验证统一网关四种方言（离线，无需 API 密钥）
                                    # 未装的工具用 npm run verify:cli:install 自动托管安装
                                    # 也可 --only=codex,pi 只跑部分
```

> `npm run test:wire` 守的是一个真实踩过的坑：设置里存的是**模型记录对象**（`{ id, name, capabilities }`），
> 而 OpenAI / Anthropic / Responses 要 body 里的字符串、Gemini 要 URL 里的字符串。把对象直接发出去，
> 严格的上游会回 `HTTP 400: model: invalid type: map, expected a string`。现在 `streamChat()` 入口统一归一化，
> 模型记录改由 `ctx.modelInfo` 传递（本地演示通道靠它判断 vision / reasoning 能力）。

---

## 架构

```
agent-studio/
├── server/                       Node.js + Express + ws
│   ├── index.js                  HTTP 服务、SPA 静态托管、WebSocket 升级、启动时数据播种
│   ├── store.js                  JSON 持久化（表名对齐原版：assistants/topics/messages/settings/minapps/files）
│   ├── config/
│   │   ├── providers.js          38 个内置服务商 + 模型能力词表
│   │   ├── minapps.js            34 个内置小程序
│   │   └── codeCliTools.js       6 个主流智能体 CLI 的安装/检测/启动规则与 env 构造
│   ├── net/                      出站网络层（Node 的 fetch 不跟随系统代理，这一层补齐）
│   │   ├── proxy.js              三档代理模式、Windows 注册表 / macOS scutil / 环境变量探测、
│   │   │                         undici dispatcher 安装、强制 IPv4、透传给子进程的 proxyEnv()
│   │   └── diagnose.js           DNS → TCP → TLS → HTTP 四步诊断
│   ├── llm/                      协议适配层
│   │   ├── net.js                llmFetch：把 undici 的裸 "fetch failed" 翻译成原因 + 建议
│   │   ├── errors.js             ApiError
│   │   ├── sse.js                SSE 帧解析 + parseJsonResponse（正文不是 JSON 时说明地址填错）
│   │   ├── message.js            多模态内容归一化（text / image_url / base64）
│   │   ├── openai.js             /v1/chat/completions（含 Azure、Ollama、各类中转站）
│   │   ├── responses.js          OpenAI Responses API
│   │   ├── anthropic.js          /v1/messages（含 thinking_delta）
│   │   ├── gemini.js             :streamGenerateContent?alt=sse
│   │   ├── mock.js               本地演示通道
│   │   └── index.js              统一分发 + 检查连通性 + 拉取模型清单
│   ├── gateway/                  统一网关（主流智能体的核心）
│   │   ├── emitters.js           把归一化事件流重新编码成 Anthropic/OpenAI/Responses/Gemini 四种 SSE
│   │   └── index.js              四种方言的请求解析 + 路由
│   ├── codecli/
│   │   ├── manager.js            托管安装、登录 shell 环境检测、npm 版本比对
│   │   ├── procKill.js           终止进程树的权威实现（Windows taskkill /T /F、POSIX 进程组、受保护 pid）
│   │   ├── winShell.js           Windows 的 .cmd / 引号 / spawn 规则
│   │   └── terminal.js           PTY 会话池（node-pty，回退 child_process）、目录浏览
│   └── routes/                   settings / providers / chatData / chat / files / minapps / codecli / network
├── scripts/
│   ├── smoke.mjs                 jsdom 冒烟测试（86 项，构建单文件产物后驱动真实 UI）
│   ├── test-net.mjs              网络与代理（26 项）
│   ├── test-kill.mjs             终止进程（9 项）
│   ├── test-providers.mjs        服务商与智能体注册表（17 项）
│   ├── test-detection.mjs        CLI 检测（9 项）
│   ├── test-win-quoting.mjs      Windows 引号与 spawn（12 项）
│   ├── test-wire-body.mjs        线上请求体（10 项）
│   └── verify-clis.mjs           真实 CLI × 统一网关 端到端验证
└── web/                          React 18 + Ant Design 5 + Redux Toolkit + Vite
    └── src/
        ├── App.jsx  theme.js  styles.css
        ├── api/                  接口封装 + SSE 流式消费
        ├── store/                Redux（chat 流式状态机 / settings / providers / minapps / codecli）
        ├── components/           Navbar、Markdown、MessageItem、ModelSelector、Inputbar、TerminalView、DirPicker
        └── pages/                chat / minapps / codecli / settings
```

**单端口**：Express 同时提供 API、统一网关、静态前端与 WebSocket，因此浏览器预览不需要 CORS 或额外端口。

---

## 统一网关是怎么工作的

主流智能体里选「统一网关」时，CLI 拿到的是一个本地地址，例如：

```
ANTHROPIC_BASE_URL = http://127.0.0.1:3000/gateway/anthropic/claude-code
ANTHROPIC_AUTH_TOKEN = agent-studio-gateway       # 占位符，真实密钥不出服务端
```

网关收到 CLI 的原生请求后：**解析该方言 → 归一化成内部消息 → 用你在「模型服务」里配置的服务商与模型发起真实请求 → 再把事件流重新编码回 CLI 期望的方言**。

所以 Claude Code 可以跑在 DeepSeek 上，Codex 可以跑在 Gemini 上，而 CLI 完全无感。支持四种方言的双向翻译：

| 方言 | 入口 |
| --- | --- |
| Anthropic Messages | `POST /gateway/anthropic/:id/v1/messages` |
| OpenAI Chat Completions | `POST /gateway/openai/:id/v1/chat/completions` |
| OpenAI Responses | `POST /gateway/openai-response/:id/v1/responses` |
| Gemini | `POST /gateway/gemini/:id/v1beta/models/:model:streamGenerateContent` |

每种方言都同时支持流式与非流式（`stream:false` 返回该协议的完整 JSON）。选「服务商直连」则跳过网关，把真实 API 地址与密钥交给 CLI。

### 真实 CLI 验证矩阵

三个方言都用**真实 CLI 二进制**跑通过头无交互（`-p` / `exec`）请求，后端指向离线的「本地演示 (Mock)」服务商——所以不需要任何 API 密钥：CLI 输出里出现的回复只可能来自 `CLI → 网关 → 方言翻译 → mock`。

| CLI | 版本 | 网关方言 | 结果 |
| --- | --- | --- | --- |
| Claude Code | 2.1.273 | Anthropic Messages | ✅ |
| Codex | 0.154.0 | OpenAI Responses | ✅ |
| Pi Agent | 0.73.1 | OpenAI Chat Completions | ✅ |

复现（服务需已启动）：

```bash
npm run verify:cli                   # 3/3 通过；--only=codex,pi 可只跑部分
                                    # 托管副本被清理过时用 npm run verify:cli:install 重新安装
```

> Gemini CLI 已从工具清单移除，矩阵因此从 4/4 变成 3/3；网关的 Gemini 方言本身保留（模型服务里 `gemini` 类型服务商仍在用）。
> 另外三个（DeepSeek Harness / Hermes Agent / OpenClaw）**没有可离线验证的无头通道**，不在矩阵内：DSH 的 `dsh --profile headless` 需要真实 DeepSeek 账号且要求 Node ≥ 22.19；OpenClaw 可以用 `openclaw tui --local --message "…"`，但安装包约 200MB、要求 Node ≥ 24.16；Hermes 官方文档没有非交互模式。它们的启动参数与配置写入由 `npm run test:providers` 断言（含生成的 `config.yaml` / `openclaw.json` 的实际内容）。

### 每个 CLI 的配置差异（实测 = 真机跑过；文档 = 依据官方文档实现）

| CLI | 生效方式 |
| --- | --- |
| Claude Code | `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL`；接非 Anthropic 模型时自动加 `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1`，否则会卡在 `unrecognized_model` 确认窗 |
| Codex | **忽略 `OPENAI_BASE_URL`**。由 `writeConfig` 生成 `data/codecli/codex/agent-studio-config/config.toml`（`[model_providers.agent-studio]` + `wire_api="responses"` + `base_url`），并用 `CODEX_HOME` 把配置目录隔离在托管目录内 |
| Pi Agent | **忽略 `OPENAI_BASE_URL`**（实测）。由 `writeConfig` 生成 `models.json` 并用 `PI_CODING_AGENT_DIR` 隔离（不碰用户 `~/.pi`）；`--model` 需要 `provider/model` 形式 |
| DeepSeek Harness (DSH) | **账号模式**（文档）：模型与密钥在它自带的 Web UI（`dsh web`，默认 `127.0.0.1:3080`）里配，也支持 `~/.dsh/settings.yaml` 的 OpenAI 兼容 provider、`~/.dsh/.credentials.yaml` 与 `DEEPSEEK_API_KEY`。服务型工具，端口取自注册表的 `servicePort` |
| Hermes Agent | **文件式配置**（文档）：`config.yaml` 是唯一配置源（上游已移除 `.env` 里的 `LLM_MODEL`），所以写 `model.provider/default` + `providers.agent-studio{type: openai, base_url, key_env, default_model, models}`；默认用 `HERMES_HOME` 指向托管目录做隔离，关掉开关则**只合并这两个键**到 `~/.hermes/config.yaml` |
| OpenClaw | **文件式配置**（文档）：`~/.openclaw/openclaw.json` 的 `models.providers`（`api: "openai-completions"`、`apiKey` 用 `${ENV}` 引用）**加上** `agents.defaults.models` 白名单与 `agents.defaults.model.primary`；JSON5 保守解析后合并，解析失败则拒绝改写并在终端说明 |

> 网关的 Gemini 方言**不发送** `data: [DONE]` 结束帧——真实 Gemini API 也不发，多发会让 Gemini CLI 抛 `Unexpected token 'D'`。

`POST /api/codecli/tools/:id/preview?raw=1` 会额外返回未脱敏的 `env`、机器可读的 `bin` / `args` 与 `warning`（工具拒绝改写配置文件时的说明），供脚本按 UI 完全相同的方式启动 CLI（不带 `raw` 时密钥仍是 `agen••••eway` 形式）。

---

## 所有模型都报「fetch failed」？（网络与代理）

**症状**：无论在智能助手里对话，还是启动主流智能体后让它跑，一律 `请求失败 fetch failed`；换服务商、换模型都一样。

**根因**：所有模型调用都由 Node 服务端发出，而 **Node 内置 `fetch`（undici）既不跟随操作系统的代理设置，也不读 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量**——这一点和 Electron 版的 Cherry Studio 完全不同（Chromium 会自动走系统代理，所以原版"开了加速器就能用"）。只要这台机器需要代理才能访问 `api.openai.com` / `api.anthropic.com` 这类地址，**每一次调用都会失败**，而 undici 只会抛一句 `TypeError: fetch failed`，真实原因（DNS 解析不到、连接被拒、超时、证书、代理没启动）全都在 `err.cause` 里，以前从来没有被打出来。
> 这也是 Cherry Studio 官方文档的原话：遇到「连接超时」「API 请求失败」等红色报错，**先确认加速器已开启、代理模式是否为「系统代理」——这是最常见的原因**。

**现在的行为**（设置 → 网络代理，对齐原版三档）：

| 代理模式 | 行为 |
| --- | --- |
| **系统代理**（默认） | Windows 读注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`（`ProxyEnable` / `ProxyServer`（含 `http=…;https=…;socks=…` 写法）/ `ProxyOverride`），macOS 读 `scutil --proxy`（HTTPS → HTTP → SOCKS 优先序 + `ExceptionsList`），都没有则回退 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` 环境变量，最后才是直连。检测到 **PAC 脚本**（`AutoConfigURL`）时会明确提示：Node 侧无法执行 PAC，请在「自定义代理」里填真实端口。 |
| **自定义代理** | 手填地址，`127.0.0.1:7890` 会自动补成 `http://…`；支持 `http://` `https://` `socks5://`。配 **代理绕过规则**（默认 `localhost,127.0.0.1,::1`，支持 `*.example.com` 子域后缀与 `host:port`，`*` 表示全部直连；CIDR 网段不按网段匹配，这是 undici 的限制，界面里写明了）。 |
| **不使用代理** | 强制直连，**即使环境变量里配了代理也不使用**（用真正的 `Agent` 而不是读 env 的 dispatcher）。 |

另外：**强制 IPv4** 开关会把 DNS 结果顺序改成 `ipv4first` 并让连接只用 IPv4——IPv6 路由不通时（`ENETUNREACH` / `EHOSTUNREACH`）undici 同样只报 fetch failed。设置**保存后立即生效**（`setGlobalDispatcher` 是进程级的），不需要重启服务；刚打开加速器的话可以点「重新探测系统代理」。

**智能体子进程也会拿到代理**：走统一网关时上游请求由服务端发出（已被 dispatcher 接管），但**账号模式**下 CLI 是自己直连上游的，而 Node 写的 CLI 基本只认环境变量，所以启动时会注入 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`（大小写各一份）。否则会出现"对话里能用了、智能体里还是 fetch failed"。预览启动命令时能看到这些变量（带凭据的代理地址会打码）。

**错误信息不再是裸 fetch failed**：`server/llm/net.js` 把 `err.cause` 展开成「目标域名:端口 + 原因 + 针对性建议 + 当前生效的代理 + 原始错误」，覆盖 `ENOTFOUND`（DNS/污染/需要代理）、`ECONNREFUSED`（代理没启动或端口错、本地服务没起）、`ETIMEDOUT`（被墙/防火墙）、`ECONNRESET`、`EHOSTUNREACH` / `ENETUNREACH`（IPv6/路由，建议开强制 IPv4）、`EACCES` / `EPERM`（**Windows 上常见：360 / 火绒 / Defender 拦了 node.exe 出站**）、`UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `SELF_SIGNED_CERT_IN_CHAIN`（公司网关或抓包工具换证书，设 `NODE_EXTRA_CA_CERTS`）、`ERR_INVALID_URL`（apiHost 填错）等。用户主动中止（AbortError）仍然原样透传，不会被误报成网络故障。

**网络诊断**（设置 → 网络代理 → 网络诊断）按四步逐个探测并给出结论：

1. **目标地址**：apiHost 是否合法（为空/写成网页地址会在这一步就被指出来）
2. **代理配置**：当前模式、地址、来源、绕过规则
3. **DNS 解析**：解析出的地址与 IPv4/IPv6 条数（只有 AAAA 时会提示开强制 IPv4）
4. **TCP 连接（直连）** / **TLS 握手（直连）**：判断"这台机器本身能不能到达对方"，证书错误会指到 `NODE_EXTRA_CA_CERTS`
5. **HTTP 请求（真实链路）**：走当前代理设置，也就是用户实际会走的路径

前三步直连、最后一步可能经代理，**两组对比就能区分「需要代理」和「代理本身坏了」**。结论会明确分成：链路正常 / 网络通但是鉴权（401、403）/ 网络通但地址指向的不是模型接口（200 返回 HTML）/ 网络不通并指出卡在哪一步。

回归测试：`npm run test:net`（26 项）用「指向死端口的代理」证明 dispatcher 真的改变了出站行为、绕过规则真的让本地请求直连、`不使用代理` 真的无视环境变量，并覆盖 Windows 注册表与 macOS `scutil` 真实输出的解析；smoke 里另有 16 项走真实 HTTP 与真实 UI。

---

## 终端里打中文，窗口会向左跳（缩进）？

**症状**：启动智能体后在终端里用中文输入法打字，整个终端窗口会向左位移一下，看起来像被缩进了。

**两个原因，都已修**：

1. **焦点滚动**。xterm 的隐藏输入框 `.xterm-helper-textarea` 平时停在 `left:-9999em`（xterm 自带的注释："Move textarea out of the screen to the far left"），输入法开始组合时它被移到光标处，而浏览器为了让**获得焦点的元素**可见会滚动最近的可滚动祖先。关键是：`overflow:hidden` 的盒子**仍然可以被焦点/程序滚动**（只是没有滚动条），于是横向就被拽过去了。
   → `.terminal-body` / `.terminal-panel` 改用 **`overflow: clip`**（真正不可滚动，保留 `hidden` 作为老浏览器回退）；同时在捕获阶段监听 `scroll`，把终端祖先链上的 `scrollLeft` 一律归零（纵向页面滚动是合法的，不动；xterm 自己的 viewport 纵向滚动也不动），并把留在屏幕外的输入框夹回盒子内（`left/top` 为负或超出容器时归零，组合时 xterm 自己设的光标位置不受影响，所以输入法候选框仍然跟着光标）。
2. **组合期间反复重排**。输入法组合时 DOM 尺寸抖动会触发 `ResizeObserver → fit()`，终端列数一变，TUI 就按新宽度重画，看起来也像窗口在动。
   → `fit()` 去抖 80ms，**组合期间不重排**，`compositionend` 之后再 fit 一次。

**顺带修的两件事**：终端字体栈原来只有 `SF Mono / Menlo / Consolas / Courier New`——**这些字体都没有 CJK 字形**，中文会逐字回退到系统默认中文字体（非等宽），字形宽度与 xterm 的两格宽对不上，视觉上就是"中文挤在一起/错位"。现在补上 `PingFang SC`、`Hiragino Sans GB`、`Microsoft YaHei`、`Noto Sans Mono CJK SC`、`Source Han Mono SC`（拉丁字符仍由前面的等宽字体渲染，度量不变）。另外 `start.bat` 开头执行 `chcp 65001`，把控制台代码页切到 UTF-8：服务端那些中文日志、以及继承同一控制台的 CLI 会话都不会再变成乱码。

> 如果修完之后**中文本身**在 CLI 自己的输入框里仍然错位（不是窗口移动），那多半是该 CLI 对全角字符的宽度计算问题（按 1 列而不是 2 列算），属于上游 CLI 的渲染行为，我们只能保证终端这一层不改它的输出。

回归守卫：smoke 里有 8 项静态断言（`overflow: clip`、组合事件监听、输入框夹回、祖先横向滚动归零、fit 去抖、卸载时移除监听，以及这些代码确实进了构建产物）——xterm 需要 canvas，jsdom 里跑不起来，所以用源码 + 产物双重守卫。

---

## 终止进程：为什么会「终止失败 + 整个程序退出」

现象：在 Pi Agent / Claude Code 的终端里点「终止进程」，CLI 没死，然后整个 Agent Studio 消失了。三个独立原因叠在一起，都已修：

1. **只杀了一个进程，没杀进程树。** Windows 上 `child.kill()` 就是 `TerminateProcess`，作用域是**单个进程**；而每个 npm 装的 CLI 都是通过 `%ComSpec% /d /s /c "<tool>.cmd" …` 起的，我们手里的 pid 是 `cmd.exe` 的，真正的 `node <tool>.js` 是它的孙子进程——于是「点了终止、终端说死了、CLI 还在跑」。POSIX 侧同理：node-pty 的 `kill()` 是 `process.kill(this.pid, 'SIGHUP')`，也只打直接子进程。
   → 现在统一由 `server/codecli/procKill.js` 处理：**Windows 用 `taskkill /pid <pid> /T /F`**（`/T` 整棵树、`/F` 强制），**POSIX 用 `kill(-pid, SIGTERM)` 打进程组**（PTY 子进程本身是会话首进程；管道模式的子进程改为 `detached: true` 自建进程组），1.5 秒没退就升级 `SIGKILL`，最后**轮询确认**真的没了。
2. **node-pty 在 Windows 上的 `kill()` 会杀掉控制台里的所有进程——包括本服务。** `WindowsPtyAgent.kill()` 会枚举**控制台进程列表**并对其中每个 pid 调 `process.kill()`，它自己的注释写明这是故意的：*"If we do not force kill all processes here, **node servers in particular** seem to become detached and remain running (see Microsoft/vscode#26807)"*。当那份列表是 Agent Studio 自己所在控制台（`start.bat` 那个窗口）时，列表里就有 `cmd.exe` 与本服务，而 Windows 的 `process.kill()` 是 `TerminateProcess`——**没有异常、没有回调、无法捕获**，程序直接消失。ConPTY 路径还有另一种失败：它 `fork` 一个 `conpty_console_list_agent` 去做 `FreeConsole()` + `AttachConsole(pid)`，任一步失败就在子进程里抛错，node-pty 等 5 秒超时后只杀 shell pid，CLI 依旧活着。
   → **Windows 上不再调用 node-pty 的 `kill()`**（进程树已被 taskkill 清干净，node-pty 会自己收到退出事件并释放 conpty）；POSIX 上仍调用它来释放 pty（此时子进程已死，无副作用）。
3. **两处未捕获异常会直接结束进程。** node-pty 的 `WindowsTerminal` 在 socket 出错时会 `throw err`，条件是 `listeners('error').length < 2`，而我们一个都没挂；管道模式的 `child.stdin` 没有 `error` 监听，往已死子进程的 stdin 写入会 EPIPE，而 Node 对没有监听者的 `error` 事件是**抛成未捕获异常**。
   → 给 pty 挂两个 `error` 监听（一个把错误打印进终端，一个专门满足计数）、给 `stdin` 挂 `error` 吞掉 EPIPE、终止后 `write()` 直接空转；`server/index.js` 增加 `uncaughtException` / `unhandledRejection` 兜底，记录到控制台与 `data/crash.log` 后**继续服务**；`start.bat` 在服务退出时打印退出码并提示去看 `data/crash.log`。

接口与界面也跟着变诚实：`POST /api/codecli/sessions/:id/kill` 返回 `{ ok, killed, method[], exitCode, error? }`（`method` 是实际用到的手段，例如 `["taskkill /pid 4321 /T /F"]` 或 `["kill(-4321, SIGTERM)", "SIGKILL"]`），不再是含糊的 `true/false`；UI 按钮变「终止中…」并用 toast 说清结果；WebSocket 那条重复且无回执的 kill 通道已去掉。另外有硬保护：**本服务自己与父进程的 pid 永远拒绝作为终止目标**。

回归测试：`npm run test:kill`（9 项，含「只杀直接子进程会留下孙子进程」的 bug 复现、真实进程树终止、Session 端到端、未知会话不 500、终止后写入不崩），以及 smoke 里经 HTTP 的完整终止链路。

---

## 数据存储

全部在本地 `data/`：

- `data/db.json` —— 全部业务数据（表名与原版一致：`assistants` / `topics` / `messages` / `settings` / `minapps` / `providers` / `codecli` / `files`），120ms 防抖 + 原子写入（临时文件 + rename）
- `data/files/` —— 上传的图片与附件
- `data/codecli/<tool>/` —— Agent Studio 托管安装的 CLI 副本（每个工具独立 `node_modules`，**不会覆盖系统 PATH 中的版本**）。
  这是**可重建的本地产物**：每个工具上百 MB、数千文件，所以既不进下载的压缩包，也不该留在工作区快照里——
  删掉整个目录后在「主流智能体」点「安装」即可重建，或用「手动指定可执行文件路径」直接指向系统里已有的那份。

设置 → 备份与恢复 支持数据库 JSON 导出/导入；**不含知识库原始文件与 MCP 保险库密钥**，完整迁移请备份整个 `data`。

---

## 与原版 Electron 的已知差异

选择 Web 架构后，有四处受平台限制，均已做降级处理：

1. **小程序内嵌**：原版用 Electron `webview`，可绕过 `X-Frame-Options` / `frame-ancestors`。浏览器里的 `iframe` 无法绕过，ChatGPT、Claude 等站点会拒绝内嵌。因此**点击卡片默认在浏览器新标签页打开**；内嵌视图保留为卡片悬停时的次要入口（支持内嵌的站点——多数文档站、CodeSandbox、JSFiddle 等——仍可在应用内使用，并可在「管理」里为单个应用打开「内嵌打开」开关）。
2. **原生目录选择框**：改为服务端目录浏览（`GET /api/codecli/fs/list`），因为浏览器拿不到本地文件系统。
3. **系统代理**：Electron 里的 Chromium 会自动跟随操作系统代理，Node 的 `fetch`（undici）**不会**，也不读 `HTTP_PROXY` 环境变量。所以「设置 → 网络代理」是我们显式实现的：三档代理模式（系统 / 自定义 / 不使用）+ 绕过规则 + 强制 IPv4，并把代理透传给智能体子进程。见「所有模型都报 fetch failed」一节。
4. **终端**：CLI 进程运行在 **Node 服务端**，通过 WebSocket 把 PTY 输出流给浏览器里的 xterm.js。这意味着 CLI 操作的是服务器文件系统——部署在你本机时与原版等价，部署在远端时需注意这一点。刷新页面不会杀掉 CLI，重连会回放服务端保留的 256KB 滚屏缓冲。

另外为了让你在没有 API Key 时也能验证全链路，内置了一个 **「本地演示 (Mock)」** 服务商（离线、可开关）。它不是原版的功能，只用于演示；**现在默认关闭**，出厂默认服务商改成了 `opencode-free`（见下）。想离线试用就在「设置 → 模型服务」把 Mock 打开即可。

---

## 默认服务商：OpenCode Zen（`opencode-free`）

`https://opencode.ai/zen/v1`，OpenAI 兼容（`/chat/completions`、`/models`）。出厂即启用，且是唯一默认启用的服务商，默认模型 `big-pickle`。

**免 API Key 的三级取值链**（`server/services/openCodeAuth.js`）：

1. 你在「设置 → 模型服务」里手填的 Key（`keySource: 'user'`）；
2. **本机 OpenCode CLI 的登录凭据**——自动读取 `~/.local/share/opencode/auth.json`（也找 `XDG_DATA_HOME` / `OPENCODE_DATA_HOME` / `%LOCALAPPDATA%` / macOS `Application Support` 等位置），只用 `type: "api"` 的条目，oauth 登录不算（`keySource: 'opencode-cli'`）。**借来的 Key 不会下发到浏览器**：接口只回 `keySource` 与文件路径，密钥留在服务端；
3. 都没有就不带 Key 直接请求（`keySource: 'none'`）。

**必须说清楚的真实限制**（2026-09 实测）：Zen 的免费层对第三方客户端返回
`HTTP 403 · OpenCode's free tier can only be used from within OpenCode`——`big-pickle`、`mimo-v2.5-free`、`nemotron-3-ultra-free`、`nemotron-3.5-lightning-free`、`ling-3.0-flash-fin-free`、`muse-spark-*-contributor-free` 都是这个结果；`deepseek-v4-flash-free` 当时上游返回 `400 Model is unavailable`。**没有做 UA / 头部伪装**（那是绕过服务方限制）。所以开箱即用有三条路：

- 本机装过 OpenCode CLI 的话，跑一次 `opencode auth login`，Agent Studio 自动复用凭据；
- 或到 <https://opencode.ai/auth> 免费注册，把 Zen API Key 填进服务商；
- 或打开「本地演示 (Mock)」离线试用；也可以换成任何你有密钥的服务商。

被拦时不会只丢一个 `403 Forbidden`：错误信息里直接写清上面三条出路（`server/llm/openai.js` 的 `httpError`）。「检查」按钮对这个服务商**不走 `GET /models`**（Zen 的 `/models` 免 Key 也返回 200，会误报连通），而是真实发一次 1 token 对话（注册表里的 `checkViaChat: true`）。「管理模型 → 获取模型列表」则可以免 Key 拉到 Zen 全部 71 个模型（非 `-free` 模型需要 Zen 余额）。

---

## 未实现（按你的要求，非必要不做）

知识库 / RAG、AI 绘画、翻译、智能体市场、MCP 服务、语音输入输出、WebDAV 备份、快捷指令、Agent 模式、企业版后台。数据模型为它们预留了扩展位（`capabilities` 已含 `embedding` / `rerank` / `image-generation` / `tts` / `stt`）。

---

## 主要 API

```
GET    /api/settings                PUT  /api/settings             (含代理设置，保存即生效)
GET    /api/network/status          POST /api/network/reapply      (重新探测系统代理)
POST   /api/network/diagnose        (DNS → TCP → TLS → HTTP 四步)
GET    /api/providers               POST /api/providers            (自定义服务商)
PUT    /api/providers/:id           DEL  /api/providers/:id
POST   /api/providers/:id/check     POST /api/providers/:id/models/fetch
PUT    /api/providers/:id/models    POST /api/providers/:id/models
GET    /api/assistants              POST /api/assistants           PUT/DEL /api/assistants/:id
GET    /api/assistants/:id/topics   POST /api/topics               PUT/DEL /api/topics/:id
POST   /api/topics/:id/clear        GET  /api/topics/:id/messages
POST   /api/messages                PUT  /api/messages/:id         DEL /api/messages/:id
POST   /api/chat/stream   (SSE)     POST /api/chat/auto-name
GET    /api/minapps                 POST /api/minapps              PUT/DEL /api/minapps/:id
POST   /api/minapps/reorder
GET    /api/codecli/tools           POST /api/codecli/tools/:id/install  (SSE 日志)
POST   /api/codecli/tools/:id/uninstall      GET /api/codecli/tools/:id/detect
GET    /api/codecli/tools/:id/providers      PUT /api/codecli/configs/:id
POST   /api/codecli/tools/:id/preview        POST /api/codecli/tools/:id/launch
GET    /api/codecli/terminals       GET  /api/codecli/fs/list
WS     /ws/terminal?session=<id>
```

`POST /api/chat/stream` 的事件：`start` / `delta` / `reasoning` / `usage` / `done`(含 metrics) / `error`。


## 工具调用修复

旧版网关丢失工具协议字段的问题已补齐。验证范围、升级方式以及 CMD 直连 Pi 的排查步骤见 [工具调用修复说明](工具调用修复说明.md)。新增 `npm run test:tools`（37 项协议回归），不代表已实测所有外部模型和 CLI。


## 智能助手与添加助手更新

对话页「＋」现在进入助手库：分类/搜索 → 提示词预览 → 添加/进入对话，也可自定义新建。新建与编辑统一支持名称、描述、图标、分组、模型、提示词和参数，保留已有数据。详细源码对照、实现边界与验证见 [智能助手更新说明](docs/智能助手更新说明.md)。


## v1.0.3 — 话题归入助手二级列表

- 移除中间独立话题栏，话题显示在当前选中助手下面；箭头可展开/收起，切换助手自动展开对应话题。
- 保留历史数据，支持新建、重命名、置顶、删除和历史话题切换；删除当前话题后切换到剩余话题。
- 对话顶部仍可新建话题；移除旧的“显示话题栏”设置，旧配置不会隐藏新二级列表。
- 话题新建框支持 Enter 提交，提交期间防重复。
- 助手/话题交互回归 26/26，四模块 smoke 86/86，单测与正式构建通过。

### 覆盖更新与版本确认

先关闭旧服务并备份 data，把压缩包内 agent-studio 文件夹**里面的内容**覆盖到原项目根目录，保留 data。运行该目录的 start.bat，等待重新构建完成，再 Ctrl+F5 刷新浏览器。

当时的 v1.0.3 版本助手栏显示 **v1.0.3**；其 `/api/health` 返回 `version: 1.0.3`、`build: assistant-topic-tree-r1`。启动脚本沿用端口占用即停止、每次重新构建的升级保护。

发布包含 `RELEASE-MANIFEST.json`：记录此版发布文件的 SHA-256；打包后逐一核对包内字节与清单，并校验构建 JS 内的版本标识。用户 data 和 node_modules 不进入压缩包。
