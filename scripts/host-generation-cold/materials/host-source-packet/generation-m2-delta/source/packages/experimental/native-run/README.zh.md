# 私有原生执行

[English](README.md) | 中文

本包提供两个独立、仅限所有者使用的执行接口。`NativeSessionDriver` 保留受保护的纯文本日志，继续拒绝工具。`prepareOwnedGenerationSource` 将真实原生活动绑定到不可变的产品标识，不扩大旧驱动器的权限。

所有者先准备严格模型调用，将 `protectedModelCalls` 传给 `ownerCtx.agents.create`，私有保留实际返回句柄，再进行一次性附接。创建副作用之前，`isPreparedOwnedGenerationSource` 校验精确所有者、会话和角色。带日志附接还验证这些精确受保护调用在原生 Agent 创建时已存在。裸 Agent、复制的句柄、结构相似的提供方或 JSON 准备对象不能提供权限。普通工作源和派生子源无工具；主源仅保留一个实际 `dsh_bot_delegate` 定义。主源可在注册前附接，使创建阶段能够验证空工具注册表；每次启动和请求都必须存在该精确注册对象。实际工具定义整体冻结，包括参数、输出 schema、渲染和内容回调、展示元数据、并发策略和超时；访问器策略被拒绝。准备阶段在副作用之前捕获路由、初始化、完整计划和回调。

附接接受空日志，或预先声明的精确初始化前缀：依次为 `permission/preset`、`sandbox/mode`、`approval/policy`，值完全一致，且没有其他事件。所有者在创建前提供模式快照。既有输入、轮次、模型调用或工具历史均拒绝附接。历史附接需要下述精确所有者日志；未封存的历史 Agent 不可使用。

`start(binding, input)` 同步返回不透明执行对象。标识保留真实 UUID 字符串 `configVersion`，代数和纪元采用正整数。源保留精确原生输入、原活动计数器、驱动器 promise、取消控制器、请求对象和实际助手流。即使 inbox 同步失败，仍保留可检查的 UNKNOWN 执行对象。UNKNOWN 执行不能复用或重放。

`inspect` 分别报告本地返回与远端结算。凭据要求原活动返回、每个已分派请求都有实际响应终止标记及完整用量，并且精确刷盘的输入、轮次和助手窗口能够读回。组装器默认终止、提供方用量缺失、idle、轮次结束或取消本身均不能产生凭据。明确观察到的零用量有效。仅 `isOwnedGenerationReceipt(receipt, source, exactBinding)` 校验凭据身份；序列化或复制的凭据无效。

`isCurrent` 校验原凭据权限及产品生命周期。`canDispatch` 独立封锁请求，并在异步认证之后再次检查。`cancel` 在首次 await 前封锁该执行，并中止所捕获的原控制器，不能停止替代活动。已完整观察到的响应，仅在原活动返回且持久窗口一致后，才可于取消后结算。其余远端状态保留 UNKNOWN。结算仅提供响应及用量证据，不代表产品目标完成。

无密钥测试挂载真实 Loader、AgentLoop、持久化、工具和严格提供方，以离线 SSE 传输验证所有权及结算机制；测试不证明实际模型行为或远端服务已取消。

所有者在准备和原生创建前打开私有目录中的 `openOwnedGenerationJournal`。新日志拒绝既有实时会话及持久原生历史，包括只有初始化前缀的会话。日志持有独占原生 flock，并同步持久化 SQLite 意图。格式 2 绑定原会话头、路由、初始化、完整工具策略、原创建意图、完整输入与标识、最终请求与协议摘要、实际响应终止及用量，以及已返回的原活动。它不迁移早期日志格式，也不为旧 Home 补授权限。仅供 Host 使用的增量 `nativeActivityIntegrity` 投影维护精确事件顺序与链坐标，不提供所有权。每次协议发送前，源在异步准备和认证之后重新读取实际持久链；投影缓存不能独自授权发送。

已知历史重启时，所有者以 `create: false` 打开同一日志，准备受保护调用，执行实际 `ownerCtx.agents.resume`，并为同一会话标识保留新的真实句柄。日志在恢复前拒绝未终结或被改写的历史。主源恢复必须在准备阶段提供精确实际 delegate 定义，使策略不符在工厂副作用之前失败。附接仅接受已知检查点及原生构造器的延续标记。`selectOwnedGenerationHistory(journal, ownerCtx, fullOriginalBinding, authority)` 读取完整封存历史并产生不透明原历史选择器。`await source.restoreKnown(selector)` 再次读取原封存窗口，返回新源持有的历史执行对象，不发送旧输入。`isOwnedGenerationHistorySelector` 拒绝复制的选择器及发生变化的原操作、nonce 或租约。独立实时读取权限允许在产品纪元变化后验证精确历史凭据；新请求仍受 `isCurrent` 和 `canDispatch` 控制。旧 `restore(binding)` 路径保留严格当前标识要求。新输入必须使用严格递增的代数。

