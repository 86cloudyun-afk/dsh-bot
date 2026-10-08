import {randomUUID} from "node:crypto";
import {copy, plain, requireCondition} from "./store.mjs";

// Public command documentation. Authorization stays in the business methods.
const contracts = {
  help: [[], ["action"], "读取本工具的动作、输入字段及真实调用者身份。", "read"],
  snapshot: [[], [], "查询当前有权读取的 Bot、记忆、任务、尝试、群、会议与投递状态。", "read"],
  catalog: [[], [], "查询官方 DSH 已配置的模型与 preset。", "read"],
  "session.list": [[], ["cursor", "limit"], "分页查询可读会话；使用返回的 nextCursor。", "read"],
  "session.page": [["sessionId"], ["cursor", "limit"], "分页读取实际原生日志；使用返回的 nextCursor。", "read"],
  "memory.search": [[], ["botId", "query"], "按文本查询可读的长期记忆。", "read"],
  "session.create": [["botId"], ["purpose"], "为已有 Bot 建立联络会话；purpose 只能为 contact。"],
  "session.send": [["sessionId", "text"], ["mode"], "发送到获准控制的联络或普通会话；mode 为 queue（默认）或 steer。"],
  "session.stop": [["sessionId", "expectedTurn"], [], "停止当前回复；expectedTurn 使用 session.list 的 activity.token。任务尝试必须用 task.stop。"],
  "session.archive": [["sessionId"], [], "归档已结算的原生会话。"],
  "session.restore": [["sessionId"], [], "恢复原生会话的原身份及日志。"],
  "memory.write": [["botId", "text"], ["memoryId", "expectedVersion", "category", "source", "automatic"], "只管理自己的长期记忆；更新已有 memoryId 时传其 version。source 可为 {sessionId,eventSeq}。"],
  "memory.forget": [["memoryId", "expectedVersion"], [], "遗忘自己的记忆；expectedVersion 使用记忆 version。"],
  "task.create": [["botId", "title", "goal", "criteria"], ["originSessionId"], "登记任务，返回真实 taskId 和 version；criteria 是字符串数组。省略 originSessionId 时 Bot 使用当前调用会话（联络或执行会话）。"],
  "task.start": [["taskId", "expectedVersion"], ["parentAttemptId"], "立即派发到独立原生工作会话，返回 attemptId；expectedVersion 使用最新任务 version。不会等待任务完成。执行会话创建的子任务最多一级。"],
  "task.adjust": [["taskId", "expectedVersion"], ["title", "goal", "criteria", "botId"], "调整任务；会停止旧尝试。结算后再用最新 version 接续。"],
  "task.stop": [["taskId", "attemptId", "epoch"], [], "停止确切尝试及其一级子工作；这些值使用 snapshot 的当前 attempt。接受停止后仍等待真实资源结算。"],
  "task.submit": [["taskId", "attemptId", "epoch", "report"], [], "实际执行会话提交当前尝试的报告。"],
  "task.accept": [["taskId", "attemptId", "expectedVersion", "outcome", "evidence"], [], "对已结算的当前尝试记录验收，outcome 为 passed、failed 或 unknown。返回结果不自动等于通过。"],
  "task.archive": [["taskId", "expectedVersion"], [], "归档已结算任务。"],
  "task.restore": [["taskId", "expectedVersion"], [], "恢复同一任务；不自动重跑。"],
  "group.post": [["groupId", "text"], [], "在有权参与的既有内部群发送消息。"],
  "meeting.opinion": [["meetingId", "epoch", "memberEpoch", "text", "source"], [], "当前原生会议参与者提交意见；source 为 {sessionId,eventSeq}，必须对应实际模型答复。"],
  "meeting.action": [["meetingId", "epoch", "botId", "title", "goal", "criteria"], [], "从已有真实决定登记并链接行动任务；之后用 task.start 执行。"],
  "outbox.reconcile": [["outboxId"], [], "查回原始结果投递；UNKNOWN 不重放。明确从未入队且被阻止的投递只在当前授权有效后重试。"],
  "bot.create": [["name", "contact"], ["role", "cwd", "execution", "executionMode", "presetId", "lifecycle"], "人类创建具名 Bot；contact/execution 使用 {provider,model,...}。executionMode 为 inherit 或 explicit。", "human"],
  "bot.update": [["botId", "expectedVersion"], ["name", "role", "cwd", "contact", "execution", "executionMode", "presetId", "lifecycle"], "人类修改 Bot；expectedVersion 使用 Bot revision。executionMode 明确保存自动跟随或指定执行模型。", "human"],
  "share.set": [["botId", "share"], [], "人类设置共享上限。", "human"],
  "grant.set": [["grantId", "recipientBotId", "ownerBotId", "scope", "level", "active"], [], "人类设置或撤销持续授权；level 为 read 或 control，active 为布尔值。", "human"],
  "group.create": [["name", "botIds", "coordinatorBotId"], ["rounds", "maxRequests"], "人类创建内部群；协调者必须在成员中。", "human"],
  "group.members": [["groupId", "expectedVersion", "botIds", "coordinatorBotId"], [], "人类修改群成员和协调者。", "human"],
  "meeting.start": [["groupId", "topic", "materials"], ["maxRequests"], "人类为群开启新会议并启动独立意见。", "human"],
  "meeting.advance": [["meetingId", "epoch", "phase"], ["absences"], "人类推进当前 independent、discussion 或 decision 阶段。", "human"],
  "meeting.topic": [["meetingId", "epoch", "topic", "materials"], [], "人类修改议题，以新世代重开独立意见。", "human"],
  "meeting.cancel": [["meetingId", "epoch"], [], "人类取消会议；已登记行动任务保持独立。", "human"],
  "recovery.reconcile": [[], [], "人类查回旧运行时状态，保留 UNKNOWN，不重放或伪造结算。", "human"],
};
export const commandNames = Object.keys(contracts);
export const botToolDescription = "管理 Bot 自己的任务、会话、长期记忆、既有内部群和会议；跨 Bot 默认只读。先用 action=help 查询具体字段，或 snapshot 查询真实 ID/version。后台工作必须先 task.create（input={botId,title,goal,criteria:字符串数组}），再 task.start（input={taskId,expectedVersion:创建回执的version}）；两个写动作分别传新的唯一 operationId。task.start 立即返回，不等待任务结束，随后继续联络聊天。不要在联络会话执行用户要求放到后台的工作。写动作必须保留完整原始请求，UNKNOWN 不自动重放，交工作台查回；人类配置和会议阶段动作不能代替人类执行。";

