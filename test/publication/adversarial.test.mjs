import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, cp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createV120Fixture} from './v120-fixture.mjs';

// Independent stateful API model: the authority can change while otherwise valid
// qualification artifacts are downloaded, or a write can commit before timing out.
const historical=await createV120Fixture({repositoryRoot:resolve(import.meta.dirname,'../..')});
after(historical.cleanup);
const {root,stock}=historical;
const {parseOwnerCommand,executePublication,PublicationFailure}=historical.publisher;
const repositoryName='86cloudyun-afk/dsh-bot';
const prefix=`/repos/${repositoryName}`;
const source='a'.repeat(40), tagSha='b'.repeat(40), otherTagSha='f'.repeat(40);
const mainRunId=38114000001, tagRunId=38114000002, publisherRunId=987, commentId=6106000000;
const owner={id:269269188,login:'86cloudyun-afk',type:'User'};
const repository={full_name:repositoryName,owner,default_branch:'main'};
const jobNames=['artifact','plugin (ubuntu-latest, 22)','plugin (ubuntu-latest, 24)','plugin (macos-latest, 22)','plugin (macos-latest, 24)','stock-gui (ubuntu-latest)','stock-gui (macos-latest)','publication-guard'];
const readableJobNames=['原生 GUI (ubuntu-latest)','原生 GUI (macos-latest)'];
const successfulJob=(name,{id,runId=mainRunId}={})=>({id,name,run_id:runId,head_sha:source,run_attempt:1,status:'completed',conclusion:'success'});
function command(mode='tag') {
  return {action:'created',repository,sender:owner,issue:{number:11,pull_request:{}},comment:{id:commentId,issue_url:'https://api.github.com/repos/86cloudyun-afk/dsh-bot/issues/11',body:`/dsh-bot-${mode} v1.2.0 ${source} ${mode==='tag'?mainRunId:tagRunId}`,user:owner,created_at:'2026-10-11T14:00:00Z',updated_at:'2026-10-11T14:00:00Z'}};
}
function ciRun(id=mainRunId) {
  return {id,workflow_id:1001,path:'.github/workflows/ci.yml',repository,head_repository:repository,head_sha:source,head_branch:id===tagRunId?'v1.2.0':'main',event:id===tagRunId?'workflow_dispatch':'push',status:'completed',conclusion:'success',run_attempt:1,created_at:id===tagRunId?'2026-10-11T12:01:00Z':'2026-10-11T10:00:00Z',updated_at:id===tagRunId?'2026-10-11T13:00:00Z':'2026-10-11T11:00:00Z',display_title:id===tagRunId?'Native plugin checks v1.2.0 publication comment 6105999999 run 986':'Native plugin checks'};
}
function annotation() {
  return {sha:tagSha,tag:'v1.2.0',object:{type:'commit',sha:source},tagger:{date:'2026-10-11T12:00:00Z'},message:'dsh-bot v1.2.0 qualified publication\n'+JSON.stringify({repository:repositoryName,version:'v1.2.0',sourceCommit:source,mainRunId,commentId:6105999999,publisherRunId:986})};
}
function qualifiedReport(sourceName,target) {
  const row={passed:true,testsPassed:true,teardownComplete:true,standardProfile:true,standardPluginInstall:true,controlledProvider:true,sourceTreeDirty:false,sourceCommit:target.sourceCommit,artifactSha256:target.artifactSha256,artifactPackageVersion:target.packageVersion,officialVersion:target.officialVersion,realModelRequests:0,browserErrors:[],stage:'complete',requests:sourceName==='gui'?[{}]:[],checks:Object.fromEntries(stock.expectedStockChecks(sourceName,target.packageVersion).map(name=>[name,true]))};
  if(sourceName!=='gui') {
    const old=stock.stockSources[sourceName];
    Object.assign(row,{previousArtifactSha256:old.sha256,upgradeArtifactSha256:target.artifactSha256,freshHostProcessAfterUpgrade:true});
    if(old.schema===1)row.migration={fromSchema:1,toSchema:2,backupChecksum:'c'.repeat(64),backupPayloadMatchesOriginal:true,allOriginalReceiptIdentitiesPreserved:true,legacySnapshotReadFromClosedOfficialKv:true};
    else row.upgradeSchemaTwo={fromSchema:2,toSchema:2,backupWasPresent:false,existingMigrationBackupRetained:true,allOriginalReceiptIdentitiesPreserved:true,exactV11RowsRetained:true,sourceSnapshotReadFromClosedOfficialKv:true};
  }
  return row;
}
async function fixture(t,mode='tag') {
  const scratch=await mkdtemp(join(tmpdir(),'dsh-publisher-adversarial-'));
  t.after(()=>rm(scratch,{recursive:true,force:true}));
  const target=await stock.readStockTarget({root,sourceCommit:source});
  const event=command(mode);
  const state={main:source,tag:mode==='publish'?annotation():null,release:null,dispatchResponse:{workflow_run_id:tagRunId},comment:structuredClone(event.comment),originalComment:{...structuredClone(event.comment),id:6105999999,body:`/dsh-bot-tag v1.2.0 ${source} ${mainRunId}`,created_at:'2026-10-11T11:30:00Z',updated_at:'2026-10-11T11:30:00Z'},ambiguousBranch:false,runs:{[mainRunId]:ciRun(),[tagRunId]:ciRun(tagRunId),[publisherRunId]:{...ciRun(),id:publisherRunId,workflow_id:2002,path:'.github/workflows/publish-v120.yml',event:'issue_comment',status:'in_progress',conclusion:null,display_title:`v1.2.0 publication comment ${commentId}`},986:{...ciRun(),id:986,workflow_id:2002,path:'.github/workflows/publish-v120.yml',event:'issue_comment',head_branch:'main',display_title:'v1.2.0 publication comment 6105999999',created_at:'2026-10-11T11:30:01Z',updated_at:'2026-10-11T12:01:30Z'}},jobsByRun:{[mainRunId]:[...jobNames,...readableJobNames].map((name,index)=>successfulJob(name,{id:5000+index,runId:mainRunId})),[tagRunId]:jobNames.map((name,index)=>successfulJob(name,{id:7000+index,runId:tagRunId}))},prior:[],tagRuns:[],reads:[],writes:[],downloads:[],unmodeled:[],afterDownload:()=>{},beforeRequest:()=>{},afterWrite:()=>{}};
  const api={async request(method,path,body) {
    await state.beforeRequest({method,path,body});
    if(method==='GET')state.reads.push(path);else state.writes.push({method,path,body});
    let response;
    if(method==='GET'&&path===prefix)response=repository;
    else if(method==='GET'&&path===`${prefix}/pulls/11`)response={number:11,state:'closed',merged:true,merged_at:'2026-10-11T09:00:00Z',merge_commit_sha:'d'.repeat(40),base:{ref:'main',repo:repository}};
    else if(method==='GET'&&path===`${prefix}/issues/comments/${commentId}`)response=state.comment;
    else if(method==='GET'&&path===`${prefix}/issues/comments/6105999999`)response=state.originalComment;
    else if(method==='GET'&&path===`${prefix}/git/ref/heads/main`)response={object:{type:'commit',sha:state.main}};
    else if(method==='GET'&&path===`${prefix}/git/ref/heads/v1.2.0`)response=state.ambiguousBranch?{object:{type:'commit',sha:source}}:null;
    else if(method==='GET'&&path===`${prefix}/actions/workflows/ci.yml`)response={id:1001,path:'.github/workflows/ci.yml',name:'Native plugin checks',state:'active'};
    else if(method==='GET'&&path.startsWith(`${prefix}/actions/workflows/publish-v120.yml/runs?`))response={total_count:state.prior.length,workflow_runs:state.prior};
    else if(method==='GET'&&path.startsWith(`${prefix}/actions/workflows/ci.yml/runs?`))response={total_count:state.tagRuns.length,workflow_runs:state.tagRuns};
    else if(method==='GET'&&/\/actions\/runs\/\d+$/.test(path))response=state.runs[path.split('/').at(-1)];
    else if(method==='GET'&&path.includes('/jobs?')){const runId=Number(/\/runs\/(\d+)/.exec(path)[1]),jobs=state.jobsByRun[runId];response={total_count:jobs.length,jobs};}
    else if(method==='GET'&&path.includes('/artifacts?')) {
      const runId=Number(/\/runs\/(\d+)/.exec(path)[1]);
      response={total_count:3,artifacts:['native-plugin-package','stock-gui-ubuntu-latest','stock-gui-macos-latest'].map((name,index)=>({id:2100+index,name,expired:false,workflow_run:{id:runId,head_sha:source,head_branch:state.runs[runId].head_branch}}))};
    } else if(method==='GET'&&path===`${prefix}/git/ref/tags/v1.2.0`)response=state.tag?{object:{type:'tag',sha:state.tag.sha}}:null;
    else if(method==='GET'&&path.startsWith(`${prefix}/git/tags/`))response=state.tag;
    else if(method==='POST'&&path===`${prefix}/git/tags`) {state.pendingTag={...annotation(),...body,object:{type:body.type,sha:body.object},tagger:{date:'2026-10-11T14:00:01Z'}};response=state.pendingTag;}
    else if(method==='POST'&&path===`${prefix}/git/refs`) {state.tag=state.pendingTag;response={ref:body.ref,object:{type:'tag',sha:body.sha}};}
    else if(method==='POST'&&path===`${prefix}/actions/workflows/ci.yml/dispatches`)response=state.dispatchResponse;
    else if(method==='GET'&&(path===`${prefix}/releases/tags/v1.2.0`||path===`${prefix}/releases/latest`))response=state.release;
    else if(method==='POST'&&path===`${prefix}/releases`) {state.release={...body,id:12345,author:{id:41898282,login:'github-actions[bot]',type:'Bot'},assets:[]};response=state.release;}
    else {state.unmodeled.push({method,path});throw Error(`Unmodeled API route ${method} ${path}`);}
    response=structuredClone(response);
    if(method!=='GET')await state.afterWrite({method,path,body,response});
    return structuredClone(response);
  }};
  const downloadArtifact=async({runId,name,directory})=>{
    state.downloads.push({runId,name});await mkdir(directory,{recursive:true});
    if(name==='native-plugin-package') {await cp(join(root,'dist/dsh-bot-1.2.0.tgz'),join(directory,'dsh-bot-1.2.0.tgz'));await cp(join(root,'dist/SHA256SUMS'),join(directory,'SHA256SUMS'));}
    else for(const name of Object.keys(stock.stockSources)){await mkdir(join(directory,name),{recursive:true});await writeFile(join(directory,name,'stock-gui-report.json'),JSON.stringify(qualifiedReport(name,target)));}
    await state.afterDownload({runId,name});
  };
  return {state,options:{event,checkoutSha:source,publisherRunId,repositoryRoot:root,api,downloadArtifact,reportDirectory:join(scratch,'private'),notesTemplate:'v1.2.0\n{{MAIN_SHA}}\n{{BRANCH_RUN}} {{PR_RUN}} {{MAIN_RUN}} {{TAG_RUN}}\nhttps://raw.githubusercontent.com/86cloudyun-afk/dsh-bot/v1.2.0/dist/dsh-bot-1.2.0.tgz\nhttps://raw.githubusercontent.com/86cloudyun-afk/dsh-bot/v1.2.0/dist/SHA256SUMS'}};
}
async function refusesWithoutWrite(t,mode,change) {
  const f=await fixture(t,mode);await change(f);await assert.rejects(()=>executePublication(f.options),PublicationFailure);assert.deepEqual(f.state.unmodeled,[],'The fixture must reach the intended rejection, without a missing API route');assert.deepEqual(f.state.writes,[],'A validation refusal must perform no external mutation');return f;
}

