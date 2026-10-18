import crossSpawn from 'cross-spawn'
import path from 'node:path'

/**
 * Windows shell / spawn helpers.
 *
 * Two Windows facts break a POSIX-only implementation:
 *
 * 1. Node >= 18.20 / 20.12 refuses to `spawn()` a `.cmd` / `.bat` file without
 *    a shell and throws EINVAL (the CVE-2024-27980 mitigation). Bare names such
 *    as `npm` are `.cmd` shims on Windows, so they hit the same rule. Those go
 *    through `%ComSpec% /d /s /c` instead of `shell:true`, because `shell:true`
 *    would mangle arguments that contain spaces or quotes.
 *
 * 2. `cmd.exe` does not treat single quotes as quoting and PowerShell will not
 *    execute a quoted string unless it is invoked with `&`. The 主流智能体 launch
 *    path types the command line into the user's chosen shell, so the quoting
 *    style has to match that shell.
 */

export const IS_WIN = process.platform === 'win32'

const POSIX_SHELLS = new Set(['bash', 'zsh', 'fish', 'sh'])

/** Characters that need no quoting anywhere. Backslashes are Windows paths. */
const SAFE_POSIX = /^[\w@./:=+,-]+$/
const SAFE_WIN = /^[\w@.:/=+,\-\\]+$/

export function isPosixShell(shellId) {
  return !shellId || POSIX_SHELLS.has(shellId)
}

/** Quote one argument for the shell that will actually run it. */
export function quoteFor(value, shellId) {
  const s = String(value)
  if (!IS_WIN || isPosixShell(shellId)) {
    if (SAFE_POSIX.test(s)) return s
    return `'${s.replace(/'/g, `'\\''`)}'`
  }
  if (SAFE_WIN.test(s)) return s
  if (shellId === 'cmd') return `"${s.replace(/"/g, '""')}"`
  // powershell / pwsh: single-quoted literal, '' escapes a quote
  return `'${s.replace(/'/g, "''")}'`
}

/** Full command line for `bin` + `args`, quoted for `shellId`. */
export function commandLineFor(bin, args = [], shellId) {
  const line = [quoteFor(bin, shellId), ...args.map((a) => quoteFor(a, shellId))].join(' ')
  if (IS_WIN && !isPosixShell(shellId) && shellId !== 'cmd' && line.startsWith("'")) {
    return `& ${line}` // PowerShell needs the call operator for a quoted command
  }
  return line
}

/**
 * Turn (command, args) into something `spawn()` / `pty.spawn()` can run on this
 * platform. Non-Windows and real `.exe` targets are returned untouched.
 */
export function winSpawnSpec(command, args = []) {
  const c = String(command)
  if (!IS_WIN) return { command: c, args, shell: false }
  const isScript = /\.(cmd|bat)$/i.test(c)
  const isBare = !path.extname(c) // npm, npx, where, node-less shims
  if (!isScript && !isBare) return { command: c, args, shell: false }
  // cross-spawn 7.0.6 is pinned. Keep its cmd escaping and the verbatim flag
  // together; Node must not CRT-escape a command already escaped for cmd.exe.
  const parsed = crossSpawn._parse(c, args, { forceShell: true })
  return {
    command: process.env.ComSpec || process.env.comspec || parsed.command,
    args: parsed.args,
    shell: false,
    windowsVerbatimArguments: true
  }
}

export function ptyArguments(spec) {
  // node-pty accepts a raw argument string on Windows. Arrays would apply CRT
  // escaping again and reintroduce the literal-backslash-quote bug.
  return spec.windowsVerbatimArguments ? spec.args.join(' ') : spec.args
}