export function commandHelp(actor, input = {}) {
  requireCondition(plain(input) && Object.keys(input).every(key => key === "action"), "invalid_input");
  requireCondition(input.action === undefined || typeof input.action === "string" && Object.hasOwn(contracts, input.action), "unknown_action");
  const identity = {kind: actor.kind, botId: actor.botId ?? null, sessionId: actor.sessionId ?? null},
    commands = {};
  for (const name of input.action ? [input.action] : commandNames) {
    const [required, optional, description, level] = contracts[name];
    commands[name] = {required, optional, description, readOnly: level === "read", humanOnly: level === "human"};
  }
  if (commands["task.create"]) commands["task.create"].example = {
    action: "task.create", operationId: randomUUID(),
    input: {botId: actor.botId ?? "<实际负责人 botId>", title: "后台任务", goal: "按用户要求完成无害工作", criteria: ["提供实际结果"]},
  };
  if (commands["task.start"]) commands["task.start"].example = {
    action: "task.start", operationId: randomUUID(), input: {taskId: "<创建回执的 taskId>", expectedVersion: 1},
  };
  return copy({identity, protocol: {
    read: "help/snapshot/catalog/session.list/session.page/memory.search 无需 operationId。input 只能使用所选动作列出的字段。",
    write: "每个新动作使用新的唯一 operationId；示例 ID 可用于一个新动作。保存完整请求，原 ID 不可改内容、用途或调用者。expectedVersion 使用刚查询或创建回执中的最新 version，Bot 配置用 revision。",
    background: "task.create 返回后立即 task.start；不等待后台工作结束，继续联络对话。执行使用独立会话。",
    recovery: "UNKNOWN 保留原始请求，通过工作台查回；不换 ID 重发，不伪造完成。授权持续有效且可撤销。",
  }, commands});
}
