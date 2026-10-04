# 阶段 0：宿主能力与交付门

核对时间：2026-10-04。设计：DSH bot v0.2.1；Library version 1，69,666 bytes；全文 392 段 / 26,635 字符；SHA-256 `675c37eadc4e4c815870fb8c12f37c287ffa4213a6dd251103fc15ae7d58bfe6`。

当前工作区是新建独立目录，没有已有 Git checkout。仅读取已安装公开包的 package.json 与 lib/types；没有加载宿主、读取原生 Session、运行模型或修改 core。固定包版本为 `@deepseek-ai/*@0.2.0-rc.2`。静态目录由 `core-current` 的 symlink 解析到 `dsh-release-20260930-dsh020rc2-fixed/core`。这不能证明生产当前已加载版本或运行行为。

GitHub：connector 与本机 `gh api user` 都确认为 `86cloudyun-afk`；直接 GET `repos/86cloudyun-afk/dsh-bot` 为 404；本人仓库清单有 4 个仓库且无同名。按用户授权创建私有 `dsh-bot`，不添加协作者，初始 main 只放最小 README，功能分支走 draft PR，最终合并由原主控负责。

| 能力 | 静态证据（相对 `node_modules/@deepseek-ai/`） | 结论 / 第一版行为 |
| --- | --- | --- |
| 原生冷读 | `dsh-api-session-controller/lib/types/index.d.ts:73,80,183–207`，list / inspect / page / follow / projections | 可写 read-only adapter；现场未验；只返回授权对象，完整性与分页明确 |
| 原生创建 | 同文件 `:93`，types.d.ts SessionCreateRequest 允许 sessionId | 静态存在；原生 create 不开放，缺 operation durable 查回 |
| 单 Session 模型 | 同文件 `:99` selectModel 会异步保存 default | 不满足隔离；禁止调用 selectModel。`selectSessionModel` 在核对的公开合同中未发现 |
| 最终 provider dispatch 冻结 | 核对 session / agent / subagent / workspace / tools / fs-sandbox / llm 的全部 `.d.ts` | `dispatchPermit` 未发现；unsupported；不做 LLM dispatch |
| 操作持久查回 | prompt 只有 requestId + accepted；没有完整 operation 查询 | `admitOperation` / `inspectOperation` 未发现；本插件的 SQLite operation 不能替代宿主证明 |
| run 世代停止 | cancel 仅 sessionId，取消当前 turn，保留 inbox | `runGeneration` 契约未发现；stopTask 精确整树停止 unsupported，不退化为 cancel |
| 真正资源结算 | Agent.whenIdle、workspace/session-stop 等局部机制 | 没有完整 owned tree / provider / tools / inbox / quota settlement 证据；unknown 不释放 |
| producer | Agent.send / followup 接收带 source 的 UserMessage；remote.prompt 不接 bot source | 可以定义 producer 契约；原生 Bot dispatch 仍 blocked；不伪造 user |
| scope enforce | `dsh-fs-sandbox/lib/types/index.d.ts` 公开说明 reads pass through untouched；工具 scoped guard 为局部入口 | 不能证明私聊 / 群文件与检索隔离；不装模型工具、raw shell、检索或外部产物发布 |
| 归档 / 恢复 | `dsh-workspace/lib/types/index.d.ts:213,224` | archive 先隐藏再请求 stop，不 await settlement；unarchive 不验证日志存在。薄 adapter 保留这些事实；原生写 blocked |
| 持久插件挂载 | Cordis Context.provide / effect，Typert 服务类型存在 | 可交付独立 Cordis plugin 接缝；原生 caller 未验时服务仅暴露能力状态、拒绝所有命令；本地 UI 单独绑定可信入口；Mac 宿主未加载 / 未测；独立云验证另任务负责 |

公开 upstream：[DeepSeek session controller](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/api/session-controller/src/index.ts)、[npm package](https://www.npmjs.com/package/@deepseek-ai/dsh)。上游 master 会变化，最终结论只针对本次固定本地包；不从符号缺失推断所有未来版本都不支持，也不将相似名称当等价语义。

## 实际交付范围

交付 `0.1.0-alpha.1` 控制层候选：持久 Bot / 群 / 消息 / 会议 / Task / Attempt / Operation / Outbox 账本、唯一 nonce 与不可变绑定、准入阻断、世代和授权屏障、unknown 查回、资源全有全无预留、单调观察、封存意见、人类验收、离线四入口 UI、只读原生 adapter、最小公开接口补强合同、CI 与确定性测试。原生 DSH 保有 Session、Agent、模型和工具执行主权，项目不提供第二套执行框架。

六个需求仍是发布门：统一真实原生会话 / 可恢复原生归档 / 多长期真实 Bot / 逐 Bot 实际模型 / 真实会议协作 / 背景未完时真实自然语言联络。当前关键能力缺失，六项现场验收均未通过。离线账本与测试不等同完整 v0.1，不能发布 ready 标签。所有 native writes 均 fail-closed；只展示 registered / blocked / unsupported / unknown。

## 分阶段证据与门

0. 已有规格与静态证伪，结果为「需最小公开补强」。根主控收到计划、能力缺口和仓库核对后推进独立实现。无 core 补丁、安装、生产重启、付费调用或额外权限。
1. 单 Bot 离线控制闭环和故障注入，独立复审；真实长任务与自然语言 reply 保持 blocked。契约证明用 test-only host，明确 synthetic。
2. 3 Bot / 2 群的 canonical 去重、membership 世代、会议封存、scope 与责任账本，独立复审；真正模型输入和工具隔离保持 inconclusive。
3. 完整离线回归、CI、review、私有仓库 draft PR。六需求原生发布门仍阻断；没有批准的真实 route / baseline，F23 不报告 p95。
