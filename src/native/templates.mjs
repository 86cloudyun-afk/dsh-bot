import { copy, plain, requireCondition } from './store.mjs';

const recipes = [
  {templateId:'personal-assistant',templateVersion:1,name:'个人助理',description:'日常安排与任务跟进',role:'协助日常安排并清楚记录任务进展。',suggestedName:'个人助理',executionMode:'inherit'},
  {templateId:'research',templateVersion:1,name:'资料整理',description:'整理来源与证据',role:'整理资料，保留来源，明确区分事实和推断。',suggestedName:'资料整理',executionMode:'inherit'},
  {templateId:'development',templateVersion:1,name:'开发',description:'实现与验证变更',role:'实现明确需求并验证实际行为。',suggestedName:'开发',executionMode:'inherit'},
  {templateId:'testing',templateVersion:1,name:'测试',description:'检查行为与证据',role:'独立检查结果，记录可复现的验证证据。',suggestedName:'测试',executionMode:'inherit'},
];
const catalog = [...recipes.map(recipe => ({...recipe,roles:[{roleKey:'assistant',botTemplateId:recipe.templateId}]})),
  {templateId:'research-review',templateVersion:1,name:'资料整理与复核',description:'整理来源并独立复核',roles:[{roleKey:'researcher',botTemplateId:'research'},{roleKey:'reviewer',botTemplateId:'testing'}],coordinatorRoleKey:'researcher',group:{rounds:1,maxRequests:12}},
  {templateId:'development-testing',templateVersion:1,name:'开发与测试',description:'实现变更并独立验证',roles:[{roleKey:'developer',botTemplateId:'development'},{roleKey:'tester',botTemplateId:'testing'}],coordinatorRoleKey:'developer',group:{rounds:1,maxRequests:12}},
];

/** Recipes create fresh identities only; no tools, credentials or history are copied. */
export class TemplateController {
  constructor({store,policy,bots,collaboration}) { Object.assign(this,{store,policy,bots,collaboration}); }
  list(actor) { this.policy.actorKey(actor); return copy(catalog); }
  async instantiate(actor,command) {
    command=copy(command);
    this.policy.actorKey(actor);
    requireCondition(actor.kind==='human','access_denied');
    requireCondition(Number.isSafeInteger(command.expectedRevision)&&command.expectedRevision>=0,'invalid_revision');
    const stamped=this.policy.command(actor,command);
    // Replays retain their original fingerprint and require no new native validation.
    if(Object.hasOwn(this.store.read().operations,command.operationId))return this.store.transact(stamped,()=>null);
    const input=command.input;
    requireCondition(plain(input)&&Object.keys(input).every(key=>['templateId','templateVersion','roles','group'].includes(key)),'invalid_template');
    const template=catalog.find(row=>row.templateId===input.templateId&&row.templateVersion===input.templateVersion);
    requireCondition(template,'template_not_found');
    requireCondition(Array.isArray(input.roles)&&input.roles.length===template.roles.length&&
      new Set(input.roles.map(row=>row?.roleKey)).size===input.roles.length&&input.roles.every(row=>
        plain(row)&&Object.keys(row).every(key=>['roleKey','config'].includes(key))&&
        template.roles.some(recipe=>recipe.roleKey===row.roleKey)&&plain(row.config)),'invalid_template_roles');
    if(input.group!==undefined)requireCondition(template.coordinatorRoleKey&&plain(input.group)&&
      Object.keys(input.group).every(key=>['name','rounds','maxRequests'].includes(key)),'invalid_group');
    const validated=[];
    for(const row of input.roles)validated.push({roleKey:row.roleKey,config:await this.bots.validateCreateConfig(row.config)});
    return this.store.transact(stamped,draft=>{
      this.policy.require(actor,'bot.create',{kind:'bot',id:'new'},draft);
      const botIdsByRole={};
      for(const row of validated)botIdsByRole[row.roleKey]=this.bots.createValidatedInDraft(actor,row.config,draft).botId;
      const group=input.group ? this.collaboration.createGroupInDraft(actor,{
        ...template.group,...input.group,botIds:Object.values(botIdsByRole),coordinatorBotId:botIdsByRole[template.coordinatorRoleKey],
      },draft) : null;
      return {templateId:template.templateId,templateVersion:template.templateVersion,botIdsByRole,groupId:group?.groupId??null};
    });
  }
}
