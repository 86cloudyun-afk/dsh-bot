/** Thin payload preparation for existing submitTask/acceptTask; trusted caller must still pass Host authorization. */
import { createHash } from 'node:crypto';
import { requireValue } from './errors.mjs';
import { explainOperation } from './operation-explanation.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');
function prerequisites(text){
 const lines=text.split(/\r?\n/),items=lines.map(line=>line.match(/^\s*(\d+)[.)]\s*(.*)$/)).filter(Boolean),reasons=[];
 if(/```|~~~/.test(text))return ['guide_code_fence_forbidden'];
 if(lines.some(line=>/[｜|]/.test(line) && !/^\s*\d+[.)]/.test(line)))return ['guide_pipe_header_forbidden'];
 if(items.length!==8 || items.some((item,i)=>Number(item[1])!==i+1))return ['guide_requires_exactly_eight_items'];
 const rows=items.map(item=>item[2].split('｜').map(cell=>cell.trim()));
 if(items.some(item=>item[2].includes('|')))return ['guide_fullwidth_delimiters_required'];
 if(rows.some(row=>row.length!==3 || row.some(cell=>cell.length===0)))return ['guide_requires_complete_columns'];
 const intro=lines.slice(0,lines.findIndex(line=>/^\s*1[.)]/.test(line))).join('\n').trim();
 if(!intro)reasons.push('guide_explanation_missing');
 if(!/dsh\s+--profile\s+dsh-bot-owner\s+--init\b/.test(rows[0][0]))reasons.push('guide_init_requires_launcher_flag');
 if(!/contact/.test(rows[5][0]) || !/独立|independent/i.test(rows[5][1]) || /独立执行会话/.test(rows[5][1]))reasons.push('guide_contact_role_incomplete');
 const stop=rows[6].join(' '),resume=rows[7].join(' ');
 if(!/未发(?:送)?/.test(stop) || !/已发(?:送)?/.test(stop) || !/unknown/.test(stop) || !/预留/.test(stop)
  || !/不证(?:明)?.*远端停止/.test(stop))reasons.push('guide_stop_conditions_incomplete');
 if(!/--resume/.test(resume) || !/原.*ID/.test(resume) || !/不重放|不重发|零重发/.test(resume)
  || !/unknown/.test(resume) || !/预留/.test(resume))reasons.push('guide_unknown_resume_incomplete');
 return reasons;
}
export function guideAcceptancePayloads({task,text,stopReason,automaticVerdict,semanticVerdict,executionEvidence,expectedAuthorityEpoch}){
 requireValue(typeof text==='string' && text.trim().length>0 && Buffer.byteLength(text)<=32768,'invalid_guide_artifact');
 requireValue(typeof task?.taskId==='string' && task.taskId.length>0 && Number.isSafeInteger(task.revision) && task.revision>0
  && Number.isSafeInteger(task.acceptanceVersion) && task.acceptanceVersion>0,'invalid_guide_task');
 requireValue(Number.isSafeInteger(expectedAuthorityEpoch) && expectedAuthorityEpoch>0,'invalid_guide_authority_epoch');
 const artifactDigest=hash(text),structuralReasons=prerequisites(text),bound=semanticVerdict?.artifactDigest===artifactDigest
  && semanticVerdict.acceptanceVersion===task.acceptanceVersion;
 let outcome='inconclusive',reasons=[];
 if(stopReason==='max_tokens')reasons=['output_truncated'];
 else if(structuralReasons.length>0){outcome='failed';reasons=structuralReasons;}
 else if(automaticVerdict==='failed'){outcome='failed';reasons=['automatic_prerequisite_failed'];}
 else if(stopReason!=='end_turn')reasons=['output_completion_unconfirmed'];
 else if(automaticVerdict!=='passed')reasons=['automatic_prerequisite_inconclusive'];
 else if(!bound)reasons=['semantic_review_missing_or_stale'];
 else if(['passed','failed','inconclusive'].includes(semanticVerdict.outcome)){outcome=semanticVerdict.outcome;reasons=outcome==='passed'?[]:['semantic_'+outcome];}
 else reasons=['semantic_review_inconclusive'];
 const content={outcome,reasons},execution=explainOperation(executionEvidence).operation;
 const answers=executionEvidence?.native?executionEvidence.native.answers:executionEvidence?.answers;
 const executionArtifactLinked=execution.operationId!==null && execution.nativeOperationId!==null && Array.isArray(answers)
  && answers.length===1 && typeof answers[0]==='string' && hash(answers[0])===artifactDigest;
 const overallOutcome=outcome==='failed'?'failed':outcome==='passed' && execution.state==='KNOWN_SETTLED'
  && execution.localErrorCategory===null && executionArtifactLinked?'passed':'inconclusive';
 const evidence=JSON.stringify({kind:'guide-content',artifactDigest,acceptanceVersion:task.acceptanceVersion,content,execution,executionArtifactLinked,overallOutcome});
 return {artifactDigest,content,execution,executionArtifactLinked,overallOutcome,
  submitTask:{taskId:task.taskId,artifactDigest,evidence,expectedAuthorityEpoch},
  acceptTask:{taskId:task.taskId,artifactDigest,acceptanceVersion:task.acceptanceVersion,outcome},
  expectedRevisions:{submit:task.revision,accept:task.revision+1}};
}
