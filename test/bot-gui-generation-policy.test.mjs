/** Private GUI admission policy only; no native capability or provider execution. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Ledger} from '../src/ledger.mjs';
import {canonical,digest} from '../src/errors.mjs';

async function fixture(t,role='work') {
  const module=await import('../src/bot-gui-generation-policy.mjs').catch(error=>{
    if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
    return {};
  });
  assert.equal(typeof module.createGuiGenerationPolicy,'function','missing private GUI generation admission policy');
  const ledger=new Ledger(':memory:');t.after(()=>ledger.close());
  const fixed={botId:'bot',botEpoch:1,configVersion:'ec3c1f15-61c1-4548-96ba-c4fa0cbb7de0',authorityEpoch:1,
    mainSessionId:'main',sessionId:role==='main'?'main':'work',role,ledgerId:'ledger'};
  ledger.put('bot','bot',{botId:'bot',epoch:1,configVersion:fixed.configVersion,contactSessionId:'main',lifecycle:'active'});
  ledger.put('grant','native-owner',{active:true,epoch:1,actor:{kind:'host',id:'ledger'},authority:'private-runtime-owner',scope:'owned-text-sessions'});
  let live=true,enabled=true;
  const policy=module.createGuiGenerationPolicy({ledger,...fixed,isOwnerCurrent:()=>live,canModelDispatch:()=>enabled});
  const work={botId:'bot',botEpoch:1,configVersion:fixed.configVersion,authorityEpoch:1,task_id:'external-work',taskId:'task',
    sessionId:'work',generation:1,taskEpoch:1,taskRevision:1};
  const task={taskId:'task',ownerBotId:'bot',ownerBotEpoch:1,epoch:1,revision:1,stop:{state:'none'},pendingRevision:null};
  ledger.put('workTask',canonical(['bot','external-work']),work);ledger.put('task','task',task);
  const message={id:'work-input',role:'user',content:[{type:'text',text:'Synthetic goal'}],source:{kind:'dsh-bot'}};
  const binding={botId:'bot',taskId:'task',sessionId:'work',generation:1,botEpoch:1,taskEpoch:1,taskRevision:1,
    authorityEpoch:1,configVersion:fixed.configVersion,operationId:'work-original',nonce:'work-nonce',
    inputMessageId:message.id,messageIdentity:digest(message),slotLease:{taskId:'task',sessionId:'work',generation:1,operationId:'work-original'}};
  ledger.put('workGeneration',canonical(['bot','task',1]),{...binding,binding,slotLease:binding.slotLease,fence:null,held:true});
  ledger.put('workDelivery',canonical(['bot','task',1]),{sessionId:'work',generation:1,message,operationId:'work-original'});
  return {ledger,fixed,policy,work,task,message,binding,setLive:value=>{live=value;},setEnabled:value=>{enabled=value;},
    contact(){
      const input={id:'main-input',role:'user',content:[{type:'text',text:'Synthetic main goal'}],source:{kind:'user'}};
      const main={...binding,sessionId:'main',taskId:'contact-original',kind:'contact',operationId:'contact-original',nonce:'contact-nonce',
        inputMessageId:input.id,messageIdentity:digest(input)};delete main.slotLease;
      ledger.put('contactOwnerOperation',canonical(['bot',main.operationId]),{botId:'bot',sessionId:'main',botEpoch:1,authorityEpoch:1,
        configVersion:fixed.configVersion,operationId:main.operationId,nonce:main.nonce,command:'sendContactText',message:input,generationBinding:main,fence:null});
      ledger.put('ownedMainGeneration',canonical(['bot','main',1]),{binding:main,state:'reserved',fence:null});
      ledger.put('ownedMainGenerationCounter',canonical(['bot','main']),{generation:1});return main;
    },
    result(){
      const main={...binding,sessionId:'main',kind:'work-result',operationId:'route-original',nonce:'route-original',
        inputMessageId:'result-input',messageIdentity:'a'.repeat(64),parentWorkBinding:structuredClone(binding)};delete main.slotLease;
      ledger.put('workObservedResponse',main.operationId,{botId:'bot',taskId:'task',sessionId:'work',generation:1,
        resultInputMessageId:main.inputMessageId,generationBinding:main,routing:'sending'});
      ledger.put('ownedMainGeneration',canonical(['bot','main',1]),{binding:main,state:'reserved',fence:null});
      ledger.put('ownedMainGenerationCounter',canonical(['bot','main']),{generation:1});return main;
    }};
}

test('original fenced work authority survives a newer generation while dispatch stays fenced and leaves both leases unchanged',async t=>{
  const f=await fixture(t);assert.equal(f.policy.isCurrent(f.binding),true);assert.equal(f.policy.canDispatch(f.binding),true);
  const key=canonical(['bot','task',1]),original=f.ledger.get('workGeneration',key);
  f.ledger.put('workGeneration',key,{...original,fence:{reason:'terminate',operationId:'stop-original'}});
  f.ledger.put('workTask',canonical(['bot','external-work']),{...f.work,generation:2});
  f.ledger.put('workGeneration',canonical(['bot','task',2]),{generation:2,held:true,fence:null,slotLease:{generation:2,operationId:'new-original'}});
  const before=f.ledger.list('workGeneration');
  assert.equal(f.policy.isCurrent(f.binding),true);assert.equal(f.policy.canDispatch(f.binding),false);
  assert.deepEqual(f.ledger.list('workGeneration'),before);
});

test('owner, authority, Bot configuration and Task changes refuse original work receipt authority',async t=>{
  const f=await fixture(t);
  f.setLive(false);assert.equal(f.policy.isCurrent(f.binding),false);f.setLive(true);
  const grant=f.ledger.get('grant','native-owner');f.ledger.put('grant','native-owner',{...grant,epoch:2});
  assert.equal(f.policy.isCurrent(f.binding),false);f.ledger.put('grant','native-owner',grant);
  const bot=f.ledger.get('bot','bot');f.ledger.put('bot','bot',{...bot,configVersion:'other-config'});
  assert.equal(f.policy.isCurrent(f.binding),false);f.ledger.put('bot','bot',bot);
  f.ledger.put('task','task',{...f.task,revision:2});assert.equal(f.policy.isCurrent(f.binding),false);
});

test('exact original input, generation and slot lease are required; model gate affects dispatch alone',async t=>{
  const f=await fixture(t);
  for(const changed of [{sessionId:'other'},{generation:2},{nonce:'changed'},{inputMessageId:'changed'},
    {messageIdentity:'b'.repeat(64)},{slotLease:{...f.binding.slotLease,operationId:'another'}}]){
    assert.equal(f.policy.isCurrent({...f.binding,...changed}),false);
  }
  f.setEnabled(false);assert.equal(f.policy.isCurrent(f.binding),true);assert.equal(f.policy.canDispatch(f.binding),false);
  f.setEnabled(Promise.resolve(true));assert.equal(f.policy.canDispatch(f.binding),false);
  const delivery=f.ledger.get('workDelivery',canonical(['bot','task',1]));
  f.ledger.put('workDelivery',canonical(['bot','task',1]),{...delivery,message:{...delivery.message,content:[{type:'text',text:'Changed original'}]}});
  assert.equal(f.policy.isCurrent(f.binding),false);
});

test('main contact stop and later main input preserve original receipt authority but cannot dispatch again',async t=>{
  const f=await fixture(t,'main'),binding=f.contact();
  assert.equal(f.policy.isCurrent(binding),true);assert.equal(f.policy.canDispatch(binding),true);
  const key=canonical(['bot','main',1]),row=f.ledger.get('ownedMainGeneration',key);
  f.ledger.put('ownedMainGeneration',key,{...row,fence:{reason:'stop',operationId:'stop-original',nonce:'stop-nonce'}});
  f.ledger.put('ownedMainGenerationCounter',canonical(['bot','main']),{generation:2});
  assert.equal(f.policy.isCurrent(binding),true);assert.equal(f.policy.canDispatch(binding),false);
  const contact=f.ledger.get('contactOwnerOperation',canonical(['bot',binding.operationId]));
  f.ledger.put('contactOwnerOperation',canonical(['bot',binding.operationId]),{...contact,nonce:'changed'});
  assert.equal(f.policy.isCurrent(binding),false);
});

test('main result is bound to the full original work input and cannot dispatch after parent fence or resume',async t=>{
  const f=await fixture(t,'main'),binding=f.result();
  assert.equal(f.policy.isCurrent(binding),true);assert.equal(f.policy.canDispatch(binding),true);
  const key=canonical(['bot','task',1]),row=f.ledger.get('workGeneration',key);
  f.ledger.put('workGeneration',key,{...row,fence:{reason:'terminate',operationId:'parent-stop'}});
  f.ledger.put('workTask',canonical(['bot','external-work']),{...f.work,generation:2});
  assert.equal(f.policy.isCurrent(binding),true);assert.equal(f.policy.canDispatch(binding),false);
  assert.equal(f.policy.isCurrent({...binding,parentWorkBinding:{...binding.parentWorkBinding,nonce:'another-original'}}),false);
  const route=f.ledger.get('workObservedResponse',binding.operationId);
  f.ledger.put('workObservedResponse',binding.operationId,{...route,resultInputMessageId:'another-input'});
  assert.equal(f.policy.isCurrent(binding),false);
});
