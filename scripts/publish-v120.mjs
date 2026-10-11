import assert from 'node:assert/strict';

export const REPOSITORY='86cloudyun-afk/dsh-bot';
export const OWNER_ID=269269188;
export const VERSION='v1.2.0';
const shaPattern=/^[a-f\d]{40}$/;
const id=value=>Number.isSafeInteger(value)&&value>0;
const owner=user=>user?.id===OWNER_ID&&user?.login==='86cloudyun-afk'&&user?.type==='User';

export function parseOwnerCommand(event) {
  assert.equal(event?.action,'created','Only new comments are authorized');
  assert.equal(event.repository?.full_name,REPOSITORY,'Wrong repository');
  assert.ok(owner(event.repository.owner),'Wrong repository owner');
  assert.ok(owner(event.sender)&&owner(event.comment?.user),'Wrong command actor');
  assert.equal(event.issue?.number,11,'Wrong issue');
  assert.ok(event.issue.pull_request,'Command requires the native release PR');
  assert.ok(id(event.comment.id),'Invalid comment identity');
  const match=/^\/dsh-bot-(tag|publish) v1\.2\.0 ([a-f\d]{40}) ([1-9]\d*)$/.exec(event.comment.body);
  assert.ok(match&&match[0]===event.comment.body,'Command must be exact');
  const runId=Number(match[3]);assert.ok(id(runId),'Invalid run identity');
  return {mode:match[1],sha:match[2],runId,commentId:event.comment.id};
}

import {readFile,mkdir,writeFile,chmod,mkdtemp,rm,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {readStockTarget,qualifyStockReports} from '../test/native-plugin/stock-qualification.mjs';

export const FROZEN_SHA256='43e837624194596a9ff679e86b68f416ea7977152f480191c208fc5eae726d94';
export const EXPECTED_JOBS=Object.freeze(['artifact','plugin (ubuntu-latest, 22)','plugin (ubuntu-latest, 24)','plugin (macos-latest, 22)','plugin (macos-latest, 24)','stock-gui (ubuntu-latest)','stock-gui (macos-latest)','publication-guard']);
const prefix=`/repos/${REPOSITORY}`;
const artifactNames=['native-plugin-package','stock-gui-ubuntu-latest','stock-gui-macos-latest'];
const tagMessagePrefix='dsh-bot v1.2.0 qualified publication\n';
const digest=value=>createHash('sha256').update(value).digest('hex');
const timestamp=value=>{const result=Date.parse(value);assert.ok(Number.isFinite(result),'Missing valid evidence timestamp');return result;};
const sameRepository=value=>value?.full_name===REPOSITORY&&owner(value.owner);
const list=(result,key)=>{assert.ok(Number.isSafeInteger(result?.total_count)&&result.total_count>=0&&result.total_count<=100,'Incomplete paginated evidence');assert.ok(Array.isArray(result[key]));assert.equal(result[key].length,result.total_count,'Incomplete evidence page');return result[key];};

async function verifyFrozen(root,sourceCommit,artifact=join(root,'dist/dsh-bot-1.2.0.tgz')) {
  const target=await readStockTarget({root,sourceCommit});
  assert.equal(target.packageVersion,'1.2.0','Unexpected package version');
  assert.equal(target.artifactSha256,FROZEN_SHA256,'Frozen package changed');
  assert.equal((await stat(artifact)).size,147662,'Frozen package size changed');
  assert.equal(digest(await readFile(artifact)),FROZEN_SHA256,'Downloaded package changed');
  const proof=JSON.parse(execFileSync(process.execPath,[join(root,'scripts/verify-distribution.mjs'),artifact],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1024*1024,timeout:60000}));
  assert.equal(proof.sha256,FROZEN_SHA256);assert.equal(proof.sourceFiles,30);assert.equal(proof.sourceFilesMatch,true);
  return target;
}

