/** Actual official dsh profile boot; fresh Home, no inherited credentials, zero IO. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp,mkdir,writeFile,readFile,access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installOwnerProfile } from './install-owner-profile.mjs';
export async function verifyOwnerProfile({runtimeDirectory,evidenceDirectory}){
 assert.ok(isAbsolute(runtimeDirectory) && isAbsolute(evidenceDirectory));
 await mkdir(evidenceDirectory,{mode:0o700});
 const root=await mkdtemp(join(tmpdir(),'dsh-bot-profile-')),home=join(root,'home');
 const installed=await installOwnerProfile({runtimeDirectory,homeDirectory:home});
 const stages=[];
 function launch(label,args){
  const records=[],ioPath=join(root,`${label}-io.json`),logs={stdout:'',stderr:''};let buffer='',closed;
  const proc=spawn(process.execPath,['--import',resolve(import.meta.dirname,'../test/owner-profile-safety.mjs'),
   join(runtimeDirectory,'node_modules','@deepseek-ai','dsh','lib','bin.js'),'--profile',installed.profile,...args],
   {cwd:home,env:{DSH_BOT_TEST_ROOT:root,DSH_HOME:home,DSH_BOT_IO_RECEIPT:ioPath,TMPDIR:root,TZ:'UTC',LANG:'en_US.UTF-8'},stdio:['pipe','pipe','pipe']});
  proc.stdout.setEncoding('utf8');proc.stderr.setEncoding('utf8');
  proc.stdout.on('data',text=>{logs.stdout+=text;buffer+=text;assert.ok(logs.stdout.length<524288,'Bounded output');let i;
   while((i=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{records.push(JSON.parse(line));}catch{/* Native public startup/help text. */}}});
  proc.stderr.on('data',text=>{logs.stderr+=text;assert.ok(logs.stderr.length<524288,'Bounded diagnostics');});
  const exited=new Promise(resolveExit=>{proc.on('error',error=>{closed={code:null,errorCategory:error.code};resolveExit(closed);});
   proc.on('close',(code,signal)=>{closed={code,signal};resolveExit(closed);});});
  const bound=setTimeout(()=>proc.kill('SIGKILL'),15000);
  async function finish(){const result=await exited;clearTimeout(bound);await writeFile(join(evidenceDirectory,`${label}.json`),JSON.stringify({records,...result},null,2)+'\n');
   await writeFile(join(evidenceDirectory,`${label}.stdout.log`),logs.stdout);await writeFile(join(evidenceDirectory,`${label}.stderr.log`),logs.stderr);
   const io=JSON.parse(await readFile(ioPath,'utf8'));await writeFile(join(evidenceDirectory,`${label}.io.json`),JSON.stringify(io,null,2)+'\n');
   assert.deepEqual(io.attempts,{fetch:0,network:0,listener:0,child:0});return result;}
  async function waitFor(match){const limit=Date.now()+10000;while(Date.now()<limit){const found=records.find(match);if(found)return found;
   if(closed)throw Error(`PROFILE_EXIT_BEFORE_REPLY_${label}_${closed.code}`);await new Promise(r=>setTimeout(r,10));}throw Error(`PROFILE_REPLY_TIMEOUT_${label}`);}
  async function send(frame,match){const before=records.length;proc.stdin.write(JSON.stringify(frame)+'\n');return waitFor(r=>records.indexOf(r)>=before && (match?match(r):r.command===frame.command));}
  return {proc,records,finish,waitFor,send};
 }
 async function phase(label,args,work,expectedCode=0){const child=launch(label,args);try{await work(child);}catch(error){child.proc.stdin.end();await child.finish();throw error;}
  const result=await child.finish();assert.equal(result.code,expectedCode);stages.push({label,passed:true,exitCode:result.code});}
 try{
  await phase('help',['--help'],async child=>{child.proc.stdin.end();});
  await assert.rejects(access(join(home,'owner-state')),{code:'ENOENT'});
  await phase('invalid',['--init','--resume'],async child=>{child.proc.stdin.end();},2);
  await assert.rejects(access(join(home,'owner-state')),{code:'ENOENT'});
  let sessions;
  await phase('init',['--init'],async child=>{
   const ready=await child.waitFor(r=>r.event==='ready');assert.equal(ready.authority,'private-runtime-owner');assert.equal(ready.publicHumanAuthorityVerified,false);
   assert.equal(ready.modelRequestsEnabled,false);assert.equal(ready.modelTools,0);assert.notEqual(ready.sessions.contact,ready.sessions.execution);sessions=ready.sessions;
   const denied=await child.send({command:'status',actor:{kind:'human',id:'owner'}},r=>r.event==='error');assert.equal(denied.errorCategory,'invalid_owner_command');
   const frame={command:'prepare',operationId:'profile-zero-1',kind:'execution',text:'Harmless native profile acceptance.'};
   const first=await child.send(frame),again=await child.send(frame);assert.equal(first.operation.state,'prepared');assert.deepEqual(again.operation,first.operation);
   assert.equal((await child.send({...frame,text:'Different harmless text'},r=>r.event==='error')).errorCategory,'owner_operation_conflict');
   assert.equal((await child.send({command:'admit',operationId:frame.operationId})).operation.state,'admitted');
   assert.equal((await child.send({command:'run',operationId:frame.operationId},r=>r.event==='error')).errorCategory,'owner_model_requests_disabled');
   assert.equal((await child.send({command:'inspect',operationId:frame.operationId})).operation.state,'admitted');
   const stop=await child.send({command:'stop',operationId:frame.operationId});assert.equal(stop.operation.state,'fenced');assert.equal(stop.operation.reservationHeld,false);
   await child.send({command:'close'});child.proc.stdin.end();
  });
  await phase('resume',['--resume'],async child=>{
   const ready=await child.waitFor(r=>r.event==='ready');assert.deepEqual(ready.sessions,sessions);
   assert.equal((await child.send({command:'inspect',operationId:'profile-zero-1'})).operation.state,'fenced');
   assert.equal((await child.send({command:'prepare',operationId:'profile-zero-2',kind:'execution',text:'Harmless fenced generation.'},r=>r.event==='error')).errorCategory,'generation_stopped');
   await child.send({command:'close'});child.proc.stdin.end();
  });
  const result={format:1,passed:true,actualLauncher:installed.dsh,profile:installed.profile,homeDirectory:home,stages,
   realModelRequests:0,modelTools:0,credentialEnvironmentInherited:false,publicHumanAuthorityVerified:false,
   scope:'Actual native CLI/profile/provider factory and empty durable Sessions; paid drive is unmeasured.'};
  await writeFile(join(evidenceDirectory,'result.json'),JSON.stringify(result,null,2)+'\n');return result;
 }catch(error){await writeFile(join(evidenceDirectory,'result.json'),JSON.stringify({format:1,passed:false,homeDirectory:home,stages,errorCategory:error.message})+'\n');throw error;}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};for(let i=2;i<process.argv.length;i+=2)options[process.argv[i]]=process.argv[i+1];
 try{process.stdout.write(JSON.stringify(await verifyOwnerProfile({runtimeDirectory:options['--runtime'],evidenceDirectory:options['--evidence']}))+'\n');}
 catch(error){process.stderr.write(JSON.stringify({passed:false,errorCategory:error.code ?? error.message})+'\n');process.exitCode=1;}
}
