// Windows launcher dependency fingerprint: an overlay update must not skip new packages.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'..'),marker=path.join(root,'node_modules','.agent-studio-deps')
const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'package.json'))).update(fs.readFileSync(path.join(root,'package-lock.json'))).digest('hex')
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')))
const ready=Object.keys({...pkg.dependencies,...pkg.devDependencies}).every(name=>fs.existsSync(path.join(root,'node_modules',name,'package.json')))
if(process.argv[2]==='write') {if(!ready)process.exit(1);fs.writeFileSync(marker,hash);process.exit(0)}
process.exit(ready && fs.existsSync(marker) && fs.readFileSync(marker,'utf8')===hash ? 0 : 1)
