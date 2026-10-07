"""Original owned config bytes and synthetic observations only; no real credentials/SDK/native."""
import hashlib,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import supervisor as R
from contract import select_platform
try:import binding_config as BC
except ModuleNotFoundError:BC=None

FAKE_BYTES=b'{"scope":"SYNTHETIC_BINDING_CAPABILITY_FIXTURE_ONLY"}'
FAKE_SHA=hashlib.sha256(FAKE_BYTES).hexdigest()
FAKE_OBSERVATION={'status':'READ_MATCHED','sha256':FAKE_SHA,'expectedSHA256':FAKE_SHA,'pinsPlatform':'linux','pinsArch':'x64'}
def fake_retention(root,ctx,case,source):
 """Explicit fake capability for unrelated case/budget tests, never actual evidence."""
 result={'status':'FAKE_CAPABILITY_ONLY','file':case+'-binding-config.json','sha256':FAKE_SHA,'parentPinsPlatform':'linux','parentPinsArch':'x64'}
 R.atomic_create_bytes(ctx['evidence']/result['file'],FAKE_BYTES)
 R.atomic_create(ctx['evidence']/(case+'-binding-config-receipt.json'),result)
 return result

class BindingConfigTests(unittest.TestCase):
 def setUp(self):self.assertIsNotNone(BC,'BINDING_CONFIG_RETENTION_MISSING')
 def fixture(self,temp):
  source=temp/'source';source.mkdir();current=temp/'current';current.mkdir();root=temp/'case';root.mkdir();evidence=temp/'evidence';evidence.mkdir()
  ctx={'temp':temp,'current':current,'evidence':evidence,'pins':select_platform('linux','x86_64'),'head':'a'*40,'tree':'b'*40,
   'installationRecordSHA256':'c'*64,'installation':{'sdkManifestSHA256':'d'*64,'packageSHA256':'e'*64}}
  value={'source':str(source),'pins':ctx['pins'],'installed':{'current':str(current),'recordSHA256':'c'*64,
   'sdkManifestSHA256':'d'*64,'packageSHA256':'e'*64,'head':'a'*40,'tree':'b'*40}}
  return source,root,evidence,ctx,value
 def test_retained_file_is_exact_original_bytes_and_hash_not_reconstruction(self):
  with tempfile.TemporaryDirectory() as d:
   source,root,evidence,ctx,value=self.fixture(Path(d).resolve());raw=(json.dumps(value,indent=7)+' \n').encode();(root/'binding-config.json').write_bytes(raw)
   result=BC.retain(root,ctx,'builtin-dual',source)
   self.assertEqual((evidence/'builtin-dual-binding-config.json').read_bytes(),raw)
   self.assertEqual(result['sha256'],hashlib.sha256(raw).hexdigest());self.assertEqual(result['status'],'RETAINED_ORIGINAL_SAFE_BYTES')
   self.assertEqual(result['parentPinsPlatform'],'linux');self.assertEqual(result['parentPinsArch'],'x64')
 def test_secret_or_extra_fields_are_refused_without_copying_or_printing_value(self):
  for change in ('extra','pins','installed'):
   with tempfile.TemporaryDirectory() as d:
    source,root,evidence,ctx,value=self.fixture(Path(d).resolve())
    if change=='extra':value['apiKey']='SYNTHETIC_SENSITIVE_SENTINEL'
    else:value[change]['authorization']='SYNTHETIC_SENSITIVE_SENTINEL'
    (root/'binding-config.json').write_text(json.dumps(value))
    with self.assertRaises(R.SafetyError) as caught:BC.retain(root,ctx,'builtin-dual',source)
    self.assertEqual(caught.exception.code,'BINDING_CONFIG_UNAPPROVED_CONTENT_REFUSED')
    self.assertEqual(list(evidence.iterdir()),[]);self.assertNotIn('SYNTHETIC_SENSITIVE_SENTINEL',str(caught.exception))
 def test_symlink_and_duplicate_key_inputs_are_refused_without_raw_archive(self):
  for change in ('symlink','duplicate'):
   with tempfile.TemporaryDirectory() as d:
    source,root,evidence,ctx,value=self.fixture(Path(d).resolve());path=root/'binding-config.json'
    if change=='symlink':target=root/'other';target.write_text(json.dumps(value));path.symlink_to(target)
    else:path.write_text('{"source":"first",'+json.dumps(value)[1:])
    with self.assertRaises(R.SafetyError):BC.retain(root,ctx,'builtin-dual',source)
    self.assertEqual(list(evidence.iterdir()),[])
 def test_child_binding_requires_match_safe_actual_pins_and_expected_original_sha(self):
  expected={'sha256':'a'*64,'parentPinsPlatform':'darwin','parentPinsArch':'arm64'}
  good={'status':'READ_MATCHED','sha256':'a'*64,'expectedSHA256':'a'*64,'pinsPlatform':'darwin','pinsArch':'arm64'}
  self.assertTrue(BC.matches(good,expected))
  for key,value in [('sha256','b'*64),('expectedSHA256','b'*64),('pinsPlatform','UNKNOWN'),('pinsArch','x64'),('status','READ_HASH_MISMATCH')]:
   bad={**good,key:value};self.assertFalse(BC.matches(bad,expected))
  for key in good:
   bad=good.copy();del bad[key];self.assertFalse(BC.matches(bad,expected))
 def test_unknown_child_projection_does_not_copy_arbitrary_fields(self):
  bad={'status':'SYNTHETIC_SENSITIVE_SENTINEL','sha256':1,'expectedSHA256':{},'pinsPlatform':[],'pinsArch':'SYNTHETIC_SENSITIVE_SENTINEL','secret':'SYNTHETIC_SENSITIVE_SENTINEL'}
  projected=BC.project(bad)
  self.assertEqual(projected,{'status':'UNKNOWN','sha256':None,'expectedSHA256':None,'pinsPlatform':'UNKNOWN','pinsArch':'UNKNOWN'})
  self.assertNotIn('SYNTHETIC_SENSITIVE_SENTINEL',json.dumps(projected))
 def test_source_change_after_exact_copy_is_refused_and_original_archive_is_preserved(self):
  with tempfile.TemporaryDirectory() as d:
   source,root,evidence,ctx,value=self.fixture(Path(d).resolve());path=root/'binding-config.json';raw=json.dumps(value).encode();path.write_bytes(raw)
   writer=R.atomic_create_bytes
   def changed(destination,original,**kwargs):
    result=writer(destination,original,**kwargs);path.write_bytes(raw+b' ');return result
   with patch.object(R,'atomic_create_bytes',side_effect=changed),self.assertRaises(R.SafetyError) as caught:
    BC.retain(root,ctx,'builtin-dual',source)
   self.assertEqual(caught.exception.code,'BINDING_CONFIG_CHANGED_REFUSED')
   self.assertEqual((evidence/'builtin-dual-binding-config.json').read_bytes(),raw)
   self.assertFalse((evidence/'builtin-dual-binding-config-receipt.json').exists())
