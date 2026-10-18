# Agent Studio · Windows 使用说明

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

## 快速开始

1. 把压缩包**完整解压**到一个普通目录（建议纯英文路径，例如 `D:\agent-studio`）
2. 双击 **`start.bat`**
3. 首次运行会自动 `npm install`（几分钟，取决于网速），完成后自动打开浏览器
4. 访问 <http://localhost:3000>

换端口：在命令行里运行 `start.bat 3001`。

停止服务：在服务窗口按 `Ctrl+C`，或直接关闭窗口。

---

## 环境要求

| 项目 | 要求 |
| --- | --- |
| 系统 | Windows 10 / 11（x64）；不支持 Windows 7 |
| Node.js | **至少 20.19，推荐 24 LTS**：<https://nodejs.org/>（安装后需**重开**终端才能生效） |
| 网络 | 仅首次 `npm install` 需要；之后可完全离线运行（内置「本地演示 (Mock)」服务商）。**要调用海外模型 API 时注意**：Node 的出站请求不跟随系统代理，请在 设置 → 网络代理 选「系统代理」（默认）或填自定义代理地址，否则所有模型都会报 `fetch failed`（见下文专章） |
| 磁盘 | 项目本体约 20 MB；`node_modules` 约 300 MB；主流智能体每托管安装一个 CLI 再加 100–350 MB（OpenClaw 约 200 MB） |
| 可选 | Visual Studio Build Tools（含「使用 C++ 的桌面开发」），用于编译 `node-pty` 获得**真 PTY 终端** |

---

## 为什么启动脚本是英文的？（编码说明）

这是刻意为之，也是防止「双击后窗口一闪就没了」的关键：

- `cmd.exe` 用**当前 OEM 代码页**（中文系统是 GBK/936，英文系统是 437）去读 `.bat` 文件本身。如果 `.bat` 存成 UTF-8 又带中文，在中文系统上会乱码；带 BOM 时第一行命令还会直接报错；一旦报错行落在 `if`/`goto` 结构里，脚本就中途退出 → 窗口闪退。
- 所以 `start.bat` 是**纯 ASCII、CRLF 换行、无 BOM**，内容不含任何中文，任何代码页下都能正确解析。
- 脚本开头执行了 `chcp 65001`，把控制台切到 UTF-8 —— 因此 **Node 服务打印的中文和 🤖 表情能正常显示**，浏览器里的界面本身就是完整中文。
- 所有中文说明放在这份 Markdown（UTF-8）里，用编辑器或浏览器打开都不会乱码。

另外脚本在**每一个**失败分支（找不到 Node、版本过旧、`npm install` 失败、构建失败等）都带 `pause`，窗口会停住让你看清错误信息，不会闪退。

---

## 数据与重置

