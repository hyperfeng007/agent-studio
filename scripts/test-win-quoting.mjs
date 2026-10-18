#!/usr/bin/env node
/**
 * Windows quoting / spawn regression test.
 *
 * The Windows code paths are guarded by process.platform, so this test fakes
 * `win32` before importing the module. It exists because a wrong quote style
 * silently breaks 编码搭档 launches on Windows (cmd.exe ignores single quotes,
 * PowerShell needs `&`), and that is hard to notice from a Linux/macOS dev box.
 *
 * Usage: node scripts/test-win-quoting.mjs
 */
import assert from 'node:assert/strict'

Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe'

const { quoteFor, commandLineFor, winSpawnSpec, ptyArguments, isPosixShell } = await import('../server/codecli/winShell.js')

const cases = [
  // cmd.exe: double quotes, no call operator
  ['cmd bare path', () => commandLineFor('C:\\app\\data\\codecli\\gemini-cli\\node_modules\\.bin\\gemini.cmd', ['-m', 'mock-chat'], 'cmd'),
    'C:\\app\\data\\codecli\\gemini-cli\\node_modules\\.bin\\gemini.cmd -m mock-chat'],
  ['cmd path with spaces', () => commandLineFor('C:\\My Documents\\agent-studio\\gemini.cmd', ['-m', 'gpt'], 'cmd'),
    '"C:\\My Documents\\agent-studio\\gemini.cmd" -m gpt'],
  ['cmd arg with spaces', () => commandLineFor('C:\\a\\codex.cmd', ['exec', 'fix the bug'], 'cmd'),
    'C:\\a\\codex.cmd exec "fix the bug"'],
  // PowerShell: single quotes + call operator when the command itself is quoted
  ['pwsh path with spaces', () => commandLineFor('C:\\My Documents\\agent-studio\\gemini.cmd', ['-m', 'gpt'], 'powershell'),
    "& 'C:\\My Documents\\agent-studio\\gemini.cmd' -m gpt"],
  ['pwsh bare path', () => commandLineFor('C:\\app\\gemini.cmd', ['--approval-mode', 'default'], 'pwsh'),
    'C:\\app\\gemini.cmd --approval-mode default'],
  ['pwsh arg with apostrophe', () => quoteFor("it's a test", 'powershell'), "'it''s a test'"],
  // spawn specs: .cmd and bare shims go through cmd.exe, real .exe do not
  ['spawn .cmd keeps verbatim cmd parsing', () => {
    const spec=winSpawnSpec('C:\\app\\tool.cmd',['-p','hi there'])
    return spec.windowsVerbatimArguments && spec.args.length===4 && spec.args[2]==='/c' && spec.shell===false
  }, true],
  ['PTY uses raw command string, not double-escaped array', () => typeof ptyArguments(winSpawnSpec('npm',['install','x'])), 'string'],
  ['real exe PTY retains argument array', () => ptyArguments(winSpawnSpec('node.exe',['a b'])), ['a b']],
  ['spawn bare npm', () => winSpawnSpec('npm', ['install', 'x']).command, 'C:\\Windows\\System32\\cmd.exe'],
  ['spawn exe untouched', () => winSpawnSpec('C:\\Windows\\System32\\cmd.exe', []).command, 'C:\\Windows\\System32\\cmd.exe'],
  ['spawn powershell untouched', () => winSpawnSpec('powershell.exe', ['-NoLogo']).command, 'powershell.exe'],
  // shell classification drives the `-i` flag for interactive POSIX shells only
  ['posix shells need -i', () => ['bash', 'zsh', 'sh', 'fish', undefined].every((s) => isPosixShell(s)), true],
  ['windows shells do not', () => ['cmd', 'powershell', 'pwsh'].every((s) => !isPosixShell(s)), true]
]

let fail = 0
for (const [name, fn, expected] of cases) {
  try {
    assert.deepEqual(fn(), expected)
    console.log(`✅ ${name}`)
  } catch (e) {
    fail++
    console.log(`❌ ${name}\n   got:      ${JSON.stringify(fn())}\n   expected: ${JSON.stringify(expected)}`)
  }
}
console.log(`\n${cases.length - fail}/${cases.length} 通过\n`)
process.exit(fail ? 1 : 0)
