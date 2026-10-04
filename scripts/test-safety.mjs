// Every test and test-runner subtest inherits this guard. No native runtime imports.
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import child from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';
if (!process.env.DSH_BOT_TEST_ROOT || !process.permission?.has('fs.write', process.env.DSH_BOT_TEST_ROOT)) throw Error('Test safety guard requires isolated filesystem permissions');
if (!resolve(process.env.DSH_HOME).startsWith(resolve(process.env.DSH_BOT_TEST_ROOT) + '/')) throw Error('Production DSH_HOME forbidden');
fs.mkdirSync(process.env.DSH_HOME, {recursive: true});
const deny = () => { throw Error('DSH_BOT_TEST_SIDE_EFFECT_DENIED'); };
globalThis.fetch = deny;
for (const [mod, names] of [[net,['connect','createConnection','createServer']], [http,['request','get','createServer']], [https,['request','get','createServer']], [tls,['connect','createServer']], [child,['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']]]) for (const name of names) mod[name] = deny;
syncBuiltinESMExports();
