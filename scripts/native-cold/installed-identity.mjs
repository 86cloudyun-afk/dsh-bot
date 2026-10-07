// Read-only installed-content checks. No SDK imports, launches, or ambient credentials.
import fs from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw Error('INSTALLED_CONTENT_IDENTITY_REFUSED');};
const requireValue=x=>{if(!x)fail();};
const safe=p=>typeof p==='string'&&p.length>0&&p.length<1024&&!/[\\\t\r\n\0]/.test(p)&&!p.startsWith('/')&&!p.split('/').some(x=>!x||x==='.'||x==='..');
const order=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
const selected=p=>/\.(?:js|mjs|cjs|json|wasm)$/.test(p);
export function fixedFile(path,max=512*1024*1024){
 const before=fs.lstatSync(path);requireValue(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1&&before.size<=max&&fs.realpathSync(path)===resolve(path));
 const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const opened=fs.fstatSync(fd);requireValue(opened.dev===before.dev&&opened.ino===before.ino&&opened.size===before.size);
  const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd),last=fs.lstatSync(path);
  requireValue(bytes.length===before.size&&after.dev===before.dev&&after.ino===before.ino&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs&&last.dev===before.dev&&last.ino===before.ino&&last.size===before.size);
  return {bytes,mode:before.mode&0o777,sha256:hash(bytes)};
 }finally{fs.closeSync(fd);}
}
function filesUnder(root,{sdk=false}={}){
 const files=[];let inspected=0,total=0;
 const walk=directory=>{
  const info=fs.lstatSync(directory);requireValue(info.isDirectory()&&!info.isSymbolicLink()&&fs.realpathSync(directory)===resolve(directory));
  for(const name of fs.readdirSync(directory).sort(order)){
   requireValue(++inspected<=100000);if(sdk&&name==='.bin')continue;
   const path=join(directory,name),rel=relative(root,path).split(sep).join('/');requireValue(safe(rel));
   const stat=fs.lstatSync(path);requireValue(!stat.isSymbolicLink());
   if(stat.isDirectory())walk(path);
   else{requireValue(stat.isFile());if(!sdk||selected(rel)){const file=fixedFile(path);total+=file.bytes.length;requireValue(total<=2*1024*1024*1024&&files.length<50000);files.push({path:rel,bytes:file.bytes.length,sha256:file.sha256,mode:file.mode});}}
  }
 };
 walk(root);return files.sort((a,b)=>order(a.path,b.path));
}
export function makeSDKInventory(source){
 const lockFile=fixedFile(join(source,'package-lock.json'),4*1024*1024),lock=JSON.parse(lockFile.bytes),packages=[];
 requireValue(lock.packages&&typeof lock.packages==='object');
 for(const path of Object.keys(lock.packages).sort(order)){
  if(!path)continue;requireValue(safe(path)&&path.startsWith('node_modules/'));
  const pin=lock.packages[path],directory=join(source,path);
  if(!fs.existsSync(directory)){requireValue(pin.optional===true);continue;}
  const metadata=JSON.parse(fixedFile(join(directory,'package.json'),1024*1024).bytes);
  const name=pin.name??path.slice(path.lastIndexOf('node_modules/')+13);
  requireValue(metadata.name===name&&metadata.version===pin.version&&typeof pin.integrity==='string');
  packages.push({path,name:metadata.name,version:metadata.version,integrity:pin.integrity});
 }
 const files=filesUnder(join(source,'node_modules'),{sdk:true});
 requireValue(packages.length>0&&packages.length<=2000&&files.length>0);
 return {schemaVersion:1,scope:'LOCKED_INSTALLED_SDK_CONTENT',lockSHA256:lockFile.sha256,packages,files};
}
export function assertSDKInventory(source,expected){
 requireValue(expected?.schemaVersion===1&&expected.scope==='LOCKED_INSTALLED_SDK_CONTENT');
 requireValue(JSON.stringify(makeSDKInventory(source))===JSON.stringify(expected));
 return true;
}
export function assertInstalledProduct(root,receipt){
 requireValue(/^[a-f0-9]{40}$/.test(receipt?.sourceHead??'')&&/^[a-f0-9]{40}$/.test(receipt?.sourceTree??'')&&Array.isArray(receipt.files)&&receipt.files.length>0&&receipt.files.length<=600);
 const expected=new Set();
 for(const row of receipt.files){
  requireValue(safe(row.path)&&!expected.has(row.path));expected.add(row.path);
  const file=fixedFile(join(root,row.path),64*1024*1024);requireValue(file.bytes.length===row.bytes&&file.sha256===row.sha256&&file.mode===row.mode);
 }
 const src=join(root,'src');if(fs.existsSync(src))for(const row of filesUnder(src))requireValue(expected.has('src/'+row.path));
 return true;
}
