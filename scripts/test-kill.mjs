#!/usr/bin/env node
/**
 * 终止进程 tests — the bug this guards against:
 *
 *   点击「终止进程」→ CLI 没死（只杀了 cmd.exe / 直接子进程），而且 Agent Studio
 *   自己整个退出。
 *
 * On Windows the second half came from node-pty: WindowsPtyAgent.kill() walks the
 * *console process list* and calls process.kill() on every pid in it (its own
 * comment: "node servers in particular seem to become detached and remain
 * running", Microsoft/vscode#26807). process.kill on Windows is TerminateProcess
 * — uncatchable — so when that list contains this server, the app just vanishes.
 * We therefore kill the tree ourselves (taskkill /T /F) and never call node-pty's
 * kill() on Windows.
 *
 * The tree part is testable on any OS, so these tests run for real on POSIX and
 * assert the Windows *plan* as data.
 *
 * Usage: node scripts/test-kill.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const { killPlan, killTree, isAlive, protectedPids } = await import('../server/codecli/procKill.js')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-studio-kill-'))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let fail = 0
const check = async (name, fn) => {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    fail++
    console.log(`❌ ${name}\n   ${String(e.message).split('\n').slice(0, 4).join('\n   ')}`)
  }
}

/** sh -c that starts a grandchild, prints its pid, then waits — a real tree. */
function spawnTree() {
  const marker = path.join(tmp, `marker-${Math.random().toString(36).slice(2)}`)
  const child = spawn('/bin/sh', ['-c', `sleep 60 & echo $! > "${marker}"; echo started; wait`], {
    cwd: tmp,
    detached: true, // same as our pipe-mode launch: the child leads its own group
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.resume()
  child.stderr.resume()
  return { child, marker, grandchildPid: () => Number(fs.readFileSync(marker, 'utf8').trim()) }
}

/* ---------------------------------------------------------- plan (pure) */
await check('Windows 计划：taskkill /T /F，且绝不调用 node-pty 的 kill()', () => {
  const plan = killPlan({ pid: 4321, usingPty: true, platform: 'win32' })
  const tk = plan.steps.find((s) => s.tool === 'taskkill')
  assert.ok(tk, 'no taskkill step')
  assert.deepEqual(tk.args, ['/pid', '4321', '/T', '/F'], '/T (tree) and /F (force) are mandatory')
  assert.equal(plan.callPtyKill, false, 'node-pty kill() on Windows can terminate this server')
  assert.equal(plan.neverCallPtyKillOnWindows, true)
})

await check('POSIX 计划：先杀进程组 SIGTERM，再升级 SIGKILL', () => {
  const plan = killPlan({ pid: 4321, usingPty: true, platform: 'linux' })
  const terms = plan.steps.filter((s) => s.tool === 'signal')
  assert.equal(terms[0].target, -4321, 'must target the process group, not just the child')
  assert.equal(terms[0].signal, 'SIGTERM')
  assert.equal(terms[terms.length - 1].signal, 'SIGKILL')
  assert.equal(plan.callPtyKill, true, 'on POSIX node-pty kill() only signals the (already dead) child')
})

await check('自己的 pid 与父进程 pid 永不作为终止目标', async () => {
  const prot = protectedPids()
  assert.ok(prot.has(process.pid))
  if (process.ppid) assert.ok(prot.has(process.ppid))
  const r = await killTree(process.pid)
  assert.equal(r.killed, false)
  assert.match(r.error, /拒绝终止/)
})

/* ------------------------------------------------- real tree kills (POSIX) */
await check('只杀直接子进程会留下孙子进程（这就是「终止失败」）', async () => {
  const { child, grandchildPid } = spawnTree()
  await wait(500)
  const gpid = grandchildPid()
  assert.ok(isAlive(gpid), 'grandchild should be running')
  process.kill(child.pid, 'SIGTERM') // the old behaviour: one process only
  await wait(600)
  assert.equal(isAlive(gpid), true, 'grandchild survived a single-pid kill — bug reproduced')
  await killTree(child.pid) // clean up
  await wait(300)
  assert.equal(isAlive(gpid), false)
})

await check('killTree 把整棵进程树都带走', async () => {
  const { child, grandchildPid } = spawnTree()
  await wait(500)
  const gpid = grandchildPid()
  assert.ok(isAlive(child.pid) && isAlive(gpid))
  const r = await killTree(child.pid)
  assert.equal(r.killed, true, JSON.stringify(r))
  assert.equal(isAlive(child.pid), false, 'child still alive')
  assert.equal(isAlive(gpid), false, 'grandchild still alive')
  assert.ok(r.method.length >= 1)
})

await check('killTree 对已退出的 pid 直接返回 killed（不抛异常、不误报）', async () => {
  const child = spawn('/bin/sh', ['-c', 'exit 0'], { cwd: tmp, stdio: 'ignore' })
  await new Promise((r) => child.on('close', r))
  const r = await killTree(child.pid, { graceMs: 200, timeoutMs: 400 })
  assert.equal(r.killed, true, JSON.stringify(r))
  assert.equal(await killTree(null).then((x) => x.killed), false, 'a missing pid must be reported, not thrown')
})

/* --------------------------------------------- Session level (real pty/pipe) */
const { createSession, killSession, listSessions } = await import('../server/codecli/terminal.js')

await check('Session.kill() 终止 CLI 及其子进程，并给出真实回执', async () => {
  const marker = path.join(tmp, 'session-grandchild')
  const session = createSession({
    kind: 'tool',
    label: 'kill-test',
    toolId: 'pi',
    command: '/bin/sh',
    args: ['-c', `sleep 60 & echo $! > "${marker}"; echo ready; wait`],
    cwd: tmp,
    env: { ...process.env },
    cols: 80,
    rows: 24
  })
  for (let i = 0; i < 40 && !fs.existsSync(marker); i++) await wait(100)
  assert.ok(fs.existsSync(marker), 'the fake CLI never started its child')
  const gpid = Number(fs.readFileSync(marker, 'utf8').trim())
  assert.ok(isAlive(gpid), 'grandchild should be alive before the kill')

  const r = await killSession(session.id)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.killed, true, `tree not killed: ${JSON.stringify(r)}`)
  assert.equal(isAlive(gpid), false, 'the CLI child survived 终止进程')
  assert.notEqual(session.exitCode, null, 'session should be marked exited so the UI does not hang')
  assert.equal(session.killed, true)

  // idempotent: a second 终止 must not throw or resurrect anything
  const again = await killSession(session.id)
  assert.equal(again.ok, true)
})

await check('终止未知会话返回明确错误，而不是 500 / 崩溃', async () => {
  const r = await killSession('does-not-exist')
  assert.equal(r.ok, false)
  assert.match(r.error, /不存在|已退出/)
})

await check('终止后继续写入不会让服务崩掉（stdin EPIPE 已被吞掉）', async () => {
  const session = createSession({
    kind: 'tool',
    label: 'epipe-test',
    toolId: 'pi',
    command: '/bin/sh',
    args: ['-c', 'echo hi; sleep 30'],
    cwd: tmp,
    env: { ...process.env },
    cols: 80,
    rows: 24
  })
  await wait(400)
  await session.kill()
  for (let i = 0; i < 20; i++) session.write('still typing\r') // must be a no-op, not a crash
  await wait(300)
  assert.ok(listSessions().some((s) => s.id === session.id), 'session list still readable')
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${fail ? `❌ ${fail} 项失败` : '✅ 全部通过'}\n`)
process.exit(fail ? 1 : 0)
