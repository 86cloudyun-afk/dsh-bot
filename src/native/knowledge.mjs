import {createHash, randomUUID} from 'node:crypto';
import {canonical, copy, digest, plain, requireCondition, validId} from './store.mjs';

export const utf8Hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
export const uniqueReferences=refs=>[...new Map(refs.map(ref=>[canonical(ref),copy(ref)])).values()];
/** Authenticated authorship adds restrictions independently of selected evidence. */
export function writerProvenance({store,policy},actor,state=store.read()) {
  policy.actorKey(actor);
  if(actor.kind!=='bot')return {origins:[],contentSources:[]};
  const reference={kind:'session',id:actor.sessionId};policy.require(actor,'session.read',reference,state);
  const binding=state.sessions[actor.sessionId];requireCondition(binding?.botId===actor.botId,'access_denied');
  const source={kind:'session',storeId:state.storeId,sessionId:actor.sessionId,derived:true,...copy(binding.lineage??{})};
  return {origins:uniqueReferences([reference,...policy.readDependencies(actor)]),contentSources:[source]};
}
export function strictObject(value,keys,code='invalid_input') {
  requireCondition(plain(value)&&Object.keys(value).every(key=>keys.includes(key)&&!['__proto__','prototype','constructor'].includes(key)),code);
}
export function validUnicode(text) {
  if(typeof text!=='string')return false;
  for(let i=0;i<text.length;i++) {
    const code=text.charCodeAt(i);
    if(code>=0xd800&&code<=0xdbff) {const next=text.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false;}
    else if(code>=0xdc00&&code<=0xdfff)return false;
  }
  return true;
}
const boundary=(text,n)=>n===0||n===text.length||!(text.charCodeAt(n-1)>=0xd800&&text.charCodeAt(n-1)<=0xdbff&&text.charCodeAt(n)>=0xdc00&&text.charCodeAt(n)<=0xdfff);
const binary=(a,b)=>a<b?-1:a>b?1:0;
export const normalize=text=>text.normalize('NFKC').toLowerCase();
const cjk=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
export function terms(text) {
  const result=[],s=normalize(text);let run='',mode='';
  const flush=()=>{if(run){if(mode==='cjk'){const chars=[...run];if(chars.length===1)result.push(chars[0]);else for(let i=0;i<chars.length-1;i++)result.push(chars[i]+chars[i+1]);}else result.push(run);}run='';mode='';};
  for(const ch of s){const next=cjk.test(ch)?'cjk':/[\p{L}\p{N}]/u.test(ch)?'word':'';if(!next){flush();continue;}if(mode&&mode!==next)flush();mode=next;run+=ch;}flush();return [...new Set(result)];
}
export function lexicalScore(query,{body='',title='',section=''}={}) {
  const ts=terms(query);if(!ts.length)return 0;
  const q=normalize(query),singleton=[...q].length===1,phrase=[...q].length>=2;
  const score=(field,weight,phraseWeight)=>{const s=normalize(field),fieldTerms=new Set(terms(field));return weight*ts.filter(term=>singleton?s.includes(term):fieldTerms.has(term)).length+(phrase&&s.includes(q)?phraseWeight:0);};
  return score(body,1,4)+score(section,2,8)+score(title,3,12);
}
function linesOf(text) {
  const lines=[];let start=0;const re=/\r\n|\r|\n/g;let match;
  while((match=re.exec(text))){lines.push({start,end:match.index+match[0].length,body:text.slice(start,match.index)});start=re.lastIndex;}
  if(start<text.length)lines.push({start,end:text.length,body:text.slice(start)});return lines;
}
export function chunkMaterial(docId,contentHash,text) {
  const lines=linesOf(text),headings=[],paragraphs=[],hierarchy=[];let fence=null;
  for(let i=0;i<lines.length;i++) {
    const line=lines[i],marker=line.body.match(/^ {0,3}(`{3,}|~{3,})/);
    if(marker){if(!fence)fence={char:marker[1][0],length:marker[1].length};else if(marker[1][0]===fence.char&&marker[1].length>=fence.length&&/^ {0,3}(?:`+|~+)\s*$/.test(line.body))fence=null;continue;}
    if(fence)continue;
    if(/^[ \t]*$/.test(line.body))paragraphs.push(line.end);
    let level,title,start=line.start;
    const atx=line.body.match(/^ {0,3}(#{1,6})(?:\s+|$)(.*)$/);
    if(atx){level=atx[1].length;title=atx[2].replace(/\s+#+\s*$/,'').trim();}
    else if(i+1<lines.length&&line.body.trim()&&!/^ {0,3}(?:`{3,}|~{3,})/.test(line.body)&&/^ {0,3}(=+|-+)\s*$/.test(lines[i+1].body)){level=lines[i+1].body.trim()[0]==='='?1:2;title=line.body.trim();i++;}
    if(level){hierarchy.length=level;hierarchy[level-1]=title;headings.push({start,section:hierarchy.filter(Boolean).join(' / ')});}
  }
  const lineAt=n=>{let low=0,high=lines.length;while(low<high){const mid=(low+high)>>1;if(lines[mid].end<=n)low=mid+1;else high=mid;}return low+1;};
  const chunks=[];let start=0;
  while(start<text.length) {
    let cap=start,count=0;while(cap<text.length&&count<800){const cp=text.codePointAt(cap);cap+=cp>0xffff?2:1;count++;}
    if(cap<text.length&&text[cap-1]==='\r'&&text[cap]==='\n')cap--;
    let end=cap;const heading=headings.find(h=>h.start>start&&h.start<=cap);
    if(heading)end=heading.start;else {const paragraph=paragraphs.filter(n=>n>start&&n<=cap).at(-1);if(paragraph)end=paragraph;}
    const section=headings.filter(h=>h.start<=start).at(-1)?.section??'';
    chunks.push({chunkId:`chunk_${digest([docId,contentHash,start,end])}`,startOffset:start,endOffset:end,startLine:lineAt(start),endLine:lineAt(end-1),section});start=end;
  }
  return chunks;
}
export function enforceQuota(state,table,botId,{perBot,profile,botBytes=2*1024*1024,profileBytes=8*1024*1024},before=null) {
  const rows=Object.values(state[table]??{}),own=rows.filter(r=>r.botId===botId),bytes=rs=>rs.reduce((n,r)=>n+Buffer.byteLength(canonical(r)),0);
  const old=before?Object.values(before[table]??{}):[],oldOwn=old.filter(r=>r.botId===botId);
  const checks=[[own.length,perBot,oldOwn.length],[rows.length,profile,old.length],[bytes(own),botBytes,bytes(oldOwn)],[bytes(rows),profileBytes,bytes(old)]];
  requireCondition(checks.every(([current,limit,prior])=>current<=limit||(before&&current<=prior)),table==='materials'?'material_quota':'memory_quota');
}
export async function readSessionEvidence({store,policy,adapter},actor,reference,{signal,range=false}={}) {
  strictObject(reference,range?['sessionId','eventSeq','partIndex','startOffset','endOffset']:['sessionId','eventSeq'],'invalid_source');
  requireCondition(validId(reference.sessionId)&&Number.isSafeInteger(reference.eventSeq)&&reference.eventSeq>=0,'invalid_source');
  const ref={kind:'session',id:reference.sessionId};policy.require(actor,'session.read',ref);
  requireCondition(store.read().sessions[reference.sessionId],'source_not_found');
  const live=adapter.context?.agents?.get(reference.sessionId);if(live)await adapter.context.sessions.flush(live.session);
  const history=await adapter.readNative(reference.sessionId,signal);
  policy.require(actor,'session.read',ref);
  const state=store.read(),binding=state.sessions[reference.sessionId],event=history.events.find(e=>e.seq===reference.eventSeq);
  requireCondition(event,'source_not_found');
  const source={kind:'session',storeId:state.storeId,...copy(reference),headerVersion:history.header?.version??history.header?.schemaVersion??1,eventHash:digest(event),...copy(binding?.lineage??{})};
  let text;
  if(range) {
    const {partIndex,startOffset,endOffset}=reference;
    requireCondition(['user/message','assistant/message','developer/message'].includes(event.type)&&Number.isSafeInteger(partIndex)&&partIndex>=0,'invalid_source');
    const content=event.type==='user/message'?event.data?.content:event.data?.message?.content,part=content?.[partIndex];
    requireCondition(part?.type==='text'&&validUnicode(part.text)&&Number.isSafeInteger(startOffset)&&Number.isSafeInteger(endOffset)&&startOffset>=0&&startOffset<endOffset&&endOffset<=part.text.length&&boundary(part.text,startOffset)&&boundary(part.text,endOffset),'invalid_source');
    text=part.text.slice(startOffset,endOffset);source.fullPartHash=utf8Hash(part.text);
  }
  return {source,origins:uniqueReferences([ref,...policy.readDependencies(actor)]),...(text===undefined?{}:{text})};
}

export class KnowledgeController {
  constructor({store,policy,adapter}) {Object.assign(this,{store,policy,adapter});}
  #owner(actor,botId,state=this.store.read()) {
    this.policy.actorKey(actor);requireCondition(state.bots[botId],'not_found');requireCondition(!state.bots[botId].deletedAt,'bot_deleted');requireCondition(actor.kind==='human'||actor.kind==='bot'&&actor.botId===botId,'access_denied');
  }
  #read(actor,docId,state=this.store.read()) {
    this.policy.actorKey(actor);requireCondition(validId(docId),'invalid_material');const doc=state.materials?.[docId];requireCondition(doc,'not_found');this.policy.require(actor,'material.read',{kind:'material',id:docId},state);return doc;
  }
  async ingest(actor,command,signal) {
    this.policy.actorKey(actor);command=copy(command);const input=command.input;
    strictObject(input,['botId','title','mediaType','fileName','text','source','replacesDocId'],'invalid_material');this.#owner(actor,input.botId);
    const stamped=this.policy.command(actor,command);if(Object.hasOwn(this.store.read().operations,command.operationId))return this.store.transact(stamped,()=>null);
    requireCondition(typeof input.title==='string'&&validUnicode(input.title)&&input.title.trim().length>0&&[...input.title].length<=200&&['text/plain','text/markdown'].includes(input.mediaType??'text/plain')&&Object.hasOwn(input,'text')!==Object.hasOwn(input,'source'),'invalid_material');
    if(input.fileName!==undefined)requireCondition(typeof input.fileName==='string'&&validUnicode(input.fileName)&&[...input.fileName].length>0&&[...input.fileName].length<=255&&!/[\\/\x00-\x1f\x7f]/.test(input.fileName)&&/\.(txt|md)$/i.test(input.fileName),'invalid_material');
    const writer=writerProvenance(this,actor);let evidence;
    if(input.source)evidence=await readSessionEvidence(this,actor,input.source,{signal,range:true});
    else {
      requireCondition(validUnicode(input.text),'invalid_material');
      if(actor.kind==='bot')evidence={source:writer.contentSources[0],origins:writer.origins,text:input.text};
      else evidence={source:{kind:'human',operationId:command.operationId},origins:[],text:input.text};
    }
    requireCondition(evidence.text.length>0,'invalid_material');requireCondition(Buffer.byteLength(evidence.text)<=65536,'material_quota');
    const docId=`doc_${randomUUID()}`,contentHash=utf8Hash(evidence.text),createdAt=new Date().toISOString();
    return this.store.transact(stamped,draft=>{
      this.#owner(actor,input.botId,draft);const liveWriter=writerProvenance(this,actor,draft);for(const origin of uniqueReferences([...evidence.origins,...writer.origins,...liveWriter.origins]))this.policy.require(actor,`${origin.kind}.read`,origin,draft);
      let previous;if(input.replacesDocId){previous=this.#read(actor,input.replacesDocId,draft);requireCondition(previous.botId===input.botId,'access_denied');}
      const doc={docId,botId:input.botId,title:input.title.trim(),mediaType:input.mediaType??'text/plain',...(input.fileName===undefined?{}:{fileName:input.fileName}),text:evidence.text,contentHash,version:1,chunkingVersion:1,createdAt,source:evidence.source,contentSources:uniqueReferences([...writer.contentSources,...liveWriter.contentSources,...(previous?[previous.source,...(previous.contentSources??[])]:[])]),origins:uniqueReferences([...evidence.origins,...writer.origins,...liveWriter.origins,...(previous?[{kind:'material',id:previous.docId},...(previous.origins??[])]:[])]),archived:false,chunks:chunkMaterial(docId,contentHash,evidence.text),...(previous?{replacesDocId:previous.docId}:{})};
      (draft.materials??={})[docId]=doc;enforceQuota(draft,'materials',input.botId,{perBot:100,profile:500});return doc;
    });
  }
  search(actor,input={}) {
    this.policy.actorKey(actor);strictObject(input,['botId','query','limit']);requireCondition(typeof input.query==='string'&&input.query.length<=500,'invalid_query');const limit=input.limit??8;requireCondition(Number.isSafeInteger(limit)&&limit>=1&&limit<=20,'invalid_limit');
    const state=this.store.read(),hits=[];
    for(const doc of Object.values(state.materials??{})) {
      if(doc.archived||input.botId&&doc.botId!==input.botId||!this.policy.canRead(actor,{kind:'material',id:doc.docId},undefined,state))continue;
      for(const chunk of doc.chunks){const excerpt=doc.text.slice(chunk.startOffset,chunk.endOffset),score=lexicalScore(input.query,{body:excerpt,title:doc.title,section:chunk.section});if(score>0)hits.push({docId:doc.docId,title:doc.title,contentHash:doc.contentHash,...copy(chunk),excerpt,source:copy(doc.source),score});}
    }
    const result=hits.sort((a,b)=>b.score-a.score||binary(a.docId,b.docId)||a.startOffset-b.startOffset||a.endOffset-b.endOffset).slice(0,limit);
    for(const hit of result)this.policy.noteRead(actor,{kind:'material',id:hit.docId});return result;
  }
  async #sourceStatus(actor,doc,signal) {
    if(doc.source.kind!=='session'||doc.source.derived)return {status:doc.source.derived?'derived':'description',...copy(doc.source)};
    try {
      const source=doc.source,reference=Object.fromEntries(['sessionId','eventSeq','partIndex','startOffset','endOffset'].map(k=>[k,source[k]]));
      const evidence=await readSessionEvidence(this,actor,reference,{signal,range:true});
      return {...copy(source),status:evidence.source.eventHash===source.eventHash&&evidence.source.fullPartHash===source.fullPartHash?'verified':'changed'};
    }catch(error){if(error.code==='access_denied')throw error;return {...copy(doc.source),status:'unavailable'};}
  }
  async page(actor,input,signal) {
    strictObject(input,['docId','chunkId','cursor','limit']);const doc=this.#read(actor,input.docId),source=await this.#sourceStatus(actor,doc,signal);this.#read(actor,input.docId);
    let startOffset,endOffset,chunk;
    if(input.chunkId!==undefined){requireCondition(input.cursor===undefined&&input.limit===undefined,'invalid_input');chunk=doc.chunks.find(c=>c.chunkId===input.chunkId);requireCondition(chunk,'chunk_not_found');({startOffset,endOffset}=chunk);}
    else {startOffset=input.cursor??0;const limit=input.limit??4000;requireCondition(Number.isSafeInteger(startOffset)&&startOffset>=0&&startOffset<=doc.text.length&&boundary(doc.text,startOffset)&&Number.isSafeInteger(limit)&&limit>=1&&limit<=16000,'invalid_cursor');endOffset=startOffset;for(let i=0;i<limit&&endOffset<doc.text.length;i++)endOffset+=doc.text.codePointAt(endOffset)>0xffff?2:1;if(endOffset<doc.text.length&&doc.text[endOffset-1]==='\r'&&doc.text[endOffset]==='\n')endOffset=endOffset===startOffset+1?endOffset+1:endOffset-1;}
    this.policy.noteRead(actor,{kind:'material',id:doc.docId});return {docId:doc.docId,title:doc.title,contentHash:doc.contentHash,...(chunk?copy(chunk):{}),text:doc.text.slice(startOffset,endOffset),startOffset,endOffset,nextCursor:endOffset<doc.text.length?endOffset:null,source};
  }
  archive(actor,command) {
    this.policy.actorKey(actor);command=copy(command);strictObject(command.input,['docId','expectedVersion']);const doc=this.#read(actor,command.input.docId);this.#owner(actor,doc.botId);
    return this.store.transact(this.policy.command(actor,command),draft=>{const row=this.#read(actor,command.input.docId,draft);this.#owner(actor,row.botId,draft);requireCondition(command.input.expectedVersion===row.version,'revision_conflict');row.archived=true;row.version++;return row;});
  }
  async download(actor,input) {
    this.policy.actorKey(actor);requireCondition(actor.kind==='human','access_denied');strictObject(input,['docId']);const doc=this.#read(actor,input.docId),source=await this.#sourceStatus(actor,doc);this.#read(actor,input.docId);this.policy.noteRead(actor,{kind:'material',id:doc.docId});return {docId:doc.docId,text:doc.text,contentHash:doc.contentHash,mediaType:doc.mediaType,fileName:doc.fileName??`${doc.docId}.${doc.mediaType==='text/markdown'?'md':'txt'}`,source};
  }
  metadata(actor,input={}) {
    this.policy.actorKey(actor);strictObject(input,['botId','cursor','limit']);const limit=input.limit??100;requireCondition(Number.isSafeInteger(limit)&&limit>=1&&limit<=500&&(input.cursor===undefined||validId(input.cursor)),'invalid_limit');
    const state=this.store.read(),rows=Object.values(state.materials??{}).filter(doc=>(!input.botId||doc.botId===input.botId)&&(!input.cursor||doc.docId>input.cursor)&&this.policy.canRead(actor,{kind:'material',id:doc.docId},undefined,state)).sort((a,b)=>binary(a.docId,b.docId)).slice(0,limit);
    return rows.map(doc=>{this.policy.noteRead(actor,{kind:'material',id:doc.docId});const {text,chunks,...metadata}=doc;return copy(metadata);});
  }
  async resolveSource(actor,input,state=this.store.read()) {
    strictObject(input,['docId','chunkId']);const doc=this.#read(actor,input.docId,state),chunk=doc.chunks.find(c=>c.chunkId===input.chunkId);requireCondition(chunk,'chunk_not_found');
    const verification=await this.#sourceStatus(actor,doc);requireCondition(!['changed','unavailable'].includes(verification.status),'source_unavailable');this.#read(actor,input.docId);
    this.policy.noteRead(actor,{kind:'material',id:doc.docId});return {source:{kind:'material',storeId:state.storeId,docId:doc.docId,chunkId:chunk.chunkId,contentHash:doc.contentHash,startOffset:chunk.startOffset,endOffset:chunk.endOffset},contentSources:uniqueReferences([doc.source,...(doc.contentSources??[])]),origins:uniqueReferences([{kind:'material',id:doc.docId},...(doc.origins??[])]),...(doc.lineage?{lineage:copy(doc.lineage)}:{})};
  }
}
