# 下一步：隔离宿主上的单 Bot 闭环（待主控审定，尚未实施）

## 已有证据与准确边界

固定上游 `dsh-v0.2.0-rc.2` 指向 `639ed015397290b3745d163aafe02ffee4aa3f84`。本次实际运行 npm `@deepseek-ai/dsh@0.2.0-rc.2`，不是该源码树的构建。Node 24.19.0；独立 DSH Home、SDK-minimal 派生 profile；全局及 Agent 作用域模型工具均为零。凭据仍由官方 provider 从用户注入环境解析，测试代码从未读取 key。

已实测公开底座：Agent create/dispose、完整冷读、resume 后追加真实回复、流式并发、Agent-local 模型选择、显式 default 保存及独立 Home 冷读、cancel 后 turn/end aborted、archive/unarchive、实际候选 Cordis 插件加载/卸载。插件本身仍拒绝 execute（unsupported_host_identity），因此完整 Bot 闭环尚未开始。cancel/idle 不证明 provider 配额或整树资源结算。

## 能用公开扩展做的部分

| 增量 | 最小实现与不变量 | 验证与限制 |
| --- | --- | --- |
| P1 原生会话及观测桥 | `ctx.agents.create/resume` 返回的 handle 只由创建者持有；`sessionPersistence.open(id,'read')` 核完整日志；订阅 `session/event`、`agent/assistant-stream`，持久保存 cursor/checkpoint | 冷读不唤醒 Agent；卸载只处置自己的 handle；断线补齐完整记录，缺口为 stale/unknown。不能把 `whenIdle()` 当特定消息的 settlement |
| P2 每 Bot 的模型快照 | creation/resume `setup` 中安装 `installModelSelection`，使用不可变 ConfigSnapshot；恢复时从插件账本恢复 selection；不用会保存 Host default 的 SessionController.selectModel | A 真实请求 low、B standing selection off、default off 已测；显式保存 default 是另一操作。LlmRuntime.prepareCall 已绑定 adapter generation、冻结 effective config 并拒绝变更，但还没有 task/grant epoch 的最终边界 |
| P3 来源和零工具输入隔离 | 采用 merge-extensible MessageSourceMap 的具名 source；producer 只能从真实 entry/caller 推导；一 Bot contact、execution、每会议各独立 session；仅传冻结且授权的本域文本；`tools.restrict/guard` 可更窄拒绝 | 类型和来源元数据可以公开扩展，不能把 payload.botId 当身份。实际 Bot/Host 自定义 source 的冷恢复尚未测；当前 profile 零工具、无文件/检索/HTTP能力，不据此声称通用文件 sandbox |
| P4 持久目标与联络队列 | 复用已实现 ProgressPlan、nextStep/checkpoint，结果事件推进；contact 与 execution 有独立 handle/队列；插件范围内预留一个 contact 槽和一个 execution 槽，unknown 预留不释放 | 可在专用隔离 profile 内约束自己发起的流量；不能控制宿主其他插件的 provider 调用。等待结果/授权检查/联络不循环问模型、不依赖定时唤醒、不 await 长任务占住 contact |
| P5 已认证人类入口 | 只接现有宿主认证入口，取得运行时授予的 caller/principal，映射受限 grant；公开 service 不接受调用者自行填写 human/host 身份 | 先验证 Typert/connection 公共上下文是否提供可信 principal；若没有，增加宿主最小 caller capability，不能使用 body.actor 或自行生成新认证凭据。本轮未启动 legacy startPreview（会生成 token） |

以上可作为插件增量，均只修改开发 worktree 与专用 profile；不触碰生产配置或系统网络权限。P5 的真实 caller 通路必须先证明，才开放命令。P1–P4 不能替代下列门，公开 `send(...,wakeup=false)` 加 `sessions.flush()` 也没有完整的 operation 原子准入与后续 wake 契约。

## 必须补到宿主最终边界的契约

