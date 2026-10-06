import {installOwnedBotProducer,type OwnedBotProducer,type BotProducerMessage,type OwnedBotProducerOptions} from 'dsh-bot/bot-producer';
import type {OwnedWorkSessionOptions,OwnedWorkSessionPort,WorkSessionCreation,CommandEnvelope} from 'dsh-bot/host';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import type {MessageSource} from '@deepseek-ai/dsh-llm';
declare const options:OwnedBotProducerOptions;
const producer:OwnedBotProducer=installOwnedBotProducer(options);
producer.delegate({operationId:'op',nonce:'nonce',task_id:'t',goal:'g',completion_condition:'c'});
producer.queue({task_id:'t',generation:1});
const source:BotProducerMessage['source']={kind:'dsh-bot',producerId:'p',ingress:'bot-tool',originSessionId:'o',callId:'c',rootCallId:'c',botId:'b',taskId:'t',sessionId:'s',generation:1,operationId:'op'};
const allowed:MessageSource=source;
createUserMessage({source:allowed,content:[{type:'text',text:'harmless'}]});
// @ts-expect-error Human source is not a Bot producer source.
const falseSource:BotProducerMessage['source']={kind:'user'};
// @ts-expect-error Caller fields cannot select source or Bot.
producer.delegate({operationId:'op',nonce:'n',task_id:'t',goal:'g',completion_condition:'c',source});
// @ts-expect-error Fabricated capabilities lack the private brand.
const fake:OwnedBotProducer={delegate:producer.delegate,query:producer.query,queue:producer.queue,dispose:producer.dispose};
declare const port:OwnedWorkSessionPort;declare const envelope:CommandEnvelope;
// @ts-expect-error Queue does not accept caller receipts.
port.queueMessage(envelope, {task_id:'t',generation:1}, {state:'durably-queued'});
declare const creation:WorkSessionCreation;
if(creation.state==='created'){const id:string=creation.sessionId;const proof:'stock-session-durable'|'fixture-contract'=creation.proofKind;void[id,proof];}
declare const c:OwnedWorkSessionOptions;
// @ts-expect-error A factory cannot return an asynchronous capability.
const asyncFactory:OwnedWorkSessionOptions={...c,creation:{cwd:'/tmp',portFor:async()=>({})}};
void[falseSource,fake,asyncFactory];
