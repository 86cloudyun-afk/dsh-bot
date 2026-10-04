import { mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Ledger } from '../src/ledger.mjs';
import { Host } from '../src/host.mjs';
import { digest } from '../src/errors.mjs';
export const human = Object.freeze({kind:'human', id:'human-1'});
export function fixture(adapter) {
  const dir = mkdtempSync(resolve(process.env.DSH_BOT_TEST_ROOT, 'case-'));
  const path = resolve(dir,'ledger.sqlite');
  const ledger = new Ledger(path);
  const host = new Host({ledger, ownerHumanId:human.id, adapter});
  const cmd = (name,payload={},expectedRevision=null, expectedEpochs={}) => {
    const envelope={operationId:randomUUID(),nonce:randomUUID(),command:name,payloadDigest:digest(payload),expectedRevision,expectedEpochs,rootHumanInstructionRef:'test-human-input',authorizationRef:'root',createdAt:new Date().toISOString(),deadline:null};
    return host.execute(human,envelope,payload);
  };
  return {dir,path,ledger,host,cmd};
}
export function createBot(f,name='A') { return f.cmd('createBot',{name,config:{contact:{provider:'synthetic',model:'model-A',reasoning:'high'},execution:{provider:'synthetic',model:'model-A',reasoning:'high'}}}).result; }
export function createTask(f,bot) { return f.cmd('createTask',{ownerBotId:bot.botId,title:'Synthetic task',scope:{namespace:'P',writeResources:[]},acceptance:'Human checks artifact digest'}).result; }
