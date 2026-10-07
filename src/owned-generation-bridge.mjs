/** Private owner bridge. Availability or copied JSON never conveys native authority. */
import {requireValue} from './errors.mjs';

let sdkPromise;
export async function loadOwnedGenerationSdk() {
 sdkPromise??=import('@deepseek-ai/dsh-experimental-native-run').catch(()=>null);
 const sdk=await sdkPromise;
 requireValue(sdk&&['prepareOwnedGenerationSource','isPreparedOwnedGenerationSource','isOwnedGenerationSource','isOwnedGenerationReceipt'].every(name=>typeof sdk[name]==='function'),'unsupported_owned_generation_sdk');
 return sdk;
}

export const unknownGenerationObservation=()=>({local:'unknown',remote:'UNKNOWN',usageKnown:false,usage:null,settlementVerified:false});
