import {createHash} from 'node:crypto';
import {appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {inspect} from 'node:util';

const names=new Set(['Error','TypeError','RangeError','SyntaxError','AssertionError','AggregateError']);
const codes=new Set(['ENOENT','EACCES','EPERM','EIO','ENOSPC','EMFILE','ENFILE','ERR_ASSERTION','ERR_INVALID_ARG_TYPE','ERR_INVALID_ARG_VALUE']);

/** Public qualification errors contain no message, stack, command or output. */
export function publicStockError(error) {
  // Keep the first already-projected failure stable across finalization.
  if(error&&typeof error==='object'&&names.has(error.type)&&/^[a-f\d]{64}$/.test(error.messageHash??'')) {
    return {type:error.type,messageHash:error.messageHash,...(codes.has(error.code)?{code:error.code}:{})};
  }
  return {type:names.has(error?.name)?error.name:'Error',messageHash:createHash('sha256').update(String(error?.message??error??'')).digest('hex'),...(codes.has(error?.code)?{code:error.code}:{})};
}

export async function recordStockError(report,error,{evidence,field='error'}={}) {
  report[field]=publicStockError(report[field]??error);
  if(evidence) {
    try {
      await appendFile(join(evidence,'stock-error-private.log'),`${inspect(error,{showHidden:true,depth:6,maxArrayLength:null,maxStringLength:null})}\n`,{mode:0o600});
    } catch(logError) {
      report.privateLogError??=publicStockError(logError);
    }
  }
}

async function sanitizeStockErrors(gui) {
  for(const field of ['error','teardownError','privateLogError'])if(gui.report[field]!==undefined)gui.report[field]=publicStockError(gui.report[field]);
  if(Array.isArray(gui.report.browserErrors)) {
    const projected=[];
    for(const row of gui.report.browserErrors) {
      const error=row?.message!==undefined?Error(String(row.message)):row;
      const temporary={};await recordStockError(temporary,error,{evidence:gui.evidence});
      if(temporary.privateLogError)gui.report.privateLogError??=temporary.privateLogError;
      projected.push({...temporary.error,...(/^[a-z\d-]{1,100}$/.test(row?.stage??'')?{stage:row.stage}:{})});
    }
    gui.report.browserErrors=projected;
  }
}

/** Preserve partial evidence and failure status even if host cleanup fails. */
export async function finishStockGui(gui) {
  const testsPassed=gui.report.passed===true;
  Object.assign(gui.report,{testsPassed,passed:false,teardownComplete:false});
  await sanitizeStockErrors(gui);
  await gui.writeReport();
  try {
    await gui.shutdown();
    gui.report.teardownComplete=true;
    gui.report.passed=testsPassed;
  } catch(error) {
    await recordStockError(gui.report,error,{evidence:gui.evidence,field:'teardownError'});
    gui.report.error??=gui.report.teardownError;
  }
  await gui.writeReport();
  return gui.report.passed;
}
