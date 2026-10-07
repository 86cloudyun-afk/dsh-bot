/** Fresh single-Bot Loader profile. Installs product bytes; never copies a Home or credentials. */
import {mkdir, writeFile, realpath} from 'node:fs/promises';
import {join, resolve, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {installProductPackage} from './package-snapshot.mjs';

const disabled = [
  'preset-standard','preset-ptc','preset-minimal','preset-cordis',
  'tool-plugin-manager','tool-bash','tool-pwsh','tool-jobs','tool-fs','tool-fs-search',
  'tool-skill','tool-subagent-control','tool-subagent-list-agents','tool-subagent',
  'tool-subagent-fork','tool-workflow','tool-result-pruner','tool-todo','tool-goal','tool-ralph','tool-web',
  'agent-instructions','skill-filesystem','compaction-basic','command-compact','workflow-ptc',
  'session-title-llm','llm-deepseek-account','llm-pi-ai','deepseek-account',
  'file-upload','open-in-app','ui-open-in-app','directory-picker',
  'plugin-manager','plugin-package-inventory-deepseek','config-editor','cordis-host-runner',
  'cordis-inspect-providers','job-controller','terminal-controller','workspace-files',
  'session-log-download','message-feedback','workspace-changes','office-to-pdf','session-reference','file-reference-local',
  'desktop-product-telemetry','product-analytics','client-hmr','ui-shortcuts',
  'ui-sidebar-right','ui-sidebar-documentpreview','ui-sidebar-browser','ui-sidebar-terminal','ui-sidebar-files',
  'ui-settings-account','account-controller','ui-settings-general','ui-settings-models',
  'ui-plugin-manager','ui-settings-plugin-inventory','ui-approval','ui-chat','ui-brand-official',
  'ui-attachment','ui-tool','ui-cordis','ui-deliverables','ui-workflow-run',
  'ui-input-trigger','ui-commands','ui-skill','ui-subagent','ui-reference','ui-jobs','ui-goal',
  'ui-message-feedback','ui-model-selection','ui-permission','ui-agent-preset',
  'ui-settings-session-log','ui-settings-plugins','ui-settings-shell','ui-settings-agent-loop',
  'ui-settings-subagent','ui-settings-web-search','ui-plan','ui-user-questions','ui-trajectory',
];

export async function installBotGuiProfile({directory, productRoot, runtimeRoot, cwd,
  packagePlacement='snapshot', packageSnapshot}) {
  if (![directory,productRoot,runtimeRoot,cwd].every(v => typeof v === 'string' && isAbsolute(v))) throw Error('gui_absolute_paths_required');
  if (packagePlacement !== 'snapshot') throw Error('gui_packed_package_required');
  const product = await realpath(productRoot), runtime = await realpath(runtimeRoot);
  const root = resolve(directory), work = resolve(cwd);
  const within = (p, parent) => p === parent || p.startsWith(parent + '/');
  if (within(work,root) || within(root,work) || [product,runtime].some(p => within(root,p) || within(work,p))) throw Error('gui_fresh_paths_required');
  await mkdir(root, {mode:0o700});
  await mkdir(work, {mode:0o700});
  const home = join(root,'home'), profile = 'dsh-bot-gui', dir = join(home,'profiles',profile);
  await mkdir(join(dir,'node_modules'), {recursive:true,mode:0o700});
  const packageInstallation = await installProductPackage({directory:join(dir,'node_modules','dsh-bot'),
    productRoot:product, packagePlacement, packageSnapshot:packageSnapshot && Object.freeze({...packageSnapshot})});
  const patch = [
    ...disabled.map(id => ({id,disabled:true})),
    {id:'agent-preset-registry',config:{default:'dsh-bot/empty'}},
    {id:'agent-loop',config:{agents:[]}},
    {id:'system-prompt',config:{personaPrefix:'You are the user’s single Bot. Handle the main goal and use dsh_bot_delegate for independent bounded work. Work Sessions return observed results to this main dialog. A result or accepted stop is not proof of native settlement.',personaSuffix:'',includeHarnessIdentity:false}},
    {id:'connection',config:{trustedHosts:[],cookieMaxAgeDays:30,maxRequestBodyBytes:1048576}},
    {id:'web-startup',name:'dsh-bot/bot-gui-startup'},
    {id:'web-runtime',config:{openBrowser:false,printUrl:true,surfaceContext:false,trustedHosts:[]}},
    {id:'session-controller',config:{nativeOpen:false}},
    {id:'credentials',config:{dshHome:home}},
    {id:'session-persistence-jsonl',config:{root:join(home,'sessions'),compression:'none'}},
    {id:'llm-deepseek',config:{apiKeyEnv:'DEEPSEEK_API_KEY',baseURL:'https://api.deepseek.com/anthropic',thinking:'disabled',reasoningEffort:'off',maxTokens:2048,streamIdleTimeoutMs:30000,retryPolicy:{mode:'normal',maxRetries:0,backoff:{initialDelayMs:1,maxDelayMs:1,jitterRatio:0}}}},
    {insert:[
      {id:'bot-gui-preset',name:'@deepseek-ai/dsh-agent-preset',config:{id:'dsh-bot/empty',plugins:[]}},
      {id:'bot-gui-closed-intake',name:'dsh-bot/bot-chain-intake',config:{}},
      {id:'bot-gui-owner',name:'dsh-bot/bot-gui-owner-app',config:{homeDirectory:home,cwd:work,agentPreset:'dsh-bot/empty'}},
      {id:'dsh-bot',name:'dsh-bot',config:{}},
    ]},
  ];
  await writeFile(join(dir,'package.json'),JSON.stringify({name:'private-dsh-bot-gui-profile',private:true,type:'module',
    dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}},dependencies:{'dsh-bot':'0.1.0-alpha.1'}},null,2)+'\n',{flag:'wx',mode:0o600});
  await writeFile(join(dir,'cordis.patch.yml'),JSON.stringify(patch,null,2)+'\n',{flag:'wx',mode:0o600});
  const result = {profile,home,cwd:work,dsh:join(runtime,'node_modules','@deepseek-ai','dsh','lib','bin.js'),
    credentialReferences:['DEEPSEEK_API_KEY'],credentialsCreated:false,coreSdkEdited:false,packageInstallation};
  await writeFile(join(root,'composition.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = {};
  for (let i=2;i<process.argv.length;i+=2) args[process.argv[i].replace(/^--/,'')] = process.argv[i+1];
  try {
    process.stdout.write(JSON.stringify(await installBotGuiProfile({directory:args.directory,productRoot:args.product,
      runtimeRoot:args.runtime,cwd:args.cwd,packageSnapshot:args['snapshot-manifest']?{manifestPath:args['snapshot-manifest'],
        manifestSHA256:args['snapshot-digest'],buildId:args['snapshot-build-id']}:undefined}))+'\n');
  } catch {
    process.stderr.write('{"errorCategory":"gui_profile_unconfirmed"}\n');
    process.exitCode = 1;
  }
}
