import { writeFile, readFile, access, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runUiRegressions } from "./stock-ui-regressions.mjs";
import {
  stockGui,
  controlledProvider,
  textReply,
  toolReply,
  waitFor,
} from "./stock-gui-runtime.mjs";

let gui;
const calls = new Map();
async function* stream(options, state) {
  const service = state.app.ctx.dshBot,
    binding = service.store.read().sessions[options.sessionId],
    count = (calls.get(options.sessionId) ?? 0) + 1;
  calls.set(options.sessionId, count);
  if (options.purpose === "session-title") {
    yield* textReply("原生插件验收");
    return;
  }
  if (binding?.purpose === "execution") {
    const attempt = service.store.read().attempts[binding.attemptId],
      task = service.store.read().tasks[attempt.taskId];
    if (task.goal.startsWith("GUI_LONG") && count === 1) {
      yield* toolReply(
        "bash",
        {
          command: `node ${JSON.stringify(join(state.root, "work/heartbeat.mjs"))}`,
          description: "Run an owned local heartbeat",
          run_in_background: true,
        },
        `heartbeat-${binding.attemptId}`,
      );
      return;
    }
    yield* textReply(
      task.goal.startsWith("GUI_LONG")
        ? "后台作业已启动"
        : task.goal.includes("接续")
          ? "接续后的目标已完成"
          : `短任务已完成 ${attempt.attemptId}`,
    );
    return;
  }
  if (binding?.purpose === "contact") {
    const bot = service.store.read().bots[binding.botId];
    yield* textReply(`${bot.name}，青草。聊天仍然可用。`);
    return;
  }
  if (binding?.lineage?.phase === "independent")
    await waitFor(
      () => Object.keys(service.store.read().meetings).length === 2,
      "two simultaneously independent meetings",
    );
  if (options.sessionId === state.ordinaryHold) {
    await new Promise((resolve) =>
      options.signal.addEventListener("abort", resolve, { once: true }),
    );
    options.signal.throwIfAborted();
    return;
  }
  yield* textReply(
    `${binding?.lineage?.phase ?? "group"}：${binding?.botId ?? "ordinary"} 的受控原生意见`,
  );
}
async function newTask(title, goal, origin = gui.contactId) {
  await gui.workbench("任务");
  const card = gui.card("新任务");
  await card.getByLabel("负责人").selectOption(gui.botIds[0]);
  await card.getByLabel("标题", { exact: true }).fill(title);
  await card.getByLabel("目标", { exact: true }).fill(goal);
  await card.getByLabel("验收条件（每行一项）").fill("原生结果和资源证据存在");
  if (origin) await card.getByLabel("结果接收会话").selectOption(origin);
  await card.getByRole("button", { name: "登记任务", exact: true }).click();
  const state = await gui.until(
    (s) => s.tasks.some((row) => row.title === title),
    "GUI task registration",
  );
  return state.tasks.find((row) => row.title === title);
}
async function startTask(task) {
  await gui
    .card(task.title)
    .getByRole("button", { name: "开始／接续", exact: true })
    .click();
  const state = await gui.until(
    (s) => s.tasks.find((row) => row.taskId === task.taskId)?.currentAttemptId,
    "GUI task start",
  );
  return state.attempts.find(
    (row) =>
      row.attemptId ===
      state.tasks.find((row) => row.taskId === task.taskId).currentAttemptId,
  );
}
async function openContact() {
  await gui.workbench("会话管理");
  await gui.page.getByRole("button", { name: "刷新会话", exact: true }).click();
  await gui.page
    .locator("article")
    .filter({ hasText: gui.contactId })
    .getByRole("button", { name: "查看原生会话", exact: true })
    .click();
  await gui.page
    .getByRole("heading", { name: "Bot 工作台", exact: true })
    .waitFor({ state: "hidden" });
  await gui.page.getByRole("textbox").last().waitFor();
}
async function chooseContact(botId) {
  await gui.page
    .getByRole("button", { name: "新建 Bot 会话", exact: true })
    .last()
    .click();
  const dialog = gui.page.getByRole("dialog", { name: "新建 Bot 会话" });
  await dialog.getByLabel("选择已创建的 Bot").selectOption(botId);
  await dialog.getByRole("button", { name: "开始对话", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await gui.page.getByRole("textbox").last().waitFor();
}
async function chat(text) {
  const input = gui.page.locator(
    '[data-composer-input="true"][contenteditable="true"]',
  );
  await input.waitFor({ state: "visible" });
  await input.fill(text);
  await input.press("Enter");
}
const mark = (stage) => {
  gui.report.stage = stage;
  console.log(JSON.stringify({ stage }));
};

try {
  gui = await stockGui({ stream });
  await writeFile(
    join(gui.root, "work/heartbeat.mjs"),
    `import {writeFileSync,existsSync} from 'node:fs';let tick=0;function beat(){if(existsSync(${JSON.stringify(join(gui.root, "work/release"))}))process.exit(0);writeFileSync(${JSON.stringify(join(gui.root, "work/heartbeat.json"))},JSON.stringify({pid:process.pid,tick:++tick}));}beat();setInterval(beat,50);\n`,
    { mode: 0o600 },
  );
  mark("standard-install-and-stock-browser");
  await writeFile(
    join(gui.root, "work/heartbeat-pty.mjs"),
    (await readFile(join(gui.root, "work/heartbeat.mjs"), "utf8")).replaceAll(
      "heartbeat.json",
      "pty-heartbeat.json",
    ),
    { mode: 0o600 },
  );
  await gui.boot();
  const unauth = await fetch(
    new URL("/api/dsh.bot/snapshot", gui.url).origin + "/api/dsh.bot/snapshot",
    { method: "POST", body: "{}" },
  );
  gui.check("nativeAuthenticationRequired", unauth.status === 401);
  await gui.workbench();
  await gui.page.getByRole("heading", { name: "创建具名 Bot" }).waitFor();
  mark("three-named-bots");
  for (const [index, name] of ["原生甲", "原生乙", "原生丙"].entries()) {
    await gui.page.getByLabel("名称", { exact: true }).fill(name);
    await gui.page
      .getByLabel("身份与职责")
      .fill("A harmless qualification Bot");
    await gui.page
      .getByLabel("工作目录（DSH 所在机器）")
      .fill(join(gui.root, "work"));
    await gui.page.getByLabel("联络模型", { exact: true }).selectOption(
      JSON.stringify({
        provider: controlledProvider,
        model: `model-${String.fromCharCode(97 + index)}`,
      }),
    );
    await gui.page.getByLabel("执行模型", { exact: true }).selectOption(
      JSON.stringify({
        provider: controlledProvider,
        model: `model-${String.fromCharCode(97 + index)}`,
      }),
    );
    await gui.page
      .getByLabel("允许使用的原生工具（逗号分隔名称）")
      .fill("bash");
    await gui.page
      .getByRole("button", { name: "创建 Bot", exact: true })
      .click();
    await gui.page.getByRole("heading", { name, exact: true }).waitFor();
  }
  const createdBots = (await gui.snapshot()).bots;
  gui.botIds = ["原生甲", "原生乙", "原生丙"].map(
    (name) => createdBots.find((row) => row.name === name).botId,
  );
  gui.check("threeSeparateBotIdentities", new Set(gui.botIds).size === 3);
  await gui.page.getByRole("button", { name: "记忆", exact: true }).click();
  await gui.page
    .getByRole("combobox", { name: "Bot", exact: true })
    .selectOption(gui.botIds[0]);
  await gui.page.getByLabel("内容", { exact: true }).fill("长期记忆代号：青草");
  await gui.page
    .getByRole("button", { name: "保存到所选 Bot", exact: true })
    .click();
  await gui.until((s) => s.memories.length === 1, "GUI memory save");
  mark("native-contact-and-frozen-model");
  await chooseContact(gui.botIds[0]);
  gui.contactId = (await gui.snapshot()).sessions.find(
    (row) => row.purpose === "contact",
  ).sessionId;
  await chat("你的名称与长期记忆");
  await waitFor(
    () =>
      gui.report.requests.some(
        (row) => row.sessionId === gui.contactId && row.finish === "stop",
      ),
    "contact native model request",
  );
  gui.check(
    "contactUsesOwnModel",
    gui.report.requests.find((row) => row.sessionId === gui.contactId).model ===
      "model-a",
  );
  await gui.save("native-contact");
  mark("real-background-job-and-concurrent-chat");
  const long = await newTask(
      "后台长任务",
      "GUI_LONG：只运行本环境内无害的心跳作业",
    ),
    longAttempt = await startTask(long);
  await waitFor(async () => {
    try {
      await access(join(gui.root, "work/heartbeat.json"));
      return gui.app.ctx.jobs
        .list(longAttempt.sessionId)
        .some((row) => row.status === "running");
    } catch {
      return false;
    }
  }, "physical native Bash background job");
  gui.check(
    "longOwnsARealRunningNativeJob",
    (await gui.snapshot()).attempts.find(
      (row) => row.attemptId === longAttempt.attemptId,
    ).reservationHeld,
  );
  await openContact();
  const before = gui.report.requests.filter(
    (row) => row.sessionId === gui.contactId && row.purpose === "conversation",
  ).length;
  await chat("后台继续运行，聊天仍然可用吗");
  await waitFor(
    () =>
      gui.report.requests.filter(
        (row) =>
          row.sessionId === gui.contactId &&
          row.purpose === "conversation" &&
          row.finish === "stop",
      ).length > before,
    "contact during background work",
  );
  gui.check(
    "contactRespondsDuringLongWork",
    gui.app.ctx.jobs
      .list(longAttempt.sessionId)
      .some((row) => row.status === "running"),
  );
  const short = await newTask("短任务", "GUI_SHORT：给出简短结果"),
    first = await startTask(short);
  let state = await gui.until(
    (s) =>
      s.outbox.some(
        (row) => row.attemptId === first.attemptId && row.state === "accepted",
      ),
    "short result in original contact",
  );
  gui.check(
    "shortCompletesBeforeLongWork",
    state.attempts.find((row) => row.attemptId === longAttempt.attemptId)
      .reservationHeld,
  );
  const terminalOwner = gui.app.ctx.agents.get(longAttempt.sessionId),
    pty = await gui.app.ctx.terminals.spawn(terminalOwner, {
      type: "bash",
      cwd: join(gui.root, "work"),
      name: "qualification",
    });
  const ptySend = gui.app.ctx.terminals.startSend(
    terminalOwner,
    pty.sessionId,
    {
      text: `node ${JSON.stringify(join(gui.root, "work/heartbeat-pty.mjs"))}`,
      submit: true,
    },
  );
  ptySend.done.catch(() => {});
  await waitFor(async () => {
    try {
      await access(join(gui.root, "work/pty-heartbeat.json"));
      return true;
    } catch {
      return false;
    }
  }, "actual owned PTY process");
  gui.check("longOwnsRealNativePty", true);
  gui.check(
    "reservedResultIdInOriginalNativeLog",
    (await gui.original(gui.contactId)).some(
      (row) =>
        row.type === "user/message" && row.data.id === first.resultMessageId,
    ),
  );
  await gui.save("concurrent-tasks");
  const child = await newTask(
    "一级子工作",
    "GUI_SHORT：由父工作管理的一级子工作",
  );
  await gui
    .card(child.title)
    .getByLabel("所属父工作")
    .selectOption(longAttempt.attemptId);
  await gui
    .card(child.title)
    .getByRole("button", { name: "作为一级子工作开始", exact: true })
    .click();
  state = await gui.until(
    (s) =>
      s.attempts.some(
        (row) => row.taskId === child.taskId && row.state === "returned",
      ),
    "native child return",
  );
  const childAttempt = state.attempts.find(
      (row) => row.taskId === child.taskId,
    ),
    childHistory = await gui.app.ctx.dshBot.adapter.readNative(
      childAttempt.sessionId,
    );
  gui.check(
    "realNativeChildDepthAndDescriptor",
    childHistory.header.parentSession === longAttempt.sessionId &&
      childHistory.header.delegationDepth === 1 &&
      childHistory.events.some(
        (row) =>
          row.type === "subagent/descriptor" && row.data.mode === "one-shot",
      ),
  );
  await gui
    .card(child.title)
    .getByRole("button", { name: "查看执行", exact: true })
    .click();
  await gui.page
    .getByRole("heading", { name: "Bot 工作台", exact: true })
    .waitFor({ state: "hidden" });
  await gui.page
    .getByText(`短任务已完成 ${childAttempt.attemptId}`, { exact: true })
    .waitFor();
  await gui.page.getByText("一次性子智能体记录", { exact: true }).waitFor();
  gui.check("actualNativeChildView", true);
  await gui.workbench("任务");
  mark("task-view-adjust-continue-accept-archive");
  await gui
    .card(short.title)
    .getByRole("button", { name: "查看执行", exact: true })
    .click();
  await gui.page
    .getByText(`短任务已完成 ${first.attemptId}`, { exact: true })
    .first()
    .waitFor();
  await gui.page
    .getByRole("heading", { name: "Bot 工作台", exact: true })
    .waitFor({ state: "hidden" });
  gui.check("actualExecutionView", true);
  await gui.workbench("任务");
  await gui.card(short.title).getByLabel("新目标").fill("GUI_SHORT 接续");
  await gui
    .card(short.title)
    .getByRole("button", { name: "调整目标", exact: true })
    .click();
  await gui.until(
    (s) =>
      s.tasks.find((row) => row.taskId === short.taskId).state === "adjusted",
    "adjusted task",
  );
  await gui
    .card(short.title)
    .getByRole("button", { name: "开始／接续", exact: true })
    .click();
  state = await gui.until(
    (s) =>
      s.attempts.some(
        (row) =>
          row.taskId === short.taskId &&
          row.epoch === 2 &&
          row.state === "returned",
      ),
    "continued task return",
  );
  const second = state.attempts.find(
    (row) => row.taskId === short.taskId && row.epoch === 2,
  );
  gui.check("sameTaskNewAttempt", second.attemptId !== first.attemptId);
  await gui.card(short.title).getByLabel("结论").selectOption("passed");
  await gui
    .card(short.title)
    .getByLabel("实际证据")
    .fill("原生日志中的受控模型答复及当次身份");
  await gui
    .card(short.title)
    .getByRole("button", { name: "记录验收", exact: true })
    .click();
  await gui.until(
    (s) =>
      s.tasks.find((row) => row.taskId === short.taskId).acceptance ===
      "passed",
    "task acceptance",
  );
  await gui
    .card(short.title)
    .getByRole("button", { name: "归档", exact: true })
    .click();
  await gui.until(
    (s) => s.tasks.find((row) => row.taskId === short.taskId).archived,
    "task archive",
  );
  await gui
    .card(short.title)
    .getByRole("button", { name: "恢复", exact: true })
    .click();
  await gui.until(
    (s) => !s.tasks.find((row) => row.taskId === short.taskId).archived,
    "task restore",
  );
  gui.check("taskGuiLifecycle", true);
  mark("exact-stop-with-physical-evidence");
  await gui
    .card(long.title)
    .getByRole("button", { name: "停止本次尝试", exact: true })
    .click();
  await gui.until(
    (s) =>
      s.attempts.find((row) => row.attemptId === longAttempt.attemptId)
        .state === "stopped" &&
      !s.attempts.find((row) => row.attemptId === longAttempt.attemptId)
        .reservationHeld,
    "real background stop settlement",
  );
  const beat = JSON.parse(
    await readFile(join(gui.root, "work/heartbeat.json"), "utf8"),
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  gui.check(
    "physicalHeartbeatStopped",
    JSON.parse(await readFile(join(gui.root, "work/heartbeat.json"), "utf8"))
      .tick === beat.tick,
  );
  gui.check(
    "nativeJobsQuiescent",
    !gui.app.ctx.jobs
      .list(longAttempt.sessionId)
      .some((row) => ["running", "stopping"].includes(row.status)),
  );
  await ptySend.done;
  const ptyBeat = JSON.parse(
    await readFile(join(gui.root, "work/pty-heartbeat.json"), "utf8"),
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  gui.check(
    "physicalPtyStopped",
    JSON.parse(
      await readFile(join(gui.root, "work/pty-heartbeat.json"), "utf8"),
    ).tick === ptyBeat.tick,
  );
  gui.check(
    "nativePtyQuiescent",
    !gui.app.ctx.terminals.hasOwnerActivity(terminalOwner),
  );
  mark("two-groups-and-two-meetings");
  await gui.workbench("内部群");
  const groupIds = [];
  for (const name of ["内部群一", "内部群二"]) {
    const form = gui.card("新建内部群");
    await form.getByLabel("群名称").fill(name);
    await form.getByLabel("成员（可多选）").selectOption(gui.botIds);
    await form.getByLabel("协调者（必须在成员中）").selectOption(gui.botIds[0]);
    await form.getByRole("button", { name: "创建群", exact: true }).click();
    state = await gui.until(
      (s) => s.groups.some((row) => row.name === name),
      "GUI group create",
    );
    groupIds.push(state.groups.find((row) => row.name === name).groupId);
  }
  for (const [index, name] of ["内部群一", "内部群二"].entries()) {
    const group = gui.card(name);
    await group
      .getByLabel("消息", { exact: true })
      .fill(`群 ${index + 1} 的独立消息`);
    await group
      .getByRole("button", { name: "发送给群成员", exact: true })
      .click();
    await gui.until(
      (s) =>
        s.groups
          .find((row) => row.groupId === groupIds[index])
          .messages.filter((row) => row.producer.kind === "bot").length === 3,
      "actual native group replies",
    );
  }
  for (const index of [0, 1]) {
    const group = gui.card("内部群一");
    await group.getByLabel("议题", { exact: true }).fill(`会议${index + 1}`);
    await group.getByLabel("共同材料").fill(`会议${index + 1}的共同材料`);
    await group.getByRole("button", { name: "发起会议", exact: true }).click();
    await gui.until(
      (s) => s.meetings.some((row) => row.topic === `会议${index + 1}`),
      "GUI meeting start",
    );
  }
  await gui.workbench("会议");
  await gui.until(
    (s) =>
      s.meetings.length === 2 &&
      s.meetings.every((row) => Object.keys(row.opinions).length === 3),
    "independent native opinions",
  );
  gui.check("twoIndependentMeetings", true);
  gui.check(
    "twoMeetingsBelongToSameGroup",
    (await gui.snapshot()).meetings.every((row) => row.groupId === groupIds[0]),
  );
  for (const topic of ["会议1", "会议2"]) {
    const card = gui.card(topic);
    await card.getByRole("button", { name: "揭示并讨论", exact: true }).click();
    await gui.until(
      (s) =>
        Object.keys(s.meetings.find((row) => row.topic === topic).discussion)
          .length === 3,
      "actual discussion",
    );
    await card.getByRole("button", { name: "进入决定", exact: true }).click();
    await gui.until(
      (s) => s.meetings.find((row) => row.topic === topic).decision,
      "actual coordinator decision",
    );
    await card.getByRole("button", { name: "结束会议", exact: true }).click();
    await gui.until(
      (s) => s.meetings.find((row) => row.topic === topic).phase === "complete",
      "GUI meeting completion",
    );
  }
  gui.check("nativeOpinionsDiscussionAndDecisions", true);
  const action = gui.card("会议1");
  await action.getByLabel("负责人").selectOption(gui.botIds[1]);
  await action.getByLabel("任务标题").fill("会议行动");
  await action.getByLabel("行动目标").fill("实际任务行动");
  await action.getByLabel("验收条件", { exact: true }).fill("原生执行");
  await action
    .getByRole("button", { name: "生成真实行动任务", exact: true })
    .click();
  state = await gui.until(
    (s) => s.tasks.some((row) => row.title === "会议行动"),
    "meeting action",
  );
  gui.check(
    "linkedRealActionTask",
    state.meetings
      .find((row) => row.topic === "会议1")
      .actions.includes(
        state.tasks.find((row) => row.title === "会议行动").taskId,
      ),
  );
  await gui.save("group-meeting-workbench");
  mark("ordinary-session-management-and-result");
  const ordinary = await gui.app.ctx.sessionController.create(
    {
      workspaceId: gui.app.ctx.workspaceRegistry
        .list()
        .find((row) => row.path === join(gui.root, "work")).id,
    },
    new AbortController().signal,
  );
  gui.ordinaryHold = ordinary.sessionId;
  await gui.workbench("会话管理");
  await gui.page.getByRole("button", { name: "刷新会话", exact: true }).click();
  await gui.page
    .locator("article")
    .filter({ hasText: ordinary.sessionId })
    .getByRole("button", { name: "查看原生会话", exact: true })
    .click();
  await gui.page
    .getByRole("heading", { name: "Bot 工作台", exact: true })
    .waitFor({ state: "hidden" });
  await chat("A held ordinary native reply");
  await waitFor(
    () => gui.activeSignals.has(ordinary.sessionId),
    "ordinary native request",
  );
  await gui.workbench("会话管理");
  await gui.page.getByRole("button", { name: "刷新会话", exact: true }).click();
  await gui.page
    .locator("article")
    .filter({ hasText: ordinary.sessionId })
    .getByRole("button", { name: "停止当前回复", exact: true })
    .click();
  await waitFor(
    () => gui.activeSignals.get(ordinary.sessionId).aborted,
    "ordinary current reply stop",
  );
  await gui.app.ctx.agents.get(ordinary.sessionId).whenIdle();
  gui.check(
    "ordinaryStopPreservesOrdinaryOwnership",
    (await gui.snapshot()).sessions.find(
      (row) => row.sessionId === ordinary.sessionId,
    ).botId === null,
  );
  gui.ordinaryHold = undefined;
  const ordinaryTask = await newTask(
      "普通来源任务",
      "GUI_SHORT：返回普通 DSH 会话",
      ordinary.sessionId,
    ),
    ordinaryAttempt = await startTask(ordinaryTask);
  await gui.until(
    (s) =>
      s.outbox.some(
        (row) =>
          row.attemptId === ordinaryAttempt.attemptId &&
          row.state === "accepted",
      ),
    "ordinary result accepted",
  );
  await waitFor(async () => {
    await gui.app.ctx.sessions.flush(
      gui.app.ctx.agents.get(ordinary.sessionId).session,
    );
    return (await gui.original(ordinary.sessionId)).some(
      (row) =>
        row.type === "user/message" &&
        row.data.source?.rpcId === ordinaryAttempt.resultMessageId,
    );
  }, "ordinary original result log");
  gui.check("guiSelectsOrdinaryResultOrigin", true);
  mark("two-browser-pages-same-identity");
  const otherPage = await gui.context.newPage();
  await otherPage.goto(gui.url, { waitUntil: "networkidle" });
  const sameIds = await otherPage.evaluate(async () => {
    const response = await fetch("/api/dsh.bot/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "client-request",
        rpcId: crypto.randomUUID(),
        method: "dsh.bot/snapshot",
        payload: {},
      }),
    });
    return (await response.json()).result.value.bots
      .map((row) => row.botId)
      .sort();
  });
  gui.check(
    "twoBrowserPagesReuseSameIdentity",
    JSON.stringify(sameIds) === JSON.stringify([...gui.botIds].sort()),
  );
  await otherPage.close();
  mark("native-contact-archive-restore");
  await gui.app.ctx.agents.get(gui.contactId)?.whenIdle();
  await gui.workbench("会话管理");
  await gui.page.getByRole("button", { name: "刷新会话", exact: true }).click();
  await gui.page
    .locator("article")
    .filter({ hasText: gui.contactId })
    .getByRole("button", { name: "归档", exact: true })
    .click();
  await gui.until(
    (s) => s.sessions.find((row) => row.sessionId === gui.contactId).archived,
    "native archive",
  );
  await gui.workbench("会话管理");
  await gui.page.getByRole("button", { name: "刷新会话", exact: true }).click();
  await gui.page
    .locator("article")
    .filter({ hasText: gui.contactId })
    .getByRole("button", { name: "恢复", exact: true })
    .click();
  await gui.until(
    (s) => !s.sessions.find((row) => row.sessionId === gui.contactId).archived,
    "native restore",
  );
  await openContact();
  gui.check(
    "sameNativeHistoryAfterRestore",
    (await gui.page.locator("body").innerText()).includes("聊天仍然可用"),
  );
  mark("cold-blank-contact-with-different-global-model");
  await gui.workbench();
  const beforeIds = new Set(
    (await gui.snapshot()).sessions.map((row) => row.sessionId),
  );
  await chooseContact(gui.botIds[0]);
  const blank = (await gui.snapshot()).sessions.find(
    (row) => row.purpose === "contact" && !beforeIds.has(row.sessionId),
  );
  const botIds = [...gui.botIds],
    contactId = gui.contactId;
  await gui.shutdown();
  await gui.boot();
  state = await gui.snapshot();
  gui.check(
    "coldRestoresOriginalBotIds",
    JSON.stringify(state.bots.map((row) => row.botId).sort()) ===
      JSON.stringify(botIds.sort()),
  );
  gui.check(
    "coldRestoresOwnMemory",
    state.memories.some((row) => row.text.includes("青草")),
  );
  await gui.app.ctx.sessionController.prompt(
    {
      requestId: crypto.randomUUID(),
      sessionId: blank.sessionId,
      mode: "queue",
      content: [
        { type: "text", text: "A fresh native controller contact turn" },
      ],
    },
    new AbortController().signal,
  );
  await waitFor(
    () =>
      gui.report.requests.some(
        (row) => row.sessionId === blank.sessionId && row.finish === "stop",
      ),
    "stock controller blank cold resume",
  );
  gui.check(
    "stockControllerColdUsesBotModel",
    gui.report.requests.find((row) => row.sessionId === blank.sessionId)
      .model === "model-a",
  );
  gui.check(
    "globalModelUnchanged",
    gui.app.ctx.agentDefaultModel.currentSelection().model === "model-c",
  );
  gui.contactId = contactId;
  mark("disable-reenable-and-uninstall-reinstall");
  gui.ordinaryHold = ordinary.sessionId;
  const priorOrdinary = gui.report.requests.filter(
    (row) =>
      row.sessionId === ordinary.sessionId && row.purpose === "conversation",
  ).length;
  await gui.app.ctx.sessionController.prompt(
    {
      requestId: crypto.randomUUID(),
      sessionId: ordinary.sessionId,
      mode: "queue",
      content: [{ type: "text", text: "An unrelated held native turn" }],
    },
    new AbortController().signal,
  );
  await waitFor(
    () =>
      gui.report.requests.filter(
        (row) =>
          row.sessionId === ordinary.sessionId &&
          row.purpose === "conversation",
      ).length > priorOrdinary,
    "ordinary turn before disable",
  );
  const manager = gui.app.ctx.pluginManager;
  await manager.setBundleEnabled("dsh-bot", false);
  await waitFor(() => !gui.app.ctx.get("dshBot"), "plugin disable");
  gui.check("disabledUnregistersNativeService", true);
  gui.check(
    "disableDoesNotCancelUnrelatedOrdinaryAgent",
    !gui.activeSignals.get(ordinary.sessionId).aborted,
  );
  await manager.setBundleEnabled("dsh-bot", true);
  await waitFor(() => gui.app.ctx.get("dshBot"), "plugin reenable");
  gui.check(
    "reenableRetainsIdentity",
    gui.app.ctx.dshBot.store.read().bots[gui.botIds[0]].botId === gui.botIds[0],
  );
  await gui.shutdown();
  gui.uninstall();
  gui.reinstall();
  await gui.boot();
  gui.check(
    "standardUninstallReinstallPreservesData",
    (await gui.snapshot()).bots.some((row) => row.botId === gui.botIds[0]),
  );
  mark("ui-sharing-and-concurrent-draft-regressions");
  await runUiRegressions(gui);
  gui.check("noBrowserScriptErrors", gui.errors.length === 0);
  await gui.save("final-native-workbench");
  gui.report.passed = true;
  mark("complete");
} catch (error) {
  if (gui) {
    gui.report.passed = false;
    gui.report.error = String(error.stack).replace(/https?:\/\/\S+/g, "[URL omitted]");
    try {
      await gui.save("failure");
    } catch {}
  } else {
    const evidence = resolve(process.env.DSH_BOT_GUI_OUTPUT ?? "qualification/gui");
    await mkdir(evidence, { recursive: true });
    const report = {
      passed: false,
      stage: "standard-profile-initialization-or-plugin-install",
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      realModelRequests: 0,
      checks: {},
      error: String(error.stack).replace(/https?:\/\/\S+/g, "[URL omitted]"),
      ...(error.code ? { errorCode: error.code } : {}),
      ...(error.status !== undefined ? { commandExitCode: error.status } : {}),
    };
    await writeFile(join(evidence, "stock-gui-report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ passed: false, stage: report.stage, error: report.error, evidence }));
  }
  process.exitCode = 1;
} finally {
  if (gui) {
    await writeFile(join(gui.root, "work/release"), "release", { mode: 0o600 });
    await gui.shutdown();
    await gui.writeReport();
    console.log(
      JSON.stringify({
        passed: gui.report.passed,
        stage: gui.report.stage,
        checks: gui.report.checks,
        controlledRequests: gui.report.requests.length,
        evidence: gui.evidence,
      }),
    );
    process.exitCode = gui.report.passed ? 0 : 1;
  }
}