- 所有数据都在项目目录的 `data\` 下：`db.json`（对话/智能助手/话题/设置/服务商/小程序/主流智能体配置）、`files\`（上传的图片附件）、`codecli\`（Agent Studio 托管安装的 CLI 副本）
- **删除 `data\` 目录即完全重置**，下次启动会重新播种默认数据
- 托管安装的 CLI 只写进 `data\codecli\<工具>\`，**不会覆盖你系统里已有的版本**
- 设置 → 备份与恢复 支持数据库 JSON 导出/导入；**不含知识库原始文件与 MCP 保险库密钥**，完整迁移请备份整个 `data`

---

## 常见问题

**1. 双击后窗口一闪就没 / 什么都没发生**

用命令行手动跑一次，就能看到真正的报错：

```bat
cd /d D:\agent-studio
start.bat
```

脚本本身在所有错误分支都会 `pause`；如果连提示都没有，通常是：从压缩包内直接双击（脚本会检测 `\Temp\` 路径并提示先解压）、或 `.bat` 被安全软件拦截。

**2. Windows 提示「已保护你的电脑」/ 杀毒软件拦截**

右键 `start.bat` → 属性 → 勾选底部「解除锁定 (Unblock)」→ 确定。或在 SmartScreen 弹窗里点「更多信息 → 仍要运行」。

**3. `npm install` 很慢或失败**

```bat
npm config set registry https://registry.npmmirror.com
start.bat
```

若卡在代理：`npm config get proxy` / `npm config delete proxy`。项目目录不要放在 `C:\Program Files` 下（需要管理员权限）。

**4. 提示 node-pty 编译失败**

不影响使用：脚本会自动用 `--omit=optional` 重试，终端降级为**管道模式**（普通命令能用，但 Claude Code / Codex 这类全屏 TUI 的渲染会打折扣）。要获得真 PTY，安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 勾选「使用 C++ 的桌面开发」，然后删除 `node_modules` 重新运行 `start.bat`。

**5. 端口 3000 被占用**

`start.bat 3001`，或用 `netstat -ano | findstr :3000` 找到占用进程后在任务管理器里结束它。

**6. 防火墙弹窗**

允许「专用网络」即可。服务默认监听 `0.0.0.0`，这样同一局域网的其他设备也能访问；只想本机访问可先设置环境变量再启动：`set HOST=127.0.0.1`。

**7. 小程序（Mini Apps）里 ChatGPT / Claude 打不开**

浏览器版受 `X-Frame-Options` 限制无法内嵌这些站点（原版用 Electron `webview` 才能绕过）。界面会给出提示并提供「在浏览器中打开」；文档站、CodeSandbox、JSFiddle 等支持内嵌的站点正常。

**8. 界面中文乱码 / 终端输出乱码**

浏览器界面是 UTF-8，不会乱码。终端窗口里的乱码请确认是通过 `start.bat` 启动的（它执行了 `chcp 65001`）；如果你自己开 `cmd` 手动运行 `node server\index.js`，先执行一次 `chcp 65001`。

---

## 已经装好的 CLI 检测不到？

检测按下面的顺序找可执行文件，任何一步命中就停：

1. **Agent Studio 托管副本**：`data\codecli\<工具>\node_modules\.bin\<命令>.cmd`
2. **PATH 查询**：`where <命令>`，对每个别名都试一遍（例如 Qoder 会同时找 `qoder` 和 `qodercli`）
3. **注册表里的用户/系统 PATH**：`HKCU\Environment` 与 `HKLM\...\Session Manager\Environment`
   —— 这一步是关键：如果服务不是由你双击的 `start.bat` 拉起（而是服务、编辑器、开机自启），
   它继承的 PATH 可能是**安装 Node / nvm / scoop 之前的旧快照**，于是明明装好了却找不到
4. **`npm prefix -g`**：全局 npm 安装目录（含自定义 prefix）
5. **常见安装目录扫描**：`%APPDATA%\npm`、`%LOCALAPPDATA%\npm`、`Program Files\nodejs`、
   `%NVM_SYMLINK%` / `%NVM_HOME%`（nvm-windows）、`~\scoop\shims`、`%ProgramData%\chocolatey\bin`、
   `~\.volta\bin`、`~\.bun\bin`、`~\.deno\bin`、`~\.cargo\bin`、`~\go\bin`、`~\.local\bin`、
   `~\.claude\local`（Claude Code 原生安装器）、`%LOCALAPPDATA%\AnthropicClaude`、
   `%LOCALAPPDATA%\pnpm`、`%LOCALAPPDATA%\Yarn\bin`、`%LOCALAPPDATA%\Microsoft\WindowsApps`、
   `%LOCALAPPDATA%\uv`、`~\.hermes\bin`（Hermes Agent 的托管 uv 运行时）、`~\.dsh\bin`，
   以及 **pip 的版本化目录** `%APPDATA%\Python\Python3*\Scripts` 与
   `%LOCALAPPDATA%\Programs\Python\Python3*\Scripts`（`*` 会按实际存在的 `Python311` / `Python312` … 展开）
   每个目录都会尝试 `.cmd` / `.exe` / `.ps1` / `.bat` / 无扩展名五种形式，`.cmd` 优先（npm shim）

都找不到时，界面上会出现**「为什么没检测到？」**链接：点开能看到这次检测**实际搜过哪些命令名**、
Windows 后缀优先级、PATH 查询方式，以及**扫描过的目录清单**（后端 `detectTool()` 在没命中时把这些一并回报，
不是猜的）。同一区块的输入框里**手动填可执行文件路径**即可兜底（例如
`C:\Users\you\AppData\Roaming\npm\claude.cmd`）。手动路径优先于托管副本与自动检测，留空即恢复自动。
改完点「重新检测」——它会忽略 30 秒缓存、清空 PATH 缓存并重新扫描，所以**在别的终端里刚装好的 CLI
不用重启服务就能认出来**。检测是 6 个工具**并行**跑的（每个最多 9 秒超时），列表不会卡住。

### 三个新工具的 Windows 注意事项

- **DeepSeek Harness**：npm 上的 `deepseek-harness` 只是**保留空包**（v0.0.1、没有 bin），真实包是
  **`@deepseek-ai/dsh`**（命令 `dsh`）。要求 **Node.js ≥ 22.19**（建议 24+），如果你用的是 Node 20，
  托管安装会因 `engines` 失败——先升级 Node。`dsh web` 自带浏览器 UI，默认监听 `127.0.0.1:3080`，
  模型与密钥在它自己的 Settings → Models 里配（所以这个工具是「账号模式」，不走统一网关）。
  用 `pip install deepseek-harness-sdk` 装的 Python 版同样会产出 `dsh` 命令，检测时 `deepseek-harness` /
  `deepseek` / `dsh-tui` 三个别名也会一并找。
- **Hermes Agent**：`npm i -g hermes-agent` **需要本机有 Git**（它要 clone 上游仓库），Node ≥ 20；
  Python 运行时由它自带的 `uv` 管理，装在 `%USERPROFILE%\.hermes\bin` 下，**你不需要单独装 Python**。
  走统一网关时 Agent Studio 会写 `config.yaml`（默认写进托管目录并用 `HERMES_HOME` 隔离，不碰
  `%USERPROFILE%\.hermes`；关掉「使用隔离的 HERMES_HOME」开关则合并写入你的 `config.yaml`，
  只改 `model` 与 `providers.agent-studio` 两个键，其余原样保留，YAML 注释会丢失）。
- **OpenClaw**：要求 **Node.js ≥ 24.16（或 ≥ 26.1）**，npm 包解包后约 200 MB，安装比其它工具慢得多。
  配置在 `%USERPROFILE%\.openclaw\openclaw.json`，是 **JSON5**（允许裸键、注释、单引号、尾逗号）：
  Agent Studio 会保守解析后**合并**写入 `models.providers["agent-studio"]` 与 `agents.defaults`
  （白名单少了会报 `model not allowed`），**解析不了就拒绝改写**并把原因打印到终端里，绝不清空你的配置。
  密钥写成 `${AGENT_STUDIO_GATEWAY_KEY}` 环境变量引用，不落盘。启动方式可选 `tui --local`（默认，
  内嵌 agent，不需要 Gateway）、`tui`、`gateway run`（Control UI 在 `http://127.0.0.1:18789/`）、
  `onboard`、`doctor`。旧命令名 `clawdbot` 也会被检测到。

