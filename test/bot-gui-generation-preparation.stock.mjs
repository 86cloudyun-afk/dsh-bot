/** Actual Core preparation substrate, keyless synthetic provider; no GUI/browser/model claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {lstat} from 'node:fs/promises';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {scopeOf} from '@deepseek-ai/dsh-scope';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {canonical,digest} from '../src/errors.mjs';
import {SessionCreationDriver} from '../src/session-creation.mjs';
import {generationFixture,route,preset} from './work-generation-fixture.mjs';

async function preparer(){
  const module=await import('../src/bot-gui-generation-preparation.mjs').catch(error=>{
    if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
    return {};
  });
  assert.equal(typeof module.createGuiGenerationPreparation,'function','missing private native journal preparation');
  return module.createGuiGenerationPreparation;
}
test('GUI preparation uses only an actual journal-capable SDK before any native Session or model side effect',async t=>{
  const create=await preparer(),f=await generationFixture(t),intent=f.command('prepareContactSession',{botId:f.bot.botId,cwd:f.directory},f.bot.revision);
  const prepare=create({ownerCtx:f.ctx,host:f.host,homeDirectory:f.directory,cwd:f.directory,agentPreset:preset,
    route:{provider:route.provider,model:route.model,reasoning:'off'},isOwnerCurrent:()=>true,canModelDispatch:()=>false});
  t.after(()=>prepare.close());
  if(typeof f.Native.openOwnedGenerationJournal!=='function'){
    await assert.rejects(()=>prepare.prepare(intent,{role:'main',create:true,mainSessionId:intent.sessionId}),{code:'gui_owned_journal_unsupported'});
    await assert.rejects(lstat(join(f.directory,'owned-generations')),{code:'ENOENT'});
  }else{
    const result=await prepare.prepare(intent,{role:'main',create:true,mainSessionId:intent.sessionId});
    assert.equal(f.Native.isPreparedOwnedGenerationSource(result.prepared,f.ctx,intent.sessionId,'main'),true);
    assert.equal(result.prepared.mode,'create');assert.deepEqual(result.route,{provider:route.provider,model:route.model,maxTokens:2048,reasoningEffort:'off'});
  }
  assert.equal(f.ctx.agents.list().length,0);assert.equal(f.ctx.sessions.list().length,0);assert.equal(f.requests(),0);
  assert.equal(f.ledger.get('creation',intent.operationId).sessionId,intent.sessionId);
  assert.equal(f.ledger.list('ownedMainGeneration').length,0);
});

test('an altered original creation nonce cannot allocate a GUI journal or native preparation',async t=>{
 const create=await preparer(),f=await generationFixture(t),intent=f.command('prepareContactSession',{botId:f.bot.botId,cwd:f.directory},f.bot.revision);
 const prepare=create({ownerCtx:f.ctx,host:f.host,homeDirectory:f.directory,cwd:f.directory,agentPreset:preset,
  route:{provider:route.provider,model:route.model,reasoning:'off'},isOwnerCurrent:()=>true,canModelDispatch:()=>false});
 t.after(()=>prepare.close());assert.equal(typeof intent.nonce,'string');
 await assert.rejects(()=>prepare.prepare({...intent,nonce:'another-creation-nonce'},{role:'main',create:true,mainSessionId:intent.sessionId}),{code:'gui_native_creation_changed'});
 assert.equal(f.ctx.agents.list().length,0);assert.equal(f.requests(),0);
 await assert.rejects(lstat(join(f.directory,'owned-generations')),{code:'ENOENT'});
});

test('the GUI retains the complete original pre-native creation snapshot after the mutable intent is marked created',async t=>{
 const create=await preparer(),f=await generationFixture(t),intent=f.command('prepareContactSession',{botId:f.bot.botId,cwd:f.directory},f.bot.revision);
 const prepare=create({ownerCtx:f.ctx,host:f.host,homeDirectory:f.directory,cwd:f.directory,agentPreset:preset,
  route:{provider:route.provider,model:route.model,reasoning:'off'},isOwnerCurrent:()=>true,canModelDispatch:()=>false});
 t.after(()=>prepare.close());let original,result;
 const port=f.host.adapter.ownedGenerationCreationPort([intent.sessionId],{scopeOf,role:'main',isCurrent:()=>true,
  prepareGeneration:async actual=>{original=actual;result=await prepare.prepare(actual,{role:'main',create:true,mainSessionId:intent.sessionId});return result;}});
 const created=await new SessionCreationDriver({host:f.host,caller:f.caller,port}).run(f.caller,intent.operationId);
 assert.equal(created.state,'created');assert.equal(original.state,'creating');
 assert.deepEqual(result.creationIntent,{binding:original,operationId:original.operationId,nonce:original.nonce});
 assert.equal(Object.isFrozen(result.creationIntent),true);assert.equal(Object.isFrozen(result.creationIntent.binding),true);
 const retained=f.ledger.get('guiNativeCreationOriginal',canonical([intent.botId,intent.sessionId,'main']));
 assert.deepEqual(retained,result.creationIntent);assert.equal(retained.binding.state,'creating');
 assert.equal(f.ledger.get('creation',intent.operationId).state,'created');assert.equal(f.requests(),0);
});

const delegateDefinition=()=>defineTool({name:'dsh_bot_delegate',description:'Synthetic original parent work only',parameters:{},
  output:{schema:{type:'object',additionalProperties:true},render:()=>[]},async execute(){return{};}});
async function parentPreparationFixture(t){
 const create=await preparer(),f=await generationFixture(t),prepare=create({ownerCtx:f.ctx,host:f.host,homeDirectory:f.directory,cwd:f.directory,
  agentPreset:preset,route:{provider:route.provider,model:route.model,reasoning:'off'},isOwnerCurrent:()=>true,canModelDispatch:()=>false});
 t.after(()=>prepare.close());
 const main=f.command('prepareContactSession',{botId:f.bot.botId,cwd:f.directory},f.bot.revision);
 const mainPort=f.host.adapter.ownedGenerationCreationPort([main.sessionId],{scopeOf,role:'main',isCurrent:()=>true,
  prepareGeneration:intent=>prepare.prepare(intent,{role:'main',create:true,mainSessionId:main.sessionId})});
 await new SessionCreationDriver({host:f.host,caller:f.caller,port:mainPort}).run(f.caller,main.operationId);
 const definition=delegateDefinition();let intent,plannedBinding,message,retainedPort;
 const port=f.host.openOwnedWorkSessionPort(f.caller,{botId:f.bot.botId,botEpoch:1,authorityEpoch:1,creation:{cwd:f.directory,
  portFor:original=>retainedPort=f.host.adapter.ownedGenerationCreationPort([original.sessionId],{scopeOf,role:'work',delegateTool:definition,isCurrent:()=>true,
   prepareGeneration:async actual=>{intent=actual;const work=f.ledger.get('workTask',canonical([f.bot.botId,actual.workBinding.task_id]));
    message=createUserMessage({source:{kind:'dsh-bot'},content:[{type:'text',text:'Synthetic parent goal'}]});
    plannedBinding={botId:work.botId,taskId:work.taskId,sessionId:work.sessionId,generation:1,botEpoch:work.botEpoch,taskEpoch:work.taskEpoch,
     taskRevision:work.taskRevision,authorityEpoch:work.authorityEpoch,configVersion:work.configVersion,operationId:'synthetic-original-input',nonce:'synthetic-original-nonce',
     inputMessageId:message.id,messageIdentity:digest(message),slotLease:{taskId:work.taskId,sessionId:work.sessionId,generation:1,operationId:'synthetic-original-input'}};
    const key=canonical([work.botId,work.taskId,1]),generation=f.ledger.get('workGeneration',key);
    // Synthetic private pre-creation reservation. These JSON selectors grant no native capability.
    f.ledger.put('workGeneration',key,{...generation,binding:plannedBinding,slotLease:plannedBinding.slotLease});
    f.ledger.put('workDelivery',key,{sessionId:work.sessionId,generation:1,operationId:plannedBinding.operationId,message});
    return prepare.prepare(actual,{role:'work',create:true,mainSessionId:main.sessionId,delegateTool:definition,plannedBinding});
   }})}});
 t.after(()=>port.dispose());
 const payload={task_id:'synthetic-parent',goal:'Synthetic parent goal',completion_condition:'Keep exact original input and tool'};
 const envelope=(command,payload,revision=null)=>({operationId:crypto.randomUUID(),nonce:crypto.randomUUID(),command,payloadDigest:digest(payload),
  expectedRevision:revision,expectedEpochs:{bot:1,nativeOwner:1,...command==='delegateWorkSession'?{}:{task:1}},authorizationRef:'native-owner',rootHumanInstructionRef:'synthetic-parent-preparation',createdAt:new Date().toISOString(),deadline:null});
 port.delegate(envelope('delegateWorkSession',payload),payload);
 const query=()=>port.query({task_ids:[payload.task_id]}).work[0],target={task_id:payload.task_id,generation:1};
 return{...f,prepare,main,definition,port,query,target,envelope,original:()=>intent,binding:()=>plannedBinding,message:()=>message,nativePort:()=>retainedPort};
}

test('GUI parent preparation binds the full original input before native creation and attaches the same delegate after blank proof',async t=>{
 const f=await parentPreparationFixture(t),created=await f.port.createSession(f.envelope('prepareWorkSessionCreation',f.target,f.query().revision),f.target);
 assert.equal(created.sessionCreation.state,'created','private parent preparation must reach actual native creation');
 const intent=f.original(),definition=f.definition,agent=f.ctx.agents.get(intent.sessionId);
 assert.equal(f.ctx.tools.schemas().length,0);assert.equal(f.ctx.tools.schemas(agent).length,0);
 agent.ctx.tools.register(definition);
 const source=f.host.adapter.bindOwnedWorkGeneration(f.nativePort(),intent,definition);
 assert.equal(f.Native.isOwnedGenerationSource(source,f.ctx),true);
 assert.throws(()=>source.start({...f.binding(),nonce:'changed-original'},f.message()));
 assert.equal(f.requests(),0);assert.equal(f.ledger.get('creation',intent.operationId).state,'created');
 assert.equal(f.binding().inputMessageId,f.message().id);assert.equal(f.binding().messageIdentity,digest(f.message()));
 assert.equal(definition.name,'dsh_bot_delegate');
});

test('GUI refuses a parent tool without a complete original binding before journal or native effects',async t=>{
 const f=await parentPreparationFixture(t),row=f.ledger.get('workTask',canonical([f.bot.botId,f.target.task_id])),payload=f.target;
 // A coordinate-only plan is never sufficient, including when the tool is the genuine same object.
 const incomplete={botId:row.botId,taskId:row.taskId,sessionId:row.sessionId,generation:row.generation,botEpoch:1,taskEpoch:1,taskRevision:1,authorityEpoch:1,configVersion:row.configVersion};
 const intent={operationId:'synthetic-unallocated-creation',sessionId:row.sessionId,kind:'execution',botId:f.bot.botId,botEpoch:1,taskId:row.taskId,taskEpoch:1,taskRevision:1,
  configVersion:row.configVersion,authorizationRef:'native-owner',authorityEpoch:1,rootHumanInstructionRef:'synthetic-parent-refusal',deadline:null,cwd:f.directory,agentPreset:preset,state:'prepared',workBinding:payload};
 f.ledger.put('creation',intent.operationId,intent);
 await assert.rejects(()=>f.prepare.prepare(intent,{role:'work',create:true,mainSessionId:f.main.sessionId,delegateTool:f.definition,plannedBinding:incomplete}),{code:'gui_parent_binding_required'});
 assert.equal(f.ctx.agents.get(row.sessionId),undefined);assert.equal(f.requests(),0);
 await assert.rejects(lstat(join(f.directory,'owned-generations',digest({botId:f.bot.botId,sessionId:row.sessionId,role:'work'}))),{code:'ENOENT'});
});

test('copied parent capabilities and JSON child lineage cannot open a child journal or native Agent',async t=>{
 const f=await parentPreparationFixture(t);
 await f.port.createSession(f.envelope('prepareWorkSessionCreation',f.target,f.query().revision),f.target);
 const original=f.original(),agent=f.ctx.agents.get(original.sessionId);agent.ctx.tools.register(f.definition);
 const source=f.host.adapter.bindOwnedWorkGeneration(f.nativePort(),original,f.definition),parentBinding=f.binding();
 const payload={task_id:'synthetic-child',goal:'Synthetic child descriptor only',completion_condition:'No JSON lineage capability'};
 f.port.delegate(f.envelope('delegateWorkSession',payload),payload);
 const work=f.ledger.get('workTask',canonical([f.bot.botId,payload.task_id]));
 f.ledger.put('workTask',canonical([f.bot.botId,payload.task_id]),{...work,depth:1,parentTaskId:parentBinding.taskId,
  parentSessionId:parentBinding.sessionId,parentGeneration:parentBinding.generation});
 const message=createUserMessage({source:{kind:'dsh-bot'},content:[{type:'text',text:'Synthetic child input'}]}),plannedBinding={...parentBinding,
  taskId:work.taskId,sessionId:work.sessionId,operationId:'synthetic-child-original-input',nonce:'synthetic-child-original-nonce',inputMessageId:message.id,messageIdentity:digest(message),
  slotLease:{taskId:work.taskId,sessionId:work.sessionId,generation:1,operationId:'synthetic-child-original-input'}};
 const childKey=canonical([work.botId,work.taskId,1]);
 f.ledger.put('workGeneration',childKey,{...f.ledger.get('workGeneration',childKey),binding:plannedBinding,slotLease:plannedBinding.slotLease});
 f.ledger.put('workDelivery',childKey,{sessionId:work.sessionId,generation:1,operationId:plannedBinding.operationId,message});
 const intent={operationId:'synthetic-child-creation',sessionId:work.sessionId,kind:'execution',botId:work.botId,botEpoch:work.botEpoch,
  taskId:work.taskId,taskEpoch:work.taskEpoch,taskRevision:work.taskRevision,configVersion:work.configVersion,authorizationRef:'native-owner',authorityEpoch:work.authorityEpoch,
  rootHumanInstructionRef:'synthetic-child-refusal',deadline:null,cwd:f.directory,agentPreset:preset,state:'prepared',workBinding:{task_id:payload.task_id,generation:1},workDepth:1,parentBinding,plannedBinding};
 f.ledger.put('creation',intent.operationId,intent);
 assert.equal(typeof f.prepare.prepareChild,'function','missing private genuine-parent preparation callback');
 await assert.rejects(()=>f.prepare.prepareChild(intent,{create:true,mainSessionId:f.main.sessionId,parentSource:{...source},parentGeneration:{},parentBinding,plannedBinding}),{code:'gui_child_source_required'});
 assert.equal(f.ctx.agents.get(work.sessionId),undefined);assert.equal(f.requests(),0);
 await assert.rejects(lstat(join(f.directory,'owned-generations',digest({botId:f.bot.botId,sessionId:work.sessionId,role:'work'}))),{code:'ENOENT'});
});
test('copied Context, changed native policy and a consumed preparation cannot allocate a replacement Session',async t=>{
  const create=await preparer(),f=await generationFixture(t),intent=f.command('prepareContactSession',{botId:f.bot.botId,cwd:f.directory},f.bot.revision);
  const options={ownerCtx:f.ctx,host:f.host,homeDirectory:f.directory,cwd:f.directory,agentPreset:preset,
    route:{provider:route.provider,model:route.model,reasoning:'off'},isOwnerCurrent:()=>true,canModelDispatch:()=>false};
  assert.throws(()=>create({...options,ownerCtx:{...f.ctx}}),{code:'gui_native_owner_required'});
  const prepare=create(options);t.after(()=>prepare.close());
  await assert.rejects(()=>prepare.prepare({...intent,cwd:'/changed-workspace'},{role:'main',create:true,mainSessionId:intent.sessionId}),{code:'gui_native_creation_changed'});
  const first=prepare.prepare(intent,{role:'main',create:true,mainSessionId:intent.sessionId});
  await first.catch(()=>{});
  await assert.rejects(()=>prepare.prepare(intent,{role:'main',create:true,mainSessionId:intent.sessionId}),{code:'gui_native_preparation_consumed'});
  assert.equal(f.ctx.agents.list().length,0);assert.equal(f.requests(),0);assert.equal(f.ledger.list('creation').length,1);
});
