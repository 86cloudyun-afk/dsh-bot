export function records(node,parent,items) {
 if(!items.length)parent.append(node('p','尚无记录'));
 for(const item of items){
  const value=JSON.stringify(item,null,2);
  const label=item.name??item.title??item.topic??(item.attemptId?'Attempt':item.taskId?'任务':item.planId?'持续计划':item.botId?'Bot':'记录');
  const states=[...new Set([item.lifecycle,item.readiness,item.responsibility,item.execution,item.state,item.stage,item.stop?.state].filter(Boolean))].join(' · ');
  if(/"(?:outcome_unknown|unknown)"/.test(value))parent.append(node('p',`${label}：结果待确认 (outcome_unknown)；保留原操作查回，核对执行与停止证据。`,'unknown'));
  const box=node('details');box.append(node('summary',`${label} · ${states}`),node('pre',value));parent.append(box);
 }
}