| 增量及落点 | 最小接口 | 必须成立的不变量与针对性测试 |
| --- | --- | --- |
| K1 最终 dispatch 门：dsh-llm + 实际 provider 调用入口 | `registerDispatchGuard(check)`；`permit={operationId,runGeneration,botEpoch,taskEpoch,taskRevision,authorityEpoch,membershipGeneration,configVersion,scopeRef,inputDigest}` | 所有 guard 单调 AND；解析 effective route/default 与凭据等 await 后，在真实 provider 启动前同步复核同一冻结 permit；后续 step/retry 同门。race 注入在 prepare、credential resolve、stream dispatch、provider start；停止/撤权发生在任一点，旧 permit 零 provider start。保留既有 prepared-call immutable 校验，不能把普通 waterfall 当强制最终 guard |
| K2 durable admission/lookup：dsh-agent-loop + session persistence | `admitOperation({operationId,payloadDigest,permit,message}) -> durable receipt`；`inspectOperation(id) -> not_admitted_fenced/admitted/consumed/settled/outcome_unknown` | journal 与 inbox admission 在执行/wake 前提交；同 id 同 binding 一次接纳，异 binding 拒绝；读查基于完整 journal。kill 点覆盖 commit 前、commit 后 wake 前、provider 后 receipt 前；重启查回只补账。not_admitted_fenced 需要排除旧 worker 后才可重试，unknown 不重放 |
| K3 精确 run stop/settlement：agent-loop、provider、jobs/子代理/工具的资源拥有者 | `stopRun({operationId,runGeneration,fence,ownedTree:true})`；`inspectOwnedResources(generation)` | generation 绑定完整拥有树及 pending inbox；stop 建立屏障，晚到旧 stop 不伤新 run；provider、工具、进程、锁、quota 各给 terminal 或 unknown。当前 zero-tool 首片只覆盖 provider/inbox，工具和子代理不启用。abort ACK、idle、timeout、lease expiry 均不能返回 confirmed_stopped；断线和 provider 槽位未知必须保留占用 |
| K4 宿主共享容量：统一 provider dispatch/admission 层 | `reserveCapacity({operationId,class:'contact'|'execution',provider,maxTokens})`，与 K1/K2 原子绑定；`settleCapacity(reservation,evidence)` | 所有调用路径共用额度；unknown 不退额；contact 预留不被 execution 用尽。先合成 provider 检查同时请求、429、取消无 usage、重启、阻塞 contact，再用少量真实文本确认联络。插件自有 semaphore 只可证明专用 profile 的子集 |
| K5 通用资源 scope：具体文件/检索/工具 provider 的执行边界（先不启用） | `scopeRef` 为宿主能力引用，真实 caller 绑定；受限查询、实际文件句柄/realpath 校验、工具执行 guard | 现有 scoped restriction/monotonic tools.guard 可做注册与拒绝；必须逐 provider 验证实际读写/检索不绕过。若现有 sandbox/provider 接口无法表达 Task scope，再补具体 provider，而非放宽系统 sandbox。测试 P/G1/G2 marker、symlink/TOCTOU、冷恢复、二次调用与子代理传播。没有证据的工具保持禁用 |

K1/K2/K3/K4 的权威语义应作为官方 core/provider 的增量实现；插件内同名接口或 wrapper 不证明这些边界。K5 不要求先改所有 core：先验证现有公开 sandbox/provider 的窄授权能力，缺失项只补其实际执行点。K1–K4 可在新源码副本和新 Home 实施，不改当前已测 npm runtime；不会扩大网络或文件权限。

## 建议最小 patch 顺序及停止条件

1. 在 `/workspace` 新建固定上游 tag 的独立 checkout 与 Home，基线锁定上述 commit，保留本次 npm runtime。先加入 K1/K2 的合成 provider contract tests；实现单 Bot、零工具、零自动重试路径。与现有 prompt queue/selectModel 行为兼容，缺能力 host 返回 typed unsupported；不要给生产安装打补丁。
2. 实现 P5 的实际 entry proof、P1/P2/P3，然后让插件引用 K1/K2 capability。以已持久 goal、3 个有证据的文本步骤和显式人工验收为唯一测试任务；用户消息只在 contact session，结果事件推进 execution。只测一次接纳回执丢失/冷恢复，unknown 不续办。
3. 加 K3 provider/inbox generation barrier 与 K4 contact 容量。单 Bot 执行有界输出时提出新话题和进度问答；实际 first-text 事件作为并发起点；精确停止、归档、完整日志只读核验、恢复查看。旧执行未结算时禁止恢复 execution；恢复联系也要通过容量/来源门。每次效果记录 permit、journal revision、usage/unknown，不记录 secret/header。
4. 合成故障检查先全通过，再用当前已授权的 DeepSeek Flash 做每项 1 次有目的真实文本请求；每次 maxRetries=0、请求/进程截止，至少保留一个 contact 槽。原生认证/key/403/网络拒绝时立即按层停止。实际请求数量和结果逐项报告，不反复试到 PASS。
5. 独立 GPT-6.1 Sol/xhigh 只读审查及完整 guard；只有全部单 Bot 门通过才把有限范围标记 measured。工具、图片、共享生产负载、多群/会议与 p95 继续单列，不能降低六项硬需求或宣称发布就绪。K5 和子代理树支持在后续批准片段中推进。

需要主控审定的是这组隔离 core + 插件增量的实施范围；当前交付只含控制层修复、原生底座测量和该计划。没有进行 core 修改、生产安装替换、网络权限调整、push 或 PR。
