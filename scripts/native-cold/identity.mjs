// No imports or ambient IO. The companion supplies already-scoped Node APIs;
// pure V8 tests supply only in-memory fakes. Inventory is diagnostic, never an allowlist.
export const MAX_NATIVE_ID_BYTES=2097152;
export const MAX_NATIVE_ATTEMPTS=16;

export function createNativeAttemptRecorder({fs,path,source,root,target,targetSHA,inventory,state,guardOnly,allocate,hashBytes,save,refuse,abort,terminateAdmission}){
 const byPath=new Map(inventory.map(row=>[source+'/node_modules/'+row.packageRelativeSDKFile,row]));
 const byHash=new Map(inventory.map(row=>[row.sha256,row]));
 if(typeof terminateAdmission!=='function')throw Object.assign(new Error('IMMEDIATE_NATIVE_EXIT_UNAVAILABLE'),{code:'IMMEDIATE_NATIVE_EXIT_UNAVAILABLE'});
 let loadReserved=false,loadBlocked=false,firstDenialReason;
 const unknown=(reason,scope='UNKNOWN')=>Object.freeze({scope,contentSHA256:null,packageIdentity:'UNKNOWN',payloadIdentity:'UNKNOWN',pathRelation:'UNKNOWN',isPathAlias:null,unknownReason:reason});
 const within=(filename,base)=>filename.startsWith(base+'/');
 function identify(filename){
  if(typeof filename!=='string'||filename.length>4096||filename.includes('\0')||!path.isAbsolute(filename))return unknown('INVALID_FILENAME');
  if(filename.split('/').includes('..'))return unknown('PATH_TRAVERSAL');
  const normalized=path.resolve(filename);
  let base,scope;
  if(within(filename,source)&&within(normalized,source)){
   if(!byPath.has(normalized))return unknown('NOT_IN_SOURCE_INVENTORY');
   if(guardOnly)return unknown('SOURCE_READ_NOT_GRANTED');
   base=source;scope='KNOWN_SOURCE';
  }else if(within(filename,root)&&within(normalized,root)){
   base=root;scope='OWNED_ROOT';
  }else return unknown('OUT_OF_SCOPE');
  if(!filename.endsWith('.node'))return unknown('INVALID_EXTENSION',scope);
  const parts=normalized.slice(base.length+1).split('/');
  if(parts.length>32)return unknown('PATH_COMPONENT_LIMIT',scope);
  let fd,result=unknown('UNREADABLE',scope);
  try{
   const baseInfo=fs.lstatSync(base);
   if(baseInfo.isSymbolicLink())return unknown('SYMLINK_COMPONENT',scope);
   if(!baseInfo.isDirectory())return unknown('NOT_DIRECTORY',scope);
   let current=base,initial;
   for(let i=0;i<parts.length;i++){
    current+='/'+parts[i];const info=fs.lstatSync(current);
    if(info.isSymbolicLink())return unknown('SYMLINK_COMPONENT',scope);
    if(i<parts.length-1){if(!info.isDirectory())return unknown('NOT_DIRECTORY',scope);}
    else initial=info;
   }
   if(!initial.isFile())return unknown('NOT_REGULAR',scope);
   if(fs.realpathSync(normalized)!==normalized)return unknown('CANONICAL_PATH_CHANGED',scope);
   if(!Number.isSafeInteger(initial.size)||initial.size<0)return unknown('INVALID_METADATA',scope);
   if(initial.size>MAX_NATIVE_ID_BYTES)return unknown('FILE_TOO_LARGE',scope);
   const flags=fs.constants;
   if(!Number.isInteger(flags?.O_NOFOLLOW)||!Number.isInteger(flags?.O_NONBLOCK))return unknown('READ_INTERFACE_UNAVAILABLE',scope);
   fd=fs.openSync(normalized,flags.O_RDONLY|flags.O_NOFOLLOW|flags.O_NONBLOCK);
   const before=fs.fstatSync(fd);
   const same=(a,b)=>a.isFile()&&b.isFile()&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
   if(!same(initial,before))result=unknown('FILE_CHANGED',scope);
   else{
    const bytes=allocate(initial.size);let offset=0,operations=0,complete=true;
    while(offset<bytes.length){
     // Reserve the last of 64 reads for the EOF check.
     if(++operations>63){complete=false;break;}
     const count=fs.readSync(fd,bytes,offset,Math.min(65536,bytes.length-offset),null);
     if(!Number.isInteger(count)||count<=0||count>Math.min(65536,bytes.length-offset)){complete=false;break;}
     offset+=count;
    }
    const extra=allocate(1);
    if(!complete||fs.readSync(fd,extra,0,1,null)!==0||!same(before,fs.fstatSync(fd)))result=unknown('FILE_CHANGED',scope);
    else{
     const digest=hashBytes(bytes);
     if(typeof digest!=='string'||!/^[0-9a-f]{64}$/.test(digest))result=unknown('INVALID_METADATA',scope);
     else{
      const known=byHash.get(digest),relation=normalized===target?(filename===target?'EXACT_ALLOWED_PATH':'ALLOWED_PATH_ALIAS'):'OTHER_FILE';
      result=Object.freeze({scope,contentSHA256:digest,packageIdentity:known?known.package:'UNKNOWN',payloadIdentity:known?known.payloadIdentity:'UNKNOWN',pathRelation:relation,isPathAlias:relation==='ALLOWED_PATH_ALIAS',unknownReason:known?'NONE':'UNKNOWN_HASH'});
     }
    }
   }
  }catch{result=unknown('UNREADABLE',scope);}
  finally{if(fd!==undefined){try{fs.closeSync(fd);}catch{result=unknown('CLOSE_FAILED',scope);}}}
  return result;
 }
 return Object.freeze({identify});
}