async function validateRun(api,runId,{sha,mode,workflow}) {
  const run=await api.request('GET',`${prefix}/actions/runs/${runId}`);
  assert.equal(run?.id,runId,'Wrong CI run identity');assert.equal(run.workflow_id,workflow.id,'Wrong CI workflow identity');
  assert.equal(run.path,'.github/workflows/ci.yml','Wrong CI workflow path');
  assert.ok(sameRepository(run.repository)&&sameRepository(run.head_repository),'Foreign CI repository');
  assert.equal(run.head_sha,sha,'CI source differs');assert.equal(run.status,'completed','CI not complete');assert.equal(run.conclusion,'success','CI did not succeed');
  assert.equal(run.event,mode==='tag'?'workflow_dispatch':'push','Wrong CI event');assert.equal(run.head_branch,mode==='tag'?VERSION:'main','Wrong CI branch');
  assert.ok(id(run.run_attempt),'Invalid CI attempt');assert.ok(timestamp(run.updated_at)>=timestamp(run.created_at),'Invalid CI chronology');
  const jobs=list(await api.request('GET',`${prefix}/actions/runs/${runId}/jobs?filter=latest&per_page=100`),'jobs');
  assert.deepEqual(jobs.map(job=>job.name).sort(),[...EXPECTED_JOBS].sort(),'Exact eight CI jobs are required');
  for(const job of jobs){assert.equal(job.status,'completed','Incomplete CI job');assert.equal(job.conclusion,'success','Unsuccessful CI job');}
  return run;
}

async function qualifyArtifacts(api,downloadArtifact,run,target,root,directory) {
  const artifacts=list(await api.request('GET',`${prefix}/actions/runs/${run.id}/artifacts?per_page=100`),'artifacts');
  assert.deepEqual(artifacts.map(x=>x.name).sort(),[...artifactNames].sort(),'Actual package and both platform artifacts required');
  let reports=0;
  for(const name of artifactNames) {
    const artifact=artifacts.find(x=>x.name===name);assert.ok(id(artifact.id)&&artifact.expired===false,'Unavailable qualification artifact');
    assert.equal(artifact.workflow_run?.id,run.id,'Foreign artifact run');assert.equal(artifact.workflow_run.head_sha,target.sourceCommit,'Foreign artifact source');assert.equal(artifact.workflow_run.head_branch,run.head_branch,'Foreign artifact branch');
    const destination=join(directory,name);await mkdir(destination,{mode:0o700});
    await downloadArtifact({runId:run.id,name,directory:destination});
    if(name==='native-plugin-package') {
      assert.equal((await readFile(join(destination,'SHA256SUMS'),'utf8')).trim(),`${FROZEN_SHA256}  dsh-bot-1.2.0.tgz`,'Downloaded checksum differs');
      await verifyFrozen(root,target.sourceCommit,join(destination,'dsh-bot-1.2.0.tgz'));
    } else {
      const result=await qualifyStockReports(destination,{target});
      assert.equal(result.passed,true,'Incomplete platform qualification');assert.equal(result.rows.length,9,'All stock sources required');
      assert.deepEqual(result.rows.map(row=>row.checks),[128,7,7,7,7,7,7,7,7],'Qualification check counts differ');reports+=result.rows.length;
    }
  }
  return {reports,checksPerPlatform:184};
}

async function readTag(api,sha) {
  const ref=await api.request('GET',`${prefix}/git/ref/tags/${VERSION}`);
  if(!ref)return null;
  assert.equal(ref.object?.type,'tag','A lightweight tag cannot qualify');assert.ok(shaPattern.test(ref.object.sha),'Invalid tag object');
  const tag=await api.request('GET',`${prefix}/git/tags/${ref.object.sha}`);
  assert.equal(tag?.sha,ref.object.sha,'Tag object identity differs');assert.equal(tag.tag,VERSION,'Tag name differs');assert.equal(tag.object?.type,'commit','Tag must directly target a commit');assert.equal(tag.object.sha,sha,'Tag target differs');
  assert.ok(tag.message?.startsWith(tagMessagePrefix),'Unknown annotated tag provenance');
  const checkpoint=JSON.parse(tag.message.slice(tagMessagePrefix.length));
  assert.equal(checkpoint.repository,REPOSITORY);assert.equal(checkpoint.version,VERSION);assert.equal(checkpoint.sourceCommit,sha);
  assert.ok(id(checkpoint.mainRunId)&&id(checkpoint.commentId)&&id(checkpoint.publisherRunId),'Invalid tag checkpoint');timestamp(tag.tagger?.date);
  return {tag,checkpoint};
}

