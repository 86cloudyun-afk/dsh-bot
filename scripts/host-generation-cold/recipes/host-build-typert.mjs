import {writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {WorkspaceTypertGenerator} from './packages/typert/generator/lib/types/workspace.js';
const generator=new WorkspaceTypertGenerator(import.meta.dirname,{checkDiagnostics:false});
const artifacts=generator.generate(["@deepseek-ai/dsh-agent-preset-registry","@deepseek-ai/dsh-commands","@deepseek-ai/dsh-llm","@deepseek-ai/dsh-permission-presets","@deepseek-ai/dsh-subagent"],['host']);
for(const artifact of artifacts){const output=join(import.meta.dirname,artifact.packageRoot,'lib');mkdirSync(output,{recursive:true});writeFileSync(join(output,'typert.host.js'),artifact.js);writeFileSync(join(output,'typert.host.d.ts'),artifact.dts);if(artifact.remote){writeFileSync(join(output,'typert.remote-client.js'),artifact.remote.js);writeFileSync(join(output,'typert.remote-client.d.ts'),artifact.remote.dts);writeFileSync(join(output,'typert.remote-client.d.ts.map'),artifact.remote.dtsMap);}else for(const name of ['typert.remote-client.js','typert.remote-client.d.ts','typert.remote-client.d.ts.map'])rmSync(join(output,name),{force:true});}
console.log(JSON.stringify({artifactCount:artifacts.length,packages:artifacts.map(x=>x.package)}));
