"""Supervisor failures use fake children only; never launch a real SDK or native loader."""
import copy
import json
import tempfile
import unittest
import shutil
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import patch
import run
import supervisor as R
from contract import select_platform

class BuiltinDiagnosticTests(unittest.TestCase):
    def test_builtin_terminal_semantics_remain_valid_refused_and_unknown(self):
        trace=self.terminal()
        with patch.object(R,'NATIVE_SHA',select_platform('linux','x86_64')['bindings'][0]['sha256'],create=True):
            valid=run.B.observation_diagnostic({'TRACE':trace},{'TRACE':'TRACE_PRESENT'},{'inventoryValid':True},999)
            self.assertIs(valid['terminalValid'],True)
            trace['preflightBoundary']['permissionReady']=False
            refused=run.B.observation_diagnostic({'TRACE':trace},{'TRACE':'TRACE_PRESENT'},{'inventoryValid':True},999)
            self.assertIs(refused['terminalValid'],False)
            unknown=run.B.observation_diagnostic({'TRACE':{'stage':{},'untrusted':'UNTRUSTED_TEXT_MUST_NOT_PERSIST'}},{},{},None)
            self.assertIsNone(unknown['terminalValid']);self.assertEqual(unknown['trace']['stage'],'UNKNOWN')
            self.assertNotIn('UNTRUSTED_TEXT_MUST_NOT_PERSIST',json.dumps(unknown))
        for value in (valid,refused,unknown):self.assertNotIn('terminalValidityScope',value)

    def test_preflight_false_predicate_is_retained_and_never_admits(self):
        names=('caseRecognized','permissionReady','environmentRestricted','platformMatches','architectureMatches')
        for failed in names:
            trace=self.terminal();trace['preflightBoundary']={'status':'CHECKED',**{name:name!=failed for name in names}}
            result,sealed=self.exercise(trace);diagnostic=sealed['builtinObservationDiagnostic']
            self.assertIn('preflightBoundary',diagnostic)
            self.assertEqual(diagnostic['preflightBoundary'],trace['preflightBoundary'])
            self.assertEqual(result['status'],'BLOCKED_OR_FAIL')

    def test_preflight_unknown_and_non_boolean_fields_are_safely_projected(self):
        trace=self.terminal();trace['preflightBoundary']={'status':'UNTRUSTED_TEXT_MUST_NOT_PERSIST','caseRecognized':1,
            'permissionReady':'UNTRUSTED_TEXT_MUST_NOT_PERSIST','environmentRestricted':{},'platformMatches':[],
            'architectureMatches':None,'untrusted':'UNTRUSTED_TEXT_MUST_NOT_PERSIST'}
        result,sealed=self.exercise(trace);diagnostic=sealed['builtinObservationDiagnostic']
        self.assertIn('preflightBoundary',diagnostic)
        self.assertEqual(diagnostic['preflightBoundary']['status'],'UNKNOWN')
        for name in ('caseRecognized','permissionReady','environmentRestricted','platformMatches','architectureMatches'):
            self.assertIsNone(diagnostic['preflightBoundary'][name])
        self.assertNotIn('UNTRUSTED_TEXT_MUST_NOT_PERSIST',json.dumps(sealed))
        self.assertEqual(result['status'],'BLOCKED_OR_FAIL')

    def terminal(self):
        stamp='2026-10-07T00:00:00.000Z'
        identity={'scope':'UNKNOWN','contentSHA256':None,'packageIdentity':'UNKNOWN','payloadIdentity':'UNKNOWN','pathRelation':'UNKNOWN','isPathAlias':None,'unknownReason':'OUT_OF_SCOPE'}
        return {'pid':999,'startUTC':stamp,'endUTC':stamp,'stage':'NATIVE_ADMISSION_REFUSED','setupReady':False,
          'explicitApprovedAddonFlag':False,'environmentRestricted':True,'sqliteGuardVerified':True,'resolveCalls':0,'resolveCompleted':False,
          'resolveStartUTC':None,'resolveEndUTC':None,'resolveAgentPresent':None,'outerErrorCode':'UNRECORDED',
          'nativeLoadAttempts':1,'nativeLoads':0,'nativeAttempts':[{'index':1,'targetId':'UNKNOWN','admission':'DENY','reason':'OTHER_ADDON_LOAD_REFUSED','outcome':'NOT_CALLED','identity':identity}],
          'nativeCalls':0,'nativeCallStartUTC':None,'nativeCallEndUTC':None,'nativeCallbackErrno':None,'nativeReturnCategory':'UNRECORDED',
          'nativeFdOwned':False,'nativeFdIdentity':None,'nativeFdClosedBeforeExit':None,'networkAttempts':0,'spawnAttempts':0,'workerAttempts':0,
          'sqliteConstructAttempts':0,'modelAttempts':None,'boundaryRefusals':['OTHER_ADDON_LOAD_REFUSED'],'setupFailureCode':'NONE',
          'targetSHA256':select_platform('linux','x86_64')['bindings'][0]['sha256'],'systemLoads':0,'narbLoads':0,'narbInfoQueries':0,'narbRequireCalls':0,'narbCalls':[],
          'terminalRefusalCategory':'OTHER_ADDON_LOAD_REFUSED','installedIdentity':None,
          'preflightBoundary':{'status':'CHECKED',**{name:True for name in ('caseRecognized','permissionReady','environmentRestricted','platformMatches','architectureMatches')}}}

    def exercise(self,trace,*,invalid_envelope=False,read_failure=False,target_change=None,assertion_change=None,progress_change=None):
        with tempfile.TemporaryDirectory() as d:
            temp=Path(d).resolve(strict=True);evidence=temp/'evidence';evidence.mkdir()
            ctx={'temp':temp,'evidence':evidence,'head':'a'*40,'tree':'b'*40,'node':Path('/synthetic/node')}
            target={'pid':999,'version':'v24.19.0','case':'builtin-dual','targetId':'CATCH_FALLBACK_IMMEDIATE_STOP'}
            assertion={'pid':999,'case':'builtin-dual','assertionId':'H_FIRST_DENIED_DLOPEN','status':'IN_PROGRESS','errorCode':'UNRECORDED'}
            target.update(target_change or {});assertion.update(assertion_change or {})
            def prepare(root,context):
                for role,payload in [('TARGET',target),('ASSERTION',assertion),('TRACE',trace)]:
                    if payload is None:continue
                    directory=root/('builtin-observation-'+role+'-0001');directory.mkdir()
                    envelope={'schemaVersion':2 if invalid_envelope and role=='TRACE' else 1,'scope':'ISOLATED_NATIVE_TEST_ONLY','durability':'NON_DURABLE',
                              'pid':999,'case':'builtin-dual','role':role,'sequence':1,'payload':payload}
                    (directory/'record.json').write_text(json.dumps(envelope))
                progress={'pid':999,'version':'v24.19.0','mode':'catch-fallback','permission':True,'allowAddons':False,'actualNativeLoaderRetained':False,'syntheticSeededAttempts':0}
                progress.update(progress_change or {});(root/'builtin-progress.json').write_text(json.dumps(progress))
            child=R.Capture(childCreated=True,childPID=999,returncode=74,processStopped=True,outputComplete=True,errorCategories=[])
            seen={};original=R.persist_and_cleanup
            def persist(root,receipt,cleanup,record,stopped,eligible,**kwargs):
                def remove(path):
                    self.assertTrue(path.exists());self.assertTrue(receipt.is_file())
                    seen['receiptBeforeCleanup']=json.loads(receipt.read_text())
                    shutil.rmtree(path)
                return original(root,receipt,cleanup,record,stopped,eligible,remover=remove,**kwargs)
            failed_read=patch.object(run.B,'read_fixed',side_effect=OSError()) if read_failure else nullcontext()
            with patch.object(run,'check_context'),patch.object(run,'prepare',side_effect=prepare),patch.object(R,'supervise_bounded',return_value=child),patch.object(R,'persist_and_cleanup',side_effect=persist),patch.object(run.B,'BUNDLE_PINS',{},create=True),patch.object(R,'NATIVE_SHA',select_platform('linux','x86_64')['bindings'][0]['sha256'],create=True),patch.dict(run.WITNESSES,{},clear=True),failed_read:
                result=run.run_case('builtin-dual',ctx)
                if result['status']!='PASS':
                    with self.assertRaises(R.SafetyError):run.verify_prior('cold1',ctx,result)
            self.assertTrue(result['completion']['diagnosticPersisted']);self.assertTrue(result['completion']['temporaryDirectoryRemoved'])
            sealed=json.loads((evidence/'builtin-dual-receipt.json').read_text())
            self.assertEqual(sealed,seen['receiptBeforeCleanup'])
            self.assertIn('builtinObservationDiagnostic',sealed)
            return result,sealed

    def test_rejected_terminal_is_projected_before_cleanup_without_untrusted_text(self):
        trace={'pid':999,'stage':'COMPANION_SETUP_FAILED','setupFailureCode':'ERR_ASSERTION','terminalRefusalCategory':'SQLITE_GUARD_BINDING_REFUSED',
               'nativeLoadAttempts':0,'nativeLoads':0,'nativeCalls':0,'untrusted':'UNTRUSTED_TEXT_MUST_NOT_PERSIST'}
        result,sealed=self.exercise(trace);diagnostic=sealed['builtinObservationDiagnostic']
        self.assertEqual(result['status'],'BLOCKED_OR_FAIL');self.assertFalse(result['completion']['safeToRunOtherApprovedCase'])
        self.assertIsNone(sealed['runtimeTrace']);self.assertFalse(diagnostic['terminalValid'])
        self.assertTrue(diagnostic['inventoryValid']);self.assertEqual(diagnostic['recordCounts']['TRACE'],1)
        self.assertEqual(diagnostic['roles']['TRACE'],'TRACE_PRESENT')
        self.assertEqual(diagnostic['trace']['stage'],'COMPANION_SETUP_FAILED')
        self.assertEqual(diagnostic['trace']['setupFailureCode'],'ERR_ASSERTION')
        self.assertEqual(diagnostic['trace']['terminalRefusalCategory'],'SQLITE_GUARD_BINDING_REFUSED')
        self.assertEqual(diagnostic['validationFailureCategory'],'BUILTIN_TRACE_REFUSED')
        self.assertNotIn('UNTRUSTED_TEXT_MUST_NOT_PERSIST',json.dumps(sealed))

    def test_missing_trace_retains_missing_role_and_keeps_cold_blocked(self):
        result,sealed=self.exercise(None);diagnostic=sealed['builtinObservationDiagnostic']
        self.assertEqual(result['status'],'BLOCKED_OR_FAIL')
        self.assertEqual(diagnostic['roles']['TRACE'],'TRACE_MISSING');self.assertEqual(diagnostic['recordCounts']['TRACE'],0)
        self.assertFalse(diagnostic['tracePresent']);self.assertFalse(diagnostic['terminalValid'])

    def test_invalid_envelope_retains_invalid_status_without_payload(self):
        result,sealed=self.exercise({'pid':999,'untrusted':'UNTRUSTED_TEXT_MUST_NOT_PERSIST'},invalid_envelope=True)
        diagnostic=sealed['builtinObservationDiagnostic'];self.assertEqual(result['status'],'BLOCKED_OR_FAIL')
        self.assertFalse(diagnostic['inventoryValid']);self.assertEqual(diagnostic['roles']['TRACE'],'TRACE_INVALID')
        self.assertFalse(diagnostic['tracePresent']);self.assertNotIn('UNTRUSTED_TEXT_MUST_NOT_PERSIST',json.dumps(sealed))

    def test_read_failure_retains_read_failed_role(self):
        result,sealed=self.exercise({'pid':999},read_failure=True)
        self.assertEqual(result['status'],'BLOCKED_OR_FAIL')
        self.assertEqual(sealed['builtinObservationDiagnostic']['roles']['TRACE'],'TRACE_READ_FAILED')

    def test_bad_types_and_ranges_are_unknown_and_never_admit(self):
        result,sealed=self.exercise({'pid':999,'stage':{},'setupFailureCode':[],'terminalRefusalCategory':'UNTRUSTED_TEXT_MUST_NOT_PERSIST',
                                    'nativeLoadAttempts':True,'nativeLoads':1000,'nativeCalls':-1})
        trace=sealed['builtinObservationDiagnostic']['trace'];self.assertEqual(result['status'],'BLOCKED_OR_FAIL')
        for key in ('stage','setupFailureCode','terminalRefusalCategory'):self.assertEqual(trace[key],'UNKNOWN')
        for key in ('nativeLoadAttempts','nativeLoads','nativeCalls'):self.assertIsNone(trace[key])
        self.assertNotIn('UNTRUSTED_TEXT_MUST_NOT_PERSIST',json.dumps(sealed))

    def test_valid_synthetic_terminal_still_requires_the_original_complete_contract(self):
        result,sealed=self.exercise(self.terminal());self.assertEqual(result['status'],'PASS')
        self.assertTrue(sealed['builtinObservationDiagnostic']['terminalValid'])
        self.assertIsNone(sealed['builtinObservationDiagnostic']['validationFailureCategory'])
        for field,value in [('sqliteGuardVerified',False),('nativeLoads',1),('setupFailureCode','ERR_ASSERTION')]:
            trace=self.terminal();trace[field]=value;result,sealed=self.exercise(trace)
            self.assertEqual(result['status'],'BLOCKED_OR_FAIL',field)
            self.assertFalse(sealed['builtinObservationDiagnostic']['terminalValid'])

    def test_valid_terminal_never_authorizes_bad_target_assertion_or_progress(self):
        for changes,category in [({'target_change':{'version':'UNTRUSTED_TEXT_MUST_NOT_PERSIST'}},'BUILTIN_TARGET_REFUSED'),
                                 ({'assertion_change':{'assertionId':'C_SQLITE_CJS_IMPORT'}},'BUILTIN_ASSERTION_REFUSED'),
                                 ({'progress_change':{'allowAddons':True}},'BUILTIN_PROGRESS_REFUSED')]:
            result,sealed=self.exercise(self.terminal(),**changes);diagnostic=sealed['builtinObservationDiagnostic']
            self.assertTrue(diagnostic['terminalValid']);self.assertEqual(diagnostic['validationFailureCategory'],category)
            self.assertEqual(result['status'],'BLOCKED_OR_FAIL');self.assertFalse(result['completion']['safeToRunOtherApprovedCase'])
            self.assertNotIn('UNTRUSTED_TEXT_MUST_NOT_PERSIST',json.dumps(sealed))

