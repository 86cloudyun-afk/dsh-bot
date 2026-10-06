import {Host} from '../src/host.js';
import type {OwnedControlSession,OwnedControlSessionOptions,OwnedControlSessionCreate,OwnedControlSessionSelect,OwnedControlSessionQuery,OwnedControlSessionSummary,OwnedControlSessionChange,OwnedControlSessionState,CommandEnvelope,Receipt,ModelRoute} from '../src/host.js';
declare const host:Host,caller:object,envelope:CommandEnvelope;
const route:ModelRoute={provider:'inert',model:'inert',reasoning:null};
const options:OwnedControlSessionOptions={envelope,payload:{controlSessionId:'synthetic-control'},isCurrent:()=>true};
const port:OwnedControlSession=host.openOwnedControlSession(caller,options);
const create:OwnedControlSessionCreate={controlSessionId:port.controlSessionId,name:'inert',config:{contact:route,execution:route,agentPreset:'opaque/custom'}};
const select:OwnedControlSessionSelect={controlSessionId:port.controlSessionId,botId:'synthetic-bot',expectedBotRevision:1};
const query:OwnedControlSessionQuery={controlSessionId:port.controlSessionId,botIds:['synthetic-bot'],taskIds:[]};
const changed:Receipt<OwnedControlSessionChange>=port.createBot(envelope,create);
port.selectExistingBot(envelope,select);
const summary:OwnedControlSessionSummary=port.query(envelope,query).result;
const state:OwnedControlSessionState=port.dispose(envelope,{controlSessionId:port.controlSessionId}).result;
const opaque:string|null=summary.bot[0]!.config.agentPreset;
void [changed,state,opaque];
// @ts-expect-error A serialized actor is not a Host-issued branded control port.
const fabricated:OwnedControlSession={controlSessionId:'fake',createBot:port.createBot,selectExistingBot:port.selectExistingBot,query:port.query,dispose:port.dispose};
// @ts-expect-error Config metadata does not introduce an executionMode runtime type.
port.createBot(envelope,{...create,config:{contact:route,executionMode:'native'}});
// @ts-expect-error Creation labels cannot substitute for healthy opaque AgentPreset references.
port.createBot(envelope,{...create,config:{contact:route,creationMode:{kind:'custom'}}});
// @ts-expect-error Selecting existing Bots needs an explicit expected Bot revision.
port.selectExistingBot(envelope,{controlSessionId:'c',botId:'b'});
// @ts-expect-error Query requires exact string IDs, never indices.
port.query(envelope,{controlSessionId:'c',botIds:[0],taskIds:[]});
// @ts-expect-error Readonly clients receive no general execute on management port.
port.execute(envelope,{});
// @ts-expect-error Management config reference remains readonly.
summary.bot[0]!.config.agentPreset='changed';
// @ts-expect-error Synchronous management lifetime callback must return a boolean.
host.openOwnedControlSession(caller,{...options,isCurrent:async()=>true});
