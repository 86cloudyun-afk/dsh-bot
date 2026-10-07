// Uses a synthetic filesystem; never imports SDK or invokes actual native bindings.
return function run(source,stopSource,legacy=false){
 const ROOT='/tmp/dsh-native-cold-pure',CASE='builtin-dual',PID=999;
 const check=(value,message)=>{if(!value)throw Error(message);};
 const symbols=Function(source.replaceAll('export ','')+'\nreturn {writer:typeof createBuiltinObservationWriter==="function"?createBuiltinObservationWriter:null,legacy:typeof createAtomicTraceWriter==="function"?createAtomicTraceWriter:null};')();
 const stop=Function(stopSource.replaceAll('export ','')+'\nreturn createNativeAdmissionStop;')();
 function fixture(fault){
  const dirs=new Set([ROOT]),files=new Map(),fds=new Map(),events=[];let next=1;
  const error=code=>Object.assign(Error(code),{code});
  const fs={constants:{O_WRONLY:1,O_CREAT:2,O_EXCL:4,O_NOFOLLOW:8},
   mkdirSync(p){events.push('MKDIR');if(dirs.has(p))throw error('EEXIST');dirs.add(p);},
   openSync(p,flags,mode){events.push('OPEN');check((flags&14)===14&&mode===0o600,'EXCLUSIVE_NOFOLLOW_REQUIRED');check(dirs.has(p.slice(0,p.lastIndexOf('/'))),'PARENT_REQUIRED');if(files.has(p))throw error('EEXIST');files.set(p,'');const fd=next++;fds.set(fd,p);return fd;},
   writeFileSync(fd,value){events.push('WRITE');if(fault==='write')throw error('WRITE_FAILURE');check(fds.has(fd),'FD_REQUIRED');files.set(fds.get(fd),value);},
   closeSync(fd){events.push('CLOSE');fds.delete(fd);},
   renameSync(a,b){events.push('RENAME');if(fault==='rename')throw error('RENAME_FAILURE');check(fds.size===0,'CLOSE_BEFORE_RENAME');check(!files.has(b),'NO_TARGET_OVERWRITE');files.set(b,files.get(a));files.delete(a);},
   unlinkSync(p){files.delete(p);},
   fsyncSync(){throw error('ERR_ACCESS_DENIED');}
  };
  const make=(role='TRACE',pid=PID,caseName=CASE,root=ROOT)=>legacy?symbols.legacy(fs,root+'/legacy.json',root):symbols.writer(fs,root,role,pid,caseName);
  return {fs,dirs,files,fds,events,make};
 }
 const cases={
  visible_non_durable_record_without_fsync(){const f=fixture();f.make()({pid:PID});check(f.files.size===1,'ONE_RECORD_REQUIRED');const e=JSON.parse([...f.files.values()][0]);check(e.scope==='ISOLATED_NATIVE_TEST_ONLY'&&e.durability==='NON_DURABLE','EXPLICIT_SCOPE_REQUIRED');},
  exact_envelope_and_payload(){const f=fixture();const payload={pid:PID,stage:'SYNTHETIC'};f.make('TARGET')(payload);const e=JSON.parse([...f.files.values()][0]);check(JSON.stringify(Object.keys(e).sort())===JSON.stringify(['schemaVersion','scope','durability','pid','case','role','sequence','payload'].sort()),'EXACT_FIELDS_REQUIRED');check(e.schemaVersion===1&&e.pid===PID&&e.case===CASE&&e.role==='TARGET'&&e.sequence===1&&JSON.stringify(e.payload)===JSON.stringify(payload),'BOUND_METADATA_REQUIRED');},
  sequential_distinct_reserved_directories(){const f=fixture();const w=f.make();w({pid:PID});w({pid:PID});check(f.dirs.size===3&&f.files.size===2,'NO_REPLACEMENT_REQUIRED');check([...f.files.keys()].every(p=>p.endsWith('/record.json')),'RECORD_NAME_REQUIRED');check([...f.files.values()].map(x=>JSON.parse(x).sequence).join(',')==='1,2','CONTIGUOUS_SEQUENCE_REQUIRED');},
  collision_refuses_without_overwriting(){const f=fixture();f.dirs.add(ROOT+'/builtin-observation-TRACE-0001');f.files.set(ROOT+'/builtin-observation-TRACE-0001/record.json','EXISTING');let failed=false;try{f.make()({pid:PID});}catch{failed=true;}check(failed&&f.files.get(ROOT+'/builtin-observation-TRACE-0001/record.json')==='EXISTING','COLLISION_MUST_FAIL');},
  invalid_scope_identity_refused_before_io(){for(const args of [['PRIVATE_ROLE',PID,CASE,ROOT],['TRACE',0,CASE,ROOT],['TRACE',PID,'other',ROOT],['TRACE',PID,CASE,'/outside']]){const f=fixture();let failed=false;try{f.make(...args)({pid:PID});}catch{failed=true;}check(failed&&f.events.length===0,'INVALID_FACTORY_MUST_FAIL');}},
  payload_pid_refused_before_io(){const f=fixture();let failed=false;try{f.make()({pid:PID+1});}catch{failed=true;}check(failed&&f.events.length===0,'PAYLOAD_PID_MUST_BIND');},
  io_failure_latches_and_closes(){const f=fixture('write'),w=f.make();let first=false,second=false;try{w({pid:PID});}catch{first=true;}const count=f.events.length;try{w({pid:PID});}catch{second=true;}check(first&&second&&f.fds.size===0&&f.events.length===count,'FAILED_WRITER_MUST_NOT_RESUME');},
  pending_not_committed_on_rename_failure(){const f=fixture('rename');let failed=false;try{f.make()({pid:PID});}catch{failed=true;}check(failed&&f.fds.size===0&&![...f.files.keys()].some(p=>p.endsWith('/record.json')),'COMMIT_FAILURE_MUST_NOT_LOOK_COMPLETE');},
  bounded_capacity_no_gap_retry(){const f=fixture(),w=f.make();for(let n=0;n<64;n++)w({pid:PID});let failed=false;try{w({pid:PID});}catch{failed=true;}check(failed&&f.files.size===64,'CAPACITY_MUST_FAIL');},
  oversized_payload_refused_before_io(){const f=fixture();let failed=false;try{f.make()({pid:PID,data:'x'.repeat(16384)});}catch{failed=true;}check(failed&&f.events.length===0,'SIZE_LIMIT_REQUIRED');},
  original_stop_exit74_after_visible_commit(){const f=fixture(),state={pid:PID,boundaryRefusals:[]};let code=null;const s=stop({state,stamp:()=> '2026-10-07T00:00:00.000Z',observeCounts:()=>{},commit:f.make(),exitImmediately:c=>{code=c;check(f.files.size===1,'VISIBLE_BEFORE_EXIT');}});try{s.stop('OTHER_ADDON_LOAD_REFUSED');}catch{}check(code===74&&s.isStopped(),'ORIGINAL_EXIT74_REQUIRED');check(JSON.parse([...f.files.values()][0]).payload.stage==='NATIVE_ADMISSION_REFUSED','TERMINAL_STAGE_REQUIRED');},
  original_stop_exit75_on_observation_failure(){const f=fixture('write'),state={pid:PID,boundaryRefusals:[]};let code=null;const s=stop({state,stamp:()=> '2026-10-07T00:00:00.000Z',observeCounts:()=>{},commit:f.make(),exitImmediately:c=>{code=c;}});try{s.stop('OTHER_ADDON_LOAD_REFUSED');}catch{}check(code===75&&s.isStopped(),'ORIGINAL_FAILURE_STOP_REQUIRED');}
 };
 const results=[];for(const [name,test]of Object.entries(cases)){try{test();results.push({name,passed:true});}catch{results.push({name,passed:false});}}
 return {tests:results.length,passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).map(x=>x.name),actualNodeChildren:0,actualNativeModelNetwork:0,engine:'TOOL_V8_SYNTHETIC_FS_ONLY',results};
};
