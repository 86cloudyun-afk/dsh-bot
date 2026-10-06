/** Display names never replace identities; JSON values avoid collisions with UI sentinels. */
export function createModeControl(node,catalog,{update=false}={}) {
 const control=node('select');control.name='agentPreset';
 const usable=catalog?.status==='available' && Array.isArray(catalog.options) && catalog.options.length>0;
 control.disabled=!usable;
 const choices=[...update?[['keep','保留当前模式']]:[],['null','新会话使用宿主默认']];
 if(usable)for(const row of catalog.options)choices.push([JSON.stringify(row.id),`${row.name ?? row.id} · ${row.id}`]);
 for(const [value,label] of choices){const option=node('option',label);option.value=value;control.append(option);}
 return control;
}

/** Disabled controls and preserve choices omit the field; explicit null resets future selection. */
export function modeConfigField(value) {
 if(value===null || value===undefined || value==='keep')return {};
 const id=JSON.parse(value);
 if(id!==null && !(typeof id==='string' && id.trim().length>0 && id.length<=200))throw Error('模式选项无效，请刷新');
 return {agentPreset:id};
}
