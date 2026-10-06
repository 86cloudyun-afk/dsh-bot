/** Network/child/listener fuses for the dedicated actual-artifact fixture; not a live launcher. */
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import child from 'node:child_process';
import dgram from 'node:dgram';
import http2 from 'node:http2';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
if(!process.env.DSH_BOT_TEST_ROOT || !process.env.DSH_HOME.startsWith(process.env.DSH_BOT_TEST_ROOT+'/'))throw Error('Fresh isolated test home required');
for(const name of ['DEEPSEEK_API_KEY','HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy'])if(Object.hasOwn(process.env,name))throw Error('Live authentication forbidden in this test launcher');
const deny=()=>{throw Error('OFFLINE_NATIVE_IO_DENIED');};globalThis.fetch=deny;
for(const [module,names] of [[net,['connect','createConnection','createServer']],[http,['request','get','createServer']],[https,['request','get','createServer']],
 [tls,['connect','createServer']],[dgram,['createSocket']],[http2,['connect','createServer','createSecureServer']],
 [child,['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']],[dns,['lookup','resolve','resolve4','resolve6']]])for(const name of names)module[name]=deny;
net.Socket.prototype.connect=deny;net.Server.prototype.listen=deny;dgram.Socket.prototype.send=deny;dgram.Socket.prototype.connect=deny;syncBuiltinESMExports();
