/** Cold Linux Host build from the verified public baseline and source packet. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, writeFileSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(process.argv[2] ?? process.cwd());
const evidence = resolve(process.argv[3] ?? import.meta.dirname);
const node = join(root, '.tools/node-v24.19.0-linux-x64/bin/node');
const rows = JSON.parse(readFileSync(join(evidence, 'historical-packages-projection.json')));
const environment = { ...process.env };
for (const name of ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'DSH_HOME']) delete environment[name];
const consumerHome = join(evidence, 'build-home');
mkdirSync(consumerHome, { recursive: true, mode: 0o700 });
environment.HOME = consumerHome;
environment.XDG_CONFIG_HOME = join(consumerHome, 'config');
environment.CI = 'true';
environment.PATH = [join(root, '.tools/node-v24.19.0-linux-x64/bin'), join(root, '.tools/musl/bin'), join(root, 'node_modules/.bin'), process.env.PATH].join(':');
const commands = [];
function run(label, args) {
  const startedUTC = new Date().toISOString();
  const result = spawnSync(node, args, { cwd: root, env: environment, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
  writeFileSync(join(evidence, label + '.log'), (result.stdout ?? '') + (result.stderr ?? ''));
  commands.push({ label, command: node, args, startedUTC, endedUTC: new Date().toISOString(), exitCode: result.status, signal: result.signal });
  writeFileSync(join(evidence, 'build-commands.json'), JSON.stringify(commands, null, 2) + '\n');
  console.log(JSON.stringify(commands.at(-1)));
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(label + ' failed; see ' + join(evidence, label + '.log'));
}
const extra = ['packages/typert/generator', 'packages/extensions/tool-cordis'];
const tsconfigs = [...new Set([...rows.map(row => row.sourcePath), ...extra])].filter(folder => existsSync(join(root, folder, 'tsconfig.json'))).map(folder => folder + '/tsconfig.json');
run('native-build', ['--import', 'tsx/esm', 'native/system/scripts/build.ts']);
run('typescript-build', ['--max-old-space-size=4096', 'node_modules/typescript/bin/tsc', '--build', ...tsconfigs]);
const workspace = [...new Set([...rows.filter(row => !row.sourcePath.startsWith('native/')).map(row => row.sourcePath), ...extra])];
const contributors = rows.filter(row => Object.hasOwn(JSON.parse(readFileSync(join(root, row.sourcePath, 'package.json'))).exports ?? {}, './typert')).map(row => row.name);
const typertScript = `import {writeFileSync,mkdirSync,rmSync} from 'node:fs';\nimport {join} from 'node:path';\nimport {WorkspaceTypertGenerator} from './packages/typert/generator/lib/types/workspace.js';\nconst generator=new WorkspaceTypertGenerator(import.meta.dirname,{checkDiagnostics:false});\nconst artifacts=generator.generate(${JSON.stringify(contributors)},['host']);\nfor(const artifact of artifacts){const output=join(import.meta.dirname,artifact.packageRoot,'lib');mkdirSync(output,{recursive:true});writeFileSync(join(output,'typert.host.js'),artifact.js);writeFileSync(join(output,'typert.host.d.ts'),artifact.dts);if(artifact.remote){writeFileSync(join(output,'typert.remote-client.js'),artifact.remote.js);writeFileSync(join(output,'typert.remote-client.d.ts'),artifact.remote.dts);writeFileSync(join(output,'typert.remote-client.d.ts.map'),artifact.remote.dtsMap);}else for(const name of ['typert.remote-client.js','typert.remote-client.d.ts','typert.remote-client.d.ts.map'])rmSync(join(output,name),{force:true});}\nconsole.log(JSON.stringify({artifactCount:artifacts.length,packages:artifacts.map(x=>x.package)}));\n`;
writeFileSync(join(root, 'host-build-typert.mjs'), typertScript);
writeFileSync(join(evidence, 'host-build-typert.mjs'), typertScript);
run('typert-build', ['host-build-typert.mjs']);
const configuration = `import { defineConfig } from 'tsdown';\nimport { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js';\nconst {transform}=typertPlugin();\nexport default defineConfig({workspace: ${JSON.stringify(workspace)}, entry: ['lib/types/{index,invariant,startup}.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false, plugins: [{name:'dsh-standard-decorators',transform}]});\n`;
const configurationPath = join(root, 'host-build.config.mjs');
writeFileSync(configurationPath, configuration);
writeFileSync(join(evidence, 'host-build.config.mjs'), configuration);
run('javascript-build', ['node_modules/tsdown/dist/run.mjs', '--config', configurationPath]);
const hashes = [];
for (const row of rows) {
  const path = join(root, row.sourcePath, 'lib/index.js');
  if (!existsSync(path)) continue;
  if (!lstatSync(path).isFile()) throw new Error('non-file built entry');
  const bytes = readFileSync(path);
  hashes.push({ name: row.name, version: row.version, path: row.sourcePath + '/lib/index.js', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
}
writeFileSync(join(evidence, 'built-entry-index.json'), JSON.stringify(hashes, null, 2) + '\n');
console.log(JSON.stringify({ builtEntryCount: hashes.length, sourcePacketRetained: true, sourceHeadEqualsBuiltIdentity: false, modelsRequested: false }));
