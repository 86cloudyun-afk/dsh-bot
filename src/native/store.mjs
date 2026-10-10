import {createHash, randomUUID} from 'node:crypto';

export function fail(code, message = code) {throw Object.assign(new Error(message), {code});}
export function requireCondition(condition, code, message) {if (!condition) fail(code, message);}
export function validId(value) {return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);}
export function plain(value) {return value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));}

/** Reject non-JSON values instead of silently losing them while persisting. */
export function canonical(value, ancestors = new Set()) {
  const parts=[],stack=[{value}];
  while(stack.length) {
    const frame=stack.pop();
    if(frame.literal!==undefined){parts.push(frame.literal);continue;}
    if(frame.close!==undefined){parts.push(frame.close);ancestors.delete(frame.value);continue;}
    const current=frame.value;
    if(current===null||typeof current==='boolean'||typeof current==='string'){parts.push(JSON.stringify(current));continue;}
    if(typeof current==='number'){requireCondition(Number.isFinite(current)&&!Object.is(current,-0),'invalid_json');parts.push(String(current));continue;}
    const array=Array.isArray(current);requireCondition(array||plain(current),'invalid_json');
    requireCondition(!ancestors.has(current),'invalid_json');ancestors.add(current);
    const keys=Reflect.ownKeys(current);
    if(array)requireCondition(keys.length===current.length+1,'invalid_json');
    else requireCondition(keys.every(key=>typeof key==='string'),'invalid_json');
    const ordered=array?Array.from({length:current.length},(_,index)=>String(index)):keys.sort();
    parts.push(array?'[':'{');stack.push({close:array?']':'}',value:current});
    for(let index=ordered.length-1;index>=0;index--) {
      const key=ordered[index],descriptor=Object.getOwnPropertyDescriptor(current,key);
      requireCondition(descriptor&&'value' in descriptor,'invalid_json');
      stack.push({value:descriptor.value});
      if(!array)stack.push({literal:`${JSON.stringify(key)}:`});
      if(index>0)stack.push({literal:','});
    }
  }
  return parts.join('');
}
export const copy = value => JSON.parse(canonical(value));
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const nativeJsonError=(error,code='invalid_json')=>Object.assign(new Error('当前原生 JSON 存储无法编码该内容结构。',{cause:error}),{code,details:{rejectedBeforeWrite:true}});
function nativeJsonEncodingFailure(error) {
  if(!(error instanceof RangeError)||typeof error.stack!=='string')return false;
  const frames=error.stack.split('\n').slice(1).map(line=>line.trim());
  const location='\\(.*[/\\\\]@deepseek-ai[/\\\\]dsh-storage-json[/\\\\]lib[/\\\\]index\\.js:[0-9]+:[0-9]+\\)';
  return frames[0]==='at JSON.stringify (<anonymous>)'&&new RegExp(`^at serialize ${location}$`).test(frames[1]??'')&&new RegExp(`^at SingleJsonUnit\\.publish ${location}$`).test(frames[2]??'')&&new RegExp(`^at SingleJsonUnit\\.putRecord ${location}$`).test(frames[3]??'');
}
/** Check the official JSON KV encoding; its deeper call stack is checked on failure too. */
export function requireNativeJson(value,code='invalid_json') {
  try {JSON.stringify({unit:{name:'dsh_bot_v1',version:1},global:null,tables:{state:{current:value}}},null,2);}
  catch(error){throw nativeJsonError(error,code);}
}
const legacyMaps = ['bots', 'sessions', 'memories', 'grants', 'tasks', 'attempts', 'groups', 'meetings', 'operations', 'outbox'];
const maps = [...legacyMaps, 'materials', 'schedules', 'occurrences', 'notices', 'taskInputs'];
function fresh() {return {schema: 2, storeId: randomUUID(), revision: 0, ...Object.fromEntries(maps.map(key => [key, {}]))};}
function validateEntityFields(state, tables) {
  const identities={bots:'botId',sessions:'sessionId',memories:'memoryId',grants:'grantId',tasks:'taskId',attempts:'attemptId',groups:'groupId',meetings:'meetingId',operations:'operationId',outbox:'outboxId',materials:'docId',schedules:'scheduleId',occurrences:'occurrenceId',notices:'noticeId',taskInputs:'inputId'};
  const references=['botId','ownerBotId','recipientBotId','taskId','attemptId','sessionId','originSessionId','currentAttemptId','parentAttemptId','parentSessionId','resultOutboxId','operationId','runtimeId','ownerRuntimeId','scheduleId','occurrenceId','attemptSessionId','acceptedAttemptId','inputId'];
  const nullable=new Set(['ownerBotId','originSessionId','currentAttemptId','parentAttemptId','parentSessionId','taskId','attemptId','sessionId']);
  const numeric=['revision','version','epoch','definitionVersion','configRevision','taskVersion','memoryRevision','claimVersion','consentVersion','depth'];
  for(const table of tables) for(const [id,row] of Object.entries(state[table])) {
    const identity=identities[table];
    if(Object.hasOwn(row,identity)) requireCondition(row[identity] === id,'malformed_state');
    for(const field of references) if(Object.hasOwn(row,field)) {
      const allowNull=nullable.has(field) || field==='botId' && ['sessions','outbox'].includes(table);
      requireCondition(validId(row[field]) || allowNull && row[field] === null,'malformed_state');
    }
    for(const field of numeric) if(Object.hasOwn(row,field)) requireCondition(Number.isSafeInteger(row[field]) && row[field] >= 0,'malformed_state');
    for(const field of ['state','lifecycle','acceptance']) if(Object.hasOwn(row,field)) requireCondition(typeof row[field] === 'string','malformed_state');
    for(const field of ['archived','reservationHeld']) if(Object.hasOwn(row,field)) requireCondition(typeof row[field] === 'boolean','malformed_state');
  }
}
function validate(state, {legacy = false} = {}) {
  requireCondition(plain(state), 'malformed_state');
  requireCondition(state.schema === (legacy ? 1 : 2), 'unsupported_schema');
  requireCondition(validId(state.storeId) && Number.isSafeInteger(state.revision) && state.revision >= 0, 'malformed_state');
  for (const key of legacy ? legacyMaps : maps) requireCondition(plain(state[key]) && Object.keys(state[key]).every(validId) && Object.values(state[key]).every(plain), 'malformed_state');
  validateEntityFields(state, legacy ? legacyMaps : maps);
  for (const op of Object.values(state.operations)) requireCondition(plain(op) && typeof op.fingerprint === 'string' && Object.hasOwn(op, 'result'), 'malformed_state');
  const scopeValid=scope=>plain(scope) && Object.keys(scope).every(key=>(legacy ? ['sessions','tasks','memories'] : ['sessions','tasks','memories','materials']).includes(key)) &&
    Object.values(scope).every(ids=>Array.isArray(ids) && ids.every(id=>id==='*'||validId(id)));
  for(const grant of Object.values(state.grants))requireCondition(plain(grant) && typeof grant.active==='boolean' && ['read','control'].includes(grant.level) &&
    validId(grant.recipientBotId) && (grant.ownerBotId===null||validId(grant.ownerBotId)) && scopeValid(grant.scope) &&
    Number.isSafeInteger(grant.version) && grant.version>=1 && grant.grantedBy==='human','malformed_state');
  for(const bot of Object.values(state.bots))if(Object.hasOwn(bot,'share'))requireCondition(plain(bot.share) && typeof bot.share.enabled==='boolean' &&
    Array.isArray(bot.share.receivers) && bot.share.receivers.every(id=>id==='*'||validId(id)) && scopeValid(bot.share.scope),'malformed_state');
  for(const task of Object.values(state.tasks))if(Object.hasOwn(task,'createdBy')) {
    const actor=task.createdBy;
    const keys = actor?.kind === 'human' ? ['kind'] : actor?.kind === 'schedule' ? ['kind','occurrenceId','scheduleId'] : ['kind','botId','sessionId'];
    requireCondition(plain(actor) && (legacy ? ['human','bot'] : ['human','bot','schedule']).includes(actor.kind) && Object.keys(actor).every(key=>keys.includes(key)) &&
      (actor.kind === 'human' ? task.source?.kind === 'human' : actor.kind === 'schedule' ? validId(actor.occurrenceId) && validId(actor.scheduleId) && task.source?.kind === 'schedule' && task.source.occurrenceId === actor.occurrenceId && task.source.scheduleId === actor.scheduleId : validId(actor.botId) && validId(actor.sessionId) && task.source?.sessionId === actor.sessionId), 'malformed_state');
  }
  if (!legacy) {
    for (const bot of Object.values(state.bots)) if (Object.hasOwn(bot,'memoryRevision')) requireCondition(Number.isSafeInteger(bot.memoryRevision) && bot.memoryRevision >= 0,'malformed_state');
    for (const memory of Object.values(state.memories)) for (const key of ['pinned','inactive']) if (Object.hasOwn(memory,key)) requireCondition(typeof memory[key] === 'boolean','malformed_state');
    for (const task of Object.values(state.tasks)) {
      if (Object.hasOwn(task,'dependsOn')) requireCondition(Array.isArray(task.dependsOn) && task.dependsOn.every(validId),'malformed_state');
      if (Object.hasOwn(task,'handoffs')) requireCondition(Array.isArray(task.handoffs) && task.handoffs.every(plain),'malformed_state');
    }
    if (Object.hasOwn(state,'migrationBackup')) {
      const backup=state.migrationBackup;
      requireCondition(plain(backup) && Object.keys(backup).sort().join(',') === 'checksum,payload,schema' && backup.schema === 1 && typeof backup.checksum === 'string','malformed_state');
      try {validate(backup.payload,{legacy:true});} catch {requireCondition(false,'malformed_state');}
      requireCondition(backup.checksum === digest(backup.payload) && backup.payload.storeId === state.storeId && backup.payload.revision <= state.revision,'malformed_state');
    }
  }
  canonical(state); return state;
}
function migrate(state) {
  validate(state, {legacy:true});
  const next=copy(state);
  next.schema=2;
  next.migrationBackup={schema:1,checksum:digest(state),payload:copy(state)};
  for (const key of maps.filter(key=>!legacyMaps.includes(key))) next[key]={};
  for (const bot of Object.values(next.bots)) {
    bot.memoryRevision=0;
    bot.share ??= {enabled:true,receivers:['*'],scope:{sessions:['*'],tasks:['*'],memories:['*']}};
    bot.share.scope.materials=[];
  }
  for (const grant of Object.values(next.grants)) grant.scope.materials=[];
  for (const memory of Object.values(next.memories)) {memory.pinned=false;memory.inactive=false;}
  for (const task of Object.values(next.tasks)) {task.dependsOn=[];task.handoffs=[];}
  return validate(next);
}
export class PluginStore {
  #unit; #state; #tail = Promise.resolve(); #closed = false; #broken = false; #listeners = new Set();
  #kvFacet; #descriptor;
  constructor(unit, state, {kvFacet,descriptor}={}) {this.#unit = unit; this.#state = state;this.#kvFacet=kvFacet;this.#descriptor=descriptor;}
  static async open(kvFacet,{namespace='dsh_bot_v1'}={}) {
    requireCondition(typeof namespace==='string'&&/^dsh_bot_v1(?:_[a-f0-9]{24})?$/.test(namespace),'invalid_namespace');
    requireCondition(typeof kvFacet?.open === 'function', 'storage_unavailable');
    const descriptor={name: namespace, version: 1, tables: ['state'], hasGlobal: false, layout: 'single'},unit = await kvFacet.open(copy(descriptor));
    try {
      const data = await unit.loadAll(), table = data.tables.state;
      requireCondition(plain(table) && Object.keys(table).every(key => key === 'current') && data.global === null, 'malformed_state');
      const existing = Object.hasOwn(table, 'current');
      const persisted = existing ? copy(table.current) : null;
      requireCondition(!existing || [1,2].includes(persisted?.schema), 'unsupported_schema');
      const state = !existing ? fresh() : persisted.schema === 1 ? migrate(persisted) : validate(persisted);
      if (!existing || persisted.schema === 1) {requireNativeJson(state);await unit.putRecord('state', 'current', state);}
      return new PluginStore(unit, state,{kvFacet,descriptor});
    } catch (error) {await unit.close(); throw nativeJsonEncodingFailure(error)?nativeJsonError(error):error;}
  }
  read({diagnostic=false}={}) {requireCondition(!this.#broken||diagnostic,'recovery_required');return copy(this.#state);}
  subscribe(listener) {this.#listeners.add(listener); return () => this.#listeners.delete(listener);}
  async #restoreEncodingFailure(error) {
    if(!this.#kvFacet||!nativeJsonEncodingFailure(error))return false;
    let reopened;
    try {
      // rc.2 serializes before writeAtomic, but its synchronous throw leaves
      // putRecord's cache changed. Reopen only through the public KV lifecycle.
      await this.#unit.close();reopened=await this.#kvFacet.open(copy(this.#descriptor));
      const data=await reopened.loadAll(),expected={global:null,tables:{state:{current:this.#state}}};
      requireCondition(canonical(data)===canonical(expected),'recovery_required');
      this.#unit=reopened;return true;
    } catch(recoveryError) {
      error.cause=recoveryError;
      if(reopened)try{await reopened.close();}catch{/* the store remains fenced */}
      return false;
    }
  }
  transact(command, mutate) {
    if (this.#closed) return Promise.reject(Object.assign(Error('插件已关闭'), {code: 'disposed'}));
    const run = async () => {
      requireCondition(!this.#broken, 'recovery_required');
      requireCondition(plain(command) && validId(command.operationId) && typeof command.action === 'string', 'invalid_command');
      const fingerprint = digest(command), previous = Object.hasOwn(this.#state.operations,command.operationId)?this.#state.operations[command.operationId]:undefined;
      if (previous) {requireCondition(previous.fingerprint === fingerprint, 'operation_conflict'); return copy(previous.result);}
      if (command.expectedRevision !== undefined) requireCondition(command.expectedRevision === this.#state.revision, 'revision_conflict');
      requireCondition(mutate.constructor.name !== 'AsyncFunction', 'async_transaction');
      const draft = copy(this.#state), result = mutate(draft);
      requireCondition(!result?.then, 'async_transaction');
      const output = copy(result);
      draft.revision = this.#state.revision + 1;
      draft.operations[command.operationId] = {fingerprint, action: command.action, result: output};
      requireCondition(plain(draft.taskInputs),'malformed_state');
      for (const [inputId,input] of Object.entries(this.#state.taskInputs)) requireCondition(Object.hasOwn(draft.taskInputs,inputId) && canonical(draft.taskInputs[inputId]) === canonical(input),'malformed_state');
      requireCondition(draft.storeId === this.#state.storeId, 'malformed_state');
      requireCondition(canonical(draft.migrationBackup ?? null) === canonical(this.#state.migrationBackup ?? null), 'malformed_state');
      const committed = validate(copy(draft));
      requireNativeJson(committed);
      try {await this.#unit.putRecord('state', 'current', committed);}
      catch (error) {if(await this.#restoreEncodingFailure(error))throw nativeJsonError(error);this.#broken = true; throw error;}
      const previousRevision = this.#state.revision; this.#state = committed;
      for (const listener of this.#listeners) {try {listener(committed.revision, previousRevision);} catch {/* notification cannot undo a durable commit */}}
      return copy(output);
    };
    const result = this.#tail.then(run); this.#tail = result.catch(() => {}); return result;
  }
  async drain() {await this.#tail;}
  async close() {this.#closed = true; await this.#tail; await this.#unit.close(); this.#listeners.clear();}
}
