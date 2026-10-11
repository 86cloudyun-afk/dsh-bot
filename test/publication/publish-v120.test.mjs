import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm,stat,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import * as stock from '../native-plugin/stock-qualification.mjs';

const root=resolve(import.meta.dirname,'../..');
const repo='86cloudyun-afk/dsh-bot',sha='a'.repeat(40),mainId=38114000001,tagId=38114000002;
const user={id:269269188,login:'86cloudyun-afk',type:'User'};
function event(mode='tag',run=mainId){return {action:'created',repository:{full_name:repo,owner:user},sender:user,issue:{number:11,pull_request:{}},comment:{id:6106000000,issue_url:`https://api.github.com/repos/${repo}/issues/11`,body:`/dsh-bot-${mode} v1.2.0 ${sha} ${run}`,user,created_at:mode==='publish'?'2026-10-11T14:00:00Z':'2026-10-11T12:00:00Z',updated_at:mode==='publish'?'2026-10-11T14:00:00Z':'2026-10-11T12:00:00Z'}};}
async function publisher(){const m=await import('../../scripts/publish-v120.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});assert.equal(typeof m.parseOwnerCommand,'function','Publish guard must validate exact owner-created commands');return m;}

test('exact owner-created commands bind the current source and explicit run',async()=>{const m=await publisher();assert.deepEqual(m.parseOwnerCommand(event()),{mode:'tag',sha,runId:mainId,commentId:6106000000});assert.equal(m.parseOwnerCommand(event('publish',tagId)).mode,'publish');});
for(const [name,mutate] of [
  ['edited action',e=>{e.action='edited';}],['foreign repository',e=>{e.repository.full_name='other/dsh-bot';}],
  ['foreign owner',e=>{e.repository.owner={...user,id:1};}],['foreign sender',e=>{e.sender={...user,id:1};}],
  ['bot sender',e=>{e.sender={...user,type:'Bot'};}],['foreign author',e=>{e.comment.user={...user,id:1};}],
  ['bot author',e=>{e.comment.user={...user,type:'Bot'};}],['other issue',e=>{e.issue.number=12;}],
  ['ordinary issue',e=>{delete e.issue.pull_request;}],['other version',e=>{e.comment.body=e.comment.body.replace('v1.2.0','v1.2.1');}],
  ['code fence',e=>{e.comment.body='```\n'+e.comment.body+'\n```';}],['extra argument',e=>{e.comment.body+=' --force';}],
  ['newline',e=>{e.comment.body+='\n';}],['short SHA',e=>{e.comment.body=e.comment.body.replace(sha,'abc');}],
  ['invalid run',e=>{e.comment.body=e.comment.body.replace(String(mainId),'0');}],['unsafe run',e=>{e.comment.body=e.comment.body.replace(String(mainId),'9007199254740992');}],
])test(`owner command rejects ${name}`,async()=>{const m=await publisher(),e=structuredClone(event());mutate(e);assert.throws(()=>m.parseOwnerCommand(e));});

const names=['artifact','plugin (ubuntu-latest, 22)','plugin (ubuntu-latest, 24)','plugin (macos-latest, 22)','plugin (macos-latest, 24)','stock-gui (ubuntu-latest)','stock-gui (macos-latest)','publication-guard'];
const repository={full_name:repo,owner:user,default_branch:'main'};
function run(runId=mainId){return {id:runId,workflow_id:1001,path:'.github/workflows/ci.yml',repository,head_repository:repository,head_sha:sha,head_branch:runId===tagId?'v1.2.0':'main',event:runId===tagId?'workflow_dispatch':'push',status:'completed',conclusion:'success',run_attempt:1,display_title:runId===tagId?'Native plugin checks v1.2.0 publication comment 6105999999 run 986':'Native plugin checks',created_at:runId===tagId?'2026-10-11T12:01:00Z':'2026-10-11T10:00:00Z',updated_at:runId===tagId?'2026-10-11T13:00:00Z':'2026-10-11T11:00:00Z'};}
function tagCheckpoint(){return {repository:repo,version:'v1.2.0',sourceCommit:sha,mainRunId:mainId,commentId:6105999999,publisherRunId:986};}
function tagObject(){return {sha:'b'.repeat(40),tag:'v1.2.0',object:{type:'commit',sha},tagger:{date:'2026-10-11T12:00:00Z'},message:'dsh-bot v1.2.0 qualified publication\n'+JSON.stringify(tagCheckpoint())};}
function report(source,target){const row={passed:true,testsPassed:true,teardownComplete:true,standardProfile:true,standardPluginInstall:true,controlledProvider:true,sourceTreeDirty:false,sourceCommit:target.sourceCommit,artifactSha256:target.artifactSha256,artifactPackageVersion:target.packageVersion,officialVersion:target.officialVersion,realModelRequests:0,browserErrors:[],stage:'complete',requests:source==='gui'?[{}]:[],checks:Object.fromEntries(stock.expectedStockChecks(source,target.packageVersion).map(x=>[x,true]))};if(source!=='gui'){const previous=stock.stockSources[source];Object.assign(row,{previousArtifactSha256:previous.sha256,upgradeArtifactSha256:target.artifactSha256,freshHostProcessAfterUpgrade:true});if(previous.schema===1)row.migration={fromSchema:1,toSchema:2,backupChecksum:'c'.repeat(64),backupPayloadMatchesOriginal:true,allOriginalReceiptIdentitiesPreserved:true,legacySnapshotReadFromClosedOfficialKv:true};else row.upgradeSchemaTwo={fromSchema:2,toSchema:2,backupWasPresent:false,existingMigrationBackupRetained:true,allOriginalReceiptIdentitiesPreserved:true,exactV11RowsRetained:true,sourceSnapshotReadFromClosedOfficialKv:true};}return row;}
async function fixture(t,mode='tag'){
  const m=await publisher();assert.equal(typeof m.executePublication,'function','Guard must independently qualify real artifacts before any write');
  const scratch=await mkdtemp(join(tmpdir(),'publication-test-'));t.after(()=>rm(scratch,{recursive:true,force:true}));
  const target=await stock.readStockTarget({root,sourceCommit:sha});
  const state={mainSha:sha,repo:structuredClone(repository),workflow:{id:1001,path:'.github/workflows/ci.yml',name:'Native plugin checks',state:'active'},pr:{number:11,state:'closed',merged:true,merged_at:'2026-10-11T09:00:00Z',merge_commit_sha:'d'.repeat(40),base:{ref:'main',repo:repository}},runs:{[mainId]:run(),[tagId]:run(tagId),987:{id:987,path:'.github/workflows/publish-v120.yml',event:'issue_comment',head_branch:'main',head_sha:sha,repository,head_repository:repository,run_attempt:1,display_title:'v1.2.0 publication comment 6106000000'}},jobs:names.map(name=>({name,status:'completed',conclusion:'success'})),tag:mode==='publish'?tagObject():null,release:null,priorPublisherRuns:[],tagRuns:[],writes:[],downloads:[],mutateReport:()=>{},mutatePackage:()=>{},writeFailure:null,leaseChanges:false,liveComment:null,originalComment:{...event().comment,id:6105999999,created_at:'2026-10-11T11:30:00Z',updated_at:'2026-10-11T11:30:00Z'}};state.runs[986]={...state.runs[987],id:986,display_title:'v1.2.0 publication comment 6105999999',status:'completed',conclusion:'success'};
  const api={async request(method,path,body){
    if(method!=='GET'){state.writes.push({method,path,body});if(state.writeFailure?.(path))throw new Error('private bearer secret https://signed.invalid/?token=private');}
    if(path===`/repos/${repo}/issues/comments/6105999999`)return state.originalComment;
    if(path===`/repos/${repo}/issues/comments/6106000000`)return state.liveComment??options.event.comment;
    if(path===`/repos/${repo}/git/ref/heads/v1.2.0`)return null;
    if(path===`/repos/${repo}`)return state.repo;
    if(path===`/repos/${repo}/pulls/11`)return state.pr;
    if(path===`/repos/${repo}/git/ref/heads/main`){const value=state.leaseChanges&&state.downloads.length?'e'.repeat(40):state.mainSha;return {object:{type:'commit',sha:value}};}
    if(path===`/repos/${repo}/actions/workflows/ci.yml`)return state.workflow;
    if(path.startsWith(`/repos/${repo}/actions/workflows/publish-v120.yml/runs?`))return {total_count:state.priorPublisherRuns.length,workflow_runs:state.priorPublisherRuns};
    if(path.startsWith(`/repos/${repo}/actions/workflows/ci.yml/runs?`))return {total_count:state.tagRuns.length,workflow_runs:state.tagRuns};
    const runMatch=new RegExp(`/actions/runs/(\\d+)$`).exec(path);if(runMatch)return state.runs[runMatch[1]];
    if(path.includes('/jobs?'))return {total_count:state.jobs.length,jobs:state.jobs};
    if(path.includes('/artifacts?')){const n=Number(/\/runs\/(\d+)/.exec(path)[1]);return {total_count:3,artifacts:['native-plugin-package','stock-gui-ubuntu-latest','stock-gui-macos-latest'].map((name,i)=>({id:2000+i,name,expired:false,workflow_run:{id:n,head_sha:sha,head_branch:state.runs[n].head_branch}}))};}
    if(path===`/repos/${repo}/git/ref/tags/v1.2.0`)return state.tag?{object:{type:'tag',sha:state.tag.sha}}:null;
    if(method==='GET'&&path===`/repos/${repo}/git/tags/${'b'.repeat(40)}`)return state.tag;
    if(method==='POST'&&path===`/repos/${repo}/git/tags`){state.pendingTag={...tagObject(),...body,object:{type:body.type,sha:body.object}};return state.pendingTag;}
    if(method==='POST'&&path===`/repos/${repo}/git/refs`){state.tag=state.pendingTag;return {ref:body.ref,object:{type:'tag',sha:body.sha}};}
    if(method==='POST'&&path===`/repos/${repo}/actions/workflows/ci.yml/dispatches`)return {workflow_run_id:tagId};
    if(method==='GET'&&path===`/repos/${repo}/releases/tags/v1.2.0`)return state.release;
    if(method==='GET'&&path===`/repos/${repo}/releases/latest`)return state.release;
    if(method==='POST'&&path===`/repos/${repo}/releases`){state.release={...body,id:12345,author:{id:41898282,login:'github-actions[bot]',type:'Bot'},assets:[]};return state.release;}
    throw new Error(`Unexpected fixture route ${method} ${path}`);
  }};
  const downloadArtifact=async({runId,name,directory})=>{state.downloads.push({runId,name,directory});await mkdir(directory,{recursive:true});if(name==='native-plugin-package'){await cp(join(root,'dist/dsh-bot-1.2.0.tgz'),join(directory,'dsh-bot-1.2.0.tgz'));await cp(join(root,'dist/SHA256SUMS'),join(directory,'SHA256SUMS'));await state.mutatePackage(directory);return;}for(const source of Object.keys(stock.stockSources)){await mkdir(join(directory,source),{recursive:true});const row=report(source,target);state.mutateReport(row,{source,name});await writeFile(join(directory,source,'stock-gui-report.json'),JSON.stringify(row));}};
  const options={event:event(mode,mode==='tag'?mainId:tagId),checkoutSha:sha,publisherRunId:987,repositoryRoot:root,api,downloadArtifact,reportDirectory:join(scratch,'private'),notesTemplate:'v1.2.0\n{{MAIN_SHA}}\n{{BRANCH_RUN}} {{PR_RUN}} {{MAIN_RUN}} {{TAG_RUN}}\nhttps://raw.githubusercontent.com/86cloudyun-afk/dsh-bot/v1.2.0/dist/dsh-bot-1.2.0.tgz\nhttps://raw.githubusercontent.com/86cloudyun-afk/dsh-bot/v1.2.0/dist/SHA256SUMS'};
  return {m,state,options,scratch};
}
async function refused(t,mutate,mode='tag'){const f=await fixture(t,mode);await mutate(f);await assert.rejects(()=>f.m.executePublication(f.options));assert.deepEqual(f.state.writes,[],'Unqualified evidence must not cause a write');}

test('qualified tag creates an annotated immutable ref and explicitly dispatches native CI',async t=>{const f=await fixture(t),result=await f.m.executePublication(f.options);assert.equal(result.status,'tagged-and-dispatched');assert.deepEqual(f.state.writes.map(x=>x.path.split('/').at(-1)),['tags','refs','dispatches']);assert.equal(f.state.writes[0].body.type,'commit');assert.equal(f.state.writes[0].body.object,sha);assert.equal(f.state.writes[1].body.sha,'b'.repeat(40));assert.deepEqual(f.state.writes[2].body,{ref:'v1.2.0',return_run_details:true,inputs:{publication_comment:'6106000000',publication_run:'987'}});assert.deepEqual(f.state.downloads.map(x=>x.name).sort(),['native-plugin-package','stock-gui-macos-latest','stock-gui-ubuntu-latest']);assert.equal(result.reports,18);assert.equal(result.checksPerPlatform,184);assert.equal((await stat(f.options.reportDirectory)).mode&0o777,0o700);assert.equal((await stat(join(f.options.reportDirectory,'publication.json'))).mode&0o777,0o600);});
for(const [name,mutate] of [
  ['untrusted checkout',f=>{f.options.checkoutSha='f'.repeat(40);}],['stale main',f=>{f.state.mainSha='f'.repeat(40);}],
  ['wrong default branch',f=>{f.state.repo.default_branch='next';}],['unmerged native PR',f=>{f.state.pr.merged=false;}],
  ['foreign workflow',f=>{f.state.workflow.path='.github/workflows/other.yml';}],['wrong workflow identity',f=>{f.state.runs[mainId].workflow_id=2002;}],
  ['wrong actual head',f=>{f.state.runs[mainId].head_sha='f'.repeat(40);}],['foreign run repository',f=>{f.state.runs[mainId].repository={...repository,full_name:'other/repo'};}],
  ['PR event relabeled as main',f=>{f.state.runs[mainId].event='pull_request';}],['wrong main branch',f=>{f.state.runs[mainId].head_branch='feature';}],
  ['running CI',f=>{f.state.runs[mainId].status='in_progress';}],['failed CI',f=>{f.state.runs[mainId].conclusion='failure';}],
  ['missing CI job',f=>{f.state.jobs.pop();}],['duplicate CI job',f=>{f.state.jobs[7]={...f.state.jobs[0]};}],
  ['unknown extra CI job',f=>{f.state.jobs.push({name:'unknown',status:'completed',conclusion:'success'});}],['skipped CI job',f=>{f.state.jobs[0].conclusion='skipped';}],
  ['main changes during qualification',f=>{f.state.leaseChanges=true;}],
  ['incomplete macOS report',f=>{f.state.mutateReport=(row,{name,source})=>{if(name==='stock-gui-macos-latest'&&source==='gui')delete row.checks.nativeAuthenticationRequired;};}],
  ['external model request',f=>{f.state.mutateReport=row=>{row.realModelRequests=1;};}],
  ['stale report source',f=>{f.state.mutateReport=row=>{row.sourceCommit='f'.repeat(40);};}],
  ['incomplete teardown',f=>{f.state.mutateReport=row=>{row.teardownComplete=false;};}],
  ['missing upgrade schema proof',f=>{f.state.mutateReport=(row,{source})=>{if(source==='upgrade-v114')delete row.upgradeSchemaTwo.exactV11RowsRetained;};}],
  ['changed downloaded package',async f=>{f.state.mutatePackage=async directory=>writeFile(join(directory,'dsh-bot-1.2.0.tgz'),'foreign package');}],
  ['foreign existing tag target',f=>{f.state.tag=tagObject();f.state.tag.object.sha='f'.repeat(40);}],
])test(`no write for ${name}`,async t=>refused(t,mutate));

test('publish uses fresh correlated actual tag qualification and creates stable latest notes with zero assets',async t=>{const f=await fixture(t,'publish'),result=await f.m.executePublication(f.options);assert.equal(result.status,'published');assert.equal(result.releaseId,12345);assert.equal(f.state.writes.length,1);const body=f.state.writes[0].body;assert.equal(body.tag_name,'v1.2.0');assert.equal(body.target_commitish,sha);assert.equal(body.draft,false);assert.equal(body.prerelease,false);assert.equal(body.make_latest,'true');assert.ok(body.body.includes(String(tagId)));assert.ok(body.body.includes(String(mainId)));assert.ok(body.body.includes('38113821247 38113823988'));assert.ok(!body.body.includes('{{'));assert.deepEqual(f.state.release.assets,[]);});
for(const [name,mutate] of [
  ['old tag run',f=>{f.state.runs[tagId].created_at='2026-10-11T11:59:59Z';}],
  ['push masquerading as tag',f=>{f.state.runs[tagId].event='push';}],
  ['main run masquerading as tag',f=>{f.state.runs[tagId].head_branch='main';}],
  ['uncorrelated dispatch',f=>{f.state.runs[tagId].display_title='Native plugin checks';}],
  ['foreign dispatch checkpoint',f=>{f.state.runs[tagId].display_title='Native plugin checks v1.2.0 publication comment 99999 run 986';}],
  ['run starts after publish command',f=>{f.state.runs[tagId].created_at='2026-10-11T15:00:00Z';f.state.runs[tagId].updated_at='2026-10-11T16:00:00Z';}],
  ['missing annotated tag',f=>{f.state.tag=null;}],
  ['unresolved notes placeholder',f=>{f.options.notesTemplate+='{{OTHER}}';}],
])test(`publish refuses ${name}`,async t=>refused(t,mutate,'publish'));

test('existing matching stable latest release is a read-only checkpoint',async t=>{const f=await fixture(t,'publish');await f.m.executePublication(f.options);f.state.writes=[];const result=await f.m.executePublication(f.options);assert.equal(result.status,'existing-release');assert.equal(result.releaseId,12345);assert.deepEqual(f.state.writes,[]);});
for(const [name,change] of [['draft',r=>{r.draft=true;}],['prerelease',r=>{r.prerelease=true;}],['extra asset',r=>{r.assets=[{id:1}];}],['changed body',r=>{r.body+='foreign';}],['wrong target',r=>{r.target_commitish='f'.repeat(40);}],['foreign author',r=>{r.author.id=1;}]])test(`existing release rejects ${name} without mutation`,async t=>{const f=await fixture(t,'publish');await f.m.executePublication(f.options);change(f.state.release);f.state.writes=[];await assert.rejects(()=>f.m.executePublication(f.options));assert.deepEqual(f.state.writes,[]);});

test('known tag object/ref survive UNKNOWN dispatch and failure text is hashed',async t=>{const f=await fixture(t);f.state.writeFailure=path=>path.endsWith('/dispatches');let failure;try{await f.m.executePublication(f.options);}catch(e){failure=e;}assert.ok(failure);assert.equal(failure.partial.status,'unknown-write');assert.equal(failure.partial.tagObjectSha,'b'.repeat(40));assert.equal(failure.partial.tagRefCreated,true);assert.equal(failure.partial.pending,'dispatch-tag-ci');assert.ok(!JSON.stringify(failure.partial).includes('private'));assert.ok(!failure.message.includes('signed.invalid'));f.state.writes=[];f.state.writeFailure=null;await assert.rejects(()=>f.m.executePublication(f.options));assert.deepEqual(f.state.writes,[],'Existing tag with no correlated CI must not blindly redispatch');});

test('UNKNOWN release response retains no speculative release ID and avoids a duplicate creation',async t=>{const f=await fixture(t,'publish');f.state.writeFailure=path=>{if(!path.endsWith('/releases'))return false;f.state.release={...f.state.writes.at(-1).body,id:12345,author:{id:41898282,login:'github-actions[bot]',type:'Bot'},assets:[]};return true;};let failure;try{await f.m.executePublication(f.options);}catch(e){failure=e;}assert.equal(failure.partial.status,'unknown-write');assert.equal(failure.partial.releaseId,undefined);assert.equal(failure.partial.pending,'create-release');f.state.writeFailure=null;f.state.writes=[];const result=await f.m.executePublication(f.options);assert.equal(result.status,'existing-release');assert.deepEqual(f.state.writes,[]);});

test('authenticated REST adapter uses fixed origin/version and never follows redirects or retries a write',async()=>{const m=await publisher();assert.equal(typeof m.createGitHubApi,'function','Publication requires a bounded nonlogging REST adapter');const calls=[];const api=m.createGitHubApi({token:'public-test-placeholder',fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({workflow_run_id:tagId})};}});assert.deepEqual(await api.request('POST',`/repos/${repo}/actions/workflows/ci.yml/dispatches`,{ref:'v1.2.0',return_run_details:true}),{workflow_run_id:tagId});assert.equal(calls.length,1);assert.equal(calls[0].url,`https://api.github.com/repos/${repo}/actions/workflows/ci.yml/dispatches`);assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers['X-GitHub-Api-Version'],'2022-11-28');await assert.rejects(()=>api.request('GET','https://foreign.invalid/'));});

