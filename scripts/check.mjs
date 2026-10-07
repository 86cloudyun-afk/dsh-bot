// Static syntax checks only. This does not import product code or start tests.
import { readdirSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'..');let count=0;
for(const directory of ['src','ui','scripts','test','scripts/native-cold'])for(const name of readdirSync(resolve(root,directory)))if(name.endsWith('.mjs')){const r=spawnSync(process.execPath,['--check',resolve(root,directory,name)],{env:{TZ:'UTC'},encoding:'utf8'});if(r.status!==0){process.stderr.write(r.stderr);process.exit(1);}count++;}
const spec=readFileSync(resolve(root,'docs/spec-v0.2.1.md'),'utf8'),matrix=readFileSync(resolve(root,'docs/acceptance-matrix.md'),'utf8');
for(const id of [...Array.from({length:28},(_,i)=>`F${String(i+1).padStart(2,'0')}`),...Array.from({length:8},(_,i)=>`U${i+1}`)])if(!spec.includes(id)||!matrix.includes(id))throw Error(`Missing required scenario ${id}`);
const extraction=JSON.parse(readFileSync(resolve(root,'docs/spec-extraction.json'),'utf8'));if(!extraction)throw Error('Missing extraction evidence');
process.stdout.write(`Static syntax: ${count} modules; F01–F28 / U1–U8 inventory present. Native execution and browser rendering were not checked.\n`);
