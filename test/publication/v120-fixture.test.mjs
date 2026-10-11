import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createV120Fixture} from './v120-fixture.mjs';

const repositoryRoot=resolve(import.meta.dirname,'../..');
const sha='a'.repeat(40);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

test('historical publication reads the frozen 1.2 manifest instead of the current release',async t=>{
  const fixture=await createV120Fixture();t.after(fixture.cleanup);
  const manifest=JSON.parse(await readFile(join(fixture.root,'package.json'),'utf8'));
  assert.equal(manifest.version,'1.2.0');
  assert.notEqual(fixture.root,repositoryRoot);
  const target=await fixture.stock.readStockTarget({root:fixture.root,sourceCommit:sha});
  assert.equal(target.artifactSha256,'43e837624194596a9ff679e86b68f416ea7977152f480191c208fc5eae726d94');
  assert.equal((await stat(join(fixture.root,'dist/dsh-bot-1.2.0.tgz'))).size,147662);
});

test('historical qualification keeps all 128 original GUI checks and eight upgrade reports',async t=>{
  const fixture=await createV120Fixture();t.after(fixture.cleanup);
  assert.equal(fixture.stock.expectedStockChecks('gui','1.2.0').length,128);
  assert.equal(Object.keys(fixture.stock.stockSources).length,9);
  assert.deepEqual(Object.keys(fixture.stock.stockSources).map(source=>fixture.stock.expectedStockChecks(source,'1.2.0').length),[128,7,7,7,7,7,7,7,7]);
  assert.equal(Object.hasOwn(fixture.stock.stockSources,'upgrade-v120'),false);
  assert.equal(fixture.publisher.VERSION,'v1.2.0');
});

test('historical publication executes the byte-identical original guard and distribution verifier',async t=>{
  const fixture=await createV120Fixture();t.after(fixture.cleanup);
  for(const [path,pinned] of [
    ['scripts/publish-v120.mjs','836d1f7e8bcf6803563b77a44bb6655c775e60f3934855f63d8085039e19f275'],
    ['scripts/verify-distribution.mjs','4db3c9d1734ce1e6b7e4aef16be5cd6b7b0afda0722e0e89bdc185958a42a83d'],
  ]) {
    const original=await readFile(join(repositoryRoot,path));
    assert.equal(digest(original),pinned);
    assert.deepEqual(await readFile(join(fixture.root,path)),original);
  }
  assert.equal(digest(await readFile(join(repositoryRoot,'.github/workflows/publish-v120.yml'))),'edab51f3197a1f722a705b62570c18105be405aac25eee7e468d3bb480eca341');
});

test('a later manifest and unrelated current checksum cannot change the historical fixture',async t=>{
  const live=await mkdtemp(join(tmpdir(),'dsh-current-release-fixture-'));
  t.after(()=>rm(live,{recursive:true,force:true}));
  for(const path of ['dist','scripts','test/native-plugin'])await mkdir(join(live,path),{recursive:true});
  for(const path of ['dist/dsh-bot-1.2.0.tgz','scripts/publish-v120.mjs','scripts/verify-distribution.mjs','test/native-plugin/stock-report.mjs'])await cp(join(repositoryRoot,path),join(live,path));
  await writeFile(join(live,'package.json'),JSON.stringify({name:'dsh-bot',version:'9.9.9'}));
  await writeFile(join(live,'dist/SHA256SUMS'),`${'f'.repeat(64)}  dsh-bot-9.9.9.tgz\n`);
  const fixture=await createV120Fixture({repositoryRoot:live});t.after(fixture.cleanup);
  const target=await fixture.stock.readStockTarget({root:fixture.root,sourceCommit:sha});
  assert.equal(target.packageVersion,'1.2.0');
  assert.equal(target.artifactSha256,'43e837624194596a9ff679e86b68f416ea7977152f480191c208fc5eae726d94');
  assert.equal(fixture.stock.expectedStockChecks('gui',target.packageVersion).length,128);
  await fixture.cleanup();
  await assert.rejects(()=>stat(fixture.root),{code:'ENOENT'});
  assert.equal(JSON.parse(await readFile(join(live,'package.json'),'utf8')).version,'9.9.9');
});

test('changed historical archive bytes are refused before fixture extraction',async t=>{
  const live=await mkdtemp(join(tmpdir(),'dsh-corrupt-history-fixture-'));
  t.after(()=>rm(live,{recursive:true,force:true}));
  await mkdir(join(live,'dist'));
  const archive=await readFile(join(repositoryRoot,'dist/dsh-bot-1.2.0.tgz'));
  archive[archive.length-1]^=1;
  await writeFile(join(live,'dist/dsh-bot-1.2.0.tgz'),archive);
  await assert.rejects(()=>createV120Fixture({repositoryRoot:live}),{name:'AssertionError',message:/^Historical distribution bytes changed\n/});
});
