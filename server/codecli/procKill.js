/**
 * Terminating a CLI session reliably — without terminating Agent Studio.
 *
 * Why this module exists (three real failure modes it fixes):
 *
 * 1. `child.kill()` on Windows is `TerminateProcess` on **one** process. Every
 *    npm-installed CLI is launched as `%ComSpec% /d /s /c "<tool>.cmd" …`, so the
 *    pid we hold is cmd.exe's; the actual `node <tool>.js` grandchild keeps
 *    running. The user clicks 终止进程, the terminal says it died, the CLI does
 *    not. Fix: `taskkill /pid <pid> /T /F` (T = whole tree, F = force).
 *
 * 2. node-pty's Windows `kill()` is worse than useless here. `WindowsPtyAgent`
 *    enumerates *the console process list* and calls `process.kill(pid)` on every
 *    entry — its own comment says this is deliberate, "If we do not force kill
 *    all processes here, node servers in particular seem to become detached and
 *    remain running (see Microsoft/vscode#26807)". When that list is the console
 *    Agent Studio itself is attached to (the `start.bat` window), it contains
 *    cmd.exe + this server, and `process.kill()` on Windows is `TerminateProcess`
 *    — no exception, no handler, no cleanup: the whole app just vanishes. The
 *    ConPTY path can also fork `conpty_console_list_agent`, which throws when
 *    `FreeConsole()`/`AttachConsole()` fail; node-pty then waits 5s and kills only
 *    the shell pid, leaving the CLI alive. Fix: on Windows we kill the tree
 *    ourselves and **never** call node-pty's `kill()`.
 *
 * 3. On POSIX node-pty's `kill()` is `process.kill(this.pid, 'SIGHUP')` — again a
 *    single process, not the group. Fix: signal `-pid` (the child is a session /
 *    group leader: forkpty calls setsid, and our piped children are spawned with
 *    `detached: true`), escalating SIGTERM → SIGKILL.
 *
 * `killPlan()` is pure so the platform behaviour can be unit-tested on any OS.
 */
import { spawn } from 'node:child_process'

export const IS_WIN = process.platform === 'win32'

const GRACE_MS = 1500
const TIMEOUT_MS = 5000

/** Pids that must never be signalled: this server and whatever launched it. */
export function protectedPids() {
  return new Set([process.pid, process.ppid].filter((p) => Number.isInteger(p) && p > 0))
}

/** Signal 0 probe: works on POSIX and Windows (Node maps it to OpenProcess). */
export function isAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM' // exists, owned by someone else
  }
}

/**
 * What we are going to do, as data.
 * @returns {{steps: object[], callPtyKill: boolean, platform: string}}
 */
export function killPlan({ pid, usingPty = false, platform = process.platform }) {
  const win = platform === 'win32'
  const steps = win
    ? [
        { tool: 'taskkill', args: ['/pid', String(pid), '/T', '/F'], why: 'kill the whole tree, not just the cmd.exe shim' },
        { tool: 'verify', pid, why: 'confirm the pid is really gone' }
      ]
    : [
        { tool: 'signal', target: -pid, signal: 'SIGTERM', why: 'process group: the CLI and everything it spawned' },
        { tool: 'wait', ms: GRACE_MS },
        { tool: 'signal', target: -pid, signal: 'SIGKILL', why: 'escalate if SIGTERM was ignored' }
      ]
  return {
    platform,
    steps,
    // See failure mode 2: node-pty's Windows kill() can terminate this server.
    // On POSIX its kill() only signals the direct child, which is already dead by
    // then, so calling it is a harmless way to let node-pty release the pty.
    callPtyKill: !win && usingPty,
    neverCallPtyKillOnWindows: win
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function runTaskkill(pid) {
  return new Promise((resolve) => {
    let out = ''
    let child
    try {
      child = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    } catch (err) {
      return resolve({ ok: false, error: err.message })
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
      resolve({ ok: false, error: 'taskkill timed out' })
    }, TIMEOUT_MS)
    child.stdout?.on('data', (d) => (out += d.toString()))
    child.stderr?.on('data', (d) => (out += d.toString()))
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, error: err.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      // 128 = process not found, which for our purposes means "already dead".
      resolve({ ok: code === 0 || code === 128, code, output: out.trim().slice(0, 300) })
    })
  })
}

function signal(target, sig) {
  try {
    process.kill(target, sig)
    return true
  } catch {
    return false // ESRCH: already gone. EPERM: not ours to kill.
  }
}

/**
 * Kill a process tree and report what actually happened.
 * @returns {Promise<{killed:boolean, method:string[], error?:string}>}
 */
export async function killTree(pid, opts = {}) {
  const platform = opts.platform || process.platform
  const graceMs = opts.graceMs ?? GRACE_MS
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS
  const method = []

  if (!pid) return { killed: false, method, error: '没有可终止的进程号' }
  if (protectedPids().has(pid)) {
    // Should be impossible, but the cost of being wrong is the whole app.
    return { killed: false, method, error: `拒绝终止 pid ${pid}：那是 Agent Studio 自己或它的父进程` }
  }

  if (platform === 'win32') {
    const r = await runTaskkill(pid)
    method.push(`taskkill /pid ${pid} /T /F`)
    if (!r.ok && r.error) {
      // No taskkill (rare) — fall back to a single-process terminate.
      if (signal(pid, 'SIGKILL')) method.push('process.kill(SIGKILL)')
      else return { killed: false, method, error: r.error }
    }
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!isAlive(pid)) return { killed: true, method }
      await wait(120)
    }
    return { killed: !isAlive(pid), method, error: isAlive(pid) ? '进程树在超时后仍然存活' : undefined }
  }

  // POSIX: the group first (the CLI is a session leader under a pty, and piped
  // children are spawned detached so they lead their own group too).
  if (signal(-pid, 'SIGTERM')) method.push(`kill(-${pid}, SIGTERM)`)
  else if (signal(pid, 'SIGTERM')) method.push(`kill(${pid}, SIGTERM)`)
  const deadline = Date.now() + graceMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return { killed: true, method }
    await wait(80)
  }
  if (!signal(-pid, 'SIGKILL')) signal(pid, 'SIGKILL')
  method.push('SIGKILL')
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (!isAlive(pid)) return { killed: true, method }
    await wait(80)
  }
  return { killed: !isAlive(pid), method, error: isAlive(pid) ? '进程在超时后仍然存活' : undefined }
}
