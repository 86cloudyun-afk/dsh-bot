"""Shared monotonic running budget with separate required finalization timing."""
import math, signal, time
from contextlib import contextmanager
import supervisor as R

PHASES={'INITIAL_CONTEXT','INITIAL_NODE_IDENTITY','PARENT_NODE_IDENTITY','SDK_PRODUCT_IDENTITY','PRIOR_RECEIPTS','CONTEXT_BEFORE','CASE_PREPARATION','CHILD_NODE_IDENTITY',
 'CHILD_SUPERVISION','START_RECEIPT','OBSERVATION','CONTEXT_AFTER','STARTUP_DIAGNOSTIC',
 'RESULT_RECEIPT','RECEIPT_HASH','CLEANUP_RECEIPT','TERMINAL_RECEIPT','RETURN_HASHES','CASE_RETURN',
 'CASE_OUTPUT','SUMMARY_RECEIPT','SUMMARY_OUTPUT','RUN_RETURN','CHILD_STOP_CONFIRMATION','BINDING_CONFIG_INPUT'}

class CaseBudget:
 def __init__(self,limit,*,clock=time.monotonic,alarms=True):
  R.require(type(limit) in (int,float) and math.isfinite(limit) and 0<limit<=20,'CASE_BUDGET_LIMIT_REFUSED')
  R.require(type(alarms) is bool,'CASE_BUDGET_TIMER_REFUSED')
  self.limit=float(limit);self.clock=clock;self.alarms=alarms;self.start=clock()
  self.cleanup_seconds=0.;self.safety_seconds=0.;self.stop_seconds=0.;self.phases={};self.stack=[]
  self.failed=False;self.failure_category=None;self.failure_phase=None
 def _wall(self):
  value=self.clock()-self.start
  R.require(type(value) in (int,float) and math.isfinite(value) and value>=0,'CASE_BUDGET_CLOCK_REFUSED')
  return value
 def _active(self):return max(0.,self._wall()-self.cleanup_seconds-self.safety_seconds-self.stop_seconds)
 @property
 def deadline(self):return self.start+self.cleanup_seconds+self.safety_seconds+self.stop_seconds+self.limit
 def fail(self,category='CASE_BUDGET_EXHAUSTED'):
  if not self.failed:
   self.failed=True;self.failure_category=category;self.failure_phase=self.stack[-1] if self.stack else 'CASE_RETURN'
  raise R.SafetyError(category)
 def check(self):
  if self.failed or self._active()>=self.limit:self.fail(self.failure_category or 'CASE_BUDGET_EXHAUSTED')
 def remaining(self):
  self.check();return self.limit-self._active()
 def child_deadline(self):
  self.check()
  deadline=self.deadline
  if deadline<=self.clock():self.fail('CASE_FINALIZATION_RESERVE_EXHAUSTED')
  return deadline
 def _label(self,name):R.require(type(name) is str and name in PHASES,'CASE_BUDGET_PHASE_REFUSED')
 @contextmanager
 def phase(self,name,*,interrupt=True):
  self._label(name);self.stack.append(name);begin=self.clock();previous=None;armed=False
  try:
   self.check()
   if interrupt and self.alarms:
    if not all(hasattr(signal,n) for n in ('SIGALRM','ITIMER_REAL','setitimer','getitimer')):self.fail('CASE_BUDGET_TIMER_UNAVAILABLE')
    if signal.getitimer(signal.ITIMER_REAL)!=(0.,0.):self.fail('CASE_BUDGET_TIMER_BUSY')
    previous=signal.getsignal(signal.SIGALRM)
    def expired(number,frame):self.fail()
    signal.signal(signal.SIGALRM,expired)
    try:signal.setitimer(signal.ITIMER_REAL,self.remaining());armed=True
    except BaseException:signal.signal(signal.SIGALRM,previous);raise
   yield
   self.check()
  finally:
   if armed:
    signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,previous)
   self.phases[name]=self.phases.get(name,0.)+max(0.,self.clock()-begin);self.stack.pop()
 @contextmanager
 def safety_phase(self,name):
  """Required finalization is separate; it never clears the timeout/failure latch."""
  self._label(name);begin=self.clock()
  try:yield
  finally:
   elapsed=max(0.,self.clock()-begin)
   if name=='CHILD_STOP_CONFIRMATION':self.stop_seconds+=elapsed
   else:self.safety_seconds+=elapsed
 def cleanup(self,remove):
  """Only actual owned-directory removal is excluded; receipts are charged."""
  begin=self.clock()
  try:return remove()
  finally:self.cleanup_seconds+=max(0.,self.clock()-begin)
 def snapshot(self):
  wall=self._wall();finalization=self.cleanup_seconds+self.safety_seconds+self.stop_seconds;active=max(0.,wall-finalization)
  return {'schemaVersion':2,'scope':'RUNNING_BUDGET_WITH_SEPARATE_REQUIRED_FINALIZATION','limitSeconds':self.limit,
   'runningSeconds':active,'activeSeconds':active,'wholeWallSeconds':wall,'cleanupSeconds':self.cleanup_seconds,
   'stopConfirmationSeconds':self.stop_seconds,'failureSealingSeconds':self.safety_seconds,'finalizationSeconds':finalization,
   'safetyFinalizationSeconds':self.safety_seconds,'withinBudget':not self.failed and active<self.limit,
   'failureCategory':self.failure_category,'failurePhase':self.failure_phase,
   'phasesSeconds':dict(sorted(self.phases.items())),'phaseTimesMayOverlap':True,
   'timerMode':'POSIX_ALARM' if self.alarms else 'SYNTHETIC_CLOCK',
   'physicalKernelIOHardBoundEstablished':False}
