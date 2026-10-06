import { requireValue,text } from './errors.mjs';

/** Validate an opaque identity without changing its bytes. */
export function presetId(value) {
 requireValue(typeof value==='string' && value.trim().length>0 && value.length<=200,'invalid_agent_preset');
 return value;
}

/** Empty metadata conveys no native capability or default assumption. */
export function emptyPresetCatalog(reason='Native AgentPreset registry unavailable',status='unsupported') {
 return Object.freeze({domain:'agentPreset',status,defaultId:null,options:Object.freeze([]),reason});
}

/** Copy only public display metadata from the trusted registry's direct list API. */
export function normalizePresetCatalog(rows,defaultId) {
 requireValue(Array.isArray(rows),'invalid_mode_catalog');
 if(defaultId!==undefined && defaultId!==null)presetId(defaultId);
 const seen=new Set(),options=[];
 for(const row of rows) {
  requireValue(row && typeof row==='object' && !Array.isArray(row),'invalid_mode_catalog');
  const id=presetId(row.id);requireValue(!seen.has(id),'invalid_mode_catalog');seen.add(id);
  requireValue(row.name===undefined || (typeof row.name==='string' && row.name.length<=200),'invalid_mode_catalog');
  requireValue(row.description===undefined || (typeof row.description==='string' && row.description.length<=2000),'invalid_mode_catalog');
  if(row.broken!==undefined)continue;
  options.push(Object.freeze({id,...row.name===undefined?{}:{name:row.name},...row.description===undefined?{}:{description:row.description},isDefault:id===defaultId}));
 }
 return Object.freeze({domain:'agentPreset',status:'available',defaultId:options.find(row=>row.isDefault)?.id ?? null,options:Object.freeze(options)});
}

/** A healthy cached choice is metadata, never an execution capability. */
export function requireHealthyPreset(catalog,value) {
 const id=presetId(value);
 requireValue(catalog?.domain==='agentPreset' && catalog.status==='available' && Array.isArray(catalog.options),'unsupported_session_mode','Healthy loaded AgentPreset metadata required');
 requireValue(catalog.options.some(row=>row.id===id),'agent-preset/not-found','Requested AgentPreset is missing or broken');
 return id;
}

function blockedRequest(operation,request) {
 return Object.freeze({status:'blocked',operation,request:Object.freeze(request),blockers:Object.freeze(['unsupported_host_identity','unsupported_native_admission'])});
}

/** Describe the exact future create request; this does not create or wake anything. */
export function prepareSessionCreate({cwd,agentPreset=null},catalog) {
 text(cwd,'cwd');
 requireValue(catalog?.domain==='agentPreset' && catalog.status==='available','unsupported_session_mode');
 const id=agentPreset ?? catalog.defaultId;
 requireValue(id!==null && id!==undefined,'agent-preset/not-found','No healthy default AgentPreset');
 return blockedRequest('session.create',{cwd,agentPreset:requireHealthyPreset(catalog,id)});
}

/** Accept only the explicit client/offline projection DTO, never a header or raw wire. */
export function readSessionAgentPreset(summary) {
 const values=summary?.projectionValues;
 requireValue(values && Object.hasOwn(values,'agentPreset') && (values.agentPreset===null || typeof values.agentPreset==='string'),'mode_projection_unavailable');
 return values.agentPreset===null?null:presetId(values.agentPreset);
}

/** Describe a blank selection; real native select and durable confirmation remain absent. */
export function prepareBlankPresetSelection(summary,id,catalog) {
 readSessionAgentPreset(summary);text(summary.id,'sessionId',200);
 requireValue(summary.blank===true,'agent-preset/locked','This session has already started',{sessionId:summary.id,agentPreset:id});
 return blockedRequest('agentPresets.select',{sessionId:summary.id,agentPreset:requireHealthyPreset(catalog,id)});
}
