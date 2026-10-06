import {installSelectedBotContactOwner} from 'dsh-bot/selected-bot-contact-owner';
import {installSelectedBotOwnerPolicy} from 'dsh-bot/selected-bot-owner-policy';
import type {Agent} from '@deepseek-ai/dsh-agent';
declare const binding:Parameters<typeof installSelectedBotOwnerPolicy>[0];
declare const contactAgent:Agent;
const owner=installSelectedBotContactOwner({...binding,contactAgent});owner.dispose();
// @ts-expect-error Browser payload is not an actual Agent or an owner installation.
installSelectedBotContactOwner({selectedBotId:'browser',contactAgent:{id:'fake'}});
const policy=installSelectedBotOwnerPolicy({...binding,actions:{selectedView:async(_payload,checkpoint)=>{checkpoint();return null;}}});
policy.perform(binding.peer,{command:'selectedView',botId:binding.selectedBotId,payload:{}},new AbortController().signal);
// @ts-expect-error Private owner does not expose a policy capability.
owner.perform(binding.peer,{});
