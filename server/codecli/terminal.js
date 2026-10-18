import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { winSpawnSpec, ptyArguments } from './winShell.js'
import { killPlan, killTree, IS_WIN } from './procKill.js'

/**
 * Terminal sessions for 主流智能体 (Code CLI).
 *
 * Uses node-pty when available (real PTY: colours, alt-screen TUIs like Claude
 * Code / Codex render correctly) and falls back to piped child_process so the
 * feature still works where the native module could not be built.
 */
let pty = null
try {
  const mod = await import('node-pty')
  pty = mod.default || mod
} catch {
  pty = null
}

export const ptyAvailable = !!pty

const HISTORY_LIMIT = 256 * 1024
const sessions = new Map()

class Session {
  constructor({ id, kind, label, toolId, command, args, cwd, env, cols, rows }) {
    this.id = id
    this.kind = kind // 'tool' | 'shell'
    this.label = label
    this.toolId = toolId
    this.command = command
    this.args = args
    this.cwd = cwd
    this.cols = cols || 80
    this.rows = rows || 24
    this.history = ''
    this.clients = new Set()
    this.exitCode = null
    this.createdAt = Date.now()
    this.usingPty = false
    this.killed = false
    this.killPromise = null
    this.killResult = null

    // On Windows a .cmd shim (every npm-installed CLI) cannot be executed by
    // CreateProcess directly; route it through cmd.exe.
    const spec = winSpawnSpec(command, args)

    if (pty) {
      try {
        this.proc = pty.spawn(spec.command, ptyArguments(spec), {
          name: 'xterm-256color',
          cols: this.cols,
          rows: this.rows,
          cwd,
          env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
        })
        this.usingPty = true
        // node-pty's WindowsTerminal rethrows socket errors into the event loop
        // unless the pty has at least two 'error' listeners:
        //   if (_this.listeners('error').length < 2) { throw err }
        // An uncaught throw there takes the whole server down, so attach two: one
        // that reports into the terminal, one that only exists to satisfy the count.
        this.proc.on('error', (err) => this.push(`\r\n[pty 错误] ${err?.message || err}\r\n`))
        this.proc.on('error', () => {})
        this.proc.onData((data) => this.push(data))
        this.proc.onExit(({ exitCode, signal }) => this.close(exitCode ?? signal ?? 0))
        return
      } catch (err) {
        this.push(`\r\n[pty 启动失败，回退到管道模式] ${err.message}\r\n`)
      }
    }

    // detached on POSIX puts the child in its own process group, so 终止 can
    // signal -pid and take the CLI's own children with it. (On Windows a detached
    // child would get a new console window, so tree-killing is done with taskkill.)
    this.proc = spawn(spec.command, spec.args, { cwd, env, shell: spec.shell, windowsHide: true, windowsVerbatimArguments: !!spec.windowsVerbatimArguments, detached: !IS_WIN })
    // A write to a dead child's stdin emits EPIPE on the stream; with no 'error'
    // listener that becomes an uncaught exception and kills the server.
    this.proc.stdin?.on('error', () => {})
    this.proc.stdout.on('data', (d) => this.push(d.toString().replace(/\n/g, '\r\n')))
    this.proc.stderr.on('data', (d) => this.push(d.toString().replace(/\n/g, '\r\n')))
    this.proc.on('error', (err) => {
      this.push(`\r\n启动失败：${err.message}\r\n`)
      this.close(-1)
    })
    this.proc.on('close', (code) => this.close(code ?? 0))
  }

  push(data) {
    this.history += data
    if (this.history.length > HISTORY_LIMIT) this.history = this.history.slice(-HISTORY_LIMIT)
    this.broadcast({ type: 'output', data })
  }

  broadcast(msg) {
    const payload = JSON.stringify(msg)
    for (const ws of this.clients) {
      try {
        if (ws.readyState === 1) ws.send(payload)
      } catch {}
    }
  }

  write(data) {
    if (this.exitCode !== null || this.killed) return
    try {
      if (this.usingPty) this.proc.write(data)
      else this.proc.stdin?.write(data)
    } catch {}
  }

  resize(cols, rows) {
    this.cols = cols
    this.rows = rows
    if (this.usingPty) {
      try {
        this.proc.resize(cols, rows)
      } catch {}
    }
  }

