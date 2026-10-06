import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes,timingSafeEqual } from 'node:crypto';
import { Ledger } from './ledger.mjs';
import { Host } from './host.mjs';
import { requireValue } from './errors.mjs';
const maximumBody=128*1024;
function secureEqual(a,b) {return typeof a==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));}
export function createHandler({host,origin,token,assets}) {
 const urlOrigin=new URL(origin);requireValue(urlOrigin.hostname==='127.0.0.1','invalid_origin');const actor={kind:'human',id:host.ownerHumanId};
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  try {
   requireValue(req.headers.host===urlOrigin.host,'forbidden');
   const url=new URL(req.url,origin),api=url.pathname.startsWith('/api/');
   if(api) {requireValue(secureEqual(req.headers['x-dsh-token'],token),'forbidden');requireValue(!req.headers.origin || req.headers.origin===origin,'forbidden');requireValue(!req.headers['sec-fetch-site'] || ['same-origin','none'].includes(req.headers['sec-fetch-site']),'forbidden');}
   if(req.method==='GET' && Object.hasOwn(assets,url.pathname)) {const a=assets[url.pathname];res.writeHead(200,{'Content-Type':a.type});res.end(a.content);return;}
   if(req.method==='GET' && url.pathname==='/api/snapshot') {send(200,host.snapshot(actor));return;}
   if(req.method==='GET' && url.pathname==='/api/agent-presets') {send(200,await host.refreshSessionModeCatalog(actor));return;}
   if(req.method==='GET' && url.pathname==='/api/operation') {requireValue(url.searchParams.get('ledgerInstanceId')===host.ledgerInstanceId,'ledger_identity_conflict');send(200,host.ledger.inspectOperation(actor,url.searchParams.get('id')));return;}
   if(req.method==='POST' && url.pathname==='/api/command') {
    requireValue(req.headers.origin===origin && req.headers['content-type']?.split(';')[0]==='application/json','forbidden');let size=0;const chunks=[];
    for await(const part of req) {const buf=Buffer.from(part);size+=buf.length;requireValue(size<=maximumBody,'body_too_large');chunks.push(buf);}
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));requireValue(body && Object.keys(body).every(k=>['envelope','payload'].includes(k)),'invalid_request');
    requireValue(body.envelope?.ledgerInstanceId===host.ledgerInstanceId,'ledger_identity_conflict');
    send(200,host.execute(actor,body.envelope,body.payload));return;
   }
   send(404,{code:'not_found'});
  } catch(error) {send(error.code==='forbidden'?403:error.code==='body_too_large'?413:error.code==='not_found'?404:error.code?400:500,{code:error.code ?? (error instanceof SyntaxError?'invalid_json':'internal_error'),message:error.code?error.message:'Request failed; inspect the original operation identity before retry'});}
 };
}
export function startPreview({databasePath=resolve('.local/preview.sqlite'),ownerHumanId='local-review-human',port=8787}={}) {
 const ledger=new Ledger(databasePath),host=new Host({ledger,ownerHumanId}),token=randomBytes(32).toString('base64url'),origin=`http://127.0.0.1:${port}`,ui=resolve(import.meta.dirname,'../ui');
 const assets=Object.fromEntries([['/','index.html','text/html; charset=utf-8'],['/app.mjs','app.mjs','text/javascript'],['/command.mjs','command.mjs','text/javascript'],['/records.mjs','records.mjs','text/javascript'],['/session-mode.mjs','session-mode.mjs','text/javascript'],['/style.css','style.css','text/css']].map(([url,file,type])=>[url,{type,content:readFileSync(resolve(ui,file),'utf8').replace('%%TOKEN%%',token)}]));
 const server=createServer(createHandler({host,origin,token,assets}));server.on('close',()=>ledger.close());server.listen(port,'127.0.0.1',()=>process.stdout.write(`DSH-bot control alpha: ${origin}\nNative effects disabled; database: ${databasePath}\n`));return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) startPreview();
