/** Pure blank-log validation; metadata does not grant any native capability. */
import {requireValue} from './errors.mjs';
const ownData=(value,keys)=>{
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length)return false;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  return keys.every(key=>Object.hasOwn(descriptors,key)&&Object.hasOwn(descriptors[key],'value'));
};
const modeKeys=['permissionPreset','sandboxMode','approvalPolicy'];
const validMode=value=>ownData(value,modeKeys)
  && ['read-only','workspace-write','danger-full-access'].includes(value.permissionPreset)
  && value.sandboxMode===value.permissionPreset
  && value.approvalPolicy===(value.permissionPreset==='danger-full-access'?'never':'ask');

export function freezeInitialSessionMode(value){
  requireValue(validMode(value),'invalid_initial_session_mode');
  return Object.freeze({permissionPreset:value.permissionPreset,sandboxMode:value.sandboxMode,approvalPolicy:value.approvalPolicy});
}

export function isBlankInitialSessionEvents(events,initialization,seq=events?.length){
  try{
    if(!Array.isArray(events)||!Number.isSafeInteger(seq)||seq!==events.length)return false;
    if(initialization===undefined)return events.length===0;
    if(!validMode(initialization)||events.length!==3)return false;
    const expected=[['permission/preset','preset',initialization.permissionPreset],
      ['sandbox/mode','mode',initialization.sandboxMode],['approval/policy','policy',initialization.approvalPolicy]];
    let previousTime=0;
    return events.every((event,index)=>{
      const[type,key,value]=expected[index];
      if(!ownData(event,['type','seq','time','data'])||event.type!==type||event.seq!==index
        ||!Number.isSafeInteger(event.time)||event.time<previousTime||!ownData(event.data,[key])||event.data[key]!==value)return false;
      previousTime=event.time;return true;
    });
  }catch{return false;}
}
