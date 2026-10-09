import assert from 'node:assert/strict';
import {waitFor} from './stock-gui-runtime.mjs';

export async function runChatIdentityChecks(gui) {
  const dock=()=>gui.page.locator('[data-slot="conversation.input.dock"]');
  async function create(name) {
    await gui.workbench('Bots');
    const editor=gui.card('创建具名 Bot');
    await editor.getByLabel('名称',{exact:true}).fill(name);
    const before=new Set((await gui.snapshot()).bots.map(bot=>bot.botId));
    await editor.getByRole('button',{name:'创建 Bot',exact:true}).click();
    const state=await gui.until(s=>s.bots.some(bot=>bot.name===name&&!before.has(bot.botId)),'create identity Bot');
    return state.bots.find(bot=>bot.name===name&&!before.has(bot.botId));
  }
  async function begin(bot) {
    await gui.card(bot.name).getByRole('button',{name:'开始聊天',exact:true}).click();
    const state=await gui.until(s=>s.sessions.some(row=>row.botId===bot.botId&&row.purpose==='contact'),'identity contact binding');
    await gui.page.locator('[data-composer-input="true"][contenteditable="true"]').waitFor();
    return state.sessions.find(row=>row.botId===bot.botId&&row.purpose==='contact').sessionId;
  }
  async function reopen(sessionId) {
    await gui.workbench('会话管理');
    await gui.page.locator('article.card').filter({has:gui.page.locator('small').filter({hasText:sessionId})})
      .getByRole('button',{name:'查看原生会话',exact:true}).click();
  }
  const first=await create('嘟嘟'),firstId=await begin(first);
  assert.equal((await gui.snapshot()).sessions.find(row=>row.sessionId===firstId).botId,first.botId);
  assert.equal(await gui.page.locator('[data-slot="conversation.session.header.utilities"]').count(),0);
  gui.check('blankContactIsBoundWhileNativeHeaderIsHidden',true);
  const requestsBefore=gui.report.requests.length;
  await dock().getByRole('button',{name:'正在与嘟嘟聊天',exact:true}).waitFor({timeout:5000});
  assert.equal(gui.report.requests.length,requestsBefore);
  gui.check('blankBotChatShowsIdentityWithoutModelRequest',true);
  await gui.save('blank-dudu-identity');
  const input=gui.page.locator('[data-composer-input="true"][contenteditable="true"]');
  await input.fill('你好，嘟嘟');await input.press('Enter');
  await waitFor(()=>gui.report.requests.some(row=>row.sessionId===firstId&&row.finish==='stop'),'native Bot chat reply');
  await gui.page.locator('[data-slot="conversation.session.header.utilities"]')
    .getByRole('button',{name:'正在与嘟嘟聊天',exact:true}).waitFor();
  await dock().getByRole('button',{name:'正在与嘟嘟聊天',exact:true}).waitFor();
  gui.check('activeNativeChatKeepsCorrectBotIdentity',true);
  const second=await create('另一只Bot'),secondId=await begin(second);
  await dock().getByRole('button',{name:'正在与另一只Bot聊天',exact:true}).waitFor();
  assert.equal(await dock().getByRole('button',{name:'正在与嘟嘟聊天',exact:true}).count(),0);
  await reopen(firstId);
  await dock().getByRole('button',{name:'正在与嘟嘟聊天',exact:true}).waitFor();
  await reopen(secondId);
  await dock().getByRole('button',{name:'正在与另一只Bot聊天',exact:true}).waitFor();
  gui.check('switchingNativeSessionsUsesTheirOwnBotBinding',true);
  await gui.page.reload({waitUntil:'networkidle'});
  await dock().getByRole('button',{name:'正在与另一只Bot聊天',exact:true}).waitFor();
  gui.check('botChatIdentitySurvivesBrowserRefresh',true);
  await gui.workbench('Bots');
  await gui.card(second.name).getByRole('button',{name:'编辑',exact:true}).click();
  const edit=gui.card('编辑 Bot');await edit.getByLabel('名称',{exact:true}).fill('嘟嘟');
  await edit.getByRole('button',{name:'保存配置',exact:true}).click();
  await gui.until(s=>s.bots.find(bot=>bot.botId===second.botId)?.name==='嘟嘟','duplicate-name rename');
  await reopen(firstId);
  await dock().getByRole('button',{name:`正在与嘟嘟 · ${first.botId}聊天`,exact:true}).waitFor();
  await reopen(secondId);
  await dock().getByRole('button',{name:`正在与嘟嘟 · ${second.botId}聊天`,exact:true}).waitFor();
  gui.check('duplicateBotNamesKeepStableIdentityInNativeChat',true);
  await dock().getByRole('button',{name:`正在与嘟嘟 · ${second.botId}聊天`,exact:true}).click();
  await gui.page.getByRole('heading',{name:'Bot 工作台',exact:true}).waitFor();
  gui.check('chatIdentityOpensBotWorkbench',true);
}
