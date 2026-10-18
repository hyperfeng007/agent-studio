#!/usr/bin/env node
/**
 * 主流智能体 detection tests: the search order that decides whether an already
 * installed agent is reported as installed.
 *
 * The Windows-specific part (npm shims are .cmd, so the extension preference
 * matters) is checked in a child process that fakes process.platform before the
 * module computes IS_WIN.
 *
 * Usage: node scripts/test-detection.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const { findInDirs, candidateDirs, expandGlob, detectTool, windowsEnvironment, expandWindowsVars } = await import('../server/codecli/manager.js')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-studio-detect-'))
const touch = (name) => {
  const p = path.join(tmp, name)
  fs.writeFileSync(p, '#!/bin/sh\necho 1.0.0\n')
  fs.chmodSync(p, 0o755)
  return p
}

let fail = 0
const check = async (name, fn) => {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    fail++
    console.log(`❌ ${name}\n   ${String(e.message).split('\n').slice(0, 3).join('\n   ')}`)
  }
}

await check('在扫描目录里找到可执行文件', () => {
  const made = touch('claude')
  assert.equal(findInDirs(['claude', 'claude-code'], [tmp]), made)
})

await check('主命令名优先于备用名（altBins）', () => {
  touch('qoder')
  const alt = path.join(tmp, 'qodercli')
  fs.existsSync(alt) || touch('qodercli')
  assert.equal(path.basename(findInDirs(['qoder', 'qodercli'], [tmp])), 'qoder')
})

await check('主命令名不存在时回退到备用名', () => {
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-studio-detect2-'))
  fs.writeFileSync(path.join(dir2, 'qodercli'), '#!/bin/sh\n')
  fs.chmodSync(path.join(dir2, 'qodercli'), 0o755)
  assert.equal(path.basename(findInDirs(['qoder', 'qodercli'], [dir2])), 'qodercli')
  fs.rmSync(dir2, { recursive: true, force: true })
})

await check('目录顺序即优先级（PATH 先于安装目录扫描）', () => {
  const first = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-studio-detect3-'))
  fs.writeFileSync(path.join(first, 'gemini'), '#!/bin/sh\n')
  const hit = findInDirs(['gemini'], [first, tmp])
  assert.equal(path.dirname(hit), first)
  fs.rmSync(first, { recursive: true, force: true })
})

await check('全部命中失败时返回 null（不误报已安装）', () => {
  assert.equal(findInDirs(['definitely-not-installed-xyz'], [tmp]), null)
  assert.equal(findInDirs([], [tmp]), null)
})

await check('候选目录覆盖常见安装位置', async () => {
  const dirs = await candidateDirs()
  assert.ok(dirs.length > 3, `too few dirs: ${dirs.length}`)
  const home = os.homedir()
  const expectSome = process.platform === 'win32' ? [home] : [path.join(home, '.local', 'bin'), '/usr/local/bin']
  for (const d of expectSome) {
    // /usr/local/bin may legitimately be absent on some systems; only assert
    // that PATH entries made it in and that home-based dirs are normalised.
    if (d === home) continue
    assert.ok(dirs.some((x) => path.normalize(x) === path.normalize(d)) || !fs.existsSync(d), `missing ${d}`)
  }
  assert.ok(dirs.every((d) => !d.includes(path.delimiter) || process.platform === 'win32'), 'unsplit PATH leaked in')
})

await check('通配目录展开（pip 的 Python3*/Scripts 这类版本化路径）', () => {
  const root = fs.mkdtempSync(path.join(tmp, 'pyglob-'))
  for (const v of ['Python311', 'Python312', 'NotPython']) {
    fs.mkdirSync(path.join(root, v, 'Scripts'), { recursive: true })
  }
  const hit = expandGlob(path.join(root, 'Python3*', 'Scripts')).map((p) => path.basename(path.dirname(p)))
  assert.deepEqual(hit.sort(), ['Python311', 'Python312'])
  assert.deepEqual(expandGlob(path.join(root, 'Python311', 'Scripts')), [path.join(root, 'Python311', 'Scripts')])
  assert.deepEqual(expandGlob(path.join(root, 'missing-*', 'Scripts')), [])
})

