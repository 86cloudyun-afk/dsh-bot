import test from 'node:test';
import assert from 'node:assert/strict';
import {projectOwnedGenerationEvents} from '../src/owned-generation-input-window.mjs';
test('copied runtime-context window cannot omit a second input or delegate prefix',()=>{
 const window={sessionId:'session-lookalike',inputMessageId:'original',startSeq:0,endSeq:3,runtimeContexts:[{seq:1,messageId:'another-input',messageDigest:'claimed'}],runtimeContextMessageIds:['another-input']},events=[{seq:0,type:'user/message',data:{id:'original'}},{seq:1,type:'user/message',data:{id:'another-input',source:{kind:'runtime-context'}}}];
 assert.throws(()=>projectOwnedGenerationEvents(window,events),e=>e.code==='owned_input_window_required');assert.throws(()=>projectOwnedGenerationEvents({...window},events,{delegate:true}),e=>e.code==='owned_input_window_required');
});
