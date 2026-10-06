/** Eight private purposeful admissions; no browser entry, spare round, replay or retry. */
import {requireValue} from './errors.mjs';
export const NATIVE_PHASE_PURPOSES=Object.freeze(['main-A','A-wait','main-status','main-B','B-result','main-B-ACK','A-result','main-A-ACK']);
export function createNativePhaseAdmission(){let failed=false,allowed=null;const attempts=[];
 const fail=()=>{failed=true;allowed=null;};
 return Object.freeze({allow(purpose,agent,validate){try{requireValue(!failed&&!allowed&&attempts.length<8&&purpose===NATIVE_PHASE_PURPOSES[attempts.length]&&agent&&typeof validate==='function','chain_phase_denied');allowed={purpose,agent,validate};}catch{fail();throw Error('chain_phase_denied');}},admit(agent){try{requireValue(!failed&&allowed&&allowed.agent===agent&&allowed.validate()===true,'chain_phase_denied');const purpose=allowed.purpose;allowed=null;attempts.push(Object.freeze({purpose,admittedMs:Date.now()}));return purpose;}catch{fail();throw Error('chain_phase_denied');}},fail,snapshot:()=>Object.freeze({failed,allowedPurpose:allowed?.purpose??null,attempts:Object.freeze([...attempts])})});
}
