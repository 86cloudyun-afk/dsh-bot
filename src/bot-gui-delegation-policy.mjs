/** Descriptive profile choice only. This tuple never conveys native or ToolCall authority. */
import {requireValue} from './errors.mjs';
export const GUI_DELEGATION_POLICY=Object.freeze({parentWorkTools:'delegate',childWorkTools:'none',maxDepth:1,workLimit:15});
export function freezeGuiDelegationPolicy(value=GUI_DELEGATION_POLICY){
  const keys=Object.keys(GUI_DELEGATION_POLICY);
  requireValue(value&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===keys.length
    &&keys.every(key=>Object.hasOwn(value,key)&&value[key]===GUI_DELEGATION_POLICY[key]),'gui_delegation_policy_required');
  return Object.freeze({...GUI_DELEGATION_POLICY});
}
