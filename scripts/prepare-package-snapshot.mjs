import {readFile,writeFile,mkdtemp,lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {decodePackageArchive,validatePackageClosure,currentPackageIndex,currentPackageNames} from './package-snapshot.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function preparePackageSnapshot({productRoot,temporaryRoot}){
 const root=await realpath(productRoot),build=await mkdtemp(join(temporaryRoot,'current-package-build-'));
 if(await lstat(join(root,'.npmrc')).catch(()=>null))throw Error('package_snapshot_project_config_refused');
 const git=args=>{const r=spawnSync('git',['-C',root,...args],{encoding:'utf8',env:{PATH:process.env.PATH,LANG:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});if(r.status!==0)throw Error('package_snapshot_git_identity_unavailable');return r.stdout.trim();};
 const sourceHead=git(['rev-parse','HEAD']),sourceTree=git(['rev-parse','HEAD^{tree}']);
 const tree=git(['ls-tree','-r','HEAD','--','src','package.json','README.md','cordis.patch.yml']);
 const expected=new Map(),gitModes=new Map();for(const row of tree.split('\n')){const m=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);if(!m)throw Error('package_snapshot_git_files_invalid');expected.set(m[3],m[2]);gitModes.set(m[3],m[1]);}
 if(JSON.stringify(await currentPackageNames(root))!==JSON.stringify([...expected.keys()].sort()))throw Error('package_snapshot_untracked_inputs_refused');
 for(const [path,blob]of expected){const absolute=join(root,path),stat=await lstat(absolute);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o7000)||await realpath(absolute)!==absolute)throw Error('package_snapshot_source_invalid');const bytes=await readFile(absolute);if(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')!==blob||Boolean(stat.mode&0o111)!==(gitModes.get(path)==='100755'))throw Error('package_snapshot_dirty_package_refused');}
 await writeFile(join(build,'user.npmrc'),'');await writeFile(join(build,'global.npmrc'),'');
 const env={PATH:process.env.PATH,LANG:'C.UTF-8',npm_config_userconfig:join(build,'user.npmrc'),npm_config_globalconfig:join(build,'global.npmrc'),npm_config_cache:join(build,'cache'),npm_config_offline:'true',npm_config_ignore_scripts:'true'};
 const packed=spawnSync('npm',['pack','--json','--ignore-scripts','--offline','--pack-destination',build],{cwd:root,env,encoding:'utf8',maxBuffer:1024*1024});
 if(packed.status!==0)throw Error('package_snapshot_fresh_pack_failed');
 const result=JSON.parse(packed.stdout);if(result.length!==1||typeof result[0].filename!=='string'||result[0].filename.includes('/'))throw Error('package_snapshot_pack_invalid');
 const tarball=result[0].filename,archive=await readFile(join(build,tarball)),files=decodePackageArchive(archive);validatePackageClosure(files);
 const index=await currentPackageIndex(root,files);if(index.length!==expected.size)throw Error('package_snapshot_untracked_inputs_refused');
 for(const [path,bytes]of files){const blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');if(expected.get(path)!==blob)throw Error('package_snapshot_dirty_package_refused');}
 if(git(['rev-parse','HEAD'])!==sourceHead||git(['rev-parse','HEAD^{tree}'])!==sourceTree)throw Error('package_snapshot_source_changed');
 const manifest={format:1,buildId:randomUUID(),sourceRoot:root,sourceHead,sourceTree,sourceWorktreeClean:git(['status','--porcelain'])==='',packageSourceClean:true,tarball,packageSHA256:sha(archive),files:index};
 const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n'),manifestPath=join(build,'manifest.json');await writeFile(manifestPath,bytes,{flag:'wx',mode:0o600});return Object.freeze({manifestPath,manifestSHA256:sha(bytes),buildId:manifest.buildId});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{process.stdout.write(JSON.stringify(await preparePackageSnapshot({productRoot:process.argv[2],temporaryRoot:process.argv[3]}))+'\n');}catch(error){process.stderr.write(JSON.stringify({errorCategory:error.message})+'\n');process.exitCode=1;}}
