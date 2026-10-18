$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path $csc)) { throw 'Install .NET Framework 4.8 developer tools to compile the launcher.' }
& $csc /nologo /target:winexe /platform:x64 /optimize+ /main:AgentStudioLauncher.Bootstrap /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions -r:System.IO.Compression.FileSystem -r:System.IO.Compression.dll "/win32manifest:$PSScriptRoot\app.manifest" "/win32icon:$PSScriptRoot\agent-studio.ico" "/out:$root\Agent Studio.exe" "$PSScriptRoot\Bootstrap.cs" "$PSScriptRoot\Launcher.cs" "$PSScriptRoot\NativeJob.cs"
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