await check('检测不到时回报搜过什么（名字 / 目录数 / 提示）', async () => {
  const r = await detectTool({ id: 'nope', npmPackage: 'nope-not-real', bin: 'definitely-not-installed-xyz', altBins: ['also-not-installed-xyz'] })
  assert.equal(r.source, null)
  assert.ok(r.search, 'no search report attached')
  assert.deepEqual(r.search.names, ['definitely-not-installed-xyz', 'also-not-installed-xyz'])
  assert.ok(typeof r.search.dirsTried === 'number' && Array.isArray(r.search.dirs))
  assert.ok(r.search.hint.includes('仅检测盘内'))
})

// ---- Windows extension preference, in a child with a faked platform ----
// The child fakes win32 *before* importing manager.js (IS_WIN is computed at
// module scope). os.tmpdir() would then resolve to %TEMP%, so the parent
// creates the scratch dirs and passes real paths in.
const winDir = fs.mkdtempSync(path.join(tmp, 'win-shims-'))
const exeDir = fs.mkdtempSync(path.join(tmp, 'win-exe-'))
const child = `
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  process.env.ComSpec = 'cmd.exe'
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { findInDirs } = await import(${JSON.stringify(path.resolve('server/codecli/manager.js'))})
  const dir = ${JSON.stringify(winDir)}
  // npm writes three shims per bin on Windows: extension-less, .cmd and .ps1
  for (const n of ['gemini', 'gemini.ps1', 'gemini.cmd']) fs.default.writeFileSync(path.default.join(dir, n), '')
  const hit = findInDirs(['gemini'], [dir])
  if (!String(hit).endsWith('gemini.cmd')) { console.error('FAIL: picked ' + hit); process.exit(1) }
  const bare = ${JSON.stringify(exeDir)}
  fs.default.writeFileSync(path.default.join(bare, 'claude.exe'), '')
  const exe = findInDirs(['claude'], [bare])
  if (!String(exe).endsWith('claude.exe')) { console.error('FAIL: exe not found -> ' + exe); process.exit(1) }
  console.log('ok')
`
await check('Windows：npm shim 优先选 .cmd，其次 .exe', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8' })
  assert.match(out, /ok/)
})

await check('Windows：新注册表 PATH 替换旧进程 PATH，去掉大小写重复键', () => {
  const env = windowsEnvironment({ Path: 'old', PATH: 'stale', AppData: 'C:/用户/npm', TOKEN: 'keep' }, '%appdata%;C:/nvm4w/nodejs')
  assert.equal(env.PATH, 'C:/用户/npm;C:/nvm4w/nodejs')
  assert.equal(env.Path, undefined)
  assert.equal(env.TOKEN, 'keep')
})
await check('Windows：注册表读取失败保留原 PATH', () => {
  assert.equal(windowsEnvironment({ Path: 'original' }, '').PATH, 'original')
})
await check('Windows：未知环境变量保留，不误变为空路径', () => {
  assert.equal(expandWindowsVars('%UNKNOWN%/bin', {}), '%UNKNOWN%/bin')
})
await check('Windows：DSH 识别 .cmd，排除不可直接启动的无后缀/PowerShell shim', () => {
  const script = `
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const {findInDirs} = await import(${JSON.stringify(path.resolve('server/codecli/manager.js'))})
    const fs = await import('node:fs'); const path = await import('node:path')
    const dir = ${JSON.stringify(winDir)}
    fs.writeFileSync(path.join(dir, 'dsh.ps1'), '')
    fs.writeFileSync(path.join(dir, 'dsh'), '')
    if (findInDirs(['dsh'], [dir]) !== null) throw Error('selected non-runnable shim')
    fs.writeFileSync(path.join(dir, 'dsh.cmd'), '')
    if (!findInDirs(['dsh'], [dir]).endsWith('dsh.cmd')) throw Error('missing dsh.cmd')
    fs.writeFileSync(path.join(dir, 'dsh.exe'), '')
    if (!findInDirs(['dsh'], [dir]).endsWith('dsh.exe')) throw Error('wrong extension precedence')
  `
  execFileSync(process.execPath, ['--input-type=module', '-e', script])
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${fail ? `❌ ${fail} 项失败` : '✅ 全部通过'}\n`)
process.exit(fail ? 1 : 0)
