# 每 Bot 原生 AgentPreset：创建时绑定

2026-10-04 已确认用户所指为原生 AgentPreset 工具/提示词组合。旧文档把需求留为 plan/permissions 待决项的解释已经纠正；计划协作状态、权限、模型/reasoning 均独立保留，不能代替用户模式需求。

最新范围收敛：用户明确“创建时绑定模式就行”。第一版在创建 DSH Session 时绑定原生/自定义 opaque agentPreset ID 并确认投影；已开始会话不热切。基础创建不要求跨重启不可变配置指纹。已按 [创建绑定最小计划](superpowers/plans/2026-10-04-create-bound-session.md) 移除强制 mode_revision_unavailable 门并实现受限创建桥。公开插件 execute 仍拒绝未验证调用者，不启用 dispatch。

| 含义 | 精确公开合同 | 配置与生效 |
| --- | --- | --- |
| 计划协作状态 | `dsh-plan-mode/lib/types/index.d.ts` PlanModeController.get(agent) / set(agent, boolean) → committed / queued / cancelled / noop；types.d.ts PlanProjection {active,pending} | `plan/mode` 日志，冷恢复与 fork 折叠。空闲立即记录，open turn 到下一 accepted pre-step 生效；PlanModeConfig.section 是部署指导文本，不是 per Bot 可写全局默认 |
| 权限模式 | `dsh-permission-presets/lib/types/index.d.ts` catalog() / current(session) / resolve(name) / set(session,name)；types.d.ts PermissionCatalog {options,defaultOptions,defaultPreset} | live catalog 给实际 key；配置 presets/defaultPreset 属宿主，插件不改。权限组合 sandbox/mode + approval/policy；custom 是派生值不能选，auto 仅 live integration 存在时支持 |
| 投递方式 | SessionPromptRequest.mode queue / steer | 不等于持续会话工作模式 |
| 原生 Agent preset | SessionCreateRequest.agentPreset | composition 身份，不是 plan 或权限状态，不假定等价 |
| reasoning | ModelSelection / route | 与上述独立 |

官方来源：[权限模式定义](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/permission-presets.md)、公开 plan-mode 类型（本地固定包）。文档 master 会变化，本轮实施依据固定类型 manifest。

## 当前最小设计

实施依据官方 `dsh-v0.2.0-rc.2` commit `639ed015397290b3745d163aafe02ffee4aa3f84`。standard/ptc/minimal/cordis 分别标准/PTC/极简/创造，仅为内置映射，不是 enum 限制。用户说的“创造”可能是自定义名称，不按名称猜 ID。

`ctx.agentPresets.list()` 返回动态声明数组，`defaultId` 为默认 ID；registry 不扫描模式目录。显式刷新只复制健康行的 id/name/description/isDefault，不读取 YAML、凭据或私有 Session。缺服务、读取失败、无效结构时清空缓存；并发刷新只有最新一次发布。catalog 来自受信宿主对象，浏览器不能提交 catalog 作为权威。

新配置增加顶层 `agentPreset:string|null`，与模型和旧 sessionModes 分开。非空字符串最多 200 字符且原样保存 opaque ID，名称仅展示。null 表示未指定；未来创建新会话前解析健康 roster 默认，形成显式 `session.create({cwd,agentPreset})`。配置选择只是持久控制记录，不证明原生组合已执行。

纯请求预检保留 blocked 描述，表示它本身不是执行许可；不再要求 mode revision。client/offline DTO 仍严格读取 `projectionValues.agentPreset`，缺投影拒绝，不取 header 替代；blank 选择预检继续拒绝已开始会话，产品不执行热切。受限创建入口是 `dsh-bot/session-creation`，只由受信本地 launcher 持有，不通过 Cordis/RPC 发布。

预检输入明确为 client/offline `AgentPresetSessionView {id,blank,projectionValues}`，不是 SessionController 的 wire SessionSummary。后者使用 sessionId/projections；未来受信 seam 必须先转换其 projections.values，本次不隐式兼容原始 wire 或 header。持久 BotConfigVersion 类型允许缺 agentPreset，以准确表示旧行与旧快照；新写入类型要求规范字段。

原生 UI 可以同步当前空白会话；原生 select 串行重绑、追加 selected event，首轮开始后锁定。Bot 默认/模式配置更新仅影响之后明确新建的 Session；本次不使用 UI 当前 blank 同步捷径。未来写桥须处理原生锁定并回读投影，仍依赖可信 caller、durable admission、scope 与最终 dispatch 门。

## 兼容迁移

SQLite schema 保持 1，不做全量迁移或旧行改写。旧 config 无 agentPreset 时有效值为 null；只在明确新建/更新命令产生新 config 时写规范字段。`sessionModes:{plan:null,permissions:null}` 保留名称与独立语义，非空值继续拒绝；不将它换成 AgentPreset，不删除旧数据。

