# 图形入口验收接口

用户启动步骤见 [单 Bot 图形入口](bot-gui-entry.md)。默认命令不带 `--enable-model-requests`；需要提交目标时，使用文档中的显式启用命令。该选项只影响本次进程，原生能力和完整历史校验仍必须通过。

下面的选择器来自实际发布的客户端，供独立浏览器验收使用。控制请求经真实 BrowserAuth 连接上的 `/dsh-bot-gui` 和 `/dsh-bot-owner` 发出，普通未授权连接不能调用。创建、停止、接续与归档的 `operationId`、`nonce` 在请求前保存；响应丢失后只能查询这对原值。

| 用户操作或状态 | 稳定选择器 |
| --- | --- |
| Bot 面板、连接状态 | `[data-dsh-bot-panel]`、`[data-dsh-bot-connection]` |
| Bot 名称、创建 | `[data-dsh-bot-create-name]`、`[data-dsh-bot-create]` |
| 创建回执、原回执查询 | `[data-dsh-bot-create-receipt]`、`[data-dsh-bot-create-reconcile]` |
| 选择 Bot | `[data-dsh-bot-select]` |
| 主目标、提交 | `[data-dsh-bot-goal]`、`[data-dsh-bot-submit]` |
| 主回执、回复、原状态 | `[data-dsh-bot-receipt]`、`[data-dsh-bot-main-reply]`、`[data-dsh-bot-contact-generation]` |
| 主停止、原回执查询 | `[data-dsh-bot-contact-stop]`、`[data-dsh-bot-reconcile]` |
| 工作详情、结果、原生状态 | `[data-dsh-bot-work-detail="TASK_ID"]`、其内的 `[data-dsh-bot-work-result]`、`[data-dsh-bot-work-generation]` |
| 工作接续、停止 | `[data-dsh-bot-work-continue="TASK_ID"]`、`[data-dsh-bot-work-stop="TASK_ID"]` |
| Bot 生命周期、归档、恢复 | `[data-dsh-bot-lifecycle]`、`[data-dsh-bot-archive]`、`[data-dsh-bot-restore]` |
| 生命周期回执、原回执查询 | `[data-dsh-bot-lifecycle-receipt]`、`[data-dsh-bot-lifecycle-reconcile]` |

`TASK_ID` 是返回的原始任务 ID。工作详情的 `<details>` 需要先展开。工作原生状态属性为 `pending`、`UNKNOWN` 或 `settled`；停止回执为 `accepted` 时，状态仍可能为 `UNKNOWN`，槽位继续保留。

`/dsh-bot-gui` 的控制 payload 和成功返回如下；失败统一为 `{ok:false,error:{code:'dsh-bot-gui/action-unconfirmed',...}}`，客户端将结果保留 UNKNOWN，不换原操作。

| endpoint | payload | `{ok:true,value}` 的字段 |
| --- | --- | --- |
| `bootstrap` | `{}` | `version:1,status:'ready',ledgerId,selectedBotId,contactSessionId,modelRequestsEnabled,modelDispatchStatus,creation,nativeGenerationTerminalSupported,controls` |
| `createBot` | `{operationId,nonce,name}` | `version:1,operationId,nonce,state:'created'|'unknown',botId,sessionId,preciseNativeSettlementVerified:false` |
| `reconcileCreate` | `{operationId,nonce}` | 原创建回执，保持同一 Bot 和 Session ID |
| `continueWork` / `inspectWorkContinuation` | `{operationId,nonce,botId,taskId,sessionId,generation}` | `version:1,operationId,nonce,botId,taskId,sessionId,originalGeneration,generation,state:'accepted'|'unknown',generationObservation,preciseNativeSettlementVerified` |
| `archiveBot` / `restoreBot` | `{operationId,nonce,botId,botEpoch}` | `version:1,operationId,nonce,botId,botEpoch,lifecycle,state:'accepted'|'unknown',preciseNativeSettlementVerified:false` |
| `inspectBotLifecycle` | `{operationId,nonce,botId}` | 原生命周期操作的当前回执 |

`controls` 是 `{version:1,botId,botEpoch,lifecycle,canArchive,canRestore,work:[{taskId,sessionId,generation,canContinue}]}`。缺少能力时这些布尔值为 false。它们只控制按钮可用性，不能作为原生收据或授权凭据。

`/dsh-bot-owner` 使用 `{command:endpoint,botId,payload}`，支持 `selectedView`、`sendContactText`、`inspectContactReceipt`、`requestContactStop`、`requestWorkStop`。`selectedView` 的 `contact` 和每个 `work` 返回原 `generationObservation` 与各自的 `preciseNativeSettlementVerified`；顶层该字段始终 false。只有当前实际原生收据能使某个原代次的证明为 true，持久 JSON、Agent 空闲或普通回复不能使它为 true。

未封存或 UNKNOWN 历史的冷启动使用官方 SessionQuery 只读原会话，不激活 Agent。此时 `selectedView.readOnly:true`、`contact.status:'unknown'`，全部原生证明字段为 false。它仅提供 `selectedView` 与 `inspectContactReceipt`，发送和停止入口拒绝；界面保持详情可读，并可查询已保存的原回执。Bot 恢复仍由单独的私有生命周期能力决定。

正式验收需分别记录真实浏览器认证、实际原生组件执行、外部模型输出来源。M1 的严格空初始化诊断与本地合成 SSE 不代表正式 profile 或真实 provider 通过。正式 profile 保留官方三项初始权限事件；同 ID 接续、完整已知历史恢复、原生归档和整棵工作树停止需在最终 M2 运行时另行验证。