class ColdDiagnosticTests(unittest.TestCase):
    def collect(self,trace):
        diagnostic={};pid=trace['pid']
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();directory=root/'builtin-observation-TRACE-0001';directory.mkdir()
            (directory/'record.json').write_text(json.dumps({'schemaVersion':1,'scope':'ISOLATED_NATIVE_TEST_ONLY','durability':'NON_DURABLE',
                'pid':pid,'case':'cold1','role':'TRACE','sequence':1,'payload':trace}))
            try:result=run.collect_cold(root,pid,'cold1',{},diagnostic)
            except R.SafetyError as error:result=error.code
        self.assertIsNone(diagnostic['terminalValid'])
        self.assertEqual(diagnostic['terminalValidityScope'],'NOT_APPLICABLE_TO_COLD')
        self.assertEqual(diagnostic['scope'],'COLD_OBSERVATION_DIAGNOSTIC_ONLY')
        return result,diagnostic

    def fixture(self):
        run.T.configure(select_platform('linux','x86_64'))
        return json.loads((Path(__file__).parent/'trace-fixture.json').read_text())

    def eligible(self,data):
        return run.T.cold_eligible(trace=data['trace'],counts=data['counts'],diagnostics=data['diagnostics'],returncode=0,
            stopped=True,complete=True,errors=[],pins=True)

    def test_valid_cold_marks_builtin_terminal_validation_not_applicable_without_blocking_admission(self):
        data=self.fixture();self.assertTrue(self.eligible(data));result,diagnostic=self.collect(data['trace'])
        self.assertIsInstance(result,tuple);self.assertTrue(self.eligible(data))
        self.assertIs(diagnostic['preflightBoundary']['permissionReady'],True)

    def test_refused_cold_keeps_false_predicate_and_original_admission_refusal(self):
        data=self.fixture();data['trace']['preflightBoundary']['permissionReady']=False
        self.assertFalse(self.eligible(data));result,diagnostic=self.collect(data['trace'])
        self.assertIsInstance(result,tuple);self.assertFalse(self.eligible(data))
        self.assertIs(diagnostic['preflightBoundary']['permissionReady'],False)

    def test_unknown_cold_fields_are_safe_and_never_become_builtin_false_or_admission(self):
        data=self.fixture();data['trace']['stage']={};data['trace']['preflightBoundary']['permissionReady']='UNTRUSTED_TEXT_MUST_NOT_PERSIST'
        self.assertFalse(self.eligible(data));result,diagnostic=self.collect(data['trace'])
        self.assertEqual(result,'COLD_TRACE_REFUSED');self.assertEqual(diagnostic['trace']['stage'],'UNKNOWN')
        self.assertIsNone(diagnostic['preflightBoundary']['permissionReady'])
        self.assertNotIn('UNTRUSTED_TEXT_MUST_NOT_PERSIST',json.dumps(diagnostic))
        initial=run.cold_observation_diagnostic({}, {}, {},None)
        self.assertIsNone(initial['terminalValid']);self.assertEqual(initial['terminalValidityScope'],'NOT_APPLICABLE_TO_COLD')
        self.assertEqual(initial['scope'],'COLD_OBSERVATION_DIAGNOSTIC_ONLY')

