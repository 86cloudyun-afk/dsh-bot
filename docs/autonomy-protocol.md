# 持久自主推进协议（新增范围，控制层候选）

新增用户需求 2026-10-04 11:21：像用户描述的 Muse / GPT dot 一样持续推进、高自动化和强自主性。这里定义自己的协议，不推断竞品内部机制。

目标 / 验收条件 → bounded plan → 独立 Attempt 准入 → 收集可验证结果 → checkpoint → 检查标准 → 恢复性修正 / 有界 retry → 下一步 → 人类最终验收。模型只提议，Host 根据已授权目标、scope、预算和世代执行，不逐步重复请示，也不能扩大权限。

持久 `ProgressPlan`：planId、taskId、taskRevision、goalDigest、acceptanceVersion、policySnapshot、steps、nextStepId、checkpoint、eventCursor、retryCount、state、observedAt。步骤保留 stepId、依赖、预期证据、Attempt 引用、完成证据；pending 不是 completed。BotConfigVersion 另存 autonomy policy，与 route / reasoning / session mode 独立。

事件限定为真实用户输入、Task/Attempt 结果、到期且已授权的有限检查、恢复事件。相同 eventId 幂等，游标单调；没有新事件不唤醒模型。alpha 只有可信人类录入这些控制记录，native event bridge、scheduled check 和 LLM planner 未实现。没有 cron、无限循环或自动模型调用。

状态：planned / ready / waiting_native / waiting_result / reconciling_unknown / blocked / submitted / verified / stopped。`advanceTask` 持久 nextStep 与 checkpoint，核同一任务 / Bot / 授权世代与阻断条件（alpha 无 native dispatch）；原生能力缺失为 waiting_native + typed blockers，零模型请求。等待不占 contact Session。用户新消息未来走独立 contact turn，精确 taskId/revision/epoch 调整；alpha 不能声称真实理解与自然回复。

可配置策略：enabled、maxSteps（1–100）、maxRetries（0–10）、observationDeadline、reportMilestonesOnly。上限只是更低的本地策略，不授权真实 quota / token / cost；真实 dispatch 仍核 grant 与整场预算。默认 disabled / maxRetries=0，不增加周期调用成本。

停止条件：目标经有效验收达成、用户停止、明确缺权限/预算/材料/关键决定、冻结观察窗结束。一次失败或 pending 不完成目标。只有有权威“明确未生效且旧 sender fenced”的证据才允许同身份安全重试；unknown 进入 reconciling_unknown，不增新 nonce 重跑。归档恢复只读查回与恢复 checkpoint，不自动重做历史效果。

报告按重要成果、阻塞、需决定事项输出，普通步骤在 checkpoint 中合并。不以 ACK / 卡片当自然语言联络。alpha 可验证策略版本、计划持久化、eventId/cursor 去重、bounded steps、unknown 无重跑、停止/撤权 fence；真实持续执行门仍全部 blocked。

版本拆分：当前 alpha 加控制协议与确定性 tests；后续 native bridge 经公开补强与隔离复审再允许 model planning / execute / verify；真实 provider 使用、周期模型调用成本、新的工具/分享/权限需原主控集中取得授权。当前不新增外部平台、费用或系统权限。
