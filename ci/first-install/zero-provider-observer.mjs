/** QA observation only. The installed SDK/product/profile are never edited. */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import {syncBuiltinESMExports} from 'node:module';

const nonce=process.env.DSH_FIRST_OBSERVER_NONCE;
if(!/^[a-f0-9]{32}$/.test(nonce??''))throw Error('FIRST_INSTALL_OBSERVER_NONCE_REQUIRED');
let providerRequests=0,otherExternalRequests=0;
function hostAllowed(value){
 const host=String(value??'localhost').toLowerCase();
 if(['127.0.0.1','localhost','::1','[::1]'].includes(host))return;
 if(host==='api.deepseek.com'||host.endsWith('.deepseek.com'))providerRequests++;
 else otherExternalRequests++;
 throw Object.assign(Error('FIRST_INSTALL_EXTERNAL_REQUEST_REFUSED'),{code:'FIRST_INSTALL_EXTERNAL_REQUEST_REFUSED'});
}
const originalFetch=globalThis.fetch;
globalThis.fetch=function(input,...rest){
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);hostAllowed(url.hostname);
 return originalFetch.call(this,input,...rest);
};
function httpHost(args){
 const first=args[0],options=(typeof first==='object'&&!(first instanceof URL))?first:args[1];
 if(options?.socketPath)return; // Local IPC; no remote network peer.
 if(typeof first==='string'||first instanceof URL){hostAllowed(new URL(first).hostname);}
 if(options&&typeof options==='object')hostAllowed(options.hostname??options.host);
}
for(const module of[http,https])for(const method of['request','get']){
 const original=module[method];module[method]=function(...args){httpHost(args);return original.apply(this,args);};
}
function socketHost(args){
 const first=args[0];
 if(first&&typeof first==='object'){if(!first.path)hostAllowed(first.host??first.hostname);}
 else if(typeof first==='number')hostAllowed(typeof args[1]==='string'?args[1]:undefined);
 else if(typeof first==='string')return; // Node's path overload is local IPC.
 else throw Error('FIRST_INSTALL_SOCKET_ARGUMENTS_REFUSED');
}
for(const[module,method]of[[net,'connect'],[net,'createConnection'],[tls,'connect']]){
 const original=module[method];module[method]=function(...args){socketHost(args);return original.apply(this,args);};
}
syncBuiltinESMExports();
process.on('exit',()=>process.stdout.write(JSON.stringify({kind:'FIRST_INSTALL_NETWORK_OBSERVER',nonce,providerRequests,otherExternalRequests})+'\n'));
