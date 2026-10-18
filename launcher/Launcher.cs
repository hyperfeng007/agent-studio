using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;
[assembly: TargetFramework(".NETFramework,Version=v4.8")]
[assembly: AssemblyTitle("Agent Studio Launcher")]
[assembly: AssemblyVersion("1.3.4.0")]
[assembly: AssemblyFileVersion("1.3.4.0")]

namespace AgentStudioLauncher {
static class Program {
    [MethodImpl(MethodImplOptions.NoInlining)]
    internal static void CompatibilityProbe() {
        // Exercise the overloads that previously compiled against Mono-only APIs.
        string root=Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd(new char[] {Path.DirectorySeparatorChar});
        string quoted="\"node.exe\"".Trim(new char[] {'"'});
        if(root.Length==0||quoted!="node.exe")throw new Exception("Compatibility probe failed");
    }
    [MethodImpl(MethodImplOptions.NoInlining)]
    internal static void Run(string[] args) {
        Bootstrap.Log("Initializing WinForms.");
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);

            string root=Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd(new char[] {Path.DirectorySeparatorChar});
            string hash; using(var sha=SHA256.Create())hash=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(root.ToUpperInvariant()))).Replace("-","").Substring(0,24);
            using(var request=new EventWaitHandle(false,EventResetMode.AutoReset,"Local\\AgentStudio.Request."+hash))
            using(var mutex=new Mutex(false,"Local\\AgentStudio.Owner."+hash)) {
                bool owner=false; try { owner=mutex.WaitOne(0); } catch(AbandonedMutexException) { owner=true; }
                if(!owner) { Bootstrap.Log("Existing launcher notified; exiting duplicate."); request.Set(); return; }
                bool restart=false;
                try {
                    Bootstrap.Log("Creating progress window.");
                    using(var window=new LauncherForm(root,args)) {
                        var registration=ThreadPool.RegisterWaitForSingleObject(request,delegate(object state,bool timedOut) { window.Request(); },null,-1,false);
                        try { Bootstrap.Log("Entering GUI message loop."); Application.Run(window); restart=window.Restart; } finally { registration.Unregister(null); }
                    }
                } finally { mutex.ReleaseMutex(); }
                if(restart) Process.Start(new ProcessStartInfo(Application.ExecutablePath,String.Join(" ",args.Select(NativeJob.Quote).ToArray())) { UseShellExecute=false,CreateNoWindow=true });
            }
    }
}
sealed class LauncherForm : Form {
    readonly string root,log,childLog,session=Guid.NewGuid().ToString("N");
    readonly int port=3000;
    readonly Label status=new Label(),elapsed=new Label(); readonly Button cancel=new Button();
    readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer(); readonly Stopwatch clock=Stopwatch.StartNew();
    readonly CancellationTokenSource cancellation=new CancellationTokenSource(); readonly object logGate=new object();
    readonly Dictionary<string,string> env=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
    NativeJob serviceJob,browserJob; Process server; string node; bool running,stopping,canClose; int missingWindows;
    public bool Restart { get; private set; }
    string Url { get { return "http://127.0.0.1:"+port; } }
    public LauncherForm(string folder,string[] args) {
        root=folder;
        if(args.Length>0) { int parsed; if(args.Length!=2||args[0]!="--port"||!Int32.TryParse(args[1],out parsed)||parsed<1024||parsed>65535)throw new Exception("参数格式：Agent Studio.exe --port 3001（1024–65535）"); port=parsed; }
        Directory.CreateDirectory(Path.Combine(root,"data","launcher"));
        string stamp=DateTime.Now.ToString("yyyyMMdd-HHmmss")+"-"+session.Substring(0,6);
        log=Path.Combine(root,"data","launcher",stamp+".log"); childLog=Path.Combine(root,"data","launcher",stamp+"-process.log");
        Text="Agent Studio · 正在启动"; ClientSize=new Size(510,245); StartPosition=FormStartPosition.CenterScreen;
        FormBorderStyle=FormBorderStyle.FixedDialog; MaximizeBox=false; MinimizeBox=false; AutoScaleMode=AutoScaleMode.Dpi;
        try { Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch {}
        Font=new Font("Microsoft YaHei UI",10); BackColor=Color.FromArgb(248,249,252);
        var title=new Label { Text="Agent Studio",Font=new Font(Font.FontFamily,20,FontStyle.Bold),Location=new Point(26,22),Size=new Size(450,42) };
        status.SetBounds(28,76,450,30); status.Text="正在检查启动环境…";
        var progress=new ProgressBar { Style=ProgressBarStyle.Marquee,MarqueeAnimationSpeed=28,Location=new Point(28,116),Size=new Size(454,9) };
        elapsed.SetBounds(28,139,454,42); elapsed.Font=new Font(Font.FontFamily,9); elapsed.ForeColor=Color.DimGray;
        var logs=new Button { Text="查看日志",Location=new Point(278,192),Size=new Size(95,30) }; logs.Click+=delegate { OpenLog(); };
        cancel.Text="取消启动"; cancel.SetBounds(385,192,97,30); cancel.Click+=async delegate { await Stop(false); };
        Controls.AddRange(new Control[]{title,status,progress,elapsed,logs,cancel});
        FormClosing+=async delegate(object sender,FormClosingEventArgs e) { if(!canClose) { e.Cancel=true; await Stop(false); } };
        Shown+=async delegate { await Boot(); };
        timer.Interval=700; timer.Tick+=async delegate {
            elapsed.Text="已用时 "+(int)clock.Elapsed.TotalSeconds+" 秒 · 首次安装可能需要数分钟\n启动期间再次双击只显示本窗口，不会重复安装。";
            if(running&&!stopping) {
                if(server==null||server.HasExited) { await Fail("后台服务意外退出，请查看日志。"); return; }
                missingWindows=browserJob.HasWindow()?0:missingWindows+1;
                if(missingWindows>=3)await Stop(false);
            }
        }; timer.Start();
    }
    public void Request() {
        try { if(!IsHandleCreated||IsDisposed)return; BeginInvoke((Action)(async delegate {
            if(stopping)return;
            if(running)await Stop(true);
            else { Show(); WindowState=FormWindowState.Normal; Activate(); TopMost=true; TopMost=false; }
        })); } catch(InvalidOperationException) {}
    }
    void Stage(string text) { cancellation.Token.ThrowIfCancellationRequested(); Log(text); if(!IsDisposed)BeginInvoke((Action)(()=>status.Text=text)); }
    void Log(string text) { lock(logGate)File.AppendAllText(log,DateTime.Now.ToString("O")+" "+text+Environment.NewLine,Encoding.UTF8); }
    void OpenLog() { try { Process.Start(new ProcessStartInfo("notepad.exe",NativeJob.Quote(File.Exists(childLog)?childLog:log)){UseShellExecute=true}); } catch {} }
    async Task Boot() {
        try {
            await Task.Run(()=> {
                serviceJob=new NativeJob(); browserJob=new NativeJob();
                if(!File.Exists(Path.Combine(root,"server","index.js")))throw new Exception("请完整解压压缩包；EXE 必须与 server、web、package.json 位于同一目录。");
                node=Path.Combine(root,"runtime","node","node.exe"); if(!File.Exists(node)) { Stage("首次运行：正在下载随盘 Node.js 24（使用系统代理，约 36 MB）…"); DownloadNode(); }
                string browser=FindBrowser(); if(browser==null)throw new Exception("未找到 Microsoft Edge 或 Google Chrome，请先安装其中一个浏览器。");
                string data=Path.Combine(root,"data"); env["DATA_DIR"]=data; env["AGENT_STUDIO_PORTABLE"]="1";
                string home=Path.Combine(data,"host-home"),temp=Path.Combine(data,"temp","app");
                Directory.CreateDirectory(temp); Directory.CreateDirectory(Path.Combine(home,"AppData","Roaming")); Directory.CreateDirectory(Path.Combine(home,"AppData","Local"));
                env["HOME"]=home; env["USERPROFILE"]=home; env["APPDATA"]=Path.Combine(home,"AppData","Roaming"); env["LOCALAPPDATA"]=Path.Combine(home,"AppData","Local");
                env["TEMP"]=temp; env["TMP"]=temp; env["npm_config_cache"]=Path.Combine(data,"cache","npm"); env["npm_config_userconfig"]=Path.Combine(data,"config","npmrc"); env["npm_config_globalconfig"]=Path.Combine(data,"config","npm-globalrc"); env["npm_config_update_notifier"]="false";
                env["HOST"]="127.0.0.1"; env["PORT"]=port.ToString(); env["AGENT_STUDIO_LAUNCH_ID"]=session; env["AGENT_STUDIO_GUI"]="1";
                env["NODE_TLS_REJECT_UNAUTHORIZED"]=null; env["npm_config_strict_ssl"]="true";
                env["PATH"]=Path.GetDirectoryName(node)+";"+Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System))+";"+Environment.GetFolderPath(Environment.SpecialFolder.Windows)+";"+Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0");
                env["NODE_OPTIONS"]=((Environment.GetEnvironmentVariable("NODE_OPTIONS")??"")+" --require "+NativeJob.Quote(Path.Combine(root,"scripts","gui-preload.cjs").Replace('\\','/'))).Trim();
                if(Run(node,new[]{"-e","let [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||a===20&&b>=19?0:1)"})!=0)throw new Exception("需要 Node.js 20.19 或更高版本，推荐 24 LTS。");
                if(Run(node,new[]{"-e","process.exit(process.allowedNodeEnvironmentFlags.has('--use-system-ca')?0:1)"})==0) {
                    string options=env["NODE_OPTIONS"];
                    env["NODE_OPTIONS"]=options.Contains("--use-system-ca")?options:(options+" --use-system-ca").Trim();
                    Log("使用系统受信任证书；本次子进程保持 TLS 校验。显式 npm cafile/ca 配置可能覆盖默认信任。");
                }
                Stage("正在检查并停止本目录的旧实例…"); StopPrevious();
                Stage("正在检查依赖…");
                if(Run(node,new[]{"scripts/dependency-state.cjs","check"})!=0) {
                    Stage("正在安装依赖（自动读取系统代理）…");
                    if(Run(node,new[]{"scripts/install-dependencies.cjs"})!=0)throw new Exception("依赖安装失败。请查看日志；若出现 SELF_SIGNED_CERT_IN_CHAIN，请检查公司 CA 是否已受 Windows 信任，以及 npm 的 ca/cafile 配置。不会跳过证书验证。");
                }
                if(Run(node,new[]{"scripts/dependency-state.cjs","write"})!=0)throw new Exception("依赖不完整，请查看安装日志。");
                Stage("正在构建最新界面…");
                if(Run(node,new[]{"node_modules/vite/bin/vite.js","build","--config","web/vite.config.js"})!=0)throw new Exception("界面构建失败，请查看日志。");
                Stage("正在启动后台服务…");
                server=Spawn(serviceJob,node,new[]{"server/index.js"});
                bool healthy=false;
                for(int i=0;i<120;i++) {
                    cancellation.Token.ThrowIfCancellationRequested(); if(server.HasExited)throw new Exception("后台服务未能启动，可能是端口被占用。请查看日志。");
                    var health=GetJson("/api/health");
                    if(health!=null&&Value(health,"instanceId")==session) { healthy=true; break; }
                    Thread.Sleep(250);
                }
                if(!healthy)throw new Exception("后台服务健康检查超时，未打开浏览器。");
                Stage("正在打开应用窗口…");
                string profile=Path.Combine(root,"data","browsers",Path.GetFileNameWithoutExtension(browser).ToLowerInvariant()); Directory.CreateDirectory(profile);
                Spawn(browserJob,browser,new[]{"--user-data-dir="+profile,"--app="+Url+"/#/chat","--no-first-run","--no-default-browser-check","--disable-background-mode","--disk-cache-dir="+Path.Combine(profile,"cache"),"--disable-features=msEdgeSyncSetup,msImplicitSignin,msSeamlessWebToBrowserSignIn","--no-service-autorun","--disable-component-update","--disable-background-networking"},true).Dispose();
                bool visible=false;
                for(int i=0;i<120;i++) { cancellation.Token.ThrowIfCancellationRequested(); if(browserJob.HasWindow()) { visible=true; break; } Thread.Sleep(250); }
                if(!visible)throw new Exception("浏览器应用窗口未成功出现。公司浏览器策略可能禁止 APP 模式或专属用户目录。");
            });
            if(stopping)return;
            running=true; missingWindows=0; Hide(); Log("应用窗口已出现，隐藏启动进度。关闭所有本应用窗口后清理所属进程。");
        } catch(OperationCanceledException) {} catch(Exception error) { if(!stopping)await Fail(error.Message); }
    }
    Process Spawn(NativeJob job,string exe,string[] args,bool showWindow=false) { cancellation.Token.ThrowIfCancellationRequested(); return job.Start(exe,args,root,childLog,env,showWindow); }
    int Run(string exe,string[] args) { using(var p=Spawn(serviceJob,exe,args)) { while(!p.WaitForExit(250))cancellation.Token.ThrowIfCancellationRequested(); return p.ExitCode; } }
    Dictionary<string,object> GetJson(string path) {
        try { var request=(HttpWebRequest)WebRequest.Create(Url+path); request.Proxy=null; request.Timeout=1000; request.ReadWriteTimeout=1000;
            using(var response=request.GetResponse())using(var reader=new StreamReader(response.GetResponseStream()))return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(reader.ReadToEnd());
        } catch { return null; }
    }
    void PostStop(string instance) {
        var request=(HttpWebRequest)WebRequest.Create(Url+"/api/desktop/stop"); request.Proxy=null; request.Method="POST"; request.ContentType="application/json"; request.Timeout=1500; request.ReadWriteTimeout=1500;
        byte[] body=Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(new {instanceId=instance,root=root})); request.ContentLength=body.Length;
        using(var stream=request.GetRequestStream())stream.Write(body,0,body.Length);
        using(var response=request.GetResponse()){}
    }
    static string Value(Dictionary<string,object> data,string key) { object value; return data.TryGetValue(key,out value)?Convert.ToString(value):""; }
    void StopPrevious() {
        var identity=GetJson("/api/desktop/identity");
        if(identity!=null) {
            if(!String.Equals(Value(identity,"root").TrimEnd('\\','/'),root,StringComparison.OrdinalIgnoreCase))throw new Exception("端口已被另一个目录的 Agent Studio 占用，不会结束它。请使用 --port 3001 或关闭另一实例。");
            int pid; if(!Int32.TryParse(Value(identity,"pid"),out pid))throw new Exception("旧实例身份无效，不会结束未知进程。");
            using(var old=Process.GetProcessById(pid)) {
                if(old.Handle==IntPtr.Zero)throw new Exception("无法取得旧实例句柄，未结束进程。");
                DateTime started=old.StartTime;
                if(!String.Equals(Path.GetFileName(old.MainModule.FileName),"node.exe",StringComparison.OrdinalIgnoreCase))throw new Exception("旧实例进程身份不匹配，不会自动结束。");
                try { PostStop(Value(identity,"instanceId")); } catch {}
                if(!old.WaitForExit(6000)) {
                    var again=GetJson("/api/desktop/identity");
                    if(again==null||Value(again,"instanceId")!=Value(identity,"instanceId")||old.StartTime!=started)throw new Exception("无法再次验证旧实例，请手动关闭后重试。");
                    if(Run(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"taskkill.exe"),new[]{"/PID",pid.ToString(),"/T","/F"})!=0)throw new Exception("无法结束已确认的旧实例，请手动关闭。");
                    old.WaitForExit(3000);
                }
            }
        }
        try { var listener=new TcpListener(IPAddress.Loopback,port); try { listener.Start(); } finally { listener.Stop(); } }
        catch(SocketException) { throw new Exception("端口 "+port+" 已被占用，但无法确认是本目录的实例。为避免误杀，请先关闭旧版 start.bat 服务，或使用 --port 3001。"); }
    }
    async Task Fail(string message) {
        if(stopping)return;
        Log("ERROR: "+message); await Stop(false,true);
        if(MessageBox.Show(message+"\n\n是否打开详细日志？","Agent Studio",MessageBoxButtons.YesNo,MessageBoxIcon.Error)==DialogResult.Yes)OpenLog();
        canClose=true; Close();
    }
    async Task Stop(bool restart,bool keepForm=false) {
        if(stopping)return; stopping=true; running=false; Restart=restart; cancellation.Cancel(); timer.Stop();
        Show(); status.Text=restart?"正在关闭旧实例并重新启动…":"正在退出并清理后台进程，请勿拔出 U 盘…"; cancel.Enabled=false;
        await Task.Run(()=> {
            if(browserJob!=null)browserJob.HasWindow(true);
            try { var h=GetJson("/api/health"); if(h!=null&&Value(h,"instanceId")==session)PostStop(session); } catch {}
            try { if(server!=null)server.WaitForExit(1800); } catch {}
            if(browserJob!=null)browserJob.Dispose(); if(serviceJob!=null)serviceJob.Dispose();
            try { FlushLogs(); } catch {}
        });
        if(!restart&&!keepForm) { Log("所属进程已退出，数据已刷写；可安全弹出。"); Hide(); NotifyEject(); }
        if(!keepForm) { canClose=true; Close(); }
    }
    protected override void Dispose(bool disposing) { if(disposing) { timer.Dispose(); cancellation.Cancel(); if(browserJob!=null)browserJob.Dispose(); if(serviceJob!=null)serviceJob.Dispose(); } base.Dispose(disposing); }
    void NotifyEject() {
        try { DriveInfo drive=new DriveInfo(Path.GetPathRoot(root)); if(drive.DriveType==DriveType.Removable) MessageBox.Show("Agent Studio 已退出，所属进程已清理。\n现在可在系统托盘使用「安全删除硬件」弹出 "+drive.Name,"Agent Studio 便携版",MessageBoxButtons.OK,MessageBoxIcon.Information); } catch {}
    }
    void FlushLogs() {
        foreach(string file in Directory.GetFiles(Path.Combine(root,"data","launcher"))) { try { using(var fs=new FileStream(file,FileMode.Open,FileAccess.ReadWrite,FileShare.ReadWrite)) fs.Flush(true); } catch {} }
    }
    const string NodeVersion="24.21.0", NodeSha256="158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541";
    void DownloadNode() {
        string runtime=Path.Combine(root,"runtime"); Directory.CreateDirectory(runtime);
        string zip=Path.Combine(runtime,"node-v"+NodeVersion+"-win-x64.zip");
        string[] mirrors={"https://nodejs.org/dist/v"+NodeVersion+"/node-v"+NodeVersion+"-win-x64.zip","https://npmmirror.com/mirrors/node/v"+NodeVersion+"/node-v"+NodeVersion+"-win-x64.zip"};
        ServicePointManager.SecurityProtocol|=SecurityProtocolType.Tls12;
        Exception last=null; bool ok=File.Exists(zip)&&Sha256(zip)==NodeSha256;
        foreach(string url in mirrors) { if(ok)break; try { Log("下载 "+url); using(var client=new WebClient()) { client.Proxy=WebRequest.GetSystemWebProxy(); client.Proxy.Credentials=CredentialCache.DefaultCredentials; client.DownloadFile(url,zip+".part"); }
            if(Sha256(zip+".part")!=NodeSha256)throw new Exception("下载内容校验失败（SHA-256 不匹配）"); File.Delete(zip); File.Move(zip+".part",zip); ok=true; } catch(Exception e) { last=e; Log("下载失败："+e.Message); try { File.Delete(zip+".part"); } catch {} } }
        if(!ok)throw new Exception("无法下载 Node.js："+(last==null?"":last.Message)+"\n请检查网络／系统代理，或手动将 node-v"+NodeVersion+"-win-x64.zip 放到 runtime 目录后重试。不会使用宿主 Node.js。");
        Stage("正在解压随盘 Node.js…"); string tmp=Path.Combine(runtime,"node-extract"); if(Directory.Exists(tmp))Directory.Delete(tmp,true);
        System.IO.Compression.ZipFile.ExtractToDirectory(zip,tmp);
        string inner=Directory.GetDirectories(tmp)[0]; string target=Path.Combine(runtime,"node"); if(Directory.Exists(target))Directory.Delete(target,true); Directory.Move(inner,target); Directory.Delete(tmp,true); File.Delete(zip);
        if(!File.Exists(node))throw new Exception("Node.js 解压后缺少 node.exe。");
        Log("随盘 Node.js 就绪："+node);
    }
    static string Sha256(string file) { using(var sha=SHA256.Create())using(var fs=File.OpenRead(file))return BitConverter.ToString(sha.ComputeHash(fs)).Replace("-","").ToLowerInvariant(); }
    static string FindNode() {
        foreach(string directory in (Environment.GetEnvironmentVariable("PATH")??"").Split(new char[] {';'})) {
            try { string path=Path.Combine(Environment.ExpandEnvironmentVariables(directory.Trim().Trim(new char[] {'"'})),"node.exe"); if(File.Exists(path))return Path.GetFullPath(path); } catch {}
        }
        foreach(string directory in new[]{Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),Environment.GetEnvironmentVariable("NVM_SYMLINK")}) {
            if(String.IsNullOrEmpty(directory))continue;
            string path=directory==Environment.GetEnvironmentVariable("NVM_SYMLINK")?Path.Combine(directory,"node.exe"):Path.Combine(directory,"nodejs","node.exe"); if(File.Exists(path))return path;
        } return null;
    }
    static string FindBrowser() {
        foreach(string name in new[]{"msedge.exe","chrome.exe"}) {
            foreach(RegistryKey hive in new[]{Registry.CurrentUser,Registry.LocalMachine}) {
                using(var key=hive.OpenSubKey("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\"+name)) { if(key!=null) { var p=key.GetValue(null) as string; if(!String.IsNullOrEmpty(p)&&File.Exists(p.Trim(new char[] {'"'})))return p.Trim(new char[] {'"'}); } }
            }
            foreach(string baseDir in new[]{Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)}) {
                if(String.IsNullOrEmpty(baseDir))continue;
                string path=Path.Combine(baseDir,name=="msedge.exe"?"Microsoft\\Edge\\Application\\msedge.exe":"Google\\Chrome\\Application\\chrome.exe"); if(File.Exists(path))return path;
            }
        } return null;
    }
}
}