---

## 所有模型都报「请求失败 fetch failed」？（Windows 篇，已修复）

**为什么以前会这样**：所有模型调用都由 Node 服务端发出，而 **Node 的 `fetch`（undici）不跟随 Windows 的系统代理，也不读 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量**。浏览器能打开网页、`npm install` 能装包，是因为它们各自有自己的代理配置（Chrome 走 WinINET，npm 读 `.npmrc` / 自己的 env 处理）——**这跟 Node 的 fetch 是三条独立的路**。所以在需要代理才能访问 `api.openai.com` / `api.anthropic.com` 的机器上，每一个模型调用都只会得到 undici 的一句 `fetch failed`（真实原因在 `err.cause` 里，以前从没打出来）。设置页里那个「网络代理」开关更是**只存了字段、服务端从来没应用过**。

**现在怎么修**：打开 **设置 → 网络代理**，代理模式选 **系统代理**（默认）——它会去读注册表
`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 的 `ProxyEnable` / `ProxyServer` /
`ProxyOverride`，也就是你在「Internet 选项 → 连接 → 局域网设置」里看到的那套；保存后**立即生效，不用重启**。
加速器如果没开系统代理开关（只开了 TUN 模式之外的"仅浏览器代理"），就选 **自定义代理** 手填端口
（Clash 7890、v2rayN 10809、Sing-box 2080 等），只写 `127.0.0.1:7890` 会自动补成 `http://`。

