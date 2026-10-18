using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace AgentStudioLauncher {
// Suspended creation guarantees a child cannot escape before assignment.
sealed class NativeJob : IDisposable {
    IntPtr job; readonly object gate = new object();
    public NativeJob() {
        job=CreateJobObject(IntPtr.Zero,null);
        if(job==IntPtr.Zero) throw new Win32Exception();
        var limits=new ExtendedLimits(); limits.Basic.LimitFlags=0x2000; // KILL_ON_JOB_CLOSE
        int size=Marshal.SizeOf(limits); IntPtr ptr=Marshal.AllocHGlobal(size);
        try { Marshal.StructureToPtr(limits,ptr,false); if(!SetInformationJobObject(job,9,ptr,(uint)size)) throw new Win32Exception(); }
        catch { CloseHandle(job); job=IntPtr.Zero; throw; }
        finally { Marshal.FreeHGlobal(ptr); }
    }
    public Process Start(string exe, string[] args, string cwd, string log, IDictionary<string,string> env, bool showWindow=false) {
        lock(gate) {
            if(job==IntPtr.Zero) throw new OperationCanceledException();
            var sa=new SecurityAttributes { Length=Marshal.SizeOf(typeof(SecurityAttributes)), Inherit=true };
            IntPtr output=CreateFile(log,0x4,3,ref sa,4,0x80,IntPtr.Zero); // append, OPEN_ALWAYS
            IntPtr input=CreateFile("NUL",0x80000000,3,ref sa,3,0,IntPtr.Zero);
            IntPtr block=IntPtr.Zero; ProcessInfo pi=new ProcessInfo();
            try {
                if(output==new IntPtr(-1)||input==new IntPtr(-1)) throw new Win32Exception();
                var si=new StartupInfo { Size=Marshal.SizeOf(typeof(StartupInfo)), Flags=showWindow?0x100:0x101, ShowWindow=(short)(showWindow?1:0), StdOutput=output, StdError=output, StdInput=input };
                var values=new SortedDictionary<string,string>(StringComparer.OrdinalIgnoreCase);
                foreach(System.Collections.DictionaryEntry pair in Environment.GetEnvironmentVariables()) values[(string)pair.Key]=(string)pair.Value;
                foreach(var pair in env) { if(pair.Value==null) values.Remove(pair.Key); else values[pair.Key]=pair.Value; }
                var text=new StringBuilder(); foreach(var pair in values) text.Append(pair.Key).Append('=').Append(pair.Value).Append('\0'); text.Append('\0');
                block=Marshal.StringToHGlobalUni(text.ToString());
                var command=new StringBuilder(Quote(exe)); foreach(string arg in args) command.Append(' ').Append(Quote(arg));
                if(!CreateProcess(exe,command,IntPtr.Zero,IntPtr.Zero,true,0x08000404,block,cwd,ref si,out pi)) throw new Win32Exception();
                if(!AssignProcessToJobObject(job,pi.Process)) { TerminateProcess(pi.Process,1); throw new Win32Exception(); }
                Process process=Process.GetProcessById((int)pi.ProcessId);
                // Retain an OS handle before resuming even a very short-lived child.
                if(process.Handle==IntPtr.Zero) { TerminateProcess(pi.Process,1); throw new Win32Exception(); }
                if(ResumeThread(pi.Thread)==0xffffffff) { TerminateProcess(pi.Process,1); process.Dispose(); throw new Win32Exception(); }
                return process;
            } finally {
                if(pi.Thread!=IntPtr.Zero)CloseHandle(pi.Thread); if(pi.Process!=IntPtr.Zero)CloseHandle(pi.Process);
                if(block!=IntPtr.Zero)Marshal.FreeHGlobal(block);
                if(output!=new IntPtr(-1))CloseHandle(output); if(input!=new IntPtr(-1))CloseHandle(input);
            }
        }
    }
    public bool HasWindow(bool close=false) {
        lock(gate) {
            if(job==IntPtr.Zero)return false;
            bool found=false;
            EnumWindows(delegate(IntPtr window,IntPtr data) {
                if(!IsWindowVisible(window))return true;
                var name=new StringBuilder(128); GetClassName(window,name,name.Capacity);
                if(name.ToString()!="Chrome_WidgetWin_1")return true;
                uint id; GetWindowThreadProcessId(window,out id);
                IntPtr process=OpenProcess(0x1000,false,id);
                if(process!=IntPtr.Zero) { bool inside; if(IsProcessInJob(process,job,out inside)&&inside) { found=true; if(close)PostMessage(window,0x0010,IntPtr.Zero,IntPtr.Zero); } CloseHandle(process); }
                return close || !found;
            },IntPtr.Zero);
            return found;
        }
    }
    public void Dispose() { lock(gate) { if(job!=IntPtr.Zero) { CloseHandle(job); job=IntPtr.Zero; } } }
    public static string Quote(string value) {
        var s=new StringBuilder("\""); int slashes=0;
        foreach(char c in value) { if(c=='\\') { slashes++; continue; } if(c=='"') { s.Append('\\',slashes*2+1).Append(c); slashes=0; } else { s.Append('\\',slashes).Append(c); slashes=0; } }
        return s.Append('\\',slashes*2).Append('"').ToString();
    }
    [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes { public int Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct StartupInfo { public int Size; public string Reserved,Desktop,Title; public int X,Y,XSize,YSize,XCount,YCount,Fill,Flags; public short ShowWindow,ReservedSize; public IntPtr ReservedPtr,StdInput,StdOutput,StdError; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process,Thread; public uint ProcessId,ThreadId; }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long ProcessTime,JobTime; public uint LimitFlags; public UIntPtr MinWorking,MaxWorking; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint Priority,Scheduling; }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits { public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory,JobMemory,PeakProcessMemory,PeakJobMemory; }
    delegate bool WindowCallback(IntPtr window,IntPtr data);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int info,IntPtr data,uint length);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr processAttrs,IntPtr threadAttrs,bool inherit,uint flags,IntPtr environment,string cwd,ref StartupInfo si,out ProcessInfo pi);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string path,uint access,uint share,ref SecurityAttributes attrs,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,uint id);
    [DllImport("kernel32.dll")] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
    [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback callback,IntPtr data);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window,uint message,IntPtr wparam,IntPtr lparam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window,StringBuilder name,int count);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint id);
}
}