  attach(ws) {
    this.clients.add(ws)
    ws.send(JSON.stringify({ type: 'hello', sessionId: this.id, history: this.history, cols: this.cols, rows: this.rows, usingPty: this.usingPty, exited: this.exitCode !== null }))
    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (msg.type === 'input') this.write(msg.data)
      else if (msg.type === 'resize') this.resize(msg.cols || this.cols, msg.rows || this.rows)
      else if (msg.type === 'kill') this.kill().catch((err) => this.push(`\r\n终止失败：${err?.message || err}\r\n`))
    })
    ws.on('close', () => {
      this.clients.delete(ws)
      // Keep the CLI running after a page refresh (reconnect replays history).
    })
  }

  /**
   * 终止进程 — kills the CLI's whole process tree and reports what happened.
   *
   * Deliberately does NOT call node-pty's kill() on Windows: that path enumerates
   * the console process list and TerminateProcess'es every pid in it, which can
   * include this server (see procKill.js). We kill the tree with taskkill /T /F
   * instead and let node-pty notice the exit on its own.
   */
  async kill() {
    if (this.killPromise) return this.killPromise
    this.killed = true
    this.killPromise = (async () => {
      const pid = this.proc?.pid
      const plan = killPlan({ pid, usingPty: this.usingPty })
      const result = await killTree(pid)

      // POSIX: let node-pty release the pty (its child is already dead).
      if (plan.callPtyKill) {
        try {
          this.proc.kill()
        } catch {}
      } else if (!this.usingPty) {
        try {
          this.proc.kill('SIGKILL')
        } catch {}
      }

      // Give the exit event a moment to arrive so the UI sees a real exit code;
      // if the pty never reports one (Windows ConPTY can lag after the tree is
      // gone) close the session ourselves instead of leaving it stuck as "running".
      for (let i = 0; i < 15 && this.exitCode === null; i++) await new Promise((r) => setTimeout(r, 100))
      if (this.exitCode === null) this.close(result.killed ? 0 : null)

      this.killResult = { ...result, exited: this.exitCode !== null, exitCode: this.exitCode, usingPty: this.usingPty, pid }
      this.broadcast({ type: 'kill_result', ...this.killResult })
      return this.killResult
    })()
    return this.killPromise
  }

  close(code) {
    if (this.exitCode !== null) return
    this.exitCode = code
    this.broadcast({ type: 'exit', code })
    setTimeout(() => {
      sessions.delete(this.id)
      for (const ws of this.clients) {
        try {
          ws.close()
        } catch {}
      }
    }, 30_000)
  }

  toJSON() {
    return {
      id: this.id,
      kind: this.kind,
      label: this.label,
      toolId: this.toolId,
      command: this.command,
      args: this.args,
      cwd: this.cwd,
      createdAt: this.createdAt,
      exitCode: this.exitCode,
      clients: this.clients.size,
      usingPty: this.usingPty,
      killed: this.killed,
      killResult: this.killResult
    }
  }
}

export function createSession(opts) {
  const id = randomUUID().slice(0, 12)
  const session = new Session({ id, ...opts })
  sessions.set(id, session)
  return session
}

export function getSession(id) {
  return sessions.get(id) || null
}

export function listSessions() {
  return [...sessions.values()].map((s) => s.toJSON())
}

/** Async: resolves with what actually happened to the process tree. */
export async function killSession(id) {
  const s = sessions.get(id)
  if (!s) return { ok: false, error: '会话不存在或已退出' }
  const result = await s.kill()
  return { ok: true, ...result }
}

/** Home directory used as the default working directory in the picker. */
export function homeDir() {
  return os.homedir()
}

/**
 * Server-side directory browser — the web build has no native folder dialog,
 * so the 工作目录 picker lists directories through this endpoint.
 */
export function listDir(target) {
  let t = target || os.homedir()
  if (t === '~') t = os.homedir()
  else if (t.startsWith('~/')) t = path.join(os.homedir(), t.slice(2))
  const dir = path.resolve(t)
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    return { error: err.message, path: dir, dirs: [], parent: path.dirname(dir) }
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const hidden = entries.filter((e) => e.isDirectory() && e.name.startsWith('.')).length
  return { path: dir, dirs, parent: path.dirname(dir), hiddenDirs: hidden }
}
