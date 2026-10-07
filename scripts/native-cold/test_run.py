"""Supervisor failures use fake children only; never launch a real SDK or native loader."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import run
import supervisor as R
from contract import select_platform

class RunTests(unittest.TestCase):
    def test_preparation_failure_commits_diagnostic_before_removing_root(self):
        with tempfile.TemporaryDirectory() as d:
            temp=Path(d); evidence=temp/'evidence';evidence.mkdir()
            ctx={'temp':temp,'evidence':evidence,'head':'a'*40,'tree':'b'*40}
            original=R.persist_and_cleanup
            seen=[]
            def persist(root,receipt,cleanup,record,stopped,eligible):
                self.assertTrue(root.exists())
                self.assertFalse(record['process']['childCreated'])
                result=original(root,receipt,cleanup,record,stopped,eligible)
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

if __name__ == '__main__':
    unittest.main()