class BindingRunnerIntegrationTests(unittest.TestCase):
 def exercise(self,*,mac=False,preparation_failure=False,child_mismatch=False,archive_failure=False,unsafe=False):
  import run
  from test_run import BuiltinDiagnosticTests
  with tempfile.TemporaryDirectory() as d:
   temp=Path(d).resolve();current=temp/'current';current.mkdir();evidence=temp/'evidence';evidence.mkdir();roots=[];original=[];calls=[]
   pins=select_platform('darwin','arm64') if mac else select_platform('linux','x86_64')
   ctx={'temp':temp,'current':current,'evidence':evidence,'pins':pins,'head':'a'*40,'tree':'b'*40,'node':Path('/synthetic/node'),
    'helpers':{},'installationRecordSHA256':'c'*64,'installation':{'sdkManifestSHA256':'d'*64,'packageSHA256':'e'*64}}
   prepare=run.prepare;write_bytes=R.atomic_create_bytes
   def prepared(root,context):
    roots.append(root);prepare(root,context)
    if unsafe:
     value=json.loads((root/'binding-config.json').read_text());value['apiKey']='SYNTHETIC_SENSITIVE_SENTINEL';(root/'binding-config.json').write_text(json.dumps(value))
    original.append((root/'binding-config.json').read_bytes())
    if preparation_failure:raise R.SafetyError('SYNTHETIC_PREPARATION_REFUSED')
   def archive(path,raw,**kwargs):
    if archive_failure and path.name=='builtin-dual-binding-config.json':raise R.SafetyError('EVIDENCE_WRITE_FAILED')
    return write_bytes(path,raw,**kwargs)
   def supervise(args,cwd,env,*a,**k):
    calls.append(True);root=Path(env['DSH_BOT_TEST_ROOT']);raw=(root/'binding-config.json').read_bytes();digest=hashlib.sha256(raw).hexdigest()
    self.assertEqual((evidence/'builtin-dual-binding-config.json').read_bytes(),raw)
    self.assertTrue((evidence/'builtin-dual-binding-config-receipt.json').is_file())
    self.assertTrue(any(arg.endswith('?builtin-dual#'+digest) for arg in args))
    observation={'status':'READ_HASH_MISMATCH' if child_mismatch else 'READ_MATCHED','sha256':'f'*64 if child_mismatch else digest,
     'expectedSHA256':digest,'pinsPlatform':pins['platform'],'pinsArch':pins['arch']}
    trace=BuiltinDiagnosticTests().terminal();trace['bindingConfig']=observation;trace['targetSHA256']=pins['bindings'][0]['sha256']
    target={'pid':999,'version':'v24.19.0','case':'builtin-dual','targetId':'CATCH_FALLBACK_IMMEDIATE_STOP'}
    assertion={'pid':999,'case':'builtin-dual','assertionId':'H_FIRST_DENIED_DLOPEN','status':'IN_PROGRESS','errorCode':'UNRECORDED'}
    for role,payload in [('TRACE',trace),('TARGET',target),('ASSERTION',assertion)]:
     folder=root/('builtin-observation-'+role+'-0001');folder.mkdir()
     (folder/'record.json').write_text(json.dumps({'schemaVersion':1,'scope':'ISOLATED_NATIVE_TEST_ONLY','durability':'NON_DURABLE','pid':999,'case':'builtin-dual','role':role,'sequence':1,'payload':payload}))
    (root/'builtin-progress.json').write_text(json.dumps({'pid':999,'version':'v24.19.0','mode':'catch-fallback','permission':True,'allowAddons':False,'actualNativeLoaderRetained':False,'syntheticSeededAttempts':0}))
    return R.Capture(childCreated=True,childPID=999,returncode=74,processStopped=True,outputComplete=True,errorCategories=[])
   with patch.object(run,'check_context'),patch.object(run,'prepare',side_effect=prepared),patch.object(R,'supervise_bounded',side_effect=supervise),patch.object(R,'atomic_create_bytes',side_effect=archive),patch.object(run.B,'BUNDLE_PINS',{},create=True),patch.object(R,'NATIVE_SHA',pins['bindings'][0]['sha256'],create=True),patch.dict(run.WITNESSES,{},clear=True):
    result=run.run_case('builtin-dual',ctx);witness='builtin-dual' in run.WITNESSES
   copy=evidence/'builtin-dual-binding-config.json';raw=copy.read_bytes() if copy.exists() else None
   receipt=json.loads((evidence/'builtin-dual-receipt.json').read_text())
   return result,receipt,raw,original[0],len(calls),witness,roots[0].exists()
 def test_original_config_retention_and_child_binding_precede_cleanup_on_both_platforms(self):
  for mac in (False,True):
   result,receipt,raw,original,calls,witness,root_exists=self.exercise(mac=mac)
   self.assertEqual(result['status'],'PASS');self.assertTrue(witness);self.assertEqual(calls,1);self.assertFalse(root_exists)
   self.assertEqual(raw,original);self.assertEqual(receipt['bindingConfigEvidence']['sha256'],hashlib.sha256(original).hexdigest())
   self.assertTrue(receipt['childBindingConfirmed']);self.assertEqual(receipt['runtimeTrace']['bindingConfig']['pinsPlatform'],'darwin' if mac else 'linux')
 def test_preparation_failure_retains_existing_original_config_without_launch(self):
  result,receipt,raw,original,calls,witness,root_exists=self.exercise(preparation_failure=True)
  self.assertEqual(result['status'],'BLOCKED_OR_FAIL');self.assertFalse(witness);self.assertEqual(calls,0);self.assertFalse(root_exists)
  self.assertEqual(raw,original);self.assertFalse(receipt['childBindingConfirmed'])
 def test_child_hash_mismatch_keeps_original_and_safe_diagnostic_but_blocks_admission(self):
  result,receipt,raw,original,calls,witness,root_exists=self.exercise(child_mismatch=True)
  self.assertEqual(result['status'],'BLOCKED_OR_FAIL');self.assertFalse(witness);self.assertEqual(raw,original)
  self.assertEqual(receipt['builtinObservationDiagnostic']['bindingConfig']['status'],'READ_HASH_MISMATCH')
  self.assertFalse(receipt['childBindingConfirmed']);self.assertFalse(root_exists)
 def test_archive_failure_never_launches_or_deletes_unretained_original(self):
  result,receipt,raw,original,calls,witness,root_exists=self.exercise(archive_failure=True)
  self.assertEqual(calls,0);self.assertFalse(witness);self.assertIsNone(raw);self.assertTrue(root_exists)
  self.assertEqual(result['completion']['status'],'BINDING_EVIDENCE_NOT_PERSISTED');self.assertFalse(result['completion']['temporaryDirectoryRemoved'])
 def test_unapproved_sensitive_fixture_is_not_archived_or_exposed(self):
  result,receipt,raw,original,calls,witness,root_exists=self.exercise(unsafe=True)
  self.assertEqual(calls,0);self.assertIsNone(raw);self.assertFalse(witness)
  self.assertNotIn('SYNTHETIC_SENSITIVE_SENTINEL',json.dumps(receipt));self.assertNotIn('SYNTHETIC_SENSITIVE_SENTINEL',json.dumps(result))
if __name__=='__main__':unittest.main()