async function validateTagOrigin(api,existingTag,event,mainRun) {
  const {checkpoint,tag}=existingTag;
  const comment=await api.request('GET',`${prefix}/issues/comments/${checkpoint.commentId}`);
  assert.equal(comment?.id,checkpoint.commentId);assert.equal(comment.issue_url,`https://api.github.com/repos/${REPOSITORY}/issues/11`);assert.equal(comment.updated_at,comment.created_at,'Original tag command was edited');
  const original=parseOwnerCommand({...event,sender:comment.user,comment});
  assert.equal(original.mode,'tag');assert.equal(original.sha,checkpoint.sourceCommit);assert.equal(original.runId,mainRun.id);assert.equal(checkpoint.mainRunId,mainRun.id);
  assert.ok(timestamp(mainRun.updated_at)<=timestamp(comment.created_at)&&timestamp(comment.created_at)<=timestamp(tag.tagger.date),'Original tag chronology differs');
  const publisher=await api.request('GET',`${prefix}/actions/runs/${checkpoint.publisherRunId}`);
  assert.equal(publisher?.id,checkpoint.publisherRunId);assert.equal(publisher.path,'.github/workflows/publish-v120.yml');assert.equal(publisher.event,'issue_comment');assert.equal(publisher.head_branch,'main');assert.equal(publisher.head_sha,checkpoint.sourceCommit);assert.equal(publisher.run_attempt,1);assert.equal(publisher.status,'completed');
  assert.equal(publisher.display_title,`v1.2.0 publication comment ${checkpoint.commentId}`);assert.ok(sameRepository(publisher.repository)&&sameRepository(publisher.head_repository),'Foreign original publisher');
}

export class PublicationFailure extends Error {
  constructor(error,partial){super(`Publication refused: ${digest(String(error?.message??error))}`);this.name='PublicationFailure';this.partial=structuredClone(partial);}
}


function correlatedTitle(checkpoint) {return `Native plugin checks v1.2.0 publication comment ${checkpoint.commentId} run ${checkpoint.publisherRunId}`;}
function releaseNotes(template,{sha,mainRunId,tagRunId}) {
  assert.equal(typeof template,'string','Missing release notes template');
  const values={MAIN_SHA:sha,BRANCH_RUN:38113821247,PR_RUN:38113823988,MAIN_RUN:mainRunId,TAG_RUN:tagRunId};
  for(const [key,value] of Object.entries(values)){const token=`{{${key}}}`;assert.ok(template.includes(token),'Missing notes provenance');template=template.replaceAll(token,String(value));}
  assert.ok(!/\{\{[^}]*\}\}/.test(template),'Unresolved release notes placeholder');
  for(const file of ['dsh-bot-1.2.0.tgz','SHA256SUMS'])assert.ok(template.includes(`https://raw.githubusercontent.com/${REPOSITORY}/${VERSION}/dist/${file}`),'Missing frozen tag download');
  return template;
}
function verifyRelease(release,{sha,body}) {
  assert.ok(id(release?.id),'Missing release identity');assert.equal(release.tag_name,VERSION);assert.ok(release.target_commitish===sha||release.target_commitish==='main','Release target differs');
  assert.equal(release.draft,false);assert.equal(release.prerelease,false);assert.deepEqual(release.assets,[],'Release must have zero assets');
  assert.equal(release.author?.id,41898282,'Unknown release author');assert.equal(release.author.login,'github-actions[bot]');assert.equal(release.author.type,'Bot');
  assert.equal(digest(release.body),digest(body),'Release body differs');return release.id;
}