排查顺序（也可以直接点页面里的 **网络诊断**，它按 DNS → TCP → TLS → HTTP 四步告诉你卡在哪）：

1. **PAC 自动配置**：如果注册表里是 `AutoConfigURL`（公司网常见），Node 侧无法执行 PAC 脚本，
   界面会明确提示；请在「自定义代理」里填真实代理端口。
2. **安全软件拦 node.exe 出站**：360 / 火绒 / Windows Defender 的"程序联网控制"会直接拒绝，
   表现为 `EACCES` / `EPERM`。把 `node.exe` 加入白名单（错误信息里会这么提示）。
3. **证书被替换**：公司网关或抓包工具（Fiddler / Charles / mitmproxy）会导致
   `UNABLE_TO_VERIFY_LEAF_SIGNATURE`。把根证书导出成 `.pem`，设环境变量后重启：
   ```bat
   set NODE_EXTRA_CA_CERTS=D:\certs\corp-root-ca.pem
   start.bat
   ```
4. **IPv6 不通**：`ENETUNREACH` / `EHOSTUNREACH`，开页面里的 **强制 IPv4** 开关。
5. **智能体（主流智能体）里仍然失败**：走统一网关时上游请求由服务端发出，已经受代理设置管；
   但**账号模式**下 CLI 是自己直连上游的，所以启动时会自动注入 `HTTP_PROXY` / `HTTPS_PROXY` /
   `ALL_PROXY` / `NO_PROXY`（在「预览启动命令」里能看到，带凭据的代理地址会打码）。
6. **apiHost 填成了网站首页**：现在会明确报「返回的不是 JSON（HTTP 200，正文开头 `<!doctype`）——
   API 地址可能指向了网页而不是接口」，而不是以前那句 `Unexpected token '<'`。

回归测试：`npm run test:net`（26 项，含用死端口代理证明 dispatcher 真的生效、绕过规则真的让本地请求直连、
"不使用代理"真的无视环境变量、注册表 `http=…;https=…` 与 socks 两种写法的解析）。

---

## 终端里打中文，窗口会向左跳（缩进）？（已修复）

xterm.js 的隐藏输入框 `.xterm-helper-textarea` 平时停在 `left:-9999em`，中文输入法一开始组合，
浏览器为了"把获得焦点的元素滚进可视区"就去滚动最近的可滚动祖先——而 **`overflow:hidden` 的盒子仍然可以被
焦点/程序滚动**（只是没有滚动条），于是整个终端被横向拽走；同时组合期间 DOM 抖动触发 `ResizeObserver → fit()`
反复重排，CLI 的 TUI 按新宽度重画，看起来也像窗口在动。

已修：终端容器改用 `overflow: clip`（真正不可滚动）、捕获阶段把祖先链上的横向滚动归零、把留在屏幕外的输入框
夹回盒子内、`fit()` 去抖且组合期间不重排。输入法候选框仍然跟着光标（xterm 在组合时自己设的位置不受影响）。

Windows 上还有两处与中文显示直接相关的：

