import {createHash, randomUUID} from 'node:crypto';

export function fail(code, message = code) {throw Object.assign(new Error(message), {code});}
export function requireCondition(condition, code, message) {if (!condition) fail(code, message);}
export function validId(value) {return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);}
export function plain(value) {return value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));}

/** Reject non-JSON values instead of silently losing them while persisting. */
export function canonical(value, ancestors = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {requireCondition(Number.isFinite(value) && !Object.is(value, -0), 'invalid_json'); return String(value);}
  requireCondition(Array.isArray(value) || plain(value), 'invalid_json');
  requireCondition(!ancestors.has(value), 'invalid_json'); ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    requireCondition(Reflect.ownKeys(value).length === value.length + 1, 'invalid_json');
    const values=[];
    for(let index=0;index<value.length;index++) {
      const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
      requireCondition(descriptor && 'value' in descriptor,'invalid_json');values.push(canonical(descriptor.value,ancestors));
    }
    result = `[${values.join(',')}]`;
  } else {
    const keys = Reflect.ownKeys(value); requireCondition(keys.every(key => typeof key === 'string'), 'invalid_json');
    result = `{${keys.sort().map(key => {const d = Object.getOwnPropertyDescriptor(value, key); requireCondition(d && 'value' in d, 'invalid_json'); return `${JSON.stringify(key)}:${canonical(d.value, ancestors)}`;}).join(',')}}`;
  }
  ancestors.delete(value); return result;
}
export const copy = value => JSON.parse(canonical(value));
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
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
  constructor(unit, state) {this.#unit = unit; this.#state = state;}
  static async open(kvFacet,{namespace='dsh_bot_v1'}={}) {
    requireCondition(typeof namespace==='string'&&/^dsh_bot_v1(?:_[a-f0-9]{24})?$/.test(namespace),'invalid_namespace');
    requireCondition(typeof kvFacet?.open === 'function', 'storage_unavailable');
    const unit = await kvFacet.open({name: namespace, version: 1, tables: ['state'], hasGlobal: false, layout: 'single'});
    try {
      const data = await unit.loadAll(), table = data.tables.state;
      requireCondition(plain(table) && Object.keys(table).every(key => key === 'current') && data.global === null, 'malformed_state');
      const existing = Object.hasOwn(table, 'current');
      const persisted = existing ? copy(table.current) : null;
      requireCondition(!existing || [1,2].includes(persisted?.schema), 'unsupported_schema');
      const state = !existing ? fresh() : persisted.schema === 1 ? migrate(persisted) : validate(persisted);
      if (!existing || persisted.schema === 1) await unit.putRecord('state', 'current', state);
      return new PluginStore(unit, state);
    } catch (error) {await unit.close(); throw error;}
  }
  read({diagnostic=false}={}) {requireCondition(!this.#broken||diagnostic,'recovery_required');return copy(this.#state);}
  subscribe(listener) {this.#listeners.add(listener); return () => this.#listeners.delete(listener);}
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
      try {await this.#unit.putRecord('state', 'current', committed);}
      catch (error) {this.#broken = true; throw error;}
      const previousRevision = this.#state.revision; this.#state = committed;
      for (const listener of this.#listeners) {try {listener(committed.revision, previousRevision);} catch {/* notification cannot undo a durable commit */}}
      return copy(output);
    };
    const result = this.#tail.then(run); this.#tail = result.catch(() => {}); return result;
  }
  async drain() {await this.#tail;}
  async close() {this.#closed = true; await this.#tail; await this.#unit.close(); this.#listeners.clear();}
}
