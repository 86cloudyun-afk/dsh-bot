import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmod,mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Historical v1.2.0 source commit: 1b0b0e92e9c5f82c4d1e7b502e4887ff485fbcfa.
// Its guard intentionally rejects any later manifest or report contract. These
// tests execute that original guard against its immutable distribution source.
const artifactName='dsh-bot-1.2.0.tgz';
const archiveHash='43e837624194596a9ff679e86b68f416ea7977152f480191c208fc5eae726d94';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const pinnedSources=[
  ['scripts/publish-v120.mjs','836d1f7e8bcf6803563b77a44bb6655c775e60f3934855f63d8085039e19f275'],
  ['scripts/verify-distribution.mjs','4db3c9d1734ce1e6b7e4aef16be5cd6b7b0afda0722e0e89bdc185958a42a83d'],
  ['test/native-plugin/stock-report.mjs','630a9ebd19659e75ecf2b29bf4cf519202c8e5a4601705dea778955aba6f5afe'],
];

export async function createV120Fixture({repositoryRoot=resolve(import.meta.dirname,'../..')}={}) {
  const artifact=join(repositoryRoot,'dist',artifactName),archive=await readFile(artifact);
  assert.equal(archive.length,147662,'Historical distribution size changed');
  assert.equal(digest(archive),archiveHash,'Historical distribution bytes changed');
  const qualification=await readFile(join(import.meta.dirname,'fixtures/v120-stock-qualification.mjs'));
  assert.equal(digest(qualification),'6b7c587cb2de24bffca78d7430ca32f9859e5b9e045ba2f9050f06024a9c866b','Historical qualification source changed');
  const sources=await Promise.all(pinnedSources.map(async([path,sha256])=>{
    const bytes=await readFile(join(repositoryRoot,path));
    assert.equal(digest(bytes),sha256,`Historical publication dependency changed: ${path}`);
    return [path,bytes];
  }));
  const entries=execFileSync('tar',['-tzf',artifact],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim().split('\n');
  assert.equal(entries.length,30,'Historical distribution file count changed');
  assert.equal(new Set(entries).size,30,'Historical distribution contains duplicate files');
  assert.ok(entries.every(path=>path.startsWith('package/')&&!path.endsWith('/')&&!path.split('/').includes('..')),'Unsafe historical distribution entry');
  const root=await mkdtemp(join(tmpdir(),'dsh-v120-publication-fixture-'));
  const cleanup=()=>rm(root,{recursive:true,force:true});
  try {
    await chmod(root,0o700);
    execFileSync('tar',['-xzf',artifact,'--strip-components=1','-C',root],{stdio:['ignore','pipe','pipe']});
    await mkdir(join(root,'dist'),{mode:0o700});
    await mkdir(join(root,'scripts'),{mode:0o700});
    await mkdir(join(root,'test/native-plugin'),{recursive:true,mode:0o700});
    for(const [path,bytes] of sources)await writeFile(join(root,path),bytes,{mode:0o600});
    await writeFile(join(root,'test/native-plugin/stock-qualification.mjs'),qualification,{mode:0o600});
    await writeFile(join(root,'dist',artifactName),archive,{mode:0o600});
    // Never borrow SHA256SUMS from the current release under development.
    await writeFile(join(root,'dist/SHA256SUMS'),`${archiveHash}  ${artifactName}\n`,{mode:0o600});
    const stock=await import(pathToFileURL(join(root,'test/native-plugin/stock-qualification.mjs')).href);
    const publisher=await import(pathToFileURL(join(root,'scripts/publish-v120.mjs')).href);
    return {root,stock,publisher,cleanup};
  } catch(error) {
    await cleanup();
    throw error;
  }
}