class RunTests(unittest.TestCase):
    def test_preparation_failure_commits_diagnostic_before_removing_root(self):
        with tempfile.TemporaryDirectory() as d:
            temp=Path(d); evidence=temp/'evidence';evidence.mkdir()
            ctx={'temp':temp,'evidence':evidence,'head':'a'*40,'tree':'b'*40}
            original=R.persist_and_cleanup
            seen=[]
            def persist(root,receipt,cleanup,record,stopped,eligible,**kwargs):
                self.assertTrue(root.exists())
                self.assertFalse(record['process']['childCreated'])
                result=original(root,receipt,cleanup,record,stopped,eligible,**kwargs)
                seen.append(result['diagnosticPersisted'] and result['temporaryDirectoryRemoved'])
                return result
            with patch.object(run,'check_context'),patch.object(run,'prepare',side_effect=OSError()),patch.object(R,'persist_and_cleanup',side_effect=persist):
                result=run.run_case('builtin-dual',ctx)
            self.assertEqual(result['status'],'BLOCKED_OR_FAIL')
            self.assertEqual(seen,[True])
            self.assertIsNone(result['pid'])
            self.assertTrue((evidence/'builtin-dual-terminal.json').is_file())

    def test_handler_restore_failure_blocks_a_clean_child_and_followup(self):
        class BrokenRestore:
            received=None
            interruptible=False
            def __enter__(self):return self
            def __exit__(self,*args):raise OSError()
        with tempfile.TemporaryDirectory() as d:
            temp=Path(d); evidence=temp/'evidence';evidence.mkdir()
            ctx={'temp':temp,'evidence':evidence,'head':'a'*40,'tree':'b'*40,'node':Path('/synthetic/node')}
            child=R.Capture(childCreated=True,childPID=999,returncode=74,processStopped=True,outputComplete=True,errorCategories=[])
            with patch.object(run,'check_context'),patch.object(run,'prepare'),patch.object(R,'SupervisorSignals',BrokenRestore),patch.object(R,'supervise_bounded',return_value=child),patch.object(run,'builtin_observation',return_value=({'stage':'NATIVE_ADMISSION_REFUSED'},{})):
                result=run.run_case('builtin-dual',ctx)
            self.assertEqual(result['status'],'BLOCKED_OR_FAIL')
            self.assertIn('SIGNAL_GUARD_RESTORE_FAILED',result['errors'])
            self.assertNotIn('builtin-dual',run.WITNESSES)

    def test_collector_exception_still_persists_and_cleans_up(self):
        with tempfile.TemporaryDirectory() as d:
            temp=Path(d); evidence=temp/'evidence';evidence.mkdir()
            ctx={'temp':temp,'evidence':evidence,'head':'a'*40,'tree':'b'*40}
            with patch.object(run,'check_context'),patch.object(run,'prepare',side_effect=OSError()),patch.object(run.C,'collect_startup',side_effect=ValueError()):
                result=run.run_case('builtin-dual',ctx)
            self.assertEqual(result['status'],'BLOCKED_OR_FAIL')
            self.assertTrue(result['completion']['diagnosticPersisted'])
            self.assertTrue(result['completion']['temporaryDirectoryRemoved'])

    def test_unverified_prior_case_never_prepares_a_child(self):
        with patch.object(run, 'prepare') as prepare:
            with self.assertRaises(R.SafetyError):
                run.run_case('cold2', {}, None)
            prepare.assert_not_called()

    def test_retained_output_is_bounded_and_full_stream_hashed(self):
        import capture
        stream=capture.Stream()
        stream.feed(b'a'*17000)
        self.assertEqual(len(stream.raw),16384)
        self.assertEqual(stream.metadata()['bytes'],17000)
        self.assertFalse(stream.metadata()['completeWithinLimit'])

    def test_diagnostic_failure_blocks_cleanup_and_followup(self):
        events=[]
        def fail(path,record):
            events.append('diagnostic')
            raise OSError()
        result=R.persist_and_cleanup(Path('/synthetic/root'),Path('/synthetic/receipt'),Path('/synthetic/cleanup'),{},True,True,writer=fail,remover=lambda p:events.append('cleanup'))
        self.assertEqual(events,['diagnostic'])
        self.assertFalse(result['safeToRunOtherApprovedCase'])

    def test_cleanup_failure_cannot_return_success(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); events=[]
            def remove(path):
                events.append('cleanup')
                raise OSError()
            def write(path,value):
                events.append('diagnostic' if path.name=='receipt' else 'completion')
                path.write_text(json.dumps(value))
            result=R.persist_and_cleanup(root/'child',root/'receipt',root/'completion',{},True,True,writer=write,remover=remove)
            self.assertEqual(events,['diagnostic','cleanup','completion'])
            self.assertFalse(result['safeToRunOtherApprovedCase'])

    def test_linux_trace_cannot_authorize_mac(self):
        from trace_policy import configure, trace_valid
        configure(select_platform('darwin','arm64'))
        self.assertFalse(trace_valid({'pid':123,'targetSHA256':'54a9c25c05186c17520f6b7a5ced5f005752c08044c3eb76524cd517287600bc'},123))

    def test_complete_cold_trace_accepts_both_independently_pinned_platforms(self):
        from trace_policy import configure, cold_eligible
        fixture=json.loads((Path(__file__).parent/'trace-fixture.json').read_text())
        linux=select_platform('linux','x86_64');mac=select_platform('darwin','arm64')
        for pins in (linux,mac):
            data=copy.deepcopy(fixture)
            for old,new in zip(linux['bindings'],pins['bindings']):
                for event in data['trace']['nativeAttempts']:
                    if event['identity']['contentSHA256']==old['sha256']:
                        event['identity'].update(contentSHA256=new['sha256'],packageIdentity=new['package'],payloadIdentity=new['payloadIdentity'])
            data['trace']['targetSHA256']=pins['bindings'][0]['sha256']
            configure(pins)
            self.assertTrue(cold_eligible(trace=data['trace'],counts=data['counts'],diagnostics=data['diagnostics'],returncode=0,stopped=True,complete=True,errors=[],pins=True))

    def test_failure_uncertainty_alias_and_omission_block_continuation(self):
        from trace_policy import configure, cold_eligible
        fixture=json.loads((Path(__file__).parent/'trace-fixture.json').read_text())
        configure(select_platform('linux','x86_64'))
        changes=[('modelAttempts',1),('modelAttempts',None),('networkAttempts',1),('spawnAttempts',1),('workerAttempts',1),('sqliteConstructAttempts',1),
                 ('resolveCalls',2),('resolveCompleted',False),('resolveAgentPresent',False),('nativeLoads',1),('nativeCalls',0),
                 ('narbInfoQueries',3),('narbRequireCalls',2),('nativeFdClosedBeforeExit',False),('nativeCallbackErrno',1),('sqliteGuardVerified',False)]
        for key,value in changes:
            data=copy.deepcopy(fixture);data['trace'][key]=value
            self.assertFalse(cold_eligible(trace=data['trace'],counts=data['counts'],diagnostics=data['diagnostics'],returncode=0,stopped=True,complete=True,errors=[],pins=True),key)
        for kind in ('alias','unknownHash','skipped','missingDiagnostic','cancelled','missingPass'):
            data=copy.deepcopy(fixture)
            if kind=='alias':data['trace']['nativeAttempts'][1]['identity']['isPathAlias']=True
            elif kind=='unknownHash':data['trace']['nativeAttempts'][1]['identity']['contentSHA256']='f'*64
            elif kind=='missingDiagnostic':data['diagnostics']=[]
            elif kind=='missingPass':data['counts']['pass']=0
            else:data['counts'][kind]=1
            self.assertFalse(cold_eligible(trace=data['trace'],counts=data['counts'],diagnostics=data['diagnostics'],returncode=0,stopped=True,complete=True,errors=[],pins=True),kind)
        for field in ('checkedBefore','checkedAfter'):
            data=copy.deepcopy(fixture);data['trace']['installedIdentity'][field]=False
            self.assertFalse(cold_eligible(trace=data['trace'],counts=data['counts'],diagnostics=data['diagnostics'],returncode=0,stopped=True,complete=True,errors=[],pins=True),field)
        for name in ('caseRecognized','permissionReady','environmentRestricted','platformMatches','architectureMatches'):
            for value in (False,None,1,'UNTRUSTED_TEXT_MUST_NOT_PERSIST'):
                data=copy.deepcopy(fixture);data['trace']['preflightBoundary'][name]=value
                self.assertFalse(cold_eligible(trace=data['trace'],counts=data['counts'],diagnostics=data['diagnostics'],returncode=0,stopped=True,complete=True,errors=[],pins=True),name)
        for value in (None,{}, {'status':'NOT_CHECKED',**{key:None for key in run.B.PREFLIGHT_KEYS}}):
            data=copy.deepcopy(fixture);data['trace']['preflightBoundary']=value
            self.assertFalse(cold_eligible(trace=data['trace'],counts=data['counts'],diagnostics=data['diagnostics'],returncode=0,stopped=True,complete=True,errors=[],pins=True))

if __name__ == '__main__':
    unittest.main()
