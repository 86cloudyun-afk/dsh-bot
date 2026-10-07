// Execute the actual companion boundary bodies with fake capabilities only.
return function(source){
 const check=x=>{if(!x)throw Error('BOUNDARY_CHECK_FAILED');};
 const between=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);check(a>=0&&b>a);return source.slice(a+start.length,b);};
 const lockBody=between('value:function(fd,callback){','\n  }});');
 const ioBody=between(' const networkDenied=()=>'," checkpoint('C_BUILTIN_EXPORT_SYNC');");
 function lockFixture(fault){
  const state={nativeCalls:0},stats={native:0,callbacks:0,stops:0,fs:0};let stopped=false;
  const nativeStop={isStopped:()=>stopped,stop(){stats.stops++;throw Error('FAKE_CAPTURED_EXIT');}};
  const refused=reason=>{stopped=true;state.terminalRefusalCategory??=reason;return nativeStop.stop();};
  const identity={dev:1,ino:2,isFile:()=>true};
  const fs={fstatSync(fd){stats.fs++;if(fd<0||fault==='fd')throw Error('FAKE_EBADF');return identity;},readdirSync(){stats.fs++;if(fault==='readdir')throw Error('FAKE_ENOENT');return ['owned'];},lstatSync(){stats.fs++;if(fault==='lstat')throw Error('FAKE_EACCES');return {...identity,isSymbolicLink:()=>false,isDirectory:()=>false};}};
  const binding={},originalLock=(fd,cb)=>{stats.native++;if(fault==='lock')throw Error('FAKE_SETUP_FAILURE');cb(fault==='errno'?1:0);return 'LOCK_RETURN';};
  const fn=Function('state','fs','root','join','refused','originalLock','binding','now','save','nativeStop','let nativeFd;return function(fd,callback){'+lockBody+'};')(state,fs,'/synthetic-owned',(a,b)=>a+'/'+b,refused,originalLock,binding,()=> 'SYNTHETIC',()=>{},nativeStop);
  return {state,stats,fn,stopped:()=>stopped,call(fd=41){try{return fn(fd,()=>stats.callbacks++);}catch{return 'CAPTURED';}}};
 }
 function ioFixture(){
  const state={networkAttempts:0,spawnAttempts:0,workerAttempts:0};let originals=0,stops=0;
  const original=()=>{originals++;};
  const module=names=>Object.fromEntries(names.map(k=>[k,original]));
  class Resolver {resolve4(){originals++;}resolve6(){originals++;}resolve(){originals++;}lookup(){originals++;}cancel(){originals++;}}
  class PromiseResolver extends Resolver {}
  const dns={...module(['lookup','lookupService','resolve','resolve4','resolve6','resolveAny','reverse','getServers','setServers']),Resolver};
  const dnsPromises={...module(['lookup','lookupService','resolve','resolve4','resolve6','resolveAny','reverse','getServers','setServers']),Resolver:PromiseResolver};
  const net={...module(['connect','createConnection','createServer']),Socket:class {},Server:class {}};
  net.Socket.prototype.connect=original;net.Server.prototype.listen=original;
  const dgram={...module(['createSocket']),Socket:class {}};dgram.Socket.prototype.send=original;dgram.Socket.prototype.connect=original;
  const modules={net,http:module(['request','get','createServer']),https:module(['request','get','createServer']),tls:module(['connect','createServer']),dgram,http2:module(['connect','createServer','createSecureServer']),child:module(['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']),worker:{Worker:class {}},dns,dnsPromises};
  const refused=()=>{stops++;throw Error('FAKE_CAPTURED_EXIT');};
  Function('state','refused',...Object.keys(modules),'const networkDenied=()=>'+ioBody)(state,refused,...Object.values(modules));
  return {state,modules,Resolver,PromiseResolver,stats:()=>({originals,stops})};
 }
 const tests={
  successful_lock_preserves_one_call(){const f=lockFixture();check(f.call()==='LOCK_RETURN'&&f.stats.native===1&&f.stats.callbacks===1&&!f.stopped());},
  negative_fd_stops_before_io(){const f=lockFixture();f.call(-1);check(f.stopped()&&f.stats.native===0&&f.stats.fs===0);},
  unsafe_fd_stops_before_io(){const f=lockFixture();f.call(2**32);check(f.stopped()&&f.stats.native===0&&f.stats.fs===0);},
  closed_fd_failure_stops(){const f=lockFixture('fd');f.call();check(f.stopped()&&f.stats.native===0&&f.stats.callbacks===0);},
  directory_failure_stops(){const f=lockFixture('readdir');f.call();check(f.stopped()&&f.stats.native===0);},
  entry_failure_stops(){const f=lockFixture('lstat');f.call();check(f.stopped()&&f.stats.native===0);},
  binding_setup_failure_stops(){const f=lockFixture('lock');f.call();check(f.stopped()&&f.stats.native===1&&f.stats.callbacks===0);},
  callback_failure_errno_stops_before_sdk(){const f=lockFixture('errno');f.call();check(f.stopped()&&f.stats.callbacks===0);},
  caught_refusal_cannot_reenter(){const f=lockFixture('fd');f.call();const prior=f.stats.fs;f.call();check(f.stopped()&&f.stats.fs===prior&&f.stats.native===0);},
  callback_dns_stops_before_original(){const f=ioFixture();for(const n of ['lookup','lookupService','resolve','resolve4','resolve6','resolveAny','reverse'])try{f.modules.dns[n]('synthetic.invalid',()=>{});}catch{}check(f.stats().originals===0&&f.state.networkAttempts===7&&f.stats().stops===7);},
  promise_dns_stops_before_original(){const f=ioFixture();for(const n of ['lookup','lookupService','resolve','resolve4','resolve6','resolveAny','reverse'])try{f.modules.dnsPromises[n]('synthetic.invalid');}catch{}check(f.stats().originals===0&&f.state.networkAttempts===7);},
  resolver_constructor_stops(){const f=ioFixture();try{new f.modules.dns.Resolver();}catch{}check(f.stats().originals===0&&f.state.networkAttempts===1);},
  promise_resolver_constructor_stops(){const f=ioFixture();try{new f.modules.dnsPromises.Resolver();}catch{}check(f.stats().originals===0&&f.state.networkAttempts===1);},
  resolver_prototype_stops(){const f=ioFixture();for(const p of [f.Resolver.prototype,f.PromiseResolver.prototype])for(const n of ['resolve4','resolve6','resolve'])try{p[n]('synthetic.invalid');}catch{}check(f.stats().originals===0&&f.state.networkAttempts===6);},
 };
 const results=[];for(const [name,test] of Object.entries(tests)){try{test();results.push({name,passed:true});}catch{results.push({name,passed:false});}}
 return {tests:results.length,passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).map(x=>x.name),results,engine:'FAKE_CAPABILITIES_ONLY',actualNativeModelNetwork:0};
};