for(const mode of ['tag','publish'])test(`independent model permits a fully qualified ${mode}`,async t=>{const f=await fixture(t,mode),result=await executePublication(f.options);assert.deepEqual(f.state.unmodeled,[]);assert.ok(['tagged-and-dispatched','published'].includes(result.status));assert.equal(f.state.downloads.length,3);assert.ok(f.state.writes.length>0);});

for(const [name,mutate] of [
  ['a forged repository owner name with the trusted ID',e=>{e.repository=structuredClone(e.repository);e.repository.owner.login='somebody-else';}],
  ['a missing comment ID',e=>{delete e.comment.id;}],
  ['an unsafe comment ID',e=>{e.comment.id=Number.MAX_SAFE_INTEGER+1;}],
  ['an exponential run number',e=>{e.comment.body=e.comment.body.replace(String(mainRunId),'3.8114e10');}],
  ['a run number padded with a leading zero',e=>{e.comment.body=e.comment.body.replace(String(mainRunId),'038114000001');}],
  ['a tab substituted for the command separator',e=>{e.comment.body=e.comment.body.replace(' v1.2.0','\tv1.2.0');}],
  ['a Windows newline after an otherwise valid command',e=>{e.comment.body+='\r\n';}],
  ['an invisible Unicode suffix',e=>{e.comment.body+='\u200b';}],
])test(`adversarial command rejects ${name}`,()=>{const e=structuredClone(command());mutate(e);assert.throws(()=>parseOwnerCommand(e));});