export async function executePublication({event,checkoutSha,publisherRunId,repositoryRoot=resolve(import.meta.dirname,'..'),api,downloadArtifact,reportDirectory,notesTemplate}) {
  let state={status:'validating'},artifactsDirectory,checkWrite;
  const save=async()=>{if(!reportDirectory)return;await mkdir(reportDirectory,{recursive:true,mode:0o700});await chmod(reportDirectory,0o700);await writeFile(join(reportDirectory,'publication.json'),JSON.stringify(state,null,2)+'\n',{mode:0o600});await chmod(join(reportDirectory,'publication.json'),0o600);};
  const write=async(kind,path,body)=>{await checkWrite(kind);state.pending=kind;await save();return api.request('POST',path,body);};
  try {
    const command=parseOwnerCommand(event);state={...state,...command,publisherRunId};assert.ok(id(publisherRunId),'Invalid publisher run');
    assert.equal(checkoutSha,command.sha,'Trusted checkout differs from command');
    const repository=await api.request('GET',prefix);assert.ok(sameRepository(repository),'Repository identity differs');assert.equal(repository.default_branch,'main','Wrong default branch');
    const pr=await api.request('GET',`${prefix}/pulls/11`);assert.equal(pr?.number,11);assert.equal(pr.state,'closed');assert.equal(pr.merged,true,'Native PR must be merged');assert.ok(shaPattern.test(pr.merge_commit_sha));timestamp(pr.merged_at);assert.equal(pr.base?.ref,'main');assert.ok(sameRepository(pr.base.repo),'Foreign native PR');
    const lease=async()=>{const currentRepository=await api.request('GET',prefix);assert.ok(sameRepository(currentRepository),'Repository owner lease changed');assert.equal(currentRepository.default_branch,'main','Default branch lease changed');const main=await api.request('GET',`${prefix}/git/ref/heads/main`);assert.equal(main?.object?.type,'commit');assert.equal(main.object.sha,command.sha,'Current main differs');assert.equal(await api.request('GET',`${prefix}/git/ref/heads/${VERSION}`),null,'Same-named branch is ambiguous');};
    const liveCommand=async()=>{assert.deepEqual(parseOwnerCommand(event),command,'Event command changed');const comment=await api.request('GET',`${prefix}/issues/comments/${command.commentId}`);assert.equal(comment?.id,command.commentId);assert.equal(comment.issue_url,`https://api.github.com/repos/${REPOSITORY}/issues/11`);assert.equal(comment.body,event.comment.body,'Live command changed');assert.equal(comment.created_at,event.comment.created_at,'Comment creation differs');assert.equal(comment.updated_at,comment.created_at,'Edited command is forbidden');assert.deepEqual(parseOwnerCommand({...event,comment}),command);return comment;};
    await lease();const live=await liveCommand();
    const currentPublisher=await api.request('GET',`${prefix}/actions/runs/${publisherRunId}`);assert.equal(currentPublisher?.id,publisherRunId);assert.equal(currentPublisher.run_attempt,1,'Automatic publisher rerun is forbidden');assert.equal(currentPublisher.path,'.github/workflows/publish-v120.yml');assert.equal(currentPublisher.event,'issue_comment');assert.equal(currentPublisher.head_branch,'main');assert.equal(currentPublisher.head_sha,command.sha);assert.equal(currentPublisher.display_title,`v1.2.0 publication comment ${command.commentId}`);assert.ok(sameRepository(currentPublisher.repository)&&sameRepository(currentPublisher.head_repository),'Foreign publisher run');
    const workflow=await api.request('GET',`${prefix}/actions/workflows/ci.yml`);assert.ok(id(workflow?.id));assert.equal(workflow.path,'.github/workflows/ci.yml');assert.equal(workflow.name,'Native plugin checks');assert.equal(workflow.state,'active');
    const target=await verifyFrozen(repositoryRoot,command.sha);
    let existingTag=await readTag(api,command.sha),run,mainRun,body;
    if(command.mode==='tag') {
      run=mainRun=await validateRun(api,command.runId,{sha:command.sha,mode:'main',workflow});assert.ok(timestamp(mainRun.updated_at)<=timestamp(live.created_at),'Main qualification completed after tag command');
      if(existingTag){assert.equal(existingTag.checkpoint.mainRunId,run.id,'Tag main checkpoint differs');await validateTagOrigin(api,existingTag,event,mainRun);}
    } else {
      assert.ok(existingTag,'Publish requires the annotated tag');state.tagObjectSha=existingTag.tag.sha;
      mainRun=await validateRun(api,existingTag.checkpoint.mainRunId,{sha:command.sha,mode:'main',workflow});await validateTagOrigin(api,existingTag,event,mainRun);
      run=await validateRun(api,command.runId,{sha:command.sha,mode:'tag',workflow});
      assert.equal(run.display_title,correlatedTitle(existingTag.checkpoint),'Tag dispatch is not correlated');
      assert.ok(timestamp(run.created_at)>=timestamp(existingTag.tag.tagger.date)&&timestamp(run.created_at)>=timestamp(mainRun.updated_at),'Tag run predates its qualified tag');
      assert.ok(timestamp(run.updated_at)<=timestamp(live.created_at),'Tag run was not complete before the publish command');
      body=releaseNotes(notesTemplate,{sha:command.sha,mainRunId:mainRun.id,tagRunId:run.id});
    }
    state.mainRunId=mainRun.id;
    artifactsDirectory=await mkdtemp(join(tmpdir(),'dsh-v120-publication-'));await chmod(artifactsDirectory,0o700);
    Object.assign(state,await qualifyArtifacts(api,downloadArtifact,run,target,repositoryRoot,artifactsDirectory));
    const previous=list(await api.request('GET',`${prefix}/actions/workflows/publish-v120.yml/runs?event=issue_comment&per_page=100`),'workflow_runs');
    const replay=previous.some(value=>value.id!==publisherRunId&&value.display_title===`v1.2.0 publication comment ${command.commentId}`);
    checkWrite=async kind=>{assert.equal(replay,false,'Automatic comment replay is forbidden');await liveCommand();await lease();const current=await readTag(api,command.sha);if(kind==='create-tag-object'||kind==='create-tag-ref')assert.equal(current,null,'Tag appeared before creation');else assert.equal(current?.tag.sha,state.tagObjectSha,'Tag object lease changed');if(kind==='create-release'){await validateTagOrigin(api,current,event,mainRun);assert.equal(await api.request('GET',`${prefix}/releases/tags/${VERSION}`),null,'Release appeared before creation');}};
    await lease();await liveCommand();
    const finalTag=await readTag(api,command.sha);assert.equal(finalTag?.tag.sha,existingTag?.tag.sha,'Tag changed during qualification');existingTag=finalTag;
    if(command.mode==='publish') {
      const existingRelease=await api.request('GET',`${prefix}/releases/tags/${VERSION}`);
      if(existingRelease) {
        state.releaseId=verifyRelease(existingRelease,{sha:command.sha,body});await lease();assert.equal((await readTag(api,command.sha))?.tag.sha,state.tagObjectSha,'Release tag lease changed');const latest=await api.request('GET',`${prefix}/releases/latest`);assert.equal(latest?.id,state.releaseId,'Release is not latest');state.status='existing-release';await save();return state;
      }
      const release=await write('create-release',`${prefix}/releases`,{tag_name:VERSION,target_commitish:command.sha,name:'dsh-bot v1.2.0',body,draft:false,prerelease:false,make_latest:'true',generate_release_notes:false});
      assert.ok(id(release?.id),'Release creation returned no identity');state.releaseId=release.id;await save();
      verifyRelease(release,{sha:command.sha,body});state.pending=null;await save();await lease();assert.equal((await readTag(api,command.sha))?.tag.sha,state.tagObjectSha,'Release tag lease changed');const latest=await api.request('GET',`${prefix}/releases/latest`);assert.equal(latest?.id,state.releaseId,'New release is not latest');state.status='published';await save();return state;
    }
    if(existingTag) {
      const tagRuns=list(await api.request('GET',`${prefix}/actions/workflows/ci.yml/runs?event=workflow_dispatch&head_sha=${command.sha}&per_page=100`),'workflow_runs').filter(value=>value.head_branch===VERSION&&value.head_sha===command.sha&&value.event==='workflow_dispatch'&&value.workflow_id===workflow.id&&value.display_title===correlatedTitle(existingTag.checkpoint)&&timestamp(value.created_at)>=timestamp(existingTag.tag.tagger.date));
      assert.ok(tagRuns.length,'Existing tag has no known correlated dispatch; read-only inspection required');state.status='existing-tag-ci';state.tagObjectSha=existingTag.tag.sha;state.tagRunIds=tagRuns.map(value=>value.id);await save();return state;
    }
    const checkpoint={repository:REPOSITORY,version:VERSION,sourceCommit:command.sha,mainRunId:run.id,commentId:command.commentId,publisherRunId};
    const object=await write('create-tag-object',`${prefix}/git/tags`,{tag:VERSION,message:tagMessagePrefix+JSON.stringify(checkpoint),object:command.sha,type:'commit'});
    assert.ok(shaPattern.test(object?.sha),'Tag creation returned no identity');state.pending=null;state.tagObjectSha=object.sha;await save();
    const ref=await write('create-tag-ref',`${prefix}/git/refs`,{ref:`refs/tags/${VERSION}`,sha:object.sha});
    assert.equal(ref?.object?.sha,object.sha,'Created ref identity differs');assert.equal(ref.object.type,'tag');assert.equal(ref.ref,`refs/tags/${VERSION}`);state.pending=null;state.tagRefCreated=true;await save();
    const dispatch=await write('dispatch-tag-ci',`${prefix}/actions/workflows/ci.yml/dispatches`,{ref:VERSION,return_run_details:true,inputs:{publication_comment:String(command.commentId),publication_run:String(publisherRunId)}});
    state.dispatchAccepted=true;assert.ok(id(dispatch?.workflow_run_id),'Dispatch returned no run identity');state.pending=null;state.tagRunId=dispatch.workflow_run_id;state.status='tagged-and-dispatched';await save();return state;
  } catch(error) {
    state.status=state.pending?'unknown-write':'refused';state.failureHash=digest(String(error?.message??error));await save();throw new PublicationFailure(error,state);
  } finally {if(artifactsDirectory)await rm(artifactsDirectory,{recursive:true,force:true});}
}

