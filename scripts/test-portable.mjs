import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'portable test '))
process.env.DATA_DIR=path.join(tmp,'data'); fs.mkdirSync(process.env.DATA_DIR,{recursive:true})
const { portableToolEnv, workspaceDir, toolConfigDir, ensurePortableDir, inside } = await import('../server/codecli/portable.js')
const { CODE_CLI_TOOLS } = await import('../server/config/codeCliTools.js')
let n=0; const ok=(c,m)=>{assert.ok(c,m);n++}
const data=fs.realpathSync(process.env.DATA_DIR)
for (const t of CODE_CLI_TOOLS) {
  const env=portableToolEnv(t.id)
  for (const k of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','npm_config_cache','npm_config_prefix','XDG_CONFIG_HOME'])
    ok(inside(data,env[k]),`${t.id} ${k} must live under data`)
  ok(!Object.values(env).some(v=>v===os.homedir()),`${t.id} must not reference host home`)
}
ok(portableToolEnv('claude-code').CLAUDE_CONFIG_DIR.startsWith(path.join(data,'tool-config')),'claude config dir')
ok(portableToolEnv('openclaw').OPENCLAW_CONFIG_PATH.endsWith('openclaw.json'),'openclaw config path')
ok(inside(data,workspaceDir()),'default workspace under data')
ok(workspaceDir(os.homedir()).startsWith(data),'host home rejected as workspace')
ok(workspaceDir('..')===path.join(data,'workspaces'),'parent escape rejected')
assert.throws(()=>ensurePortableDir(path.join(tmp,'outside')),/data/); n++
fs.rmSync(path.join(data,'tool-config','pi'),{recursive:true,force:true})
const legacy=path.join(data,'codecli','pi','agent-studio-config'); fs.mkdirSync(legacy,{recursive:true}); fs.writeFileSync(path.join(legacy,'models.json'),'{}')
ok(fs.existsSync(path.join(toolConfigDir('pi'),'models.json')),'legacy pi config migrated')
ok(!fs.existsSync(legacy),'legacy dir moved, not copied')
const home=path.join(tmp,'fake home'); const saved=[process.env.HOME,process.env.USERPROFILE]; process.env.HOME=home; process.env.USERPROFILE=home
try {
  for (const t of CODE_CLI_TOOLS.filter(t=>t.writeConfig)) t.writeConfig({dir:toolConfigDir(t.id),endpoint:'http://127.0.0.1:3000/g',apiKey:'k',model:'m',cfg:{mode:'gateway'},provider:{type:'openai'}})
  ok(!fs.existsSync(home),'no tool config written to host home')
} finally { process.env.HOME=saved[0]; process.env.USERPROFILE=saved[1] }
fs.rmSync(tmp,{recursive:true,force:true})
console.log(`便携模式检查 ${n}/${n} 通过`)
