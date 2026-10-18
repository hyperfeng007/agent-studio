using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace AgentStudioLauncher {
// Keep Main free of WinForms types and prevent GUI-method inlining. A JIT failure
// in the GUI entry must be caught by this already-running outer entry method.
static class Bootstrap {
    static string logFile;
    static int reported;
    [STAThread] static void Main(string[] args) {
        try {
            InitializeLog();
            Log("Bootstrap entered; CLR="+Environment.Version+"; 64bit="+Environment.Is64BitProcess);
            AppDomain.CurrentDomain.UnhandledException+=delegate(object sender,UnhandledExceptionEventArgs e) { Report(e.ExceptionObject as Exception ?? new Exception(Convert.ToString(e.ExceptionObject))); };
            if(args.Length==1&&args[0]=="--bootstrap-test") { Program.CompatibilityProbe(); Log("Compatibility probe passed."); return; }
            Log("Calling GUI entry.");
            Program.Run(args);
            Log("GUI entry returned normally.");
        } catch(Exception error) { Environment.ExitCode=1; Report(error); }
    }
    static void InitializeLog() {
        string filename="bootstrap-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+"-"+Process.GetCurrentProcess().Id+".log";
        string[] folders={Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"data","launcher"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"AgentStudio","launcher"),Path.GetTempPath()};
        foreach(string folder in folders) {
            try { Directory.CreateDirectory(folder); string candidate=Path.Combine(folder,filename); File.WriteAllText(candidate,"Agent Studio bootstrap 1.3.4\r\n",Encoding.UTF8); logFile=candidate; return; } catch {}
        }
    }
    internal static void Log(string message) {
        try { if(logFile!=null)File.AppendAllText(logFile,DateTime.Now.ToString("O")+" "+message+Environment.NewLine,Encoding.UTF8); } catch {}
    }
    internal static void Report(Exception error) {
        Log(error.ToString());
        if(Interlocked.Exchange(ref reported,1)!=0)return;
        string message="Agent Studio 启动失败。\n\n"+error.GetType().FullName+": "+error.Message+"\n\n诊断日志："+(logFile??"无法写入日志，请查看 Windows 应用程序事件记录。");
        // Native dialog does not need WinForms to have initialized successfully.
        try { MessageBoxW(IntPtr.Zero,message,"Agent Studio 启动诊断",0x00010010); } catch {}
    }
    [DllImport("user32.dll",CharSet=CharSet.Unicode,ExactSpelling=true)] static extern int MessageBoxW(IntPtr owner,string text,string caption,uint flags);
}
}
