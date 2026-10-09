import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

const source=await readFile(new URL('./stock-gui-run.mjs',import.meta.url),'utf8');
const start=source.lastIndexOf('} finally {\n  if (gui) {');
assert.ok(start>0);
const body=source.slice(start+'} finally {'.length,source.lastIndexOf('\n}'));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const finalize=new AsyncFunction('gui','writeFile','join','console','process','finishStockGui',body);
const finish=source.includes('await finishStockGui(gui)')
  ? (await import('./stock-report.mjs')).finishStockGui : undefined;

async function failingTeardown(report) {
  const reports=[];
  const gui={root:'/stock-report-fixture',report,
    async writeReport(){reports.push(structuredClone(this.report));},
    async shutdown(){throw Object.assign(Error('Cleanup failed at https://fixture.invalid/?auth=PRIVATE'),{code:'cleanup_failed'});},
  };
  await finalize(gui,async()=>{},join,{log(){}},{},finish).catch(()=>{});
  return reports;
}

test('a GUI assertion failure remains readable when stock host teardown also fails',async()=>{
  const reports=await failingTeardown({passed:false,stage:'sharing-draft',checks:{firstBot:true},requests:[],error:'Original sharing assertion'});
  assert.ok(reports.length>0,'The original failure report must survive a teardown exception');
  assert.equal(reports.at(-1).passed,false);
  assert.equal(reports.at(-1).error,'Original sharing assertion');
});

test('a stock host teardown failure cannot publish a successful GUI qualification',async()=>{
  const reports=await failingTeardown({passed:true,stage:'complete',checks:{firstBot:true},requests:[]});
  assert.ok(reports.length>0,'A teardown failure must produce a qualification report');
  assert.equal(reports.at(-1).passed,false);
  assert.ok(reports.at(-1).teardownError.includes('cleanup_failed'));
  assert.ok(!JSON.stringify(reports).includes('auth=PRIVATE'));
});
