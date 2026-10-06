# 阶段 0：宿主能力与交付门

2026-10-05 类型增量：[公开类型与兼容范围](types-and-compatibility.md) 区分固定官方 rc.2 只读插件/Host 与整个 reviewed development SDK 私有原生入口。官方 tag 缺 experimental native-run，native-controller/owner-app import 在构造前 ERR_MODULE_NOT_FOUND；protected-provider 的 registry/factory 也仅存在于 development SDK。默认读取来源仍为 not_configured；Node 22 本轮未测。下述 dated 表格保留其历史阶段范围。

后续范围更新：[受限原生 owner profile](owner-entry.md) 已取得实际官方 launcher 的零模型创建、prepare/admit/inspect/stop/close/resume 证据。以下历史表格针对一般公开入口；本机私有 runtime-owner 能力不代表 SDK/浏览器人类授权、一般产品门通过或发布就绪。

核对时间：2026-10-04。设计：DSH bot v0.2.1；Library version 1，69,666 bytes；全文 392 段 / 26,635 字符；SHA-256 `675c37eadc4e4c815870fb8c12f37c287ffa4213a6dd251103fc15ae7d58bfe6`。

当前工作区已从冻结私有 backup ref 接手。历史阶段仅读取 Mac 固定包类型；本轮云端实际安装并加载了独立 npm rc.2，测量公开 Agent/Session 底座及候选插件接缝。没有 core 或生产安装修改。候选 native dispatch 仍不开放；发布门与底座测量分别记账。

GitHub 私有 backup ref `backup/mac-handoff-20261004` 已只读核验；它仍为 `13d1fb15c0dbb59434ae066fb2b5a56e90d8b683`。云端 local worktree 是唯一 writer；本轮不 push、开 PR 或 merge。旧阶段关于 main/draft PR 的步骤已被当前集中发布门取代。

| 能力 | 静态证据（相对 `node_modules/@deepseek-ai/`） | 结论 / 第一版行为 |
| --- | --- | --- |
| 原生冷读 | `dsh-api-session-controller/lib/types/index.d.ts:73,80,183–207`，list / inspect / page / follow / projections | 可写 read-only adapter；完整 cold read/resume 底座已测；candidate adapter 仍 incomplete；全历史分页/目录未测 |
| 原生创建 | 同文件 `:93`，types.d.ts SessionCreateRequest 允许 sessionId | 公开 Agent create 底座已测；candidate create 不开放，缺 operation durable 查回 |
| AgentPreset 元数据与模式 | 固定源码 registry index.ts:150/318/340；SessionController agent.ts:381/485；projection session.ts:35 | 只读动态健康 roster、独立 opaque ID 配置、显式创建及 blank 选择的 blocked 预检已离线测试。当前新 diff 未在用户 runtime 加载；公开接口无持久组合 revision，跨重启指纹和 native 模式写入仍 blocked |
| 单 Session 模型 | 同文件 `:99` selectModel 会异步保存 default | 此 selectModel 不满足隔离，candidate 不调用。公开 installModelSelection 已测 Agent-local selection 与 default 分离；durable Bot 绑定及最终 permit 尚未实现 |
| 最终 provider dispatch 冻结 | 核对 session / agent / subagent / workspace / tools / fs-sandbox / llm 的全部 `.d.ts` | `dispatchPermit` 未发现；unsupported；不做 LLM dispatch |
| 操作持久查回 | prompt 只有 requestId + accepted；没有完整 operation 查询 | `admitOperation` / `inspectOperation` 未发现；本插件的 SQLite operation 不能替代宿主证明 |
| run 世代停止 | 公开 Agent.cancel 针对当前 activity，默认清 pending；keepInbox 可选；无 runGeneration stop 契约 | `runGeneration` 契约未发现；stopTask 精确整树停止 unsupported，不退化为 cancel |
| 真正资源结算 | Agent.whenIdle、workspace/session-stop 等局部机制 | 没有完整 owned tree / provider / tools / inbox / quota settlement 证据；unknown 不释放 |
| producer | Agent.send / followup 接收带 source 的 UserMessage；remote.prompt 不接 bot source | 可以定义 producer 契约；原生 Bot dispatch 仍 blocked；不伪造 user |
| scope enforce | `dsh-fs-sandbox/lib/types/index.d.ts` 公开说明 reads pass through untouched；工具 scoped guard 为局部入口 | 不能证明私聊 / 群文件与检索隔离；不装模型工具、raw shell、检索或外部产物发布 |
| 归档 / 恢复 | `dsh-workspace/lib/types/index.d.ts:213,224` | archive 先隐藏再请求 stop，不 await settlement；unarchive 不验证日志存在。薄 adapter 保留这些事实；原生写 blocked |
| 持久插件挂载 | Cordis Context.provide / effect，Typert 服务类型存在 | 可交付独立 Cordis plugin 接缝；原生 caller 未验时服务仅暴露能力状态、拒绝所有命令；本地 UI 单独绑定可信入口；云端真实 Cordis fiber 加载/卸载已测；native trusted caller 仍未证明 |

公开 upstream：[DeepSeek session controller](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/api/session-controller/src/index.ts)、[npm package](https://www.npmjs.com/package/@deepseek-ai/dsh)。上游 master 会变化，最终结论只针对本次固定本地包；不从符号缺失推断所有未来版本都不支持，也不将相似名称当等价语义。

## 实际交付范围

交付 `0.1.0-alpha.1` 控制层候选：持久 Bot / 群 / 消息 / 会议 / Task / Attempt / Operation / Outbox 账本、唯一 nonce 与不可变绑定、准入阻断、世代和授权屏障、unknown 查回、资源全有全无预留、单调观察、封存意见、人类验收、离线四入口 UI、只读原生 adapter、最小公开接口补强合同、CI 与确定性测试。原生 DSH 保有 Session、Agent、模型和工具执行主权，项目不提供第二套执行框架。

六个需求仍是发布门：统一真实原生会话 / 可恢复原生归档 / 多长期真实 Bot / 逐 Bot 实际模型 / 真实会议协作 / 背景未完时真实自然语言联络。当前关键能力缺失，六项现场验收均未通过。离线账本与测试不等同完整 v0.1，不能发布 ready 标签。所有 native writes 均 fail-closed；只展示 registered / blocked / unsupported / unknown。

## 分阶段证据与门

0. 历史规格/静态核对确认需最小补强；云端已追加固定 npm 安装与9次有目的真实文本请求，known usage 1042 tokens，1次取消 usage未知。用户已授权费用；无 core/生产修改或额外权限。
1. 单 Bot 离线控制闭环和故障注入，独立复审；真实长任务与自然语言 reply 保持 blocked。契约证明用 test-only host，明确 synthetic。
2. 3 Bot / 2 群的 canonical 去重、membership 世代、会议封存、scope 与责任账本，独立复审；真正模型输入和工具隔离保持 inconclusive。
3. 本轮完整 guard 67/67、独立 GPT-6.1 Sol/xhigh 复审无剩余P1/P2、静态25模块。真实 deepseek-official/deepseek-flash route已授权并测；p95/负载baseline未测。六需求原生发布门仍阻断，不 push/PR。

详见 [逐项证据矩阵](acceptance-matrix.md)、[native summary](evidence/cloud-20261004/native-summary.json) 及 [可执行下一片方案](superpowers/plans/2026-10-04-native-loop-next.md)。
