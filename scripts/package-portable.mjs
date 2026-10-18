// Source-only USB package: app + built UI. Node is downloaded by the launcher on first run.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
const root=path.resolve(new URL('..',import.meta.url).pathname)
const release=JSON.parse(fs.readFileSync(path.join(root,'app-release.json'),'utf8'))
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'agent-studio-portable-')); const app=path.join(stage,'agent-studio')
const skip=new Set(['node_modules','data','.git','dist-smoke','__pycache__','runtime','RELEASE-MANIFEST.json'])
const files={}
const walk=(dir,rel='')=>{ for(const e of fs.readdirSync(dir,{withFileTypes:true})){ if(skip.has(e.name))continue; const r=path.join(rel,e.name); if(e.isDirectory())walk(path.join(dir,e.name),r); else { fs.mkdirSync(path.join(app,path.dirname(r)),{recursive:true}); fs.copyFileSync(path.join(dir,e.name),path.join(app,r)); files[r.split(path.sep).join('/')]=crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,e.name))).digest('hex') } } }
walk(root)
if(!fs.existsSync(path.join(app,'web','dist','index.html')))throw new Error('web/dist missing: run npm run build first')
for(const d of ['data','runtime'])fs.mkdirSync(path.join(app,d),{recursive:true})
fs.writeFileSync(path.join(app,'runtime','README.txt'),'Node.js 24.21.0 is downloaded here automatically on first launch (SHA-256 verified).\nOffline: place node-v24.21.0-win-x64.zip in this folder before starting.\n')
fs.writeFileSync(path.join(app,'RELEASE-MANIFEST.json'),JSON.stringify({release,portable:true,nodeDownloadedOnFirstRun:'24.21.0',files},null,2)+'\n')
const out=path.resolve(process.argv[2]||path.join(root,'..','agent-studio-windows.zip')); fs.rmSync(out,{force:true})
execFileSync('zip',['-qr','-9',out,'agent-studio'],{cwd:stage}); fs.rmSync(stage,{recursive:true,force:true})
console.log('package',out,fs.statSync(out).size,'bytes,',Object.keys(files).length,'files, release',release)