test('an owner command edited while artifacts download cannot cause a tag write',async t=>{
  await refusesWithoutWrite(t,'tag',f=>{f.state.afterDownload=()=>{f.state.comment.body='/dsh-bot-tag v1.2.0 '+source+' '+(mainRunId+100);f.state.comment.updated_at='2026-10-11T14:01:00Z';};});
});
test('a live comment with a changed author cannot authorize a release',async t=>{
  await refusesWithoutWrite(t,'publish',f=>{f.state.afterDownload=()=>{f.state.comment.user={id:123,login:'other',type:'User'};};});
});
test('main moving during artifact download cannot authorize a release',async t=>{
  await refusesWithoutWrite(t,'publish',f=>{f.state.afterDownload=()=>{f.state.main='e'.repeat(40);};});
});
test('a same-target tag object replaced during downloads cannot authorize a release',async t=>{
  await refusesWithoutWrite(t,'publish',f=>{f.state.afterDownload=()=>{f.state.tag.sha=otherTagSha;};});
});
test('main moving after tag-object creation leaves only that known orphan object',async t=>{
  const f=await fixture(t);f.state.afterWrite=({path})=>{if(path===`${prefix}/git/tags`)f.state.main='e'.repeat(40);};
  let failure;try{await executePublication(f.options);}catch(error){failure=error;}
  assert.ok(failure instanceof PublicationFailure);assert.deepEqual(f.state.writes.map(x=>x.path),[`${prefix}/git/tags`]);assert.equal(failure.partial.tagObjectSha,tagSha);assert.notEqual(failure.partial.status,'unknown-write');
});
test('a tag ref changing immediately after creation prevents dispatching the replacement',async t=>{
  const f=await fixture(t);f.state.afterWrite=({path})=>{if(path===`${prefix}/git/refs`)f.state.tag.sha=otherTagSha;};
  await assert.rejects(()=>executePublication(f.options),PublicationFailure);
  assert.deepEqual(f.state.writes.map(x=>x.path),[`${prefix}/git/tags`,`${prefix}/git/refs`],'No CI dispatch may use the substituted tag');
});
for(const [name,created,updated] of [
  ['before tag creation','2026-10-11T11:59:59Z','2026-10-11T13:00:00Z'],
  ['after the publish command','2026-10-11T14:00:01Z','2026-10-11T14:30:00Z'],
  ['still incomplete when the publish command was created','2026-10-11T12:01:00Z','2026-10-11T14:00:01Z'],
])test(`an exact-source tag CI ${name} cannot be reused`,async t=>{
  await refusesWithoutWrite(t,'publish',f=>{Object.assign(f.state.runs[tagRunId],{created_at:created,updated_at:updated});});
});
test('a prior failed publisher for the same comment is never automatically replayed',async t=>{
  await refusesWithoutWrite(t,'tag',f=>{f.state.prior=[{id:986,display_title:`v1.2.0 publication comment ${commentId}`,status:'completed',conclusion:'failure'}];});
});
test('a new comment does not redispatch when the previous tag publisher outcome is unknown',async t=>{
  await refusesWithoutWrite(t,'tag',f=>{f.state.tag=annotation();f.state.runs[986].conclusion='failure';});
});
for(const suffix of ['git/refs','actions/workflows/ci.yml/dispatches'])test(`a committed ${suffix} followed by a timeout is recorded as UNKNOWN and written only once`,async t=>{
  const f=await fixture(t);f.state.afterWrite=({path})=>{if(path===`${prefix}/${suffix}`)throw Error('write timed out after remote commit; bearer sensitive');};
  let failure;try{await executePublication(f.options);}catch(error){failure=error;}
  assert.ok(failure instanceof PublicationFailure);assert.equal(failure.partial.status,'unknown-write');assert.ok(failure.partial.pending);assert.equal(failure.partial.tagObjectSha,tagSha);
  assert.equal(f.state.writes.filter(x=>x.path===`${prefix}/${suffix}`).length,1);assert.ok(!failure.message.includes('sensitive'));assert.ok(!failure.message.includes('bearer'));
});
test('a remotely committed release followed by timeout remains UNKNOWN and is not repeated',async t=>{
  const f=await fixture(t,'publish');f.state.afterWrite=({path})=>{if(path===`${prefix}/releases`)throw Error('publication timed out after remote commit');};
  let failure;try{await executePublication(f.options);}catch(error){failure=error;}
  assert.ok(failure instanceof PublicationFailure);assert.equal(failure.partial.status,'unknown-write');assert.ok(f.state.release);assert.equal(f.state.writes.filter(x=>x.path===`${prefix}/releases`).length,1);
});

