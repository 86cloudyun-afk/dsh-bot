import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {chromium} from 'playwright-core';

// Structural renderer fixture only: evaluate the maintained component unchanged,
// exposing its internal pane in this test copy without changing the product API.
// This is not a native SDK, installed UI, approval, or qualification witness.
export async function renderOriginalPlanDialog(sessionId,detail) {
  const source=await readFile(new URL('../../src/client/bot-space.js',import.meta.url),'utf8');
  const marker='return {BotSpace,NativeConversation,NativeInteraction};';
  assert.equal(source.split(marker).length,2,'Expose exactly the original factory return in the evaluated test copy');
  const {createBotSpace}=await import(`data:text/javascript;base64,${Buffer.from(source.replace(marker,'return {BotSpace,NativeConversation,NativeInteraction,InteractionPane};')).toString('base64')}`);
  const React={
    createElement(type,props,...children) {
      const flat=children.flat(Infinity).filter(child=>child!==null&&child!==undefined&&child!==false);
      return typeof type==='function'?type({...props,children:flat}):{type,props:props??{},children:flat};
    },
    useState:initial=>[initial,()=>{}],useRef:initial=>({current:initial}),useEffect:()=>{},useSyncExternalStore:()=>{},
  };
  const {InteractionPane}=createBotSpace({React,ctx:{effect:()=>{}}});
  return InteractionPane({
    target:{sessionId,identityLabel:`原通道 ${sessionId}`,pending:{kind:'plan-review',questions:[{id:'original-plan',detail}]}},
    recovering:true,recoveryReference:{id:sessionId},isPending:()=>true,onClose:()=>{},onError:()=>{},
    SessionProvider:({session,children})=>{assert.equal(session.id,sessionId);return React.createElement('div',{'data-original-reference':session.id},children);},
    renderSlot:(name,props)=>{assert.equal(name,'dsh.bot-space.interaction');assert.equal(props.sessionId,sessionId);return React.createElement('div',{'data-plan-review-key':sessionId},React.createElement('button',null,'同意执行'));},
  });
}

export async function verifyPlanDialogScope(page) {
  const sessionId='original-plan-channel',otherId='different-plan-channel';
  const detail='# 原通道计划\n\n完整第二段\n\n- 原通道最后一项';
  const otherDetail='# 另一通道计划\n\n- 另一通道最后一项';
  const tree=await Promise.all([renderOriginalPlanDialog(otherId,otherDetail),renderOriginalPlanDialog(sessionId,detail)]);
  await page.evaluate(nodes=>{
    const render=node=>{
      if(typeof node==='string'||typeof node==='number')return document.createTextNode(String(node));
      const element=document.createElement(node.type);
      for(const [key,value] of Object.entries(node.props)) {
        if(key==='className')element.className=value;
        else if(key==='type'||key==='role'||key.startsWith('aria-')||key.startsWith('data-'))element.setAttribute(key,String(value));
      }
      for(const child of node.children)element.append(render(child));
      return element;
    };
    for(const node of nodes){const dialog=render(node);document.body.append(dialog);dialog.show();}
  },JSON.parse(JSON.stringify(tree))); // Only DOM structure/attributes; event callbacks are not this fixture's subject.
  const panel=page.locator(`.bs-interaction[data-session-id="${sessionId}"]`);
  assert.equal(await panel.count(),1);
  assert.equal(await page.locator('dialog').count(),2,'A different channel dialog must remain a distractor');
  assert.equal(await panel.locator('.bs-plan-document[aria-label="完整原生计划"] > pre').count(),0,'The genuine original component renders the plan as a sibling');
  const source=await readFile(new URL('./stock-v130-bot-space-checks.mjs',import.meta.url),'utf8');
  if(source.includes("const plan=panel.locator('.bs-plan-document[aria-label=\"完整原生计划\"] > pre')")) {
    assert.equal(await panel.locator('.bs-plan-document[aria-label="完整原生计划"] > pre').count(),1,'The installed selector must locate the real original component plan');
  }
  const {exactChannelPlanDocument}=await import('./stock-v130-bot-space-checks.mjs');
  assert.equal(typeof exactChannelPlanDocument,'function');
  const plan=await exactChannelPlanDocument(panel,sessionId);
  assert.equal(await plan.innerText(),detail,'Exact original full text includes its final item');
  assert.notEqual(await plan.innerText(),otherDetail);
  await assert.rejects(()=>exactChannelPlanDocument(page.locator(`.bs-interaction[data-session-id="${otherId}"]`),sessionId),/original session/);
  await assert.rejects(()=>exactChannelPlanDocument(page.locator('.bs-interaction'),sessionId),/unique native pane/);
  const owner=panel.locator('xpath=ancestor::dialog[1]');
  await owner.evaluate(dialog=>{const clone=dialog.querySelector('.bs-plan-document').cloneNode(true);clone.setAttribute('data-negative-test','duplicate-plan');dialog.querySelector('.bs-modal-body').append(clone);});
  await assert.rejects(()=>exactChannelPlanDocument(panel,sessionId),/one full original plan/);
  await owner.locator('[data-negative-test="duplicate-plan"]').evaluate(node=>node.remove());
  await owner.evaluate(dialog=>{const clone=dialog.querySelector('.bs-interaction').cloneNode(true);clone.setAttribute('data-session-id','different-nested-channel');dialog.querySelector('.bs-modal-body').append(clone);});
  await assert.rejects(()=>exactChannelPlanDocument(panel,sessionId),/only its original native pane/);
  assert.match(source,/const plan=await exactChannelPlanDocument\(panel,selected\.sessionId\)/,'The installed witness must use the same verified dialog scope');
}

if(resolve(process.argv[1]??'')===fileURLToPath(import.meta.url)) {
  test('original rendered plan belongs to the exact native channel dialog in Chromium',async()=>{
    const executablePath=process.env.DSH_BOT_CHROMIUM||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
    const browser=await chromium.launch({executablePath,headless:true,args:process.platform==='linux'?['--no-sandbox']:[]});
    try {const page=await browser.newPage();await verifyPlanDialogScope(page);} finally {await browser.close();}
  });
}
