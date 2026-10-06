/** Preload only for a fresh, credential-free actual native profile child. */
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import child from 'node:child_process';
import dgram from 'node:dgram';
import http2 from 'node:http2';
import dns from 'node:dns';
import { writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const root=process.env.DSH_BOT_TEST_ROOT,home=process.env.DSH_HOME,receipt=process.env.DSH_BOT_IO_RECEIPT;
if(!root || !home?.startsWith(root+'/') || !receipt?.startsWith(root+'/'))throw Error('FRESH_PROFILE_TEST_REQUIRED');
for(const name of ['DEEPSEEK_API_KEY','HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy'])if(Object.hasOwn(process.env,name))throw Error('LIVE_AUTH_FORBIDDEN');
const attempts={fetch:0,network:0,listener:0,child:0};
const deny=kind=>()=>{attempts[kind]++;throw Error('ZERO_MODEL_PROFILE_IO_DENIED');};
globalThis.fetch=deny('fetch');
for(const [module,names,kind] of [[net,['connect','createConnection'],'network'],[net,['createServer'],'listener'],
 [http,['request','get'],'network'],[http,['createServer'],'listener'],[https,['request','get'],'network'],[https,['createServer'],'listener'],
 [tls,['connect'],'network'],[tls,['createServer'],'listener'],[dgram,['createSocket'],'network'],[http2,['connect'],'network'],
 [http2,['createServer','createSecureServer'],'listener'],[child,['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'],'child'],
 [dns,['lookup','resolve','resolve4','resolve6'],'network']])for(const name of names)module[name]=deny(kind);
net.Socket.prototype.connect=deny('network');net.Server.prototype.listen=deny('listener');dgram.Socket.prototype.send=deny('network');dgram.Socket.prototype.connect=deny('network');syncBuiltinESMExports();
process.on('exit',()=>writeFileSync(receipt,JSON.stringify({format:1,credentialEnvironmentPresent:false,attempts})+'\n',{flag:'wx',mode:0o600}));
