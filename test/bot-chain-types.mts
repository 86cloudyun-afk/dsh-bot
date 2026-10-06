import {installOwnedBotProducer,type OwnedBotProducerOptions,type ObservedWorkResponse} from 'dsh-bot/bot-producer';
import {createChainRequestGuard,type ChainRequestSnapshot} from 'dsh-bot/bot-chain-request-guard';
import {installSelectedBotOwnerPolicy} from 'dsh-bot/selected-bot-owner-policy';
import {createUserMessage,type MessageSource} from '@deepseek-ai/dsh-llm';
import type {OwnedWorkSessionPort,CommandEnvelope} from 'dsh-bot/host';
declare const options:OwnedBotProducerOptions;declare const port:OwnedWorkSessionPort;declare const envelope:CommandEnvelope;
const p=installOwnedBotProducer(options);p.execute({task_id:'one',generation:1});p.acknowledged({task_id:'one',generation:1});port.executeMessage(envelope,{task_id:'one',generation:1});
declare const observed:ObservedWorkResponse;
const {resultInputMessageId,...source}=observed;const validSource:MessageSource={kind:'dsh-bot-work-result',task_id:'one',...source};createUserMessage({source:validSource,content:[{type:'text',text:'harmless marker'}]});
const guard=createChainRequestGuard({save:row=>void row});const snapshot:ChainRequestSnapshot=guard.snapshot();guard.dispose();
// @ts-expect-error Guard observations cannot be submitted as native generation receipts.
port.executeMessage(envelope,{task_id:'one',generation:1,usage:snapshot});
// @ts-expect-error Selected Bot owner policy requires actual host and connection types.
installSelectedBotOwnerPolicy({ownerCtx:{},expectedHost:{},connection:{},peer:{},selectedBotId:'one'});
void resultInputMessageId;
