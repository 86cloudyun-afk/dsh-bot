import {plain, requireCondition} from './store.mjs';
const DAY = 86400000;
const formatters = new Map();
function formatter(timezone) {
  if (!formatters.has(timezone)) {
    try { formatters.set(timezone,new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})); }
    catch { requireCondition(false,'invalid_timezone'); }
  }
  return formatters.get(timezone);
}
function parts(at,timezone) {
  const p=Object.fromEntries(formatter(timezone).formatToParts(new Date(at)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`,stamp:Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)};
}
function dateStamp(date) {
  requireCondition(typeof date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(date),'invalid_schedule_rule');
  const value=Date.parse(`${date}T00:00:00Z`);
  requireCondition(Number.isFinite(value) && new Date(value).toISOString().slice(0,10)===date,'invalid_schedule_rule');
  return value;
}
function timestamp(at) {
  const value=at instanceof Date?at.getTime():typeof at==='number'?at:Date.parse(at);
  requireCondition(Number.isFinite(value),'invalid_schedule_rule');return value;
}
function localInstant(date,time,timezone) {
  const local=dateStamp(date)+(+time.slice(0,2)*60 + +time.slice(3))*60000, offsets=new Set();
  // Actual UTC offsets around this local day cover either side of a DST transition.
  for (const delta of [-36,-24,-12,0,12,24,36]) {const sample=local+delta*3600000;offsets.add(parts(sample,timezone).stamp-sample);}
  const candidates=[...offsets].map(offset=>local-offset).filter(at=>{const p=parts(at,timezone);return p.date===date&&p.time===time;});
  return candidates.length?Math.min(...candidates):null;
}
export function normalizeScheduleRule(input) {
  requireCondition(plain(input),'invalid_schedule_rule');
  const kind=input.kind??input.type, timezone=input.timezone??input.timeZone??'Asia/Shanghai';
  requireCondition(['once','interval','daily','weekly'].includes(kind)&&typeof timezone==='string'&&timezone.length<=100,'invalid_schedule_rule');
  formatter(timezone);
  const version=input.version??1;requireCondition(Number.isSafeInteger(version)&&version>=1,'invalid_schedule_rule');
  if(kind==='interval') {
    const everyMinutes=input.everyMinutes??input.intervalMinutes, anchor=timestamp(input.anchorAt??input.startAt);
    requireCondition(Number.isSafeInteger(everyMinutes)&&everyMinutes>=15&&everyMinutes<=52560000,'invalid_schedule_rule');
    return {kind,timezone,version,everyMinutes,anchorAt:new Date(anchor).toISOString()};
  }
  const time=input.time??input.localTime;
  requireCondition(typeof time==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time),'invalid_schedule_rule');
  if(kind==='once') {
    const date=input.date??input.localDate;dateStamp(date);
    const at=localInstant(date,time,timezone);requireCondition(at!==null,'nonexistent_local_time');
    return {kind,timezone,version,date,time,dueAt:new Date(at).toISOString()};
  }
  const result={kind,timezone,version,time};
  if(input.startDate!==undefined){dateStamp(input.startDate);result.startDate=input.startDate;}
  if(kind==='weekly') {
    requireCondition(Array.isArray(input.weekdays)&&input.weekdays.length>=1&&input.weekdays.length<=7&&input.weekdays.every(n=>Number.isInteger(n)&&n>=0&&n<=6),'invalid_schedule_rule');
    result.weekdays=[...new Set(input.weekdays)].sort();
  }
  return result;
}
function trigger(rule,at,date) {
  return {dueAt:new Date(at).toISOString(),triggerKey:rule.kind==='interval'?`utc:${new Date(at).toISOString()}`:`local:${date}`,ruleVersion:rule.version,...(date?{localDate:date}:{})};
}
function find(input,at,direction,inclusive) {
  const rule=normalizeScheduleRule(input), now=timestamp(at);
  if(rule.kind==='once') {
    const due=timestamp(rule.dueAt), eligible=direction===1?(inclusive?due>=now:due>now):due<=now;
    return eligible?trigger(rule,due,rule.date):null;
  }
  if(rule.kind==='interval') {
    const anchor=timestamp(rule.anchorAt), period=rule.everyMinutes*60000;
    const index=direction===1?(inclusive?Math.ceil((now-anchor)/period):Math.floor((now-anchor)/period)+1):Math.floor((now-anchor)/period);
    if(direction===-1&&index<0)return null;
    return trigger(rule,anchor+Math.max(index,0)*period);
  }
  let day=dateStamp(parts(now,rule.timezone).date);
  if(direction===1&&rule.startDate)day=Math.max(day,dateStamp(rule.startDate));
  // A daily/weekly rule needs at most one year to find the next real local time.
  // No trigger history is enumerated even after decades offline.
  let skipped=0;
  for(let i=0;i<370;i++,day+=direction*DAY) {
    const date=new Date(day).toISOString().slice(0,10);
    if(rule.startDate&&date<rule.startDate)return null;
    if(rule.kind==='weekly'&&!rule.weekdays.includes(new Date(day).getUTCDay()))continue;
    const due=localInstant(date,rule.time,rule.timezone);
    if(due===null){skipped++;continue;}
    if(direction===1?(inclusive?due>=now:due>now):due<=now)return {...trigger(rule,due,date),...(skipped?{skippedLocalTimes:skipped,skipReason:'nonexistent_local_time'}:{})};
  }
  return null;
}
export function nextTrigger(rule,after,{inclusive=false}={}) {return find(rule,after,1,inclusive);}
export function latestTrigger(rule,at) {return find(rule,at,-1,true);}