test('a fresh exact-source tag run belonging to another dispatch cannot qualify publication',async t=>{
  await refusesWithoutWrite(t,'publish',f=>{f.state.runs[tagRunId].display_title='Native plugin checks v1.2.0 publication comment 6105998888 run 985';});
});
test('an identically named branch cannot make the tag dispatch ref ambiguous',async t=>{
  await refusesWithoutWrite(t,'tag',f=>{f.state.ambiguousBranch=true;});
});

test('rerunning the same publisher run cannot replay a possible UNKNOWN write',async t=>{
  await refusesWithoutWrite(t,'tag',f=>{f.state.runs[publisherRunId].run_attempt=2;});
});

test('a nonce-correlated tag dispatch in the tag creation second can qualify publication',async t=>{
  const f=await fixture(t,'publish');f.state.runs[tagRunId].created_at=f.state.tag.tagger.date;const result=await executePublication(f.options);assert.equal(result.status,'published');assert.deepEqual(f.state.unmodeled,[]);assert.equal(f.state.writes.filter(x=>x.path===`${prefix}/releases`).length,1);
});

test('an accepted dispatch without a returned run ID retains UNKNOWN rather than pretending the operation was refused',async t=>{
  const f=await fixture(t);f.state.dispatchResponse=null;let failure;try{await executePublication(f.options);}catch(error){failure=error;}assert.ok(failure instanceof PublicationFailure);assert.equal(failure.partial.status,'unknown-write');assert.equal(failure.partial.tagObjectSha,tagSha);assert.equal(f.state.writes.filter(x=>x.path===`${prefix}/actions/workflows/ci.yml/dispatches`).length,1);
});
test('a successful tag-ref response with an inconsistent ID retains the committed remote fact and UNKNOWN',async t=>{
  const f=await fixture(t);f.state.afterWrite=({path,response})=>{if(path===`${prefix}/git/refs`)response.object.sha=otherTagSha;};let failure;try{await executePublication(f.options);}catch(error){failure=error;}assert.ok(failure instanceof PublicationFailure);assert.equal(failure.partial.status,'unknown-write');assert.equal(f.state.tag.sha,tagSha);assert.equal(failure.partial.tagObjectSha,tagSha);assert.equal(f.state.writes.filter(x=>x.path===`${prefix}/git/refs`).length,1);
});