test('REST failure text excludes response bodies and unauthorized 404 does not become absence',async()=>{const m=await publisher();assert.equal(typeof m.createGitHubApi,'function');let calls=0;const api=m.createGitHubApi({token:'public-test-placeholder',fetchImpl:async()=>{calls++;return {ok:false,status:401,text:async()=> 'Bearer private https://signed.invalid'};}});await assert.rejects(()=>api.request('POST',`/repos/${repo}/git/tags`,{}),error=>!error.message.includes('private')&&!error.message.includes('signed.invalid'));assert.equal(calls,1);const missing=m.createGitHubApi({token:'public-test-placeholder',fetchImpl:async()=>({ok:false,status:404})});assert.equal(await missing.request('GET',`/repos/${repo}/git/ref/tags/v1.2.0`),null);await assert.rejects(()=>missing.request('GET',`/repos/${repo}/actions/runs/${mainId}`));});

test('privileged workflow gates new owner PR comments and checks out exact trusted default SHA',async()=>{const text=await readFile(join(root,'.github/workflows/publish-v120.yml'),'utf8').catch(error=>{if(error.code!=='ENOENT')throw error;return '';});assert.ok(text.includes('types: [created]'),'Only created comments trigger publication');assert.ok(text.includes('github.run_attempt == 1'));assert.ok(text.includes('github.event.sender.id == 269269188'));assert.ok(text.includes("github.event.sender.type == 'User'"));assert.ok(text.includes('github.event.comment.user.id == 269269188'));assert.ok(text.includes('github.event.issue.number == 11'));assert.ok(text.includes('github.event.issue.pull_request'));assert.ok(text.includes('contents: write')&&text.includes('actions: write'));assert.ok(!text.includes('write-all'));assert.ok(text.includes('persist-credentials: false'));assert.ok(text.includes('ref: ${{ github.sha }}'));assert.ok(text.includes('actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'));assert.ok(text.includes('actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'));assert.ok(text.includes("node-version: '24'"));assert.ok(text.includes('run: node scripts/publish-v120.mjs'));assert.ok(!/run:[^\n]*\$\{\{/.test(text),'Untrusted values cannot become shell code');});

test('GitHub normalized main target metadata still binds the immutable verified tag',async t=>{const f=await fixture(t,'publish');await f.m.executePublication(f.options);f.state.release.target_commitish='main';f.state.writes=[];const result=await f.m.executePublication(f.options);assert.equal(result.status,'existing-release');assert.deepEqual(f.state.writes,[]);});

test('malformed accepted dispatch response remains UNKNOWN with known tag facts',async t=>{const f=await fixture(t),original=f.options.api.request;f.options.api.request=async(method,path,body)=>{const value=await original(method,path,body);return method==='POST'&&path.endsWith('/dispatches')?null:value;};let failure;try{await f.m.executePublication(f.options);}catch(error){failure=error;}assert.equal(failure?.partial.status,'unknown-write');assert.equal(failure.partial.pending,'dispatch-tag-ci');assert.equal(failure.partial.dispatchAccepted,true);assert.equal(failure.partial.tagRefCreated,true);assert.equal(failure.partial.tagRunId,undefined);});

test('tag command submitted before main qualification completed never becomes write authorization',async t=>refused(t,f=>{f.state.runs[mainId].updated_at='2026-10-11T12:01:00Z';}));

for(const [name,mutate] of [
  ['foreign original tag author',f=>{f.state.originalComment.user={...user,id:1};}],
  ['edited original tag command',f=>{f.state.originalComment.updated_at='2026-10-11T11:31:00Z';}],
  ['incorrect original tag command',f=>{f.state.originalComment.body=f.state.originalComment.body.replace(String(mainId),String(tagId));}],
  ['foreign original publisher workflow',f=>{f.state.runs[986].path='.github/workflows/other.yml';}],
  ['replayed original publisher',f=>{f.state.runs[986].run_attempt=2;}],
])test(`annotation provenance rejects ${name}`,async t=>refused(t,mutate,'publish'));

test('unrelated comments cannot cancel an authorized queued publication job',async()=>{const workflow=await readFile(join(root,'.github/workflows/publish-v120.yml'),'utf8');assert.ok(!/^concurrency:/m.test(workflow),'Global issue-comment concurrency allows unrelated runs to replace an authorized pending run');assert.ok(workflow.includes('    concurrency:\n      group: dsh-bot-v120-publication\n      cancel-in-progress: false'),'Only the gated publisher job enters its serialization queue');});

test('default branch moving during artifact review revokes the write lease',async t=>refused(t,f=>{f.state.mutateReport=()=>{f.state.repo.default_branch='next';};}));

test('a stalled REST response is bounded without retrying the write',async()=>{const m=await publisher();let calls=0;const api=m.createGitHubApi({token:'public-test-placeholder',timeoutMs:5,fetchImpl:async(url,{signal})=>{calls++;return new Promise((resolve,reject)=>signal?.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});let timer;try{await assert.rejects(Promise.race([api.request('POST',`/repos/${repo}/git/tags`,{}),new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('REST did not abort within its budget')),50);})]),{name:'TimeoutError'});assert.equal(calls,1);}finally{clearTimeout(timer);}});
