"""Synthetic clocks, owned files and fake children only; no SDK/native/model/network."""
import hashlib, io, json, math, signal, subprocess, tempfile, time, unittest
from contextlib import redirect_stdout
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch
import supervisor as R
import run
from test_binding import fake_retention,FAKE_OBSERVATION
try:
 from case_budget import CaseBudget
except ModuleNotFoundError:
 CaseBudget=None
class Clock:
 def __init__(self):self.value=0.
 def __call__(self):return self.value
 def advance(self,seconds):self.value+=seconds
class BudgetTests(unittest.TestCase):
 def setUp(self):self.assertIsNotNone(CaseBudget,'CASE_TOTAL_BUDGET_MISSING');self.clock=Clock()
 def budget(self,limit=5):return CaseBudget(limit,clock=self.clock,alarms=False)
 def test_remaining_includes_prior_identity_work(self):
  b=self.budget();self.clock.advance(2)
  self.assertEqual(b.remaining(),3)
  with b.phase('CONTEXT_BEFORE'):self.clock.advance(1)
  self.assertEqual(b.remaining(),2);self.assertEqual(b.snapshot()['phasesSeconds']['CONTEXT_BEFORE'],1)
 def test_exact_boundary_and_slow_identity_are_refused(self):
  for spent in (5,11.463614244):
   b=self.budget()
   with self.assertRaises(R.SafetyError) as caught:
    with b.phase('CONTEXT_BEFORE'):self.clock.advance(spent)
   self.assertEqual(caught.exception.code,'CASE_BUDGET_EXHAUSTED')
   self.assertFalse(b.snapshot()['withinBudget'])
 def test_previous_cold_wall_overruns_cannot_pass_numeric_total_budget(self):
  for spent in (20.570495544,20.410317702):
   b=self.budget(20)
   with self.assertRaises(R.SafetyError):
    with b.phase('CONTEXT_AFTER'):self.clock.advance(spent)
   self.assertFalse(b.snapshot()['withinBudget'])
 def test_cleanup_is_completed_measured_and_wall_is_not_hidden(self):
  b=self.budget();self.clock.advance(3);called=[]
  b.cleanup(lambda:(called.append(True),self.clock.advance(7)))
  self.clock.advance(1);s=b.snapshot()
  self.assertEqual(called,[True]);self.assertEqual(s['cleanupSeconds'],7)
  self.assertEqual(s['activeSeconds'],4);self.assertEqual(s['wholeWallSeconds'],11);self.assertTrue(s['withinBudget'])
 def test_cleanup_exception_still_has_time_accounted(self):
  b=self.budget()
  def remove():self.clock.advance(2);raise OSError()
  with self.assertRaises(OSError):b.cleanup(remove)
  self.assertEqual(b.snapshot()['cleanupSeconds'],2)
 def test_failure_finalization_keeps_evidence_and_cannot_restore_success(self):
  b=self.budget();self.clock.advance(6)
  with self.assertRaises(R.SafetyError):b.remaining()
  with b.safety_phase('RESULT_RECEIPT'):self.clock.advance(1)
  self.assertFalse(b.snapshot()['withinBudget']);self.assertEqual(b.snapshot()['safetyFinalizationSeconds'],1)
 def test_required_stop_confirmation_is_separate_from_running_budget(self):
  b=self.budget();self.clock.advance(3)
  with b.safety_phase('CHILD_STOP_CONFIRMATION'):self.clock.advance(7)
  s=b.snapshot();self.assertEqual(s['runningSeconds'],3);self.assertEqual(s['stopConfirmationSeconds'],7)
  self.assertEqual(s['finalizationSeconds'],7);self.assertEqual(s['wholeWallSeconds'],10);self.assertTrue(s['withinBudget'])
 def test_failed_sealing_time_is_separate_but_timeout_latch_never_clears(self):
  b=self.budget();self.clock.advance(6)
  with self.assertRaises(R.SafetyError):b.check()
  with b.safety_phase('RESULT_RECEIPT'):self.clock.advance(7)
  s=b.snapshot();self.assertEqual(s['runningSeconds'],6);self.assertEqual(s['failureSealingSeconds'],7)
  self.assertEqual(s['wholeWallSeconds'],13);self.assertFalse(s['withinBudget'])
 def test_invalid_types_limits_and_phase_labels_are_refused(self):
  for limit in (True,0,-1,21,float('inf'),float('nan'),'5'):
   with self.assertRaises(R.SafetyError):CaseBudget(limit,clock=self.clock,alarms=False)
  b=self.budget()
  with self.assertRaises(R.SafetyError):
   with b.phase('UNTRUSTED_TEXT_MUST_NOT_PERSIST'):pass
  self.assertNotIn('UNTRUSTED_TEXT_MUST_NOT_PERSIST',json.dumps(b.snapshot()))
 def test_short_real_alarm_interrupts_only_synthetic_sleep_and_restores_handler(self):
  previous=signal.getsignal(signal.SIGALRM);b=CaseBudget(.03)
  with self.assertRaises(R.SafetyError) as caught:
   with b.phase('CONTEXT_BEFORE'):time.sleep(.1)
  self.assertEqual(caught.exception.code,'CASE_BUDGET_EXHAUSTED')
  self.assertEqual(signal.getsignal(signal.SIGALRM),previous);self.assertEqual(signal.getitimer(signal.ITIMER_REAL),(0.,0.))
 def test_existing_alarm_is_never_overridden(self):
  previous=signal.getsignal(signal.SIGALRM);timer=signal.getitimer(signal.ITIMER_REAL)
  signal.setitimer(signal.ITIMER_REAL,10)
  try:
   b=CaseBudget(5)
   with self.assertRaises(R.SafetyError) as caught:
    with b.phase('CONTEXT_BEFORE'):pass
   self.assertEqual(caught.exception.code,'CASE_BUDGET_TIMER_BUSY')
   self.assertGreater(signal.getitimer(signal.ITIMER_REAL)[0],0);self.assertEqual(signal.getsignal(signal.SIGALRM),previous)
  finally:signal.setitimer(signal.ITIMER_REAL,*timer)
