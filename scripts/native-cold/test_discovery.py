"""Real bounded Node CLI; synthetic files only, no SDK/addons/network/model."""
import json,shutil,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import run
import supervisor as R
from contract import select_platform
from test_binding import fake_retention

class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        retain=patch.object(run.BC,'retain',side_effect=fake_retention);retain.start();self.addCleanup(retain.stop)
    def exercise(self,absolute=False):
        with tempfile.TemporaryDirectory() as d:
            temp=Path(d).resolve(strict=True);current=temp/'current';product=current/'product'
            (product/'test').mkdir(parents=True);(product/'scripts').mkdir()
            entry=json.loads((run.HERE/'partition.json').read_text())['migrations'][0]['to']
            (product/'scripts/test-safety.mjs').write_bytes((run.SOURCE/'scripts/test-safety.mjs').read_bytes())
            (product/entry).write_text("import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';test('SYNTHETIC_CLI_DISCOVERY_ORDER',()=>{assert.equal(process.execArgv.includes('--allow-addons'),false);assert.equal(fs.readFileSync(process.env.DSH_BOT_TEST_ROOT+'/preload-ready','utf8'),'READY');});\n")
            evidence=temp/'evidence';evidence.mkdir();node=Path(shutil.which('node')).resolve(strict=True)
            pins=select_platform(sys.platform,__import__('platform').machine())
            ctx={'temp':temp,'current':current,'evidence':evidence,'node':node,'head':'a'*40,'tree':'b'*40,'helpers':{}}
            observed={};supervise_cli=R.supervise_bounded
            def prepare(root,context):
                (root/'companion.mjs').write_text("import fs from 'node:fs';if(!process.env.DSH_HOME||!process.permission.has('fs.write',process.env.DSH_BOT_TEST_ROOT)||!fs.existsSync(process.env.DSH_HOME))throw Error('SYNTHETIC_GUARD_ORDER_REFUSED');fs.writeFileSync(process.env.DSH_BOT_TEST_ROOT+'/preload-ready','READY');\n")
            def supervise(args,cwd,env,deadline,**kwargs):
                self.assertEqual(cwd,product)
                self.assertEqual([a for a in args if a.startswith('--allow-fs-read=')],['--allow-fs-read='+str(run.SOURCE),'--allow-fs-read='+str(current),'--allow-fs-read='+env['DSH_BOT_TEST_ROOT']])
                self.assertEqual([a for a in args if a.startswith('--allow-fs-write=')],['--allow-fs-write='+env['DSH_BOT_TEST_ROOT']])
                self.assertEqual(set(env),R.ENV_KEYS)
                # Keep the actual production argv/cwd; synthetic CLI never admits addons.
                pure=[a for a in args if a!='--allow-addons']
                if absolute:pure[-1]=str(product/entry)
                with patch.object(R,'NODE',node),patch.object(R,'NODE_SHA',pins['node']['binarySHA256']):
                    capture=supervise_cli(pure,cwd,env,5,allow_addons=False,supervisor_signals=kwargs['supervisor_signals'])
                self.assertTrue(capture['processStopped']);self.assertTrue(capture['outputComplete']);self.assertEqual(capture['errorCategories'],[])
                stdout,stderr=capture.stdout,capture.stderr
                self.assertLessEqual(len(stdout),16384);self.assertLessEqual(len(stderr),16384)
                observed.update(returncode=capture['returncode'],counts=R.parse_output(stdout)[0],preloadReady=(Path(env['DSH_BOT_TEST_ROOT'])/'preload-ready').exists(),
                                diagnostic=run.C.collect_startup(stdout,stderr,capture['returncode'],None),entryRelative=not Path(args[-1]).is_absolute())
                return capture
            with patch.object(run,'check_context'),patch.object(run,'verify_prior'),patch.object(run,'prepare',side_effect=prepare),patch.object(R,'supervise_bounded',side_effect=supervise),patch.object(run,'collect_cold',side_effect=R.SafetyError('COLD_SEQUENCE_REFUSED')):
                result=run.run_case('cold1',ctx)
            self.assertEqual(result['status'],'BLOCKED_OR_FAIL')
            self.assertFalse(result['completion']['safeToRunOtherApprovedCase'])
            self.assertTrue(result['completion']['temporaryDirectoryRemoved'])
            return observed

    def test_bound_entry_discovers_after_original_guard_and_preload(self):
        observed=self.exercise()
        self.assertEqual(observed['returncode'],0,'BOUND_SYNTHETIC_LITERAL_NOT_DISCOVERED')
        self.assertTrue(observed['entryRelative'])
        self.assertTrue(observed['preloadReady'])
        self.assertEqual(observed['counts'].get('tests'),1)
        self.assertEqual(observed['counts'].get('pass'),1)
        self.assertEqual(observed['counts'].get('fail'),0)
        self.assertEqual(observed['counts'].get('skipped'),0)

    def test_absolute_literal_stays_refused_before_preload_under_same_grants(self):
        observed=self.exercise(absolute=True)
        self.assertEqual(observed['returncode'],1)
        self.assertFalse(observed['preloadReady'])
        self.assertEqual(observed['counts'],{})
        self.assertEqual(observed['diagnostic']['startupErrorCategory'],'NODE_TEST_INPUT_DISCOVERY')

if __name__=='__main__':unittest.main()
