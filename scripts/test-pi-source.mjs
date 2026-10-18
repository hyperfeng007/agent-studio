import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CODE_CLI_TOOLS } from '../server/config/codeCliTools.js'
import { migrateLegacyPackages } from '../server/codecli/manager.js'
const pi=CODE_CLI_TOOLS.find(t=>t.id==='pi')
assert.equal(pi.website,'https://github.com/earendil-works/pi')
assert.equal(pi.npmPackage,'@earendil-works/pi-coding-agent')
assert.equal(pi.bin,'pi')
assert.equal(pi.ignoreInstallScripts,true)
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-migration-')),file=path.join(dir,'package.json')
try {
 fs.writeFileSync(file,JSON.stringify({name:'managed-pi',dependencies:{'@mariozechner/pi-coding-agent':'*',other:'1'},custom:{keep:true}}))
 assert.equal(migrateLegacyPackages(file,pi),true)
 const result=JSON.parse(fs.readFileSync(file));assert.deepEqual(result.dependencies,{other:'1'});assert.deepEqual(result.custom,{keep:true})
 assert.equal(migrateLegacyPackages(file,pi),false)
 console.log('Pi 官方包与旧声明迁移 8/8 通过')
} finally {fs.rmSync(dir,{recursive:true,force:true})}