class SupervisorBudgetTests(unittest.TestCase):
 def setUp(self):self.assertIsNotNone(CaseBudget,'CASE_TOTAL_BUDGET_MISSING');self.clock=Clock()
 def budget(self,limit=5):return CaseBudget(limit,clock=self.clock,alarms=False)
 def exercise(self,node_seconds=0,launch_seconds=0,timeout_once=False,stop_seconds=0,communicate_seconds=.2):
  b=self.budget();self.clock.advance(3);calls=[]
  with tempfile.TemporaryDirectory() as d:
   root=Path(d).resolve();env=R.synthetic_env(root)
   class Child:
    pid=999
    done=False
    def communicate(child,timeout):
     calls.append(('wait',timeout))
     if timeout_once and not child.done:self.clock.advance(timeout);raise subprocess.TimeoutExpired('synthetic',timeout)
     self.clock.advance(communicate_seconds);child.done=True;return b'',b''
    stop_measured=False
    def poll(child):
     if child.done and not child.stop_measured:child.stop_measured=True;self.clock.advance(stop_seconds)
     return 0 if child.done else None
    def terminate(child):calls.append(('terminate',None));child.done=True
    def kill(child):calls.append(('kill',None));child.done=True
   def launch(*a,**k):calls.append(('launch',None));self.clock.advance(launch_seconds);return Child()
   def node():self.clock.advance(node_seconds);return Path('/synthetic/node')
   with patch.object(R.os,'kill',side_effect=ProcessLookupError):
    capture=R.supervise_once(['/synthetic/node','--permission'],root,env,20,popen=launch,node_check=node,budget=b)
  return capture,calls,b
 def test_child_uses_remaining_total_after_node_identity(self):
  capture,calls,b=self.exercise(node_seconds=.25)
  self.assertTrue(capture['processStopped']);self.assertTrue(capture['outputComplete'])
  waits=[v for k,v in calls if k=='wait'];self.assertLessEqual(max(waits),1.75)
  self.assertTrue(b.snapshot()['withinBudget'])
 def test_slow_node_identity_prevents_launch(self):
  capture,calls,b=self.exercise(node_seconds=3)
  self.assertFalse(capture['childCreated']);self.assertFalse(any(k=='launch' for k,v in calls))
  self.assertIn('CASE_BUDGET_EXHAUSTED',capture['errorCategories'])
 def test_launch_overrun_retains_handle_and_stops_child(self):
  capture,calls,b=self.exercise(launch_seconds=3)
  self.assertTrue(capture['childCreated']);self.assertTrue(capture['processStopped'])
  self.assertIn('CASE_BUDGET_EXHAUSTED',capture['errorCategories']);self.assertFalse(b.snapshot()['withinBudget'])
 def test_child_timeout_stops_and_completes_capture_within_remaining_allowance(self):
  capture,calls,b=self.exercise(timeout_once=True)
  self.assertTrue(capture['timedOut']);self.assertTrue(capture['processStopped']);self.assertTrue(capture['outputComplete'])
  self.assertIn('TIMEOUT',capture['errorCategories']);self.assertTrue(any(k=='terminate' for k,v in calls))
 def test_slow_stop_confirmation_is_measured_separately_after_running_child(self):
  capture,calls,b=self.exercise(node_seconds=.25,stop_seconds=7)
  self.assertTrue(capture['processStopped']);self.assertTrue(capture['outputComplete'])
  self.assertAlmostEqual(b.snapshot()['stopConfirmationSeconds'],7);self.assertTrue(b.snapshot()['withinBudget'])
  self.assertLess(b.snapshot()['runningSeconds'],5);self.assertGreater(b.snapshot()['wholeWallSeconds'],7)
 def test_successful_child_returning_after_running_deadline_stays_failed(self):
  capture,calls,b=self.exercise(communicate_seconds=3,stop_seconds=7)
  self.assertTrue(capture['processStopped']);self.assertTrue(capture['outputComplete'])
  self.assertIn('CASE_BUDGET_EXHAUSTED',capture['errorCategories']);self.assertFalse(b.snapshot()['withinBudget'])
  self.assertEqual(b.snapshot()['runningSeconds'],6);self.assertEqual(b.snapshot()['stopConfirmationSeconds'],7)
