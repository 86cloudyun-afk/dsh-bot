import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const target=resolve(root,'src/client/client.js');
let source=readFileSync(target,'utf8');
const {version}=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
if(typeof version!=='string'||!version)throw Error('package.json: missing release version');
const versionDeclaration=/const pluginVersion = "[^"]+", clientProtocol = 2;/g;
if([...source.matchAll(versionDeclaration)].length!==1)throw Error('client.js: missing or duplicate release identity');
source=source.replace(versionDeclaration,`const pluginVersion = ${JSON.stringify(version)}, clientProtocol = 2;`);
for(const entry of [{file:'bot-space.js',marker:'BOT SPACE',declaration:'export function createBotSpace('},{file:'bot-space.styles.js',marker:'BOT SPACE STYLES',declaration:'export const botSpaceStyles'}]) {
  const helper=readFileSync(resolve(root,'src/client',entry.file),'utf8').replace(/\r\n/g,'\n');
  if(helper.split(entry.declaration).length!==2)throw Error(`${entry.file}: expected exactly one public declaration`);
  const body=helper.replace(entry.declaration,entry.declaration.slice(7)).trimEnd();
  const start=`    // BEGIN GENERATED ${entry.marker}`,end=`    // END GENERATED ${entry.marker}`;
  const generated=`${start}\n${body.split('\n').map(line=>`    ${line}`).join('\n')}\n${end}`;
  const startIndex=source.indexOf(`${start}\n`),endIndex=source.indexOf(`${end}\n`);
  if(startIndex<0||endIndex<startIndex||source.indexOf(`${start}\n`,startIndex+start.length)!==-1||source.indexOf(`${end}\n`,endIndex+end.length)!==-1)throw Error(`client.js: missing or duplicate ${entry.marker} markers`);
  source=source.slice(0,startIndex)+generated+source.slice(endIndex+end.length);
}
const original=readFileSync(target,'utf8');
if(process.argv.includes('--check')){if(source!==original)throw Error('Generated client.js is stale. Run node scripts/build-client.mjs.');}
else if(source!==original)writeFileSync(target,source);
console.log(`Bot space deterministic client ${process.argv.includes('--check')?'check':'build'}: PASS`);