更新省略 agentPreset 继承旧选择；显式 null 取消未来会话的特定模式。模型/execution route/自主策略保持原合同。既有 Attempt/ProgressPlan configSnapshot、旧操作 digest 和回执不改写、不重新绑定。权限只能在现有 scope/grant 内收紧，模式不授予权限。

## 受限创建桥

`prepareContactSession` 在控制 ledger 事务内记录预定 Session ID、operationId、Bot epoch、configVersion、AgentPreset ID、授权 grant epoch、cwd 和 deadline；不创建原生对象。每 Bot 仅保留一次 contact 创建意图，未知结果不再分配新 ID。配置更新不会重绑现有 Session。

本地 `SessionCreationDriver` 以 launcher 提供的进程内对象身份核验 caller。调用前刷新实际健康 ID，并在提交 creating 状态后调用官方 SessionController.create。creating/unknown 恢复路径只查看原 ID，不重新 create。回执 Session ID 冲突持久保持 unknown，重复调用或重开 ledger 不采纳。停止、归档、撤权、Bot/config 身份变化和截止时间在每次 native await 前后阻止旧意图确认。

只有原生 Session/Agent 对象确切一致、实际 agentPreset 投影匹配、空白 Session、global 和 Agent-scoped tools 均为 0 时，才在一个 ledger 事务内绑定 Bot/contact conversation。只存验证字段，不存原始日志或异常。冷持久 header 无法证明有效 Agent scope，保持 unknown；这不是自动恢复/唤醒功能。基础重新挂载可接受 DSH 按 ID 当前健康定义的语义，不承诺旧内存 generation。

Cordis 服务属性每次读取产生新的 traceable proxy；adapter 比较公开 Service.tracker 的每实例身份以识别真实替换，仍通过受信代理调用 list，不解包实现。目录元数据不会变成执行 capability。

## 原生恢复限制：基础创建不依赖指纹

活跃 Agent/子 Agent 可保留旧内存 generation；持久日志只存 ID 和选择事件，重启按 ID 的当前定义恢复。缺失/坏定义拒绝，不回退 standard。list/composedPreset 无持久 revision，acquireScope 的 ScopeKey 是进程内引用；readDocument 是当前声明 YAML，不能证明活跃 generation、表达式求值、插件实现或有效配置。不得拿 YAML hash 当运行时指纹。

跨重启恢复接受 DSH 原生语义：按保存 ID 使用其当前健康定义；缺失/坏定义拒绝，不保证复现旧 generation。compositionRevision/compositionProviderScope、配置指纹及漂移检测只保留为未实现限制，不能作为此基础功能的新增必需门。不编造值、不把刷新序号当 revision。独立安全切片仍不等于原生 Session/AgentLoop 接入；provider dispatch 等已有安全守卫保持。

## 验证矩阵

| 情况 | 本次离线验证 | 未验收 |
| --- | --- | --- |
| 自定义“创造”与 opaque ID | 实际 adapter/Host/UI 数据路径保留 ID，名称只展示 | 用户实际 roster、浏览器现场 |
| broken/无效行/读取失败/并发刷新 | 健康过滤、拒绝无效结构、清旧缓存、最新刷新发布 | 宿主热更新 |
| legacy config/回执/快照 | 无就地改写，新 config 规范化，旧身份和快照不变 | 生产数据升级 |
| 模型/自主更新、显式 null | 保留选择，仅影响新 config，权限/计划非空继续拒绝 | 原生模型及权限行为 |
| 创建、投影、blank 锁定 | 持久意图、受限 driver、同 ID 查回、caller/epoch/grant/config/stop、投影及双工具数校验 | 浏览器身份、热切、自动冷恢复、完整 Bot dispatch |
| 定义漂移 | 不要求指纹；只选择当前健康 ID | 不可变跨重启 generation、漂移检测 |

原生 baseline 46/46（注册表33、创建8、投影2、展示3）独立保存于 `历史隔离位置〔mode-public-baseline.log〕`，不是本次产品或用户现场 PASS。固定源码定位：registry README:46/58/95；index.ts:150/208/268/318/340；session.ts:35；SessionController agent.ts:381/431/485。

## 本次现场证据

[原生回执](evidence/cloud-create-20261004/native-receipt.json)：npm0.2.0-rc.2/Node24.19.0，新 Home，官方 AgentPreset declarer 声明 acceptance/create-opaque（plugins:[]）。产品受限 driver 创建一次并确认实际投影，Bot/contact conversation 均绑定同一 ID；重复调用不再次 create。双工具数0，provider/prompt/网络/监听尝试0，shutdown 完成。底层同 ID 采纳与未知 ID 拒绝另列，不计完整 Bot PASS。

首次目录失败在任何创建前发生并单独保留；实际运行确认 Cordis 服务代理每次不同、公开 tracker 稳定。修复后受限回归103/103，独立审查无未解决 P1/P2。公开插件仍拒绝未验证 caller，nativeRuntimeVerified/releaseReady 保持 false。冷记录不能证明 Agent scope；完整 Bot dispatch 和独立90-test安全切片接入仍未实现。
