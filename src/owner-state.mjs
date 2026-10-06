/** Pre-writer layout checks; these files identify owned data, never an invocation capability. */
import { lstat,realpath,mkdir,readFile,readdir } from 'node:fs/promises';
import { isAbsolute,join,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { requireValue,CommandError,canonical,digest } from './errors.mjs';
export const OWNER_LABEL='local-runtime-owner';
async function existing(path,directory,optional=false){
 let stat;try{stat=await lstat(path);}catch(error){if(error.code==='ENOENT'){if(optional)return false;throw new CommandError('owner_state_incomplete');}throw error;}
 requireValue(!stat.isSymbolicLink() && (directory?stat.isDirectory():stat.isFile()),'owner_state_path_conflict');
 requireValue(await realpath(path)===resolve(path),'owner_state_path_conflict');
 return true;
}
async function sessionPaths(root){
 let count=0;
 async function walk(path,depth){requireValue(++count<=256 && depth<=16,'owner_state_incomplete');
  const stat=await lstat(path);requireValue(!stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile()),'owner_state_path_conflict');
  requireValue(await realpath(path)===resolve(path),'owner_state_path_conflict');
  if(stat.isDirectory())for(const name of await readdir(path))await walk(join(path,name),depth+1);
 }
 await existing(root,true);await walk(root,0);
}
function nativeJournal(path,binding){
 let reader;
 try{
  reader=new DatabaseSync(path,{readOnly:true});
  requireValue(reader.prepare('PRAGMA quick_check').get()?.quick_check==='ok','owner_state_incomplete');
  const meta=reader.prepare('SELECT format,data,revision,stateDigest FROM meta WHERE id=1').get();
  requireValue(meta?.format===3 && meta.data===canonical({hostId:binding.hostId,capacity:binding.capacity})
   && Number.isSafeInteger(meta.revision) && meta.revision>=0,'owner_state_incomplete');
  // node:sqlite rows have a null prototype; normalize only row containers for
  // the product's finite-JSON canonicalizer (stored data strings stay exact).
  const rows=sql=>reader.prepare(sql).all().map(row=>({...row}));
  const targets=rows('SELECT id,data FROM targets ORDER BY id'),operations=rows('SELECT id,data FROM operations ORDER BY id'),
   stops=rows('SELECT id,target,generation,operation FROM stops ORDER BY id');
  requireValue(meta.stateDigest===digest({targets,operations,stops}) && targets.length===2,'owner_state_incomplete');
  for(const {target} of Object.values(binding.targets))requireValue(targets.find(row=>row.id===target.id)?.data===canonical(target),'owner_state_incomplete');
 }catch{throw new CommandError('owner_state_incomplete');}finally{reader?.close();}
}
export async function ownerState(homeDirectory,mode){
 requireValue(typeof homeDirectory==='string' && isAbsolute(homeDirectory),'invalid_owner_home');
 const home=resolve(homeDirectory);await existing(home,true);
 const directory=join(home,'owner-state');
 if(mode==='init'){
  requireValue(!await existing(join(home,'sessions'),true,true),'owner_home_not_fresh');
  try{await mkdir(directory,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw new CommandError('owner_state_exists');throw error;}
  return {home,directory,database:join(directory,'product.sqlite'),journal:join(directory,'journal'),entryPath:join(directory,'entry.json')};
 }
 requireValue(mode==='resume','invalid_owner_home');
 await existing(directory,true);const database=join(directory,'product.sqlite'),journal=join(directory,'journal'),entryPath=join(directory,'entry.json');
 for(const path of [database,entryPath,join(journal,'journal.sqlite')])await existing(path,false);await existing(journal,true);
 for(const path of [database+'-wal',database+'-shm',join(journal,'journal.sqlite-wal'),join(journal,'journal.sqlite-shm'),join(journal,'writer.lock')])await existing(path,false,true);
 await sessionPaths(join(home,'sessions'));
 let entry;try{entry=JSON.parse(await readFile(entryPath,'utf8'));}catch{throw new CommandError('owner_state_incomplete');}
 requireValue(entry?.format===1 && entry.home===home && typeof entry.ledgerInstanceId==='string','owner_state_incomplete');
 const reader=new DatabaseSync(database,{readOnly:true});let binding;
 try{
  requireValue(reader.prepare('PRAGMA user_version').get().user_version===1,'owner_state_incomplete');
  const get=(kind,id)=>{const row=reader.prepare('SELECT value FROM objects WHERE kind=? AND id=?').get(kind,id);return row?JSON.parse(row.value):null;};
  const owner=get('meta','owner'),instance=get('meta','instance'),grant=get('grant','native-owner');binding=get('nativeBinding','protected-text-owner');
  requireValue(owner?.id===OWNER_LABEL && instance?.id===entry.ledgerInstanceId && binding?.hostId===entry.ledgerInstanceId && binding.directory===journal,'owner_state_incomplete');
  requireValue(grant?.authority==='private-runtime-owner' && grant.scope==='owned-text-sessions' && grant.actor?.kind==='host'
   && grant.actor.id===entry.ledgerInstanceId && Number.isSafeInteger(grant.epoch) && typeof grant.active==='boolean','owner_state_incomplete');
  for(const kind of ['contact','execution']){
   const row=binding.targets?.[kind],id=entry[`${kind}CreationId`];
   const creation=typeof id==='string'?get('creation',id):null,sessionId=row?.target?.sessionBinding?.sessionId;
   requireValue(typeof id==='string' && row?.creationId===id && creation?.state==='created'
    && typeof sessionId==='string' && creation.sessionId===sessionId && entry.sessions?.[kind]===sessionId
    && row.target.sessionBinding.cwd===home,'owner_state_incomplete');
  }
 }catch(error){if(error.code==='owner_state_incomplete')throw error;throw new CommandError('owner_state_incomplete');}finally{reader.close();}
 requireValue((await lstat(join(journal,'journal.sqlite'))).size>0,'owner_state_incomplete');
 nativeJournal(join(journal,'journal.sqlite'),binding);
 return {home,directory,database,journal,entryPath,entry,binding};
}
