import datetime,hashlib,os,selectors,subprocess,time
LIMIT=16384

class Stream:
 def __init__(self):self.raw=bytearray();self.total=0;self.digest=hashlib.sha256();self.overflow=False
 def feed(self,data):
  self.total+=len(data);self.digest.update(data);room=LIMIT-len(self.raw);self.raw.extend(data[:max(0,room)]);self.overflow=self.total>LIMIT
 def release(self):self.raw[:]=b''
 def metadata(self):return {'bytes':self.total,'sha256':self.digest.hexdigest(),'completeWithinLimit':not self.overflow}


class CappedProcess:
 def __init__(self,args,**kwargs):
  kwargs['stdin']=subprocess.DEVNULL
  self.args=args;self.streams={'stdout':Stream(),'stderr':Stream()};self.selector=selectors.DefaultSelector();self.limitStopSent=False;self.setupFailed=False;self.setupFailureSignaled=False
  try:self.child=subprocess.Popen(args,**kwargs)
  except BaseException:self.selector.close();raise
  self.pid=self.child.pid
  try:
   for name in self.streams:
    pipe=getattr(self.child,name);os.set_blocking(pipe.fileno(),False);self.selector.register(pipe,selectors.EVENT_READ,name)
  except BaseException:self.setupFailed=True # Return the held child to the existing supervisor stop path.
 def poll(self):return self.child.poll()
 def terminate(self):return self.child.terminate()
 def kill(self):return self.child.kill()
 def communicate(self,timeout=None):
  if self.setupFailed:
   if not self.setupFailureSignaled:self.setupFailureSignaled=True;raise OSError('CAPTURE_PIPE_SETUP_FAILED')
   self.child.wait(timeout=timeout);self.exitObservedMonotonic=time.monotonic();self.exitObservedUTC=datetime.datetime.now(datetime.timezone.utc)
   self.selector.close()
   for name in self.streams:getattr(self.child,name).close()
   return b'',b''
  end=time.monotonic()+timeout
  while self.selector.get_map():
   if time.monotonic()>=end:raise subprocess.TimeoutExpired('PINNED_NODE_ONLY',timeout)
   for key,_ in self.selector.select(min(.05,max(0,end-time.monotonic()))):
    chunk=os.read(key.fileobj.fileno(),4096)
    if not chunk:self.selector.unregister(key.fileobj);key.fileobj.close();continue
    stream=self.streams[key.data];stream.feed(chunk)
    if stream.overflow and not self.limitStopSent:
     self.limitStopSent=True
     try:self.child.terminate()
     except ProcessLookupError:pass
  self.child.wait(timeout=max(.001,end-time.monotonic()));self.exitObservedMonotonic=time.monotonic();self.exitObservedUTC=datetime.datetime.now(datetime.timezone.utc);self.selector.close()
  result=tuple(bytes(self.streams[name].raw) for name in ['stdout','stderr'])
  for stream in self.streams.values():stream.release()
  return result