class CaseBudgetIntegrationTests(unittest.TestCase):
 def setUp(self):
  self.assertIsNotNone(CaseBudget,'CASE_TOTAL_BUDGET_MISSING');self.clock=Clock()
  retain=patch.object(run.BC,'retain',side_effect=fake_retention);retain.start();self.addCleanup(retain.stop)
 def exercise(self,slow_identity=0,slow_receipt=0,slow_cleanup=0,slow_terminal=0,slow_cleanup_receipt=0,slow_return_hash=0,late_snapshot=False,terminal_hash_failure=False,cleanup_reseal_failure=False):
  with tempfile.TemporaryDirectory() as d:
   temp=Path(d).resolve();evidence=temp/'evidence';evidence.mkdir()
   ctx={'temp':temp,'evidence':evidence,'head':'a'*40,'tree':'b'*40,'node':Path('/synthetic/node')}
   b=CaseBudget(5,clock=self.clock,alarms=False);ctx['builtinBudget']=b
   child=R.Capture(childCreated=True,childPID=999,returncode=74,processStopped=True,outputComplete=True,errorCategories=[])
   writer=R.atomic_create;remover=R.shutil.rmtree;hasher=R.sha;snapshot=b.snapshot;injected=[]
   def timed_snapshot():
    value=snapshot()
    if late_snapshot and (evidence/'builtin-dual-terminal.json').exists() and not b.stack and not injected:
     injected.append(True);self.clock.advance(6)
    return value
   def check(context):self.clock.advance(slow_identity)
   def write(path,value,**kwargs):
    if cleanup_reseal_failure and path.name=='builtin-dual-cleanup.json' and value.get('safeToRunOtherApprovedCase') is False:raise OSError('SYNTHETIC_RESEAL_FAILURE')
    if path.name=='builtin-dual-receipt.json':self.clock.advance(slow_receipt)
    if path.name=='builtin-dual-cleanup.json' and value.get('safeToRunOtherApprovedCase'):self.clock.advance(slow_cleanup_receipt)
    if path.name=='builtin-dual-terminal.json' and value.get('evaluatedOutcome')=='PASS':self.clock.advance(slow_terminal)
    return writer(path,value,**kwargs)
   def remove(path):self.assertTrue((evidence/'builtin-dual-receipt.json').is_file());self.clock.advance(slow_cleanup);return remover(path)
   def digest(path):
    if path.name=='builtin-dual-cleanup.json':self.clock.advance(slow_return_hash)
    if terminal_hash_failure and path.name=='builtin-dual-terminal.json' and not injected:
     injected.append(True);raise OSError('SYNTHETIC_HASH_FAILURE')
    return hasher(path)
   with patch.object(run,'check_context',side_effect=check),patch.object(run,'prepare'),patch.object(R,'supervise_bounded',return_value=child) as launch,patch.object(run,'builtin_observation',return_value=({'stage':'NATIVE_ADMISSION_REFUSED','bindingConfig':FAKE_OBSERVATION.copy()},{})),patch.object(R,'atomic_create',side_effect=write),patch.object(R.shutil,'rmtree',side_effect=remove),patch.object(R,'sha',side_effect=digest),patch.object(b,'snapshot',side_effect=timed_snapshot),patch.dict(run.WITNESSES,{},clear=True):
    outcome=run.run_case('builtin-dual',ctx)
    witness='builtin-dual' in run.WITNESSES
   files={p.name:json.loads(p.read_text()) for p in evidence.glob('*.json')}
   terminal=files.get('builtin-dual-terminal.json')
   if terminal:
    for field,name in [('diagnosticSHA256','builtin-dual-receipt.json'),('cleanupSHA256','builtin-dual-cleanup.json')]:
     self.assertEqual(terminal[field],hashlib.sha256((evidence/name).read_bytes()).hexdigest())
   return outcome,files,launch.call_count,witness
 def test_slow_case_identity_blocks_launch_and_keeps_failure_receipt(self):
  outcome,files,launch,witness=self.exercise(slow_identity=6)
  self.assertEqual(launch,0);self.assertFalse(witness);self.assertEqual(outcome['status'],'BLOCKED_OR_FAIL')
  self.assertIn('CASE_BUDGET_EXHAUSTED',outcome['errors']);self.assertIn('builtin-dual-receipt.json',files)
 def test_slow_result_receipt_blocks_success_but_cleanup_is_complete(self):
  outcome,files,launch,witness=self.exercise(slow_receipt=6)
  self.assertFalse(witness);self.assertEqual(outcome['status'],'BLOCKED_OR_FAIL')
  self.assertTrue(outcome['completion']['diagnosticPersisted']);self.assertTrue(outcome['completion']['temporaryDirectoryRemoved'])
  self.assertFalse(outcome['timing']['withinBudget'])
 def test_slow_cleanup_is_done_and_separately_quantified(self):
  outcome,files,launch,witness=self.exercise(slow_cleanup=7)
  self.assertEqual(outcome['status'],'PASS');self.assertTrue(witness)
  self.assertEqual(outcome['timing']['cleanupSeconds'],7);self.assertGreaterEqual(outcome['elapsedSeconds'],7)
  self.assertEqual(outcome['timing']['activeSeconds'],0);self.assertTrue(outcome['completion']['temporaryDirectoryRemoved'])
 def test_late_terminal_write_never_leaves_final_pass_or_witness(self):
  outcome,files,launch,witness=self.exercise(slow_terminal=6)
  self.assertEqual(outcome['status'],'BLOCKED_OR_FAIL');self.assertFalse(witness)
  self.assertEqual(files['builtin-dual-terminal.json']['evaluatedOutcome'],'BLOCKED_OR_FAIL')
 def test_expiration_after_terminal_phase_revokes_stale_snapshot_and_witness(self):
  outcome,files,launch,witness=self.exercise(late_snapshot=True)
  self.assertEqual(outcome['status'],'BLOCKED_OR_FAIL');self.assertFalse(witness)
  self.assertFalse(outcome['timing']['withinBudget'])
  self.assertEqual(files['builtin-dual-terminal.json']['evaluatedOutcome'],'BLOCKED_OR_FAIL')
  self.assertFalse(files['builtin-dual-cleanup.json']['safeToRunOtherApprovedCase'])
 def test_terminal_hash_failure_revokes_the_already_written_pass(self):
  outcome,files,launch,witness=self.exercise(terminal_hash_failure=True)
  self.assertEqual(outcome['status'],'BLOCKED_OR_FAIL');self.assertFalse(witness)
  self.assertEqual(files['builtin-dual-terminal.json']['evaluatedOutcome'],'BLOCKED_OR_FAIL')
  self.assertFalse(files['builtin-dual-cleanup.json']['safeToRunOtherApprovedCase'])
 def test_failed_cleanup_reseal_removes_former_terminal_pass_first(self):
  outcome,files,launch,witness=self.exercise(slow_terminal=6,cleanup_reseal_failure=True)
  self.assertEqual(outcome['status'],'BLOCKED_OR_FAIL');self.assertFalse(witness)
  self.assertNotIn('builtin-dual-terminal.json',files)
  self.assertIn('TERMINAL_REVOCATION_OR_RESEAL_FAILED',outcome['errors'])
 def test_initial_context_work_and_case_share_one_builtin_allowance(self):
  with tempfile.TemporaryDirectory() as d:
   temp=Path(d).resolve();evidence=temp/'evidence';evidence.mkdir();b=CaseBudget(5,clock=self.clock,alarms=False);self.clock.advance(4)
   ctx={'temp':temp,'evidence':evidence,'head':'a'*40,'tree':'b'*40,'node':Path('/synthetic/node'),'builtinBudget':b}
   with patch.object(run,'check_context',side_effect=lambda c:self.clock.advance(2)),patch.object(R,'supervise_bounded') as launch:
    result=run.run_case('builtin-dual',ctx)
   launch.assert_not_called();self.assertEqual(result['status'],'BLOCKED_OR_FAIL')
   self.assertEqual(result['timing']['activeSeconds'],6)
 def test_slow_cleanup_receipt_is_charged_and_sealed_as_blocked(self):
  outcome,files,launch,witness=self.exercise(slow_cleanup_receipt=6)
  self.assertFalse(witness);self.assertEqual(outcome['status'],'BLOCKED_OR_FAIL')
  self.assertFalse(files['builtin-dual-cleanup.json']['safeToRunOtherApprovedCase'])
  self.assertEqual(files['builtin-dual-terminal.json']['evaluatedOutcome'],'BLOCKED_OR_FAIL')
 def test_slow_receipt_hash_still_preserves_a_failed_terminal(self):
  outcome,files,launch,witness=self.exercise(slow_return_hash=6)
  self.assertFalse(witness);self.assertEqual(outcome['status'],'BLOCKED_OR_FAIL')
  self.assertIn('builtin-dual-terminal.json',files)
  self.assertEqual(files['builtin-dual-terminal.json']['evaluatedOutcome'],'BLOCKED_OR_FAIL')
 def test_initial_context_timeout_cleans_verified_owned_installation_without_a_child(self):
  with tempfile.TemporaryDirectory() as d:
   temp=Path(d).resolve();current=temp/'current';current.mkdir();evidence=temp/'evidence'
   args=SimpleNamespace(temp_dir=str(temp),evidence_dir=str(evidence),current_dir=str(current),expected_sha='a'*40,node='/synthetic/node')
   b=CaseBudget(5,clock=self.clock,alarms=False)
   def context(arguments,resources,budget):
    evidence.mkdir();resources.update(evidence=evidence,current=current);self.clock.advance(6)
    return {}
   with patch.object(run,'CaseBudget',return_value=b),patch.object(run.argparse.ArgumentParser,'parse_args',return_value=args),patch.object(run,'context',side_effect=context),patch.object(R,'supervise_bounded') as launch,redirect_stdout(io.StringIO()):
    exitcode=run.main()
   launch.assert_not_called();self.assertEqual(exitcode,2);self.assertFalse(current.exists())
   self.assertTrue((evidence/'preflight-receipt.json').is_file())
   sealed=json.loads((evidence/'preflight-cleanup.json').read_text())
   self.assertTrue(sealed['diagnosticPersisted']);self.assertTrue(sealed['temporaryDirectoryRemoved'])
 def test_actual_context_registers_owned_installation_before_slow_node_hash(self):
  with tempfile.TemporaryDirectory() as d:
   temp=Path(d).resolve();current=temp/'current';current.mkdir();evidence=temp/'evidence';node=temp/'synthetic-node';node.write_bytes(b'fixture')
   args=SimpleNamespace(temp_dir=str(temp),evidence_dir=str(evidence),current_dir=str(current),expected_sha='a'*40,node=str(node))
   b=CaseBudget(5,clock=self.clock,alarms=False)
   env={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':run.REPOSITORY,'GITHUB_EVENT_NAME':'push','GITHUB_REF':'refs/heads/'+run.BRANCH,'GITHUB_SHA':args.expected_sha}
   with patch.object(run,'CaseBudget',return_value=b),patch.object(run.argparse.ArgumentParser,'parse_args',return_value=args),patch.dict(run.os.environ,env,clear=True),patch.object(R,'NODE',None),patch.object(R,'NODE_SHA',None),patch.object(R,'NATIVE_SHA',None,create=True),patch.object(R,'checked_node',side_effect=lambda:self.clock.advance(6)),patch.object(R,'supervise_bounded') as launch,redirect_stdout(io.StringIO()):
    exitcode=run.main()
   launch.assert_not_called();self.assertEqual(exitcode,2);self.assertFalse(current.exists())
   self.assertTrue((evidence/'preflight-receipt.json').is_file());self.assertTrue((evidence/'preflight-cleanup.json').is_file())
 def test_expired_child_journal_is_projected_before_cleanup(self):
  with tempfile.TemporaryDirectory() as d:
   temp=Path(d).resolve();evidence=temp/'evidence';evidence.mkdir();b=CaseBudget(5,clock=self.clock,alarms=False)
   ctx={'temp':temp,'evidence':evidence,'head':'a'*40,'tree':'b'*40,'node':Path('/synthetic/node'),'builtinBudget':b}
   child=R.Capture(childCreated=True,childPID=999,returncode=74,processStopped=True,outputComplete=True,errorCategories=[])
   def prepare(root,context):
    directory=root/'builtin-observation-TRACE-0001';directory.mkdir()
    payload={'pid':999,'stage':'NATIVE_ADMISSION_REFUSED','terminalRefusalCategory':'PREFLIGHT_BOUNDARY_REFUSED','preflightBoundary':{'status':'CHECKED',**{name:name!='permissionReady' for name in run.B.PREFLIGHT_KEYS}},'untrusted':'UNTRUSTED_TEXT_MUST_NOT_PERSIST'}
    envelope={'schemaVersion':1,'scope':'ISOLATED_NATIVE_TEST_ONLY','durability':'NON_DURABLE','pid':999,'case':'builtin-dual','role':'TRACE','sequence':1,'payload':payload}
    (directory/'record.json').write_text(json.dumps(envelope))
   def supervise(*a,**k):self.clock.advance(6);return child
   with patch.object(run,'check_context'),patch.object(run,'prepare',side_effect=prepare),patch.object(run.B,'BUNDLE_PINS',{},create=True),patch.object(R,'supervise_bounded',side_effect=supervise),patch.dict(run.WITNESSES,{},clear=True):outcome=run.run_case('builtin-dual',ctx)
   sealed=json.loads((evidence/'builtin-dual-receipt.json').read_text());diagnostic=sealed['builtinObservationDiagnostic']
   self.assertEqual(outcome['status'],'BLOCKED_OR_FAIL');self.assertTrue(outcome['completion']['temporaryDirectoryRemoved'])
   self.assertEqual(diagnostic['preflightBoundary']['status'],'CHECKED');self.assertIs(diagnostic['preflightBoundary']['permissionReady'],False)
   self.assertEqual(diagnostic['trace']['terminalRefusalCategory'],'PREFLIGHT_BOUNDARY_REFUSED')
   self.assertNotIn('UNTRUSTED_TEXT_MUST_NOT_PERSIST',json.dumps(sealed))
 def test_expired_cold_journal_retains_only_safe_fixed_predicates(self):
  with tempfile.TemporaryDirectory() as d:
   temp=Path(d).resolve();evidence=temp/'evidence';evidence.mkdir();current=temp/'current';(current/'product').mkdir(parents=True)
   ctx={'temp':temp,'evidence':evidence,'current':current,'head':'a'*40,'tree':'b'*40,'node':Path('/synthetic/node'),'helpers':{}}
   b=CaseBudget(20,clock=self.clock,alarms=False)
   child=R.Capture(childCreated=True,childPID=999,returncode=0,processStopped=True,outputComplete=True,errorCategories=[])
   def prepare(root,context):
    directory=root/'builtin-observation-TRACE-0001';directory.mkdir()
    payload={'pid':999,'stage':'NATIVE_ADMISSION_REFUSED','preflightBoundary':{'status':'CHECKED',**{name:name!='architectureMatches' for name in run.B.PREFLIGHT_KEYS}},'untrusted':'UNTRUSTED_TEXT_MUST_NOT_PERSIST'}
    (directory/'record.json').write_text(json.dumps({'schemaVersion':1,'scope':'ISOLATED_NATIVE_TEST_ONLY','durability':'NON_DURABLE','pid':999,'case':'cold1','role':'TRACE','sequence':1,'payload':payload}))
   def supervise(*a,**k):self.clock.advance(21);return child
   with patch.object(run,'CaseBudget',return_value=b),patch.object(run,'verify_prior'),patch.object(run,'check_context'),patch.object(run,'prepare',side_effect=prepare),patch.object(R,'supervise_bounded',side_effect=supervise),patch.dict(run.WITNESSES,{},clear=True):outcome=run.run_case('cold1',ctx)
   sealed=json.loads((evidence/'cold1-receipt.json').read_text());diagnostic=sealed['coldObservationDiagnostic']
   self.assertEqual(outcome['status'],'BLOCKED_OR_FAIL');self.assertTrue(outcome['completion']['temporaryDirectoryRemoved'])
   self.assertIs(diagnostic['preflightBoundary']['architectureMatches'],False);self.assertEqual(diagnostic['scope'],'COLD_OBSERVATION_DIAGNOSTIC_ONLY')
   self.assertIsNone(sealed['runtimeTrace']);self.assertNotIn('UNTRUSTED_TEXT_MUST_NOT_PERSIST',json.dumps(sealed))

class MainBudgetIntegrationTests(unittest.TestCase):
 def exercise(self,slow_installation=0,slow_summary=0,slow_output=0,slow_cleanup=0):
  clock=Clock()
  with tempfile.TemporaryDirectory() as d:
   temp=Path(d).resolve();evidence=temp/'evidence';evidence.mkdir();current=temp/'current';current.mkdir()
   ctx={'temp':temp,'evidence':evidence,'current':current,'head':'a'*40,'tree':'b'*40,'installation':{},'installationRecordSHA256':'c'*64,'partition':{'legacyNativeNotIncluded':[]}}
   args=SimpleNamespace(temp_dir=str(temp),evidence_dir=str(evidence),current_dir=str(current),expected_sha='a'*40,node='/synthetic/node')
   budgets=[];writer=R.atomic_create;remover=R.shutil.rmtree;calls=[]
   def make_budget(limit):b=CaseBudget(limit,clock=clock,alarms=False);budgets.append(b);return b
   def case(name,context,prior):
    calls.append(name);b=context['builtinBudget'] if name=='builtin-dual' else make_budget(20);context['caseBudget']=b
    completion={'status':'CLEANUP_OK','diagnosticPersisted':True,'temporaryDirectoryRemoved':True,'safeToRunOtherApprovedCase':True}
    result={'case':name,'status':'PASS','errors':[],'pid':999,'processStopped':True,'completion':completion,'timing':b.snapshot()}
    for suffix,value in [('receipt',{}),('cleanup',completion),('terminal',{'case':name,'evaluatedOutcome':'PASS'})]:writer(evidence/(name+'-'+suffix+'.json'),value)
    run.WITNESSES[name]={'result':result,'hashes':{}}
    return result
   def write(path,value,**kwargs):
    if path.name=='installation-receipt.json':clock.advance(slow_installation)
    if path.name=='summary.json' and value.get('status')=='PASS':clock.advance(slow_summary)
    return writer(path,value,**kwargs)
   def remove(path):clock.advance(slow_cleanup);return remover(path)
   class Output(io.StringIO):
    charged=False
    def write(output,value):
     if slow_output and not output.charged and 'builtin-dual' in value:clock.advance(slow_output);output.charged=True
     return super().write(value)
   with patch.object(run,'CaseBudget',side_effect=make_budget),patch.object(run.argparse.ArgumentParser,'parse_args',return_value=args),patch.object(run,'context',return_value=ctx),patch.object(run,'run_case',side_effect=case),patch.object(R,'atomic_create',side_effect=write),patch.object(R.shutil,'rmtree',side_effect=remove),patch.dict(run.WITNESSES,{},clear=True),redirect_stdout(Output()):
    code=run.main();witnesses=set(run.WITNESSES)
   files={p.name:json.loads(p.read_text()) for p in evidence.glob('*.json')}
   return code,files,calls,budgets,witnesses,current.exists()
 def test_final_installation_receipt_is_charged_to_last_case(self):
  code,files,calls,budgets,witnesses,exists=self.exercise(slow_installation=21)
  self.assertEqual(code,2);self.assertFalse(exists);self.assertFalse(budgets[-1].snapshot()['withinBudget'])
  self.assertEqual(files['summary.json']['status'],'BLOCKED_OR_FAIL');self.assertNotIn('cold2',witnesses)
 def test_final_summary_write_cannot_leave_a_pass_after_expiration(self):
  code,files,calls,budgets,witnesses,exists=self.exercise(slow_summary=21)
  self.assertEqual(code,2);self.assertEqual(files['summary.json']['status'],'BLOCKED_OR_FAIL');self.assertNotIn('cold2',witnesses)
 def test_slow_result_output_blocks_the_next_case(self):
  code,files,calls,budgets,witnesses,exists=self.exercise(slow_output=6)
  self.assertEqual(code,2);self.assertEqual(calls,['builtin-dual']);self.assertEqual(files['summary.json']['status'],'BLOCKED_OR_FAIL')
  self.assertNotIn('builtin-dual',witnesses)
 def test_installation_cleanup_is_completed_and_separately_measured(self):
  code,files,calls,budgets,witnesses,exists=self.exercise(slow_cleanup=7)
  self.assertEqual(code,0);self.assertFalse(exists);self.assertEqual(budgets[-1].snapshot()['cleanupSeconds'],7)
  self.assertEqual(files['summary.json']['timing']['cleanupSeconds'],7)
if __name__=='__main__':unittest.main()
