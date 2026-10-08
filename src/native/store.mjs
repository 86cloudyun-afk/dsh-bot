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
    requireCondition(Object.keys(value).length === value.length, 'invalid_json');
    result = `[${value.map(item => canonical(item, ancestors)).join(',')}]`;
  } else {
    const keys = Reflect.ownKeys(value); requireCondition(keys.every(key => typeof key === 'string'), 'invalid_json');
    result = `{${keys.sort().map(key => {const d = Object.getOwnPropertyDescriptor(value, key); requireCondition(d && 'value' in d, 'invalid_json'); return `${JSON.stringify(key)}:${canonical(d.value, ancestors)}`;}).join(',')}}`;
  }
  ancestors.delete(value); return result;
}
export const copy = value => JSON.parse(canonical(value));
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const maps = ['bots', 'sessions', 'memories', 'grants', 'tasks', 'attempts', 'groups', 'meetings', 'operations', 'outbox'];
function fresh() {return {schema: 1, storeId: randomUUID(), revision: 0, ...Object.fromEntries(maps.map(key => [key, {}]))};}
function validate(state) {
  requireCondition(plain(state), 'malformed_state');
  requireCondition(state.schema === 1, 'unsupported_schema');
  requireCondition(validId(state.storeId) && Number.isSafeInteger(state.revision) && state.revision >= 0, 'malformed_state');
  for (const key of maps) requireCondition(plain(state[key]) && Object.keys(state[key]).every(validId), 'malformed_state');
  for (const op of Object.values(state.operations)) requireCondition(plain(op) && typeof op.fingerprint === 'string' && Object.hasOwn(op, 'result'), 'malformed_state');
  canonical(state); return state;
}
export class PluginStore {
  #unit; #state; #tail = Promise.resolve(); #closed = false; #broken = false; #listeners = new Set();
  constructor(unit, state) {this.#unit = unit; this.#state = state;}
  static async open(kvFacet) {
    requireCondition(typeof kvFacet?.open === 'function', 'storage_unavailable');
    const unit = await kvFacet.open({name: 'dsh_bot_v1', version: 1, tables: ['state'], hasGlobal: false, layout: 'single'});
    try {
      const data = await unit.loadAll(), table = data.tables.state;
      requireCondition(plain(table) && Object.keys(table).every(key => key === 'current') && data.global === null, 'malformed_state');
      const existing = Object.hasOwn(table, 'current');
      const state = existing ? validate(copy(table.current)) : fresh();
      if (!existing) await unit.putRecord('state', 'current', state);
      return new PluginStore(unit, state);
    } catch (error) {await unit.close(); throw error;}
  }
  read() {return copy(this.#state);}
  subscribe(listener) {this.#listeners.add(listener); return () => this.#listeners.delete(listener);}
  transact(command, mutate) {
    if (this.#closed) return Promise.reject(Object.assign(Error('插件已关闭'), {code: 'disposed'}));
    const run = async () => {
      requireCondition(!this.#broken, 'recovery_required');
      requireCondition(plain(command) && validId(command.operationId) && typeof command.action === 'string', 'invalid_command');
      const fingerprint = digest(command), previous = this.#state.operations[command.operationId];
      if (previous) {requireCondition(previous.fingerprint === fingerprint, 'operation_conflict'); return copy(previous.result);}
      if (command.expectedRevision !== undefined) requireCondition(command.expectedRevision === this.#state.revision, 'revision_conflict');
      requireCondition(mutate.constructor.name !== 'AsyncFunction', 'async_transaction');
      const draft = copy(this.#state), result = mutate(draft);
      requireCondition(!result?.then, 'async_transaction');
      const output = copy(result);
      draft.revision = this.#state.revision + 1;
      draft.operations[command.operationId] = {fingerprint, action: command.action, result: output};
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
