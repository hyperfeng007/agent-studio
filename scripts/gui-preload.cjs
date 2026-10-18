// GUI-only bootstrap, inherited by npm/node descendants through NODE_OPTIONS.
// Keep lifecycle/build commands hidden without changing normal CLI launches.
const cp = require('node:child_process')
const { promisify } = require('node:util')
function hiddenArgs(kind, supplied) {
  const args = [...supplied]
  const index = kind === 'exec' || kind === 'execSync' ? 1 : Array.isArray(args[1]) ? 2 : 1
  if (args[index] && typeof args[index] === 'object') args[index] = { ...args[index], windowsHide: true }
  else if (args[index] === undefined) args[index] = { windowsHide: true }
  else args.splice(index, 0, { windowsHide: true })
  return args
}
module.exports = { hiddenArgs }
if (process.platform === 'win32' && process.env.AGENT_STUDIO_GUI === '1') {
  for (const kind of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    const original = cp[kind]
    const wrapped = function (...args) { return original.apply(this, hiddenArgs(kind, args)) }
    for (const key of Reflect.ownKeys(original)) {
      if (!['name', 'length', 'prototype', 'arguments', 'caller'].includes(key) && key !== promisify.custom) Object.defineProperty(wrapped, key, Object.getOwnPropertyDescriptor(original, key))
    }
    if (original[promisify.custom]) Object.defineProperty(wrapped, promisify.custom, {
      value: function (...args) { return original[promisify.custom].apply(this, hiddenArgs(kind, args)) }
    })
    cp[kind] = wrapped
  }
  require('node:module').syncBuiltinESMExports()
}