/** Fixed-origin REST client: one attempt per operation, no redirects or response-body logging. */
export function createGitHubApi({token,fetchImpl=fetch,timeoutMs=30000}) {
  assert.ok(typeof token==='string'&&token.length>0,'Missing platform job token');assert.ok(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=60000,'Invalid REST timeout');
  return {async request(method,path,body) {
    assert.ok((method==='GET'||method==='POST')&&path.startsWith(`${prefix}/`)||method==='GET'&&path===prefix,'Invalid REST route');
    const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'dsh-bot-v120-qualified-publication'};
    // Repository and owner-command evidence is public; no additional issues/PR permission is needed.
    if(!(/^\/(?:repos\/[^/]+\/[^/]+)(?:\/pulls\/11|\/issues\/comments\/\d+)?$/.test(path)&&method==='GET'))headers.Authorization=`Bearer ${token}`;
    if(body!==undefined)headers['Content-Type']='application/json';
    const response=await fetchImpl(`https://api.github.com${path}`,{method,headers,redirect:'error',signal:AbortSignal.timeout(timeoutMs),...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(response.status===404&&method==='GET'&&(path===`${prefix}/git/ref/tags/${VERSION}`||path===`${prefix}/git/ref/heads/${VERSION}`||path===`${prefix}/releases/tags/${VERSION}`))return null;
    assert.ok(response.ok,`GitHub REST failed (${response.status})`);
    if(response.status===204)return null;
    return response.json();
  }};
}

function artifactDownloader(token) {
  return async({runId,name,directory})=>{
    assert.ok(id(runId)&&artifactNames.includes(name),'Invalid artifact download');
    execFileSync('gh',['run','download',String(runId),'--repo',REPOSITORY,'--name',name,'--dir',directory],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1024*1024,timeout:120000,env:{...process.env,GH_TOKEN:token,GITHUB_TOKEN:token}});
  };
}

