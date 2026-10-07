// Builtin-only visibility journal. No fsync and no production durability claim.
// Exclusive owned directories assume one writer; hostile same-UID races are out of scope.
export function createBuiltinObservationWriter(fs,root,role,pid,caseName) {
  if (!/^\/(?:[^/\x00]+\/)*dsh-native-cold-[A-Za-z0-9_-]+$/.test(root) ||
      !['TARGET','ASSERTION','TRACE'].includes(role) || !Number.isInteger(pid) ||
      pid <= 0 || pid >= 2**31 || !['builtin-dual','cold1','cold2'].includes(caseName)) throw Error('BUILTIN_OBSERVATION_IDENTITY_REFUSED');
  const mkdir=fs.mkdirSync.bind(fs),open=fs.openSync.bind(fs),write=fs.writeFileSync.bind(fs);
  const close=fs.closeSync.bind(fs),rename=fs.renameSync.bind(fs),unlink=fs.unlinkSync.bind(fs);
  const flags=fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW;
  let sequence=0,failed=false;
  return function commit(payload) {
    if (failed) throw Error('BUILTIN_OBSERVATION_FAILED_LATCH');
    let fd=null,pending=null;
    try {
      if (sequence >= 64 || payload === null || typeof payload !== 'object' || Array.isArray(payload) ||
          Object.getPrototypeOf(payload) !== Object.prototype || payload.pid !== pid) throw Error('BUILTIN_OBSERVATION_PAYLOAD_REFUSED');
      const next=sequence+1;
      const body=JSON.stringify({schemaVersion:1,scope:'ISOLATED_NATIVE_TEST_ONLY',durability:'NON_DURABLE',pid,case:caseName,role,sequence:next,payload})+'\n';
      if (body.length > 16384 || /[^\x00-\x7f]/.test(body)) throw Error('BUILTIN_OBSERVATION_SIZE_REFUSED');
      sequence=next;
      const directory=root+'/builtin-observation-'+role+'-'+String(sequence).padStart(4,'0');
      mkdir(directory,{mode:0o700});
      pending=directory+'/record.json.pending';
      fd=open(pending,flags,0o600);write(fd,body,'utf8');close(fd);fd=null;
      rename(pending,directory+'/record.json');pending=null;
    } catch (error) {
      failed=true;
      if (fd!==null) {try {close(fd);} catch {}}
      if (pending!==null) {try {unlink(pending);} catch {}}
      throw error;
    }
  };
}
