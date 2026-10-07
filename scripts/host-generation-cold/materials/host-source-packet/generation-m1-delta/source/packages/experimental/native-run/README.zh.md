# 私有原生执行

[English](README.md) | 中文

本包提供两个独立、仅限所有者使用的执行接口。`NativeSessionDriver` 保留受保护的纯文本日志，继续拒绝工具。`prepareOwnedGenerationSource` 将真实原生活动绑定到不可变的产品标识，不扩大旧驱动器的权限。

所有者先准备严格模型调用，将 `protectedModelCalls` 传给 `ownerCtx.agents.create`，私有保留实际返回句柄，再进行一次性附接。创建副作用之前，`isPreparedOwnedGenerationSource` 校验精确所有者、会话和角色。裸 Agent、复制的句柄、结构相似的提供方或 JSON 准备对象不能提供权限。普通工作源和派生子源无工具；主源仅保留一个实际 `dsh_bot_delegate` 定义。主源可在注册前附接，使创建阶段能够验证空工具注册表；每次启动和请求都必须存在该精确注册对象。

附接接受空日志，或预先声明的精确初始化前缀：依次为 `permission/preset`、`sandbox/mode`、`approval/policy`，值完全一致，且没有其他事件。所有者在创建前提供模式快照。既有输入、轮次、模型调用或工具历史均拒绝附接。历史附接需要下述精确所有者日志；未封存的历史 Agent 不可使用。

`start(binding, input)` 同步返回不透明执行对象。标识保留真实 UUID 字符串 `configVersion`，代数和纪元采用正整数。源保留精确原生输入、原活动计数器、驱动器 promise、取消控制器、请求对象和实际助手流。即使 inbox 同步失败，仍保留可检查的 UNKNOWN 执行对象。UNKNOWN 执行不能复用或重放。

`inspect` 分别报告本地返回与远端结算。凭据要求原活动返回、每个已分派请求都有实际响应终止标记及完整用量，并且精确刷盘的输入、轮次和助手窗口能够读回。组装器默认终止、提供方用量缺失、idle、轮次结束或取消本身均不能产生凭据。明确观察到的零用量有效。仅 `isOwnedGenerationReceipt(receipt, source, exactBinding)` 校验凭据身份；序列化或复制的凭据无效。

`isCurrent` 校验原凭据权限及产品生命周期。`canDispatch` 独立封锁请求，并在异步认证之后再次检查。`cancel` 在首次 await 前封锁该执行，并中止所捕获的原控制器，不能停止替代活动。已完整观察到的响应，仅在原活动返回且持久窗口一致后，才可于取消后结算。其余远端状态保留 UNKNOWN。结算仅提供响应及用量证据，不代表产品目标完成。

无密钥测试挂载真实 Loader、AgentLoop、持久化、工具和严格提供方，以离线 SSE 传输验证所有权及结算机制；测试不证明实际模型行为或远端服务已取消。

所有者在准备前打开私有目录中的 `openOwnedGenerationJournal`。日志持有独占原生 flock，并同步持久化 SQLite 意图。它绑定原会话头、路由、初始化、精确工具 schema 和输出约定、完整输入与标识、最终请求与协议摘要、实际响应终止及用量，以及已返回的原活动。仅供 Host 使用的增量 `nativeActivityIntegrity` 投影维护精确事件顺序与链坐标，不提供所有权。每次协议发送前，源在异步准备和认证之后重新读取实际持久链；投影缓存不能独自授权发送。

已知历史重启时，所有者以 `create: false` 打开同一日志，准备受保护调用，执行实际 `ownerCtx.agents.resume`，并为同一会话标识保留新的真实句柄。日志在恢复前拒绝未终结或被改写的历史。主源恢复必须在准备阶段提供精确实际 delegate 定义，使 schema 不符在工厂副作用之前失败。附接仅接受已知检查点及原生构造器的延续标记。`await source.restore(exactHistoricalBinding)` 再次读取原封存窗口，返回新源持有的历史执行对象；它不发送旧输入。凭据保留原操作、nonce 和租约的全部字段。新输入必须使用严格递增的代数。

父工作源可通过 `workDelegate` 和预先规划的稳定标识，仅获准一个实际 delegate 定义；其日志显式使用 `toolPolicy: 'delegate'`。完整启动标识仍保留全部执行字段。只有实际原 delegate 调用可派生 `prepareOwnedChildGenerationSource`；复制的源、伪造执行对象、JSON 谱系及递归子任务无效。已标识的子准备对象提供实际 `parentAgent` 供原生创建，并校验实时运行时所有权及持久谱系。零工具子请求在每个异步阶段后复核所捕获的原父活动及产品授权。原凭据成立后，所有者才可通过 `planOwnedWorkGenerationSource` 规划下一代父工作输入。产品拥有共享工作槽预留，并必须在发送检查中包含授权及租约权限。