async function runFromActions() {
  let reportDirectory;
  try {
    assert.equal(process.env.GITHUB_EVENT_NAME,'issue_comment');assert.equal(process.env.GITHUB_REPOSITORY,REPOSITORY);assert.equal(process.env.GITHUB_REF,'refs/heads/main');assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1','Automatic workflow rerun is forbidden');
    const root=resolve(import.meta.dirname,'..');
    const checkoutSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();assert.ok(shaPattern.test(checkoutSha));assert.equal(checkoutSha,process.env.GITHUB_SHA,'Checkout differs from trusted workflow SHA');
    const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));parseOwnerCommand(event);
    const token=process.env.GITHUB_TOKEN;const api=createGitHubApi({token});
    reportDirectory=await mkdtemp(join(tmpdir(),'dsh-v120-publication-private-'));await chmod(reportDirectory,0o700);
    const result=await executePublication({event,checkoutSha,publisherRunId:Number(process.env.GITHUB_RUN_ID),repositoryRoot:root,api,downloadArtifact:artifactDownloader(token),reportDirectory,notesTemplate:await readFile(join(root,'docs/releases/v1.2.0-release-notes.zh-CN.md'),'utf8')});
    console.log(JSON.stringify(publicIdentifiers(result)));
  } catch(error) {
    console.log(JSON.stringify({...publicIdentifiers(error.partial??{}),status:error.partial?.status??'refused',failureHash:digest(String(error?.message??error))}));process.exitCode=1;
  }
}
function publicIdentifiers(state) {
  const result={};for(const key of ['status','mode','sha','runId','mainRunId','tagRunId','tagRunIds','commentId','publisherRunId','tagObjectSha','tagRefCreated','dispatchAccepted','releaseId','pending','reports','checksPerPlatform','failureHash'])if(state[key]!==undefined)result[key]=state[key];return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await runFromActions();
