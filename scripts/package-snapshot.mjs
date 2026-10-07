import {readFile,lstat,realpath,readdir,mkdir,writeFile,symlink,rm,chmod} from 'node:fs/promises';
import {join,dirname,isAbsolute,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const sha = b => createHash('sha256').update(b).digest('hex');
const fail = message => {throw Error(message);};
const safe = p => typeof p==='string' && p && !p.includes('\\') && !isAbsolute(p) && !p.split('/').some(x=>!x||x==='.'||x==='..'||['node_modules','.git','.aws','.codex','.agents','.npmrc'].includes(x)||x.startsWith('.env'));
const selected = p => ['package.json','README.md','cordis.patch.yml'].includes(p)||p.startsWith('src/');
export function decodePackageArchive(input){
 const bytes=input[0]===31&&input[1]===139?gunzipSync(input,{maxOutputLength:64*1024*1024}):input;
 if(bytes.length>64*1024*1024||bytes.length%512)fail('package_snapshot_archive_invalid');
 const files=new Map(),directories=new Set();files.modes=new Map();let ended=false;
 const str=b=>b.toString('utf8').replace(/\0.*$/s,'');
 const oct=b=>{const s=str(b).trim();if(!/^[0-7]+$/.test(s))fail('package_snapshot_archive_invalid');return parseInt(s,8);};
 for(let at=0;at<bytes.length;){
  const h=bytes.subarray(at,at+512);at+=512;
  if(h.every(x=>x===0)){if(bytes.subarray(at).some(x=>x!==0))fail('package_snapshot_archive_invalid');ended=true;break;}
  const check=Buffer.from(h);check.fill(32,148,156);if(check.reduce((a,b)=>a+b,0)!==oct(h.subarray(148,156)))fail('package_snapshot_archive_invalid');
  const prefix=str(h.subarray(345,500)),name=(prefix?prefix+'/':'')+str(h.subarray(0,100)),type=String.fromCharCode(h[156]||48),size=oct(h.subarray(124,136)),mode=oct(h.subarray(100,108));
  if(size>64*1024*1024||at+Math.ceil(size/512)*512>bytes.length||mode>0o777)fail('package_snapshot_archive_invalid');
  if(type==='5'){const directory=name.replace(/\/$/,'');if(size||directories.has(directory)||directory!=='package'&&(!directory.startsWith('package/')||!safe(directory.slice(8))))fail('package_snapshot_archive_invalid');directories.add(directory);}
  else{
   if(type!=='0'||!name.startsWith('package/'))fail('package_snapshot_archive_invalid');const path=name.slice(8);
   if(!safe(path)||!selected(path)||files.has(path)||files.size>=600)fail('package_snapshot_archive_invalid');
   files.set(path,Buffer.from(bytes.subarray(at,at+size)));
   files.modes.set(path,mode);
  }
  at+=Math.ceil(size/512)*512;
 }
 if(!ended||!files.size||[...directories].some(d=>d!=='package'&&![...files.keys()].some(p=>p.startsWith(d.slice(8)+'/'))))fail('package_snapshot_archive_invalid');return files;
}
export function validatePackageClosure(files){
 let pkg;try{pkg=JSON.parse(files.get('package.json'));}catch{fail('package_snapshot_closure_incomplete');}
 if(pkg.name!=='dsh-bot'||pkg.private!==true||JSON.stringify(pkg.files)!==JSON.stringify(['src','cordis.patch.yml','README.md'])||!files.has('README.md')||!files.has('cordis.patch.yml'))fail('package_snapshot_closure_incomplete');
 const required=[];const collect=value=>{if(typeof value==='string')required.push(value);else if(value&&typeof value==='object')Object.values(value).forEach(collect);};
 collect(pkg.exports);collect(pkg.main);collect(pkg.types);collect(pkg.dsh?.bundle?.patch);collect(pkg.dsh?.client?.inject?.filter(x=>x.startsWith('.')));
 for(const target of required){const path=target.replace(/^\.\//,'');if(!safe(path)||!files.has(path))fail('package_snapshot_closure_incomplete');}
 for(const [path,bytes]of files)if(/\.(?:mjs|js)$/.test(path)){
  const imports=bytes.toString('utf8').matchAll(/(?:\b(?:import|export)\s+(?:[^;]*?\sfrom\s*)?|\bimport\s*\()\s*['"](\.[^'"]+)['"]/g);
  for(const [,target]of imports){const absolute=resolve('/',dirname(path),target),relative=absolute.slice(1);if(!safe(relative)||!files.has(relative))fail('package_snapshot_closure_incomplete');}
 }
 return pkg;
}
export async function currentPackageNames(root){
 const names=['package.json','README.md','cordis.patch.yml'];
 const walk=async at=>{const directory=join(root,at),stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(directory)!==directory)fail('package_snapshot_source_invalid');for(const entry of await readdir(directory,{withFileTypes:true})){const path=at+'/'+entry.name;if(!safe(path)||names.length>=600)fail('package_snapshot_source_invalid');if(entry.isDirectory())await walk(path);else names.push(path);}};
 await walk('src');return names.sort();
}
export async function currentPackageIndex(root,files){
 const names=await currentPackageNames(root);if(JSON.stringify(names)!==JSON.stringify([...files.keys()].sort()))fail('package_snapshot_source_changed');
 const index=[];for(const path of names){const absolute=join(root,path),stat=await lstat(absolute);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o7000)||await realpath(absolute)!==absolute)fail('package_snapshot_source_invalid');const bytes=await readFile(absolute),mode=files.modes.get(path);if(!bytes.equals(files.get(path))||mode!==(stat.mode&0o777))fail('package_snapshot_source_changed');index.push({path,bytes:bytes.length,sha256:sha(bytes),mode});}return index;
}
export async function installProductPackage({directory,productRoot,packagePlacement='symlink',packageSnapshot,packageSourceMode='recorded-root'}){
 if(!['symlink','snapshot'].includes(packagePlacement))fail('package_placement_invalid');
 if(!['recorded-root','verified-export'].includes(packageSourceMode))fail('package_source_mode_invalid');
 if(packageSourceMode==='verified-export'&&packagePlacement!=='snapshot')fail('package_verified_export_snapshot_required');
 if(![directory,productRoot].every(isAbsolute))fail('package_snapshot_absolute_paths_required');
 if(packagePlacement==='symlink'){await symlink(productRoot,directory);return {packagePlacement};}
 const pin=packageSnapshot&&Object.freeze({...packageSnapshot});
 if(!pin||!isAbsolute(pin.manifestPath??'')||!/^[a-f0-9]{64}$/.test(pin.manifestSHA256??'')||typeof pin.buildId!=='string')fail('package_snapshot_required');
 const manifestBytes=await readFile(pin.manifestPath);if(sha(manifestBytes)!==pin.manifestSHA256)fail('package_snapshot_manifest_changed');
 const manifest=JSON.parse(manifestBytes),root=await realpath(productRoot);
 const sourceRootValid=typeof manifest.sourceRoot==='string'&&isAbsolute(manifest.sourceRoot)&&resolve(manifest.sourceRoot)===manifest.sourceRoot;
 if(manifest.format!==1||manifest.buildId!==pin.buildId||!sourceRootValid||packageSourceMode==='recorded-root'&&manifest.sourceRoot!==root||manifest.packageSourceClean!==true||!['sourceHead','sourceTree'].every(k=>/^[a-f0-9]{40}$/.test(manifest[k]??''))||!Array.isArray(manifest.files)||!/^[a-f0-9]{64}$/.test(manifest.packageSHA256??'')||!safe(manifest.tarball??'')||manifest.tarball.includes('/'))fail('package_snapshot_stale_or_invalid');
 const archivePath=join(dirname(pin.manifestPath),manifest.tarball),archiveStat=await lstat(archivePath);if(await realpath(archivePath)!==archivePath||!archiveStat.isFile()||archiveStat.isSymbolicLink()||archiveStat.size>64*1024*1024)fail('package_snapshot_archive_invalid');
 const archive=await readFile(archivePath);if(sha(archive)!==manifest.packageSHA256)fail('package_snapshot_archive_changed');
 const files=decodePackageArchive(archive);validatePackageClosure(files);const index=await currentPackageIndex(root,files);
 if(JSON.stringify(index)!==JSON.stringify(manifest.files))fail('package_snapshot_source_changed');
 if(await realpath(dirname(directory))!==dirname(directory)||directory===root||directory.startsWith(root+'/'))fail('package_snapshot_destination_invalid');
 await mkdir(directory,{mode:0o700});let claimed;
 try{claimed=await lstat(directory);for(const file of index){const path=join(directory,file.path);await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,files.get(file.path),{flag:'wx',mode:file.mode});await chmod(path,file.mode);}
  if(JSON.stringify(await currentPackageIndex(root,files))!==JSON.stringify(index))fail('package_snapshot_source_changed');
  const installed=await currentPackageIndex(directory,files);if(JSON.stringify(installed)!==JSON.stringify(index))fail('package_snapshot_install_changed');
  return Object.freeze({packagePlacement,packageSourceMode,recordedSourceRoot:manifest.sourceRoot,...(packageSourceMode==='verified-export'?{verifiedExportRoot:root}:{}),sourceHead:manifest.sourceHead,sourceTree:manifest.sourceTree,sourceWorktreeClean:manifest.sourceWorktreeClean,packageSHA256:manifest.packageSHA256,fileIndexSHA256:sha(JSON.stringify(index)),buildId:manifest.buildId,installationId:randomUUID(),fileCount:index.length});
 }catch(error){const now=await lstat(directory).catch(()=>null);if(claimed&&now?.ino===claimed.ino&&now?.dev===claimed.dev&&now.isDirectory())await rm(directory,{recursive:true,force:true});throw error;}
}
