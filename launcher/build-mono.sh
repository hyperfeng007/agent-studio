#!/bin/sh
# Deliberately use reference assemblies, NOT the installed Mono runtime APIs.
set -eu
cd "$(dirname "$0")/.."
refs="${FRAMEWORK_REFS:-/usr/lib/mono/4.8-api}"
test -f "$refs/mscorlib.dll" || { echo 'Missing .NET Framework 4.8 reference assemblies'; exit 1; }
mcs -nostdlib+ -target:winexe -platform:x64 -optimize+ \
  -main:AgentStudioLauncher.Bootstrap \
  -r:"$refs/mscorlib.dll" -r:"$refs/System.dll" -r:"$refs/System.Core.dll" \
  -r:"$refs/System.Windows.Forms.dll" -r:"$refs/System.Drawing.dll" -r:"$refs/System.Web.Extensions.dll" -r:"$refs/System.IO.Compression.FileSystem.dll" -r:"$refs/System.IO.Compression.dll" \
  -win32manifest:launcher/app.manifest -win32icon:launcher/agent-studio.ico \
  -out:'Agent Studio.exe' launcher/Bootstrap.cs launcher/Launcher.cs launcher/NativeJob.cs
