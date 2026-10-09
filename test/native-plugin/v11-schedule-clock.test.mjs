import test from 'node:test';
import assert from 'node:assert/strict';
const mod = await import('../../src/native/schedule-clock.mjs').catch(()=>({}));
function api(){assert.equal(typeof mod.normalizeScheduleRule,'function','pure schedule clock is missing');return mod;}
test('interval UTC sequence is bounded, validates minimum, and handles rollback',()=>{
 const {normalizeScheduleRule,nextTrigger,latestTrigger}=api();
 assert.throws(()=>normalizeScheduleRule({kind:'interval',timezone:'UTC',anchorAt:'2026-01-01T00:00:00Z',everyMinutes:14}),{code:'invalid_schedule_rule'});
 assert.throws(()=>normalizeScheduleRule({kind:'daily',timezone:'Invalid/Zone',time:'12:00'}),{code:'invalid_timezone'});
 const rule=normalizeScheduleRule({kind:'interval',timezone:'Asia/Shanghai',anchorAt:'2026-01-01T00:00:00Z',everyMinutes:15});
 assert.equal(nextTrigger(rule,'2026-01-01T00:01:00Z').dueAt,'2026-01-01T00:15:00.000Z');
 assert.equal(latestTrigger(rule,'2036-01-01T00:01:00Z').dueAt,'2036-01-01T00:00:00.000Z');
 assert.equal(nextTrigger(rule,'2026-01-01T00:15:00Z').dueAt,'2026-01-01T00:30:00.000Z');
});
test('daily DST gap skips, overlap selects earlier UTC, weekly retains local weekday',()=>{
 const {normalizeScheduleRule,nextTrigger,latestTrigger}=api();
 const gap=normalizeScheduleRule({kind:'daily',timezone:'America/New_York',time:'02:30',startDate:'2026-03-07'});
 assert.equal(nextTrigger(gap,'2026-03-07T08:00:00Z').dueAt,'2026-03-09T06:30:00.000Z');
 const overlap=normalizeScheduleRule({kind:'daily',timezone:'America/New_York',time:'01:30',startDate:'2026-10-31'});
 assert.equal(nextTrigger(overlap,'2026-10-31T08:00:00Z').dueAt,'2026-11-01T05:30:00.000Z');
 assert.equal(latestTrigger(overlap,'2026-11-01T06:45:00Z').dueAt,'2026-11-01T05:30:00.000Z');
 const week=normalizeScheduleRule({kind:'weekly',timezone:'Asia/Shanghai',time:'09:00',weekdays:[1],startDate:'2026-10-01'});
 assert.equal(nextTrigger(week,'2026-10-04T23:00:00Z').dueAt,'2026-10-05T01:00:00.000Z');
});
test('once uses a validated local date and does not replace missing DST identity',()=>{
 const {normalizeScheduleRule,nextTrigger,latestTrigger}=api();
 const once=normalizeScheduleRule({kind:'once',timezone:'Asia/Shanghai',date:'2026-10-09',time:'09:00'});
 assert.equal(nextTrigger(once,'2026-10-08T00:00:00Z').dueAt,'2026-10-09T01:00:00.000Z');
 assert.equal(nextTrigger(once,'2026-10-09T01:00:00Z'),null);
 assert.equal(latestTrigger(once,'2026-10-10T00:00:00Z').dueAt,'2026-10-09T01:00:00.000Z');
 assert.throws(()=>normalizeScheduleRule({kind:'once',timezone:'UTC',date:'2026-02-30',time:'09:00'}),{code:'invalid_schedule_rule'});
 assert.throws(()=>normalizeScheduleRule({kind:'once',timezone:'America/New_York',date:'2026-03-08',time:'02:30'}),{code:'nonexistent_local_time'});
});