test('a remotely accepted annotated tag with a missing returned object SHA remains UNKNOWN',async t=>{
  const f=await fixture(t);f.state.afterWrite=({path,response})=>{if(path===`${prefix}/git/tags`)delete response.sha;};let failure;try{await executePublication(f.options);}catch(error){failure=error;}assert.ok(failure instanceof PublicationFailure);assert.equal(failure.partial.status,'unknown-write');assert.equal(f.state.pendingTag.sha,tagSha);assert.equal(f.state.writes.length,1);
});
test('a remotely accepted release with a missing returned release ID remains UNKNOWN',async t=>{
  const f=await fixture(t,'publish');f.state.afterWrite=({path,response})=>{if(path===`${prefix}/releases`)delete response.id;};let failure;try{await executePublication(f.options);}catch(error){failure=error;}assert.ok(failure instanceof PublicationFailure);assert.equal(failure.partial.status,'unknown-write');assert.equal(f.state.release.id,12345);assert.equal(f.state.writes.filter(x=>x.path===`${prefix}/releases`).length,1);
});

// Real main push run38116990411 includes the two fixed native GUI check-run
// summaries in GET /jobs. Workflow-dispatched tag runs do not create them.
test('the observed main ten-job and tag eight-job contracts permit qualified publication',async t=>{
  const f=await fixture(t,'publish');assert.equal(f.state.jobsByRun[mainRunId].length,10);assert.equal(f.state.jobsByRun[tagRunId].length,8);const result=await executePublication(f.options);assert.equal(result.status,'published');assert.ok(f.state.reads.some(path=>path.includes(`/runs/${mainRunId}/jobs?`)));assert.ok(f.state.reads.some(path=>path.includes(`/runs/${tagRunId}/jobs?`)));assert.deepEqual(f.state.unmodeled,[]);
});
for(const name of readableJobNames){
  test(`main qualification rejects missing readable summary ${name}`,async t=>refusesWithoutWrite(t,'tag',f=>{f.state.jobsByRun[mainRunId]=f.state.jobsByRun[mainRunId].filter(job=>job.name!==name);}));
  test(`main qualification rejects duplicate readable summary ${name} while total remains ten`,async t=>refusesWithoutWrite(t,'tag',f=>{const other=readableJobNames.find(value=>value!==name),index=f.state.jobsByRun[mainRunId].findIndex(job=>job.name===other);f.state.jobsByRun[mainRunId][index]={...f.state.jobsByRun[mainRunId][index],name};}));
  test(`main qualification rejects failed readable summary ${name} despite successful run`,async t=>refusesWithoutWrite(t,'tag',f=>{f.state.jobsByRun[mainRunId].find(job=>job.name===name).conclusion='failure';}));
  test(`main qualification rejects incomplete readable summary ${name} despite completed run`,async t=>refusesWithoutWrite(t,'tag',f=>{f.state.jobsByRun[mainRunId].find(job=>job.name===name).status='in_progress';}));
  test(`tag qualification rejects unexpected readable summary ${name}`,async t=>refusesWithoutWrite(t,'publish',f=>{f.state.jobsByRun[tagRunId].push(successfulJob(name,{id:9000,runId:tagRunId}));}));
}
test('main qualification rejects an unknown extra job instead of allowing arbitrary additional checks',async t=>refusesWithoutWrite(t,'tag',f=>{f.state.jobsByRun[mainRunId].push(successfulJob('unreviewed publication check',{id:9000,runId:mainRunId}));}));
test('main qualification rejects a similarly named third-platform readable summary',async t=>refusesWithoutWrite(t,'tag',f=>{f.state.jobsByRun[mainRunId].push(successfulJob('原生 GUI (windows-latest)',{id:9000,runId:mainRunId}));}));

for(const [name,mutate] of [
  ['a different run carrying the same source',job=>{job.run_id=tagRunId;}],
  ['a different source carrying the right run ID',job=>{job.head_sha='e'.repeat(40);} ],
  ['a different attempt carrying the right run and source',job=>{job.run_attempt=2;}],
  ['an invalid numeric check identity',job=>{job.id=0;}],
])test(`readable job provenance rejects ${name} despite exact successful job names`,async t=>refusesWithoutWrite(t,'tag',f=>{mutate(f.state.jobsByRun[mainRunId].find(job=>job.name===readableJobNames[0]));}));
test('readable job provenance rejects duplicate IDs across independently named platform summaries',async t=>refusesWithoutWrite(t,'tag',f=>{const rows=f.state.jobsByRun[mainRunId].filter(job=>readableJobNames.includes(job.name));rows[1].id=rows[0].id;}));
