import {execFileSync} from 'node:child_process';
import {readdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
for(const directory of ['src/native','src/client','scripts']) for(const entry of readdirSync(resolve(root,directory),{withFileTypes:true})) {
 if(entry.isFile() && /\.(mjs|js)$/.test(entry.name))execFileSync(process.execPath,['--check',resolve(root,directory,entry.name)],{stdio:'inherit'});
}
const p=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
if(p.scripts.start || Object.keys(p.exports).some(x=>/owner|host|controller/.test(x)))throw Error('Standalone route remains active');
console.log('Native plugin syntax and entry closure: PASS');
