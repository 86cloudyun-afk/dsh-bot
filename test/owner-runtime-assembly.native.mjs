/** Synthetic public-package metadata regression, not native runtime acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,symlink,access } from 'node:fs/promises';
import { join } from 'node:path';
import { assembleOwnerRuntime } from '../scripts/assemble-owner-runtime.mjs';
import { installOwnerProfile } from '../scripts/install-owner-profile.mjs';
test('runtime assembly excludes archive rehydration node_modules links and never recursively follows them',async()=>{
 const root=await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'assembly-fixture-')),official=join(root,'official'),candidate=join(root,'candidate'),output=join(root,'output');
 await mkdir(join(official,'node_modules','@deepseek-ai','dsh','lib'),{recursive:true});await mkdir(join(official,'node_modules','.bin'));
 await writeFile(join(official,'node_modules','@deepseek-ai','dsh','package.json'),JSON.stringify({name:'@deepseek-ai/dsh',version:'0.2.0-rc.2',dependencies:{}}));
 await writeFile(join(official,'node_modules','@deepseek-ai','dsh','lib','bin.js'),'// Synthetic assembly fixture, never executed');
 await mkdir(join(candidate,'.packages'),{recursive:true});
 await writeFile(join(candidate,'artifact-manifest.json'),JSON.stringify({candidateCommit:'3fbedc25d3626caf4e401b14c31a7f0326a19ec7',corePackageCount:74}));
 for(let i=0;i<75;i++){const name=`fixture-${String(i).padStart(2,'0')}`,path=join(candidate,'.packages',name);await mkdir(path);await writeFile(join(path,'package.json'),JSON.stringify({name:`@deepseek-ai/${name}`,version:'0.2.0-rc.2'}));await symlink('.',join(path,'node_modules'));}
 const result=await assembleOwnerRuntime({officialRoot:official,candidateRoot:candidate,outputDirectory:output});assert.equal(result.manifest.overlayPackages.length,75);assert.equal(result.manifest.declaredCorePackageCount,74);assert.equal(result.manifest.actualPackageCount,75);
 await assert.rejects(access(join(output,'node_modules','@deepseek-ai','fixture-00','node_modules')),{code:'ENOENT'});
 await assert.rejects(()=>assembleOwnerRuntime({officialRoot:official,candidateRoot:candidate,outputDirectory:join(official,'nested-output')}),/EXCLUSIVE_RUNTIME_OUTSIDE_INPUTS_REQUIRED/);
});
test('setup rejects a symlinked output parent before writing either runtime or Home',async()=>{
 const root=await mkdtemp(join(process.env.DSH_BOT_TEST_ROOT,'setup-parent-')),prior=join(root,'prior'),alias=join(root,'alias'),candidate=join(root,'candidate'),official=join(root,'official');
 await mkdir(prior);await symlink(prior,alias);await mkdir(join(official,'node_modules','@deepseek-ai','dsh','lib'),{recursive:true});await mkdir(join(official,'node_modules','.bin'));await mkdir(join(candidate,'.packages'),{recursive:true});
 await writeFile(join(official,'node_modules','@deepseek-ai','dsh','package.json'),JSON.stringify({version:'0.2.0-rc.2',dependencies:{}}));
 await writeFile(join(official,'node_modules','@deepseek-ai','dsh','lib','bin.js'),'// Unexecuted fixture');
 await writeFile(join(candidate,'artifact-manifest.json'),JSON.stringify({candidateCommit:'3fbedc25d3626caf4e401b14c31a7f0326a19ec7',corePackageCount:74}));
 await writeFile(join(official,'owner-runtime-manifest.json'),JSON.stringify({format:1,officialDshVersion:'0.2.0-rc.2',coreCandidate:'3fbedc25d3626caf4e401b14c31a7f0326a19ec7'}));
 await assert.rejects(()=>assembleOwnerRuntime({officialRoot:official,candidateRoot:candidate,outputDirectory:join(alias,'runtime')}),/CANONICAL_OUTPUT_PARENT_REQUIRED/);
 await assert.rejects(access(join(prior,'runtime')),{code:'ENOENT'});
 await assert.rejects(()=>installOwnerProfile({runtimeDirectory:official,homeDirectory:join(alias,'home')}),/CANONICAL_HOME_PARENT_REQUIRED/);
 await assert.rejects(access(join(prior,'home')),{code:'ENOENT'});
});