父工作源可通过 `workDelegate` 仅获准一个实际 delegate 定义；其日志显式使用 `toolPolicy: 'delegate'`。`workDelegate.plannedBinding` 固定预留的完整原启动标识：操作、nonce、实际输入 id 和摘要、槽租约以及全部产品坐标。`plannedBinding` 为零工具工作或子任务提供同样完整准入，不增加派生权限。只有实际原 delegate 调用可派生 `prepareOwnedChildGenerationSource`；复制的源、伪造执行对象、JSON 谱系及递归子任务无效。已标识的子准备对象提供实际 `parentAgent` 供原生创建，并校验实时运行时所有权及封存原始谱系。零工具子请求在每个异步阶段后复核所捕获的原父活动及产品授权。原凭据成立后，`planOwnedWorkGenerationSource(source, ownerCtx, fullNextBinding)` 接纳新的完整计划，包括 g2 的新操作、nonce、输入和租约；九字段子集或冲突的同代计划不能授权。产品拥有共享工作槽预留，并在发送检查中包含授权及租约权限。

已知子任务通过 `await prepareOwnedKnownChildGenerationSource(actualResumedParentSource, restoredOriginalParentGeneration, childOptions)` 重开。原生源在工厂副作用之前验证完整封存的原父输入及标识、实际 delegate 调用和原子日志。准备结果保留实际恢复的 `parentAgent`，用于同一子会话 id。序列化父 id 或普通工作准备不能恢复该子任务。新的完整计划可在当前所有者权限下接纳新子执行，不重放已封存的原输入。替代原生父活动会使历史准备失效。

恢复可通过 `historicalPlan: genuineHistorySelector` 保留精确封存的原完整计划，即使普通当前标识检查拒绝其旧纪元。选择器及独占日志必须在原生工厂副作用前核对整个原计划。该计划不能启动或重放；原生日志拒绝已消费代数。所有者等待实际用户继续，持久预留完整新输入、操作、nonce 和租约，再于当前 `isCurrent` 和 `canDispatch` 下调用同一完整 planner，不在恢复时虚构未来输入。

官方 sandbox 和 approval 钩子可在原操作者输入旁追加原生运行上下文快照。AgentLoop 在钩子能够复制或重标记消息之前，将精确消息对象和事件序号记录到原活动。结算将这些原生确证事件与完整持久窗口核对并封存。`getOwnedGenerationReceiptInputWindow(receipt, source, fullBinding)` 仅为精确源产生的凭据返回冻结的原输入 id、窗口坐标和运行上下文 id。产品响应归属可仅跳过这些被确证的 id。JSON `source.kind`、额外操作者消息或复制的原生消息均不提供权限。

原生归档调用实际 Workspace 注册表及其共享 `ArchivedSessionGate`。所有者通过 `mountOwnedGenerationArchiveGate(ownerCtx)` 挂载，并在产品失效处理前调用 `admitOwnedGenerationControl(source, originalGeneration, ownerCtx, fullBinding, authority)`。控制仅提供精确原执行的 `inspect`、`cancel` 和 `archive`，不能启动或附接源。固定的同步 `isAuthorized` 回调独立于旧纪元，验证当前实际所有者授权及 fiber；固定的 `isDispatchFenced` 回调验证产品持久发送围栏。归档同步封锁原生日志，仅停止所捕获的原活动，复核完整持久历史，再调用实际 `workspaceRegistry.archiveSession`，在异步副作用前后持续检查。本地返回的 UNKNOWN 可归档，但用量保持 UNKNOWN，且不能重开。

真正空白的封存创建使用 `admitOwnedBlankSessionControl(source, ownerCtx, originalCreationIntent, authority)`。该意图是原生创建前不可变的实际创建数据，含原操作和 nonce，不虚构模型代数或主任务坐标。完整日志、原初始化和原生活动计数器在整个归档过程中必须保持空白。并发启动使控制失效，但不会取消该新执行。独占重开已知历史并实际附接同 id 受保护句柄后，`unarchiveOwnedGenerationSource(source, ownerCtx, authority)` 在实际取消归档前后核验完整日志及原生检查点，只在验证成功后清除原生发送围栏。UNKNOWN、旧历史、复制的能力及失效授权继续关闭。
