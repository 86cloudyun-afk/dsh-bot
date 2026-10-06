/** Offline public-package assembly. Never copies a Home, config, environment or credential. */
import { cp,mkdir,readFile,writeFile,readdir,rm,symlink,realpath } from 'node:fs/promises';
import { resolve,join,isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const CORE='3fbedc25d3626caf4e401b14c31a7f0326a19ec7';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
function target(root,name){if(!/^@[a-z0-9-]+\/[a-z0-9._-]+$/.test(name))throw Error('INVALID_PUBLIC_PACKAGE_NAME');return join(root,'node_modules',...name.split('/'));}
export async function assembleOwnerRuntime({officialRoot,candidateRoot,outputDirectory,productRoot=resolve(import.meta.dirname,'..')}){
 if(![officialRoot,candidateRoot,outputDirectory].every(p=>typeof p==='string' && isAbsolute(p)))throw Error('ABSOLUTE_ARTIFACT_PATHS_REQUIRED');
 const official=await realpath(officialRoot),candidate=await realpath(candidateRoot),product=await realpath(productRoot),output=resolve(outputDirectory);
 if(await realpath(resolve(output,'..'))!==resolve(output,'..'))throw Error('CANONICAL_OUTPUT_PARENT_REQUIRED');
 if([official,candidate,product].some(path=>output===path || output.startsWith(path+'/')))throw Error('EXCLUSIVE_RUNTIME_OUTSIDE_INPUTS_REQUIRED');
 const cli=await json(join(official,'node_modules','@deepseek-ai','dsh','package.json')),manifest=await json(join(candidate,'artifact-manifest.json'));
 if(cli.version!=='0.2.0-rc.2' || manifest.candidateCommit!==CORE || manifest.corePackageCount!==74)throw Error('FIXED_ARTIFACT_IDENTITY_REQUIRED');
 await mkdir(output,{mode:0o700});await cp(join(official,'node_modules'),join(output,'node_modules'),{recursive:true,verbatimSymlinks:true});
 const overlays=[];
 for(const directory of await readdir(join(candidate,'.packages'))){const source=join(candidate,'.packages',directory),pkg=await json(join(source,'package.json')),destination=target(output,pkg.name);
  await rm(destination,{recursive:true,force:true});await mkdir(resolve(destination,'..'),{recursive:true});
  // Archive rehydration links point back into the entire package graph. Packages
  // resolve dependencies from the one staged root, so never copy that graph link.
  await cp(source,destination,{recursive:true,dereference:true,filter:path=>path!==join(source,'node_modules')});
  const lib=join(source,'lib','index.js');let runtimeHash=null;try{runtimeHash=sha(await readFile(lib));}catch(error){if(error.code!=='ENOENT')throw error;}
  overlays.push({name:pkg.name,version:pkg.version,sourcePackageJsonSha256:sha(await readFile(join(source,'package.json'))),runtimeEntrySha256:runtimeHash});
 }
 // The fixed archive itself contains 75 directories; its manifest says 74.
 // Preserve that discrepancy in the receipt instead of silently correcting it.
 if(overlays.length!==75)throw Error('FIXED_PACKAGE_COUNT_REQUIRED');
 // Convert only publishing metadata; executable built files remain byte-identical.
 for(const overlay of overlays){const path=join(target(output,overlay.name),'package.json'),pkg=await json(path);
  for(const section of ['dependencies','optionalDependencies','peerDependencies','devDependencies'])for(const [name,range] of Object.entries(pkg[section] ?? {}))if(range.startsWith('workspace:')){
   let version;try{version=(await json(join(target(output,name),'package.json'))).version;}catch{continue;}
   pkg[section][name]=(range==='workspace:~'?'~':range==='workspace:^'?'^':'')+version;
  }
  await writeFile(path,JSON.stringify(pkg,null,2)+'\n');
 }
 const destination=join(output,'node_modules','dsh-bot');await mkdir(destination);await cp(join(product,'src'),join(destination,'src'),{recursive:true});
 await cp(join(product,'package.json'),join(destination,'package.json'));
 const cliPath=join(output,'node_modules','@deepseek-ai','dsh','package.json'),stagedCli=await json(cliPath);stagedCli.dependencies['dsh-bot']=(await json(join(product,'package.json'))).version;
 await writeFile(cliPath,JSON.stringify(stagedCli,null,2)+'\n');
 const bin=join(output,'node_modules','.bin','dsh');await rm(bin,{force:true});await symlink('../@deepseek-ai/dsh/lib/bin.js',bin);
 const productFiles={};for(const name of await readdir(join(product,'src')))if(name.endsWith('.mjs') || name.endsWith('.d.ts'))productFiles[`src/${name}`]=sha(await readFile(join(product,'src',name)));
 productFiles['package.json']=sha(await readFile(join(product,'package.json')));
 const receipt={format:1,officialDshVersion:cli.version,coreCandidate:CORE,officialRoot:official,candidateRoot:candidate,
  officialCliBinSha256:sha(await readFile(join(official,'node_modules','@deepseek-ai','dsh','lib','bin.js'))),
  declaredCorePackageCount:manifest.corePackageCount,actualPackageCount:overlays.length,
  overlayPackages:overlays.sort((a,b)=>a.name.localeCompare(b.name)),productFiles,
  executableFilesAltered:false,metadataWorkspaceRangesNormalized:true,credentialsOrHomesCopied:false,
  qualification:'Private isolated official-launcher/candidate overlay for owner-entry acceptance; not stock npm rc.2 or a release.'};
 await writeFile(join(output,'owner-runtime-manifest.json'),JSON.stringify(receipt,null,2)+'\n');return {runtimeDirectory:output,dsh:bin,manifest:receipt};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};for(let i=2;i<process.argv.length;i+=2)options[process.argv[i]]=process.argv[i+1];
 try{const result=await assembleOwnerRuntime({officialRoot:options['--official'],candidateRoot:options['--candidate'],outputDirectory:options['--output']});process.stdout.write(JSON.stringify({runtimeDirectory:result.runtimeDirectory,dsh:result.dsh,coreCandidate:CORE,declaredPackageCount:74,overlayPackages:result.manifest.actualPackageCount,credentialsCopied:false})+'\n');}
 catch(error){process.stderr.write(JSON.stringify({errorCategory:error.code ?? error.message})+'\n');process.exitCode=1;}
}
