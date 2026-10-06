import { readFileSync,readdirSync } from 'node:fs';
import { resolve,relative } from 'node:path';
import { createHash } from 'node:crypto';
const root=process.argv[2];if(!root)throw Error('Provide the explicitly authorized public @deepseek-ai package directory. This script never imports a host.');
const packages=['dsh','cordis','dsh-api-session-controller','dsh-agent','dsh-subagent','dsh-workspace','dsh-tools','dsh-fs-sandbox','dsh-llm','dsh-plan-mode','dsh-permission-presets'];
const symbols=['selectSessionModel','dispatchPermit','admitOperation','inspectOperation','runGeneration','selectModel','archiveSession','unarchiveSession','PlanModeController','PermissionCatalog'];
function walk(path){return readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(path,e.name)):e.isFile() && e.name.endsWith('.d.ts')?[resolve(path,e.name)]:[]);}
const result={authority:'public-static-types-only',nativeRuntimeLoaded:false,scannedPackages:packages,packages:[]};
for(const name of packages){const folder=resolve(root,name);try{const pkg=JSON.parse(readFileSync(resolve(folder,'package.json'),'utf8')),files=walk(resolve(folder,'lib/types'));result.packages.push({name:pkg.name,version:pkg.version,license:pkg.license??null,files:files.map(file=>{const source=readFileSync(file,'utf8');return {path:relative(folder,file),sha256:createHash('sha256').update(source).digest('hex'),signals:Object.fromEntries(symbols.map(symbol=>[symbol,source.split('\n').flatMap((line,i)=>line.includes(symbol)?[i+1]:[])]).filter(([,lines])=>lines.length))};})});}catch(e){result.packages.push({name,status:'unavailable',code:e.code??e.name});}}
process.stdout.write(JSON.stringify(result,null,2)+'\n');