- **字体**：终端字体栈原来只有 `Consolas / Courier New` 这类**没有 CJK 字形**的西文等宽字体，中文会逐字回退到
  系统默认中文字体（非等宽），字宽和 xterm 的两格宽对不上，看起来就是"中文挤在一起/错位"。现在栈里加了
  `Microsoft YaHei`、`Noto Sans Mono CJK SC`、`Source Han Mono SC` 等（拉丁字符仍由 Consolas 渲染，度量不变）。
  装了 [Sarasa Mono SC](https://github.com/be5invis/Sarasa-Gothic)（更纱黑体等宽）的话中文对齐效果最好。
- **代码页**：`start.bat` 开头执行 `chcp 65001`，把控制台切到 UTF-8，服务端的中文日志与继承同一控制台的
  CLI 会话都不会再乱码。手动启动的话记得先执行一次 `chcp 65001`。

> 如果窗口不再移动、但**中文在 CLI 自己的输入框里仍然错位**，那是该 CLI 对全角字符按 1 列而非 2 列计算宽度的
> 问题（上游行为），终端这一层不会去改它的输出。

---

## 点「终止进程」结果整个程序退出了？（已修复）

这是曾经真实存在的 bug，根因有三层，都在 Windows 上更严重：

1. **以前只杀了一个进程。** npm 装的 CLI 在 Windows 上是 `.cmd` 垫片，必须经 `%ComSpec% /d /s /c` 启动，
   所以服务端手里的 pid 是 `cmd.exe` 的，而 `child.kill()` 在 Windows 上等于 `TerminateProcess` **单个**进程 ——
   真正的 `node claude.js` / `node pi.js` 是孙子进程，于是「点了终止，CLI 还在跑」。
   现在改用 **`taskkill /pid <pid> /T /F`**（`/T` = 整棵进程树，`/F` = 强制），并在之后**轮询确认**进程真的消失。
2. **node-pty 的 Windows `kill()` 可能把 Agent Studio 自己杀掉。** `WindowsPtyAgent.kill()` 会枚举
   **控制台进程列表**，然后对列表里每个 pid 调 `process.kill()`；它源码里的注释写明这是刻意的
   （“node servers in particular seem to become detached and remain running”，Microsoft/vscode#26807）。
   当那份列表恰好是 `start.bat` 所在控制台时，里面就有 `cmd.exe` 和 Agent Studio 本体，而 Windows 的
   `process.kill()` 是 `TerminateProcess`：**没有异常、无法捕获**，窗口里只剩一行 “Server stopped”。
   现在 **Windows 上一律不调用 node-pty 的 `kill()`**：进程树由 taskkill 处理，node-pty 自己会收到退出事件并释放 ConPTY。
3. **两处未捕获异常也会让服务直接退出。** node-pty 在 socket 出错时会 `throw err`（条件是 pty 的 `error`
   监听者少于 2 个，而我们一个都没挂）；管道模式下往已死子进程的 stdin 写入会 EPIPE，而 Node 对
   没有监听者的 `error` 事件会抛成未捕获异常。现在都加了监听，并在服务端加了
   `uncaughtException` / `unhandledRejection` 兜底：错误写进 `data\crash.log` 并继续服务，而不是整个退出。

界面侧也变了：按钮点下去会变「终止中…」，结束后用提示条告诉你**真实结果**（用了什么手段、退出码、
是否确认已死）。接口 `POST /api/codecli/sessions/:id/kill` 现在返回
`{ ok, killed, method[], exitCode, error? }`。另有一条硬保护：**Agent Studio 自己与父进程的 pid 永远拒绝作为终止目标**。

如果你还遇到窗口关闭，请看 `data\crash.log`（`start.bat` 在服务退出时会打印退出码并提示这个文件）。

---

## 主流智能体（Code CLI）在 Windows 上的实现细节

- 托管安装的可执行文件是 `data\codecli\<工具>\node_modules\.bin\<工具>.cmd`；Node 20.12+ 出于安全（CVE-2024-27980）**禁止不带 shell 直接 spawn `.cmd`**，所以服务端统一通过 `%ComSpec% /d /s /c` 启动它们
- 终端可选 **PowerShell 7 / PowerShell / 命令提示符**（按实际存在的列出）
- 命令行按目标 shell 生成：cmd 用双引号，PowerShell 用单引号并在需要时加调用运算符 `&`，因此**路径含空格也能正常启动**
- 统一网关地址始终是 `http://127.0.0.1:<端口>/gateway/<方言>/<工具>`，密钥不出服务端（CLI 只拿到占位符）

回归测试（Windows 分支在 Linux/macOS 上也能验证，脚本会伪造 `process.platform`）：

```bat
npm test                              REM 三个单元测试：线上请求体 / Windows 引号与 spawn / 安装检测
npm run test:wire                     REM 单独跑：抓真实请求体，断言四种协议 model 都是字符串
npm run test:win                      REM 单独跑：Windows 引号风格与 .cmd spawn 规则
npm run test:detect                   REM 单独跑：检测优先级、备用命令名、.cmd 优先
npm run verify:cli                    REM 真实 CLI × 统一网关四种方言（离线，无需 API 密钥）
npm run test:smoke                    REM jsdom 驱动真实 UI，43 项断言
```

---

## 手动启动（不用脚本）

```bat
cd /d D:\agent-studio
npm install
npm run build
node server\index.js
```

然后浏览器打开 <http://localhost:3000>。


## 工具调用修复

旧版网关丢失工具协议字段的问题已补齐。验证范围、升级方式以及 CMD 直连 Pi 的排查步骤见 [工具调用修复说明](工具调用修复说明.md)。新增 `npm run test:tools`（37 项协议回归），不代表已实测所有外部模型和 CLI。


## 更新：Windows 智能体检测（2026-09-18）

本次在原 Agent Studio 项目中增量修改，未另建项目或更换技术栈。

- 参照 Cherry Studio 提交 b4a9c86 的系统命令发现流程：先从注册表读取系统/用户 PATH，再解析可执行文件。
- 按 Windows 大小写不敏感规则展开环境变量，合并为单一 PATH 键；读取失败回退进程 PATH。
- 系统检测直接查找 `.exe`、`.cmd`、`.bat`，不把无后缀 shell shim 或 `.ps1` 当成可直接启动的程序。
- 保留本项目既有托管安装与常见目录扫描；不是导入 Cherry 的 Electron/mise 管理器。
- 重新检测会清缓存；启动终端或 DSH 服务前重新检测，并使用相同的刷新环境启动。
- 原数据目录 `data` 不包含在发布包中。更新前关闭旧服务、备份 data，再覆盖解压到原目录，保留 data 后运行 start.bat。

验证：单测通过（检测套件从 9 项增加到 13 项）；工具协议 37 项通过；页面 smoke 86/86；前端构建成功。
Windows 检测专项采用纯函数与模拟 win32 文件场景测试，尚未在用户 Windows 电脑上实测。


## 智能助手与添加助手更新

对话页「＋」现在进入助手库：分类/搜索 → 提示词预览 → 添加/进入对话，也可自定义新建。新建与编辑统一支持名称、描述、图标、分组、模型、提示词和参数，保留已有数据。详细源码对照、实现边界与验证见 [智能助手更新说明](docs/智能助手更新说明.md)。


## 覆盖更新后仍显示旧界面（v1.0.2）

这版在智能助手栏显示 `v1.0.2`；`/api/health` 返回 `version: 1.0.2`、`build: assistant-library-r2`。
启动脚本每次重新构建前端；端口占用时停止启动，不再自动打开可能是旧服务的页面。

1. 关闭原 Agent Studio 服务窗口，保留并备份 data。
2. 压缩包包含一层 agent-studio 文件夹。把该文件夹**里面的内容**覆盖到原来的项目根目录（该层应直接看到 start.bat、package.json、server、web）。不要变成旧目录/agent-studio/agent-studio。
3. 运行该目录的 start.bat，等待构建完成，再访问启动窗口显示的地址。
4. 浏览器 Ctrl+F5。智能助手栏应显示 v1.0.2，点击 ＋ 应进入可搜索/分类的助手库。
5. 旧助手列表只有三个属于数据保留，不是模板库只有三个；模板库独立提供 15 个模板。
6. 如果仍无变化，打开 http://localhost:3000/api/health 与 http://localhost:3000/api/assistant-presets，将返回结果和启动窗口的 Folder 信息提供给维护者。使用自定义端口时替换 3000。


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
