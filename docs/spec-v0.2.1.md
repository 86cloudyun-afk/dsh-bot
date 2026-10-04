DSH bot 整体框架
设计版本 v0.2.1 修订
日期 2026年10月4日
状态 供设计评审  尚未实现或通过真实宿主验收
1 结论与本次完善
建议继续采用 DSH 原生插件路线。DSH 负责模型运行、原生 Session、子代理与原生日志；dsh-bot 负责长期身份、内部群、会议、任务责任、投递、授权及可恢复控制账本。插件不引入第二套模型运行框架。
本修订保留六项原始需求，重点补上能实现、能证伪的运行协议：联络与执行分离；每次实际 dispatch 冻结配置；操作有持久身份和查回机制；停止按 run 世代寻址；结果提交与发布都有世代屏障；资源真实结算后才释放容量；群与私聊隔离由工具和检索边界执行。仅新增 selectSessionModel，仍不足以完成这些要求。
首个实现阶段应验证宿主是否具备这些能力，再做单 Bot 闭环，最后扩大到三个 Bot 和两个群。若关键宿主能力失败，应提出最小公开接口补强并重新评审，不能靠提示词、状态卡片或替换框架掩盖。
本稿是 v0.2 的设计修订，沿用同一文档并保留版本历史；原两份附件保持不变：2026-10-04-dsh-bot-design.md 和 2026-10-04-github-absorption.md。本文中的协议、状态和接口名，除明确标为现有入口外，均是拟议契约。写设计文档不代表获准修改生产 core、安装插件、重启宿主或部署。
1 1 保留的六项硬需求
1. 一个管理会话管理全部授权范围内的 DSH 会话与任务，包括已有普通会话、根会话和可寻址子任务。
2. 清理采用可恢复归档，保留日志并有恢复入口。首版不物理删除。
3. 多个 Bot 有长期稳定身份，能够持续联络、参加多个群、拥有多项工作责任。
4. 每个 Bot 独立设置宿主可用的 provider、model 和该 route 支持的 reasoning。联络与执行可分别配置，默认相同。
5. 人类和 Bot 在 DSH 内部群聊、开会、分工和协作；会议有真实议题、独立意见、讨论、决定与行动项。
6. 长任务尚未结束时，用户仍可随时联系同一 Bot，得到实际模型理解后的答复，并查询、调整或停止工作。收件 ACK、排队或 steer 旧轮不算达成此项。
“全部”不扩大访问权限。统一管理按授权范围呈现原生普通 Session、根会话、可寻址子任务和插件 Task，保留对象类型、稳定 ID、来源与父链、负责人、时间和状态，归档及异常对象也可查。分页和最近窗口不冒充全集；找“上周那个”用真实元数据与完整可用分页定位，不以 recent N 缺失改建新对象。重名或指代歧义给最小候选选择；不能把不可结构化的旧会话伪造成插件 Task，也不要求首版新增全文检索系统。冷读不唤醒全部 Agent。
现有普通忙会话继续保留其原生 queue 或 steer 语义，管理入口如实说明等待；只有 dsh-bot 管理的独立执行 attempt 才提供与联络分离的保证。
1 2 首版范围和必要取舍
产品首版仍按 v0.1 范围：一个受信任人类、一个 DSH 宿主、多个 Bot、内部群、手动发起会议和任务。v0.2.1 是设计版本，不新增外部聊天平台、多租户、多宿主、定时 routines、电脑管理、全盘工具或真实攻击测试。
推荐路线是原生 DSH 控制层加薄插件账本。单个 Agent 加 busy queue 改造更少，但无法满足后台未完时独立回复；拼接 OpenBot、LangGraph 等另一运行层能借用功能，却引入双生命周期和双授权来源。因此不采用这两条路线作为首版底座。
保留持久对账而不承诺跨存储 exactly-once；保留可见 unknown 而不把超时当失败；为联络留容量而不抢占取消别人的任务；长任务结果先 submitted 再验收 verified。代价是更早暴露阻塞和配置问题，但这些是六项需求成立的前提。
1 3 本次修订补上的交互闭环
本次补齐四组契约：管理旧会话和断线提交的精确身份；私聊与群参与共同享有的有限交互服务；unknown 下的统一执行准入、资源领取及事件单调归并；调整、协助、责任接手和验收的明确生效点。这些补充来自设计推演，不能称为已复现宿主故障或已经试用顺畅。
2 证据分级与源码吸收
本稿区分三种证据：
• 已核静态依据：附件记录的固定源码路径和 DSH 0.2.0-rc.2 静态合同，可支持局部机制判断。没有据此宣称真实宿主已运行。
• 候选设计：本稿提出的实体、协议、调度和最小宿主补强，需要实现与审查。
• 未测能力：模型冻结、持续联络、取消时延、真实资源结算、隔离、恢复、故障收敛和发布性能，必须由固定版本隔离宿主的证据确认。
来源与固定提交
可以吸收的机制
不可外推的边界
OpenMausBot 6dd4403d
长期 Bot 与 Thread 分层；短 admission；持久委派与收据；协调者可在下游工作未完时接新轮
纯 admission 只证明接纳；busy queue 不证明独立联络；其预算内存实现不满足本稿恢复要求
Rakazo bd764d31
Task Run Attempt 分层；fenced lease；事务与 reconciler；不明 effect 的对账
租约过期不代表旧 worker 已停；账本成功不能证明宿主或外部副作用完成
Hydra 20afb5ec
前台 concierge 与后台 worker 的分离，claim heartbeat report
Web 队列依赖内存、取消链不完整；不能原样宣称恢复和整树停止
Cebus 4aa3a79d
显式寻址、阶段化会议、独立意见的编排思路
TL 路径串行；原始 tag 去重后仍须 canonical botId 去重；history filter 不是 ACL
dsh-discord-bot 97a1b2b1
冷读、状态订阅与 DSH 适配边界
archive 是导出；切模型改全局；recent 25 不能证明消息不存在，误 fallback 不可用于幂等
OpenBot cb5dc32a
身份目录、durable work lease、已开始且结果未知时不盲重跑
README 标明 Alpha 模板；身份配置不等于逐 Bot 模型字段；UI 队列仍在内存
grok-bot-0.18-reconstructed a9f633e0
isRunningWork 与 isRunningTurn 分离，用于责任与轮次状态建模
非官方公开源码证明；in-process child 重启后 unknown，单槽 steer、clear wake 先于 enqueue 均需避免；没有上游 source 使用许可
open-grokbot ea516084
可作为群编排和生命周期的反例验收素材
GPL-3.0；静态成员群、空议题、私聊历史共享、绕调度、await 后缺 epoch 复核、内存 nonce、假 A2A 完成和 watchdog 提前判停均不能照搬

以上为选定路径研究，不是全仓、依赖或供应链审计。重建版及社区实现的观察不能称为 xAI 官方缺陷。本稿只参考机制，不复制代码；若以后引入第三方代码，应逐文件审查许可与 notice。OMB 核心与 enterprise 许可不同；open-grokbot 的 GPL 条件不能按 MIT 处理；重建版 NOTICE 不能授予上游源码许可。[R3–R10]
3 组件边界与主权
入口包括管理会话、Bot 私聊、内部群和薄 Client。所有可变操作调用同一组 typed Host command；模型只提出请求，Host 验证身份、目标、授权、世代和资源范围。
Host 内设五个职责明确的模块：Directory 管 Bot 与配置；Broker 管消息、inbox、outbox；WorkController 管任务、attempt 与停止；MeetingController 管议题、封存、轮次和预算；Reconciler 管未知结果与跨存储查回。Scheduler 分配容量，DSHAdapter 只封装已验证的公开宿主能力。
插件存储建议用宿主持久机制或插件自有 SQLite 单写者，具体依赖由阶段0确定。只有短事务持有写锁，模型、工具、网络等待不在事务内。原生 Session 日志不迁入插件；事件携原生日志引用和观察游标。插件数据与原生日志间没有分布式事务，因此必须保存待对账状态。
插件账本对身份、授权、责任、群消息、投递和会议流程有主权。DSH 对实际 Session、真实 dispatch、Agent 生命周期和其资源事件有主权。provider 或工具系统对外部效果有主权。投影和 UI 都不能凭自身状态覆写这些事实。
4 宿主能力矩阵与阶段0阻断门
附件的 DSH 静态核对来自已记录的 0.2.0-rc.2 安装，本稿未重新读取该机器。下表的“现有”仅指该附件记载的公开合同；加载版本及运行语义均待隔离验证。[R1 第5节]
能力
现有依据或候选接口
验证要求与失败处理
列表 创建 冷读 恢复
sessionController list inspect create fork resolveAgent
列表不唤醒所有 Agent；精确 session identity；subagent-owned 走专用服务
仅目标 Session 选型
现有 selectModel 会异步改 Host default；拟补 selectSessionModel
不改全局；首 prompt 前持久确认；图片路由、冷恢复及并发选型均稳定
最终 dispatch 原子冻结
公开完备合同未证实；拟议 dispatchPermit
归一化有效配置后，与 attempt 快照校验，并把同一不可变值送到最终 provider 调用；不得核验后被 ref 或 adapter 重选
真实 producer 来源
live Agent send followup 等及可扩展 source 静态依据
Bot 与 Host 来源在日志、冷恢复和工具 caller 中保持；不能转成 user
操作身份查回
requestId 和 accepted 不够；拟议 admitOperation 与 inspectOperation
同一 operationId 查回创建、接纳、消费、run 和结果；有权威未接纳证据才能安全重试
按 run 世代停止
根 cancel 与子代理服务有静态依据；完整世代控制待证
精确 runGeneration 与 owned tree；旧 stop 不影响新 run；旧世代接纳和新资源启动被 fence
真正资源结算
Agent 状态或 whenIdle 不足；资源枚举能力待证
模型、子代理、进程、工具、队列、锁都有真实终态或 unknown；caller timeout 不提前释放
工具 检索 目录范围执行
预设与能力安装有依据；完整 enforce 待证
路径与 symlink、检索、工具输入、产物提交都检查 scope；全盘 shell 无法限制则不安装
归档 恢复 可读校验
workspaceRegistry archiveSession unarchiveSession
隐藏与停止分开；完整日志可读后恢复；重复 archive 不代替停止重试
持久插件挂载与投影
Host service preset Client 扩展为候选组合
版本固定、重启可恢复、短事务、观测游标断线补齐，UI 不作为唯一状态源

后五类能力不能用 selectSessionModel 代替。如果宿主不能按操作查回，关键创建与副作用会停在 outcome_unknown；不能按 run 世代 fence，不能安全停止后立刻恢复执行；不能执行 resource scope，不能发布多群隔离；不能固定最终 dispatch，不能发布逐 Bot 模型冻结。这些都应阻断相应验收，而非降级成“已完成”。
能力探针只在隔离 DSH Home、合成材料、授权范围内进行。是否允许实现探针、补 core 及运行宿主，需在设计和实施计划评审后确定。
5 实体与稳定身份
实体
最小持久字段
权威与生命周期
Bot
botId ownerHumanId botEpoch roleVersion defaultModelVersions lifecycle
插件长期身份；不因新会话或新 attempt 重建
Conversation
conversationId kind botId groupId membershipGeneration sessionId conversationEpoch
插件语境与 DSH Session 的明确映射；kind 为 management contact participation execution
Group
groupId ownerHumanId groupEpoch membershipRevision members coordinatorBotId resourceScopeVersion
插件内部共享语境；每成员另有 membershipGeneration
Meeting
meetingId groupId meetingEpoch topicSnapshot materialSnapshot participants stage round budget
插件流程；同群同成员可同时存在多个不同 meetingId
Task
taskId rootAuthorization ownerBotId origin scope acceptance dependencies taskEpoch
插件工作责任；重试保留 taskId，独立保存验收状态
Attempt
attemptId taskId ordinal sessionId runGeneration fence leaseOwner leaseUntil configSnapshot
插件执行尝试加 DSH 真实 run 关联；每次真实重跑新 attemptId
Delivery
deliveryId messageId targetConversation membershipGeneration operationId causation state
插件投递责任；接纳、消费、答复分开可查
Effect
effectId attemptId operationId target payloadDigest scopeVersion externalReceipt outcome settlement
插件记录意图，宿主或外部证据确认效果；unknown 不自动重放

补充持久记录包括 immutable BotConfig、Message、Operation、Inbox、Outbox、AuthorizationGrant、ResourceLease、Observation 和 AcceptanceCheck。Session 与 Run 不是由插件状态伪造的新运行器。
群成员用 canonical botId 寻址。显示名、大小写、别名先解析到 botId，再做唯一集合去重，然后检查 membershipGeneration。未知或歧义目标拒绝或让用户选择；不按最相似名字发送。只解析真实输入中的显式寻址，引用材料、文件或转述文本里的 @ 不产生新 Delivery。
未 @ 的人类普通群消息默认只由预先指定协调 Bot 负责模型答复。没有有效协调者、协调者归档或不再是成员时，Host 显示原因并由人类选择，不能随机广播唤醒全员。显式 @ 消息冻结规范接收者；Bot 消息只按有效 obligation 和 causation 链续办，Host 通知不自动制造下一轮模型工作。会议阶段的具名投递优先按已批准 Meeting 契约路由。
一个 Bot 的私聊、各群参与和每个 execution attempt 使用不同原生 Session。每个群参与 Session 可以串行处理本群协调，但 meetingId 必须留在每条消息和 turn 的快照中；同成员多会议不能共用一个“当前会议”字段。资源或上下文无法隔离时改用 meeting 专用短会话，不能悄悄串议题。
6 正交状态与显示规则
单个大 status 枚举无法同时表达归档、运行、停止和验收。至少分为以下维度，各维度单独转移、保留证据。
对象与维度
状态示例
判定依据
Bot 或 Conversation 可见性
active archived orphaned unreadable
插件目录加 Registry 和日志观察
Task 责任
open blocked waiting_input submitted verified cancelled
目标与验收记录；worker done 仅可支持 submitted
Attempt 执行
queued admitted running settling settled failed outcome_unknown
真实 operation run 资源记录
Attempt 停止
none requested fencing stopping partially_stopped confirmed_stopped unknown
精确停止目标与全部资源终态
Delivery
received ready admitted consumed replied failed revoked outcome_unknown
插件事务与宿主接纳消费结果
Effect 结果
planned authorized dispatched confirmed failed outcome_unknown
最终执行回执或外部查回
Observation 新鲜度
fresh stale disconnected unknown
source cursor observedAt

“runningWork”表示仍有未结束责任或 owned 工作；“runningTurn”只表示某次模型交互正在运行。联系人空闲但下游还在执行是正常状态；新联络 turn 不应清掉后台责任。[R9]
显示时合并而不压扁维度，例如“已归档，停止待确认；有1个未知工具进程”“已提交，待验收”“Bot 联络空闲，2项后台任务进行中”。不以 watchdog、ACK、进程 Promise 返回或 UI 无活动证明 settled。
AcceptanceCheck 用现有记录保存判定主体、标准、证据和结果，并绑定被验收 taskRevision、标准版本及不可变产物版本或 digest。写 verified 的事务须核对当前有效责任与验收版本和检查绑定完全一致，且验收主体当前仍获准；不一致只保留历史检查，新修订显示待验收或无法确认，不能借旧 passed 完成新目标。只有真实检查不符合条件时写“验收失败”并指出条件；证据缺失或检查无法完成为 inconclusive，显示“验收无法确认”，不能把 pending 或 inconclusive 文案写成失败。执行者 submitted 不自动改变为 verified。阻塞采用现有 blocked 维度加 typed reason 与解除条件，避免把每个原因扩成独立状态机。
7 统一命令与授权协议
拟议 CommandEnvelope 必须包含 operationId、nonce、authenticatedActor、targetIds、payloadDigest、expectedRevision、expectedEpochs、rootHumanInstructionRef、authorizationRef、createdAt 和 deadline。authenticatedActor 由真实入口和 live Agent 注册映射建立，不能取请求正文中的 sender。
nonce 的数据库唯一约束明确为 UNIQUE(authenticatedActor, nonce)，不能把目标或 digest 加入此 UNIQUE 后允许同 nonce 变更内容插入新记录。记录内保存命令类型、规范目标、payloadDigest、规范化版本和预期世代等不可变绑定。相同 actor 与 nonce 的重试先比较完整绑定：相同则返回原 Operation，即使 caller 另带新 operationId 也不创建第二份；目标、内容或世代不同则返回 nonce_conflict。operationId 本身另设稳定唯一约束，重用它但 actor 或绑定不同返回 operation_conflict。首次登记和比较均在持久事务内完成，不能只在内存保存 in-flight nonce。明确新操作才使用新 nonce 和 operationId；新身份不能用来绕过拒绝或自动重放不明效果。
手机及其他 Client 在首次发送前持久保存输入、operationId、nonce 与完整不可变绑定，分别显示本地待发送、Host 已收到和送达结果不明。断线重启先查原 operation；已生效补显示，明确未接纳且旧发送者已被 fence 时才按同身份重试，不明只查回，不新造 nonce 再派。旧 stop 或 adjust 永远绑定原目标世代与 revision，不能重连后改指当前新 run。消息和事件按稳定身份去重。
一个 human 原始输入可保留不可变的真实人类来源。管理 Bot 解释、生成、缩写或转派后的任务属于 Bot producer，并引用原始授权；Host 通知属于 Host producer。不能因为内容源于人类就把 Bot 重写内容送入 source.kind=user。
AuthorizationGrant 由真实人类入口建立，限定 action 类别、bot 或 group 或 task、资源和检索范围、可委托对象、允许再委托深度、期限、额度及必要确认。Bot 的角色说明不是 grant；Bot 给另一个 Bot 的消息不能扩大授权。子 grant 只能缩小父 grant，Host 检查整条链仍有效。人类撤权递增 authorityEpoch，优先于历史配置快照，后续 dispatch、工具操作、结果公开都必须再次检查。
授权、安全或 scope 拒绝是终止性拒绝，不能改新 nonce、换工具、换路径或以“诊断”名义重试同一被拒目标。人类明确改变许可且满足平台要求后才能建立新操作。独立且已授权的只读事实查回仍可继续，不能借查回实施原被拒动作。
UI 和模型工具共用有界操作：list inspect createBot updateBotConfig sendMessage createGroup changeMembership startMeeting submitOpinion createTask startAttempt adjustTask stopTask archive restore inspectOperation。名称为拟议 API，返回 typed receipt 或可解释的拒绝，不把自然语言“已办好”当执行回执。
人类确认界面以目的、负责人、可读写范围与分享对象、额度和需要决定的后果为主，不要求逐项理解全部 Grant 字段。已经明确授权的讨论、查进度和范围内投递不重复确认；扩大权限或平台安全要求仍单独确认。明确选中的 Task 不重复询问目标；“停下”“继续刚才那个”在多任务下无法精确绑定时，先问一次最小澄清，不先变更再解释。
8 事务 outbox inbox 与不明效果
8 1 本地提交
1. Host 校验 actor、授权、版本、世代和 canonical targets。
2. 同一短事务写 Operation、源 Message、冻结 recipient 集合、Delivery 与 Outbox，并建立稳定唯一键。
3. 事务成功后立即返回 received 收据，含 operationId 和当前状态；尚未投递时不能写 replied。
4. dispatcher 领取 Outbox，事务内递增 fence 并持久化 lease。事务外调用 DSHAdapter。
5. 宿主以相同 operationId 和目标世代接纳，返回 admissionReceipt 与真实 run 或 inbox 身份；插件另一个事务保存回执并更新 Outbox。
6. 消费、模型开始、结果提交和群发布分别产生可查事件。对客户端断线可按游标补齐，不清 wake 后再赌 enqueue 成功。
群 Message 与全体 Delivery 必须同事务。唯一键可为 messageId 加 canonical botId 加 membershipGeneration；每个会议阶段另外绑定 meetingId、roundId 与 obligationId。其他成员变动不使仍有效成员的消息失效。
8 2 三类恢复判断
• 明确未生效：宿主通过完整 operation 索引或线性化未接纳证明确认没有该操作，并能防止旧 dispatcher 晚到。可以用同一 operationId 重试。
• 明确已生效：查回 admission、run、消费或效果回执，补记本地账本，继续观察，不重新创建或执行。
• 不明：宿主先执行而回执丢失、观察区间不完整、工具开始后进程失联，均为 outcome_unknown。冻结自动重放，展示已知证据，按操作身份查回。查不到 recent 25 或“暂时没有活跃 run”都不是未生效证明。
lease 过期只允许新 dispatcher 获得更高 fence，不证明旧 worker 死亡。宿主接纳和最终副作用边界必须拒绝旧 fence。若宿主无此能力，新 lease 只能对账，不能重发关键动作。对于无法查回也不支持幂等键的外部工具，应要求人工核对；即使此前获准该动作，也不能擅自重复可能已经发生的副作用。
8 3 Effect 与发布屏障
工具调用前建立 Effect intent，绑定 actor、target、digest、授权和 attempt 世代。等待结束后，重新核验 fence、taskEpoch、botEpoch、相关 membershipGeneration、authorityEpoch 和资源 scope，再持久提交结果或发布群消息；任何 await 都不能携旧状态直接提交。
模型返回内容先保存为候选结果。写入 submitted、更新任务、封存意见、公开文件或群发的事务都须在锁内 compare-and-swap 同一世代和授权。成功后写发布 Outbox；真正外部发送前再检查授权和 fencing。若发送在撤权前已经真实发生，记录事实并对账；不能声称撤回了不可逆效果。
晚到事件留作带原始世代的审计证据，可帮助确认旧 run 是否结算，但不能推动新任务世代、释放新 run 的资源、公开新会议意见或覆写当前结果。已启动外部副作用也不会因丢弃旧事件自动消失。
同一 epoch 的事件也不能任意覆盖。每个权威 source 保存 eventId 和 sourceSeq 或 sourceRevision，插件实体保存 projectionRevision；reducer 幂等去重并校验该维度合法转移。settled 之后补到较旧 running 只能归档为历史，不能使当前投影或资源账本倒退。多个来源不可按接收时间任意争权；原生运行、插件责任和外部效果按各自主权字段归并。eventObservedAt 与 projectionUpdatedAt 分开，游标或版本缺口无法证明时显示 stale 或 unknown。重复、乱序和顺序 trace 应得到同一当前投影及占用账本。
9 调度与持续联络
调度分四条路径。控制路径是不依赖模型的短事务和冷读；contact 是私聊或管理会话的短模型 turn；participation 是群协调或会议意见的短 turn；execution 是长任务和长工具。管理入口不 await 下游结束，后台还在执行时协调者可接新轮。
每种模型路径保存独立队列与 deadline，执行 Session 不借用 contact Session。contact 和 participation 都有固定短轮超时及输出预算，超时可单独取消，不牵连 execution；长工作转入 execution attempt。新话题触发独立交互 turn，只读查询读取真实快照，不把所有输入塞成旧任务 steer。
adjustTask 绑定 taskId、expectedRevision 和明确 intent。优先级调整只改变尚未开始的调度顺序，不抢占当前模型或长工具；目标、验收标准或模型的实质变更先保存 pending revision，默认走停止旧 attempt、真实结算、再以同一 taskId 的新 attempt 续做，获准 dispatch 时才标生效。当前执行与待生效修改同时可见，旧 unknown 时修改继续待生效，不能承诺工具已暂停。cancel_responsibility 关闭责任；stop_for_revision 只为安全续做停止旧 attempt，不先将 Task cancelled 再隐式复活。首版不用“暂停”表示尚无恢复契约的动作。
容量按实际共享凭据或限额组归类，不按 model 名分割。至少核验并发请求槽、RPM、TPM、provider retry-after、宿主 driver、长工具、进程和可用内存。凭据只保留不含秘密的 quotaGroupId，不能存入群材料或日志。
拟议联络保障策略：该限额组的短交互保留预算同时覆盖 contact 与 participation，不能只给私聊留槽而让两群持续等 execution 结算。短交互按 botId、conversationId 和 meetingId 分层有界轮转，避免一个 Bot、群或会议独占；固定短轮上限和每个 eligible 队列的服务界由已知容量与批准负载计算，deadline 超过时明确 blocked 或超时。它保证有限服务机会，不承诺两群同时或零延迟回答。execution 使用剩余容量且有每 Bot 上限，控制操作不排在模型队列后。
若已知并发仅1而背景模型占槽，就不启动声称可持续联络的新执行，返回 blocked_capacity；额度未知也不宣称保证成立。阻塞仅限相关新执行许可，inspect、stop、revoke、归档与查回继续可用，有真实可用短交互容量时仍可联系。已有普通会话或外部消费者不受插件调度约束时，要列出容量不可控事实；换 quotaGroup 名字不能证明实际限额独立。
长工具结束前仍算工作，但未占模型槽时可允许联络 dispatch。provider Promise 超时但实际请求未结算时，槽标为占用或 unknown，不提前回收。必要时无法保证联络，应明确容量阻塞；不能静默换模型、取消后台或用模板答复假装 Bot 已理解。
联络和进度问答使用带 observedAt 的摘要，内容包括真实当前步骤、最近事件、待决和 unknown。每个交互 turn 固定 conversation、真实 caller、source cursor、reply 与 causation 引用；任务相关查询、调整或停止必须精确绑定授权范围内的 taskId 与 taskEpoch；有关 attempt 或 run 存在时绑定其精确身份，不存在则显式为空，不伪造 runGeneration，并读取当前快照。普通新话题允许任务引用为 null 或空集合，不猜挂最近 Task，也不要求先创建 Task 才能聊天。冷恢复或两任务并行后，“刚才那个”无法唯一绑定就澄清，跨群材料仅经明确共享授权桥接。回答时交代过期资料，不把旧摘要当实时事实。普通新话题必须发生独立真实 LLM 请求，不能仅返回进度卡。
9 1 量测与发布目标
receivedAt、admittedAt、modelRequestAt、firstTokenAt、replyCompletedAt、backgroundSettledAt 要按同一 requestId 关联。首 token 不等于完整理解回复；至少检查对新问题的实质答复与引用进度的证据。
候选发布负载为1人、3 Bot、2群，后台3项长任务，并对同一 Bot 私聊和两个群发新输入；测试包含不同 Bot 共用限额组、慢模型、长工具和限流。候选目标：健康宿主的收件 p95 不超过1秒；联络排队 p95 不超过2秒；完整模型答复 p95 不超过同 route 无背景基线的1.5倍加2秒。后两项必须限定输入长度、输出预算、provider 和样本，不能跨 route 直接比较。
上述数值是待用户批准的验收目标，没有测量结果。无论数值如何批准，必须在固定健康已知容量、短轮上限和持住背景的 barrier 下持续重复成立：同一 Bot 的私聊、G1、G2 各 eligible 入口在有限服务界内发生独立模型请求并完成实质答复，答复完成先于阻塞背景结算。只有私聊快而两群等背景结束，或只有 ACK 没有实际答复，都不通过六号硬需求。
10 不可变配置贯穿最终 dispatch
BotConfigVersion 包含 contact 和 execution 的模型 route、显式或规范化 reasoning、adapter 默认标识、roleVersion、presetVersion、toolPolicyVersion、memoryPolicyVersion 和 resourceScopeVersion。默认配置可变，版本不可变；实际凭据只引用安全存储，不进入快照正文。
contact 或 participation 在该 turn 被接纳时冻结一次 TurnConfig。execution 在 Attempt 创建时冻结完整 ConfigSnapshot，后续全部模型 step 使用同一版本。修改 Bot 默认只作用于后续新 turn 或新 attempt；当前执行要改模型，先按停止协议结算，再新 attempt 续做。
拟议 dispatchPermit 必须完成下列不可分割契约：
1. 核验 caller、attempt fence、task 与 Bot 世代、当前撤权、资源许可和配置版本。
2. 解析实际 provider、model、有效 reasoning 与 adapter 默认，核对冻结快照；未显式 reasoning 而 adapter 填合法已知默认不误报。
3. 固定本次 dispatch 的不可变参数，由该参数发出真正 provider 调用。任何原生 UI 改选、ref 更新、图片 route 或 adapter fallback 不能在核验后换值。
4. 记录 permitId、实际有效 route、requestId 与 config version，作为事后审计证据。
这是宿主最后调用边界的能力要求，不是插件事先读一次 ref 就能达成。外部 UI 更改旧 execution Session 时必须 dispatch 前报 configuration_conflict 并阻止后续 step；失败、不支持模型或 reasoning 都显式报错，不静默 fallback。role、preset 和资源版本也须真正送入执行链，不能只写元数据。
不可变快照不冻结撤权。安全限制、授权撤销与资源访问收紧在每次动作和发布前即时优先；放宽资源或增加工具需新获准版本及新 attempt 或新 turn，不能借旧快照获得更多权限。
10 1 统一 startAttempt 准入
创建 Attempt 记录和允许 dispatch 分开。所有新执行、重试、模型变更后的续做、恢复续做及交接，都通过同一 startAttempt 准入谓词，不能在恢复按钮或其他路径绕开。准入事务检查当前授权与 task revision、前置依赖、旧 run 与 Effect 冲突、有效 fencing、写资源与运行树隔离、真实 quota 占用、冻结配置和需要的能力证据。未满足只登记 queued 或 blocked 并返回具体 blocker、证据和解除条件，不允许发出模型或工具调用。
旧 outcome_unknown 不因人类点击“重试”或确认核对而消除。相同责任的不明 Effect 不自动重放；冲突写资源、运行树及未结算额度继续阻断。放行必须有权威终态，或宿主可验证的旧执行 fencing 加实际无冲突隔离，并证明不会重复未明副作用及限额仍足够；逻辑新 epoch 或新目录名称不是证明。独立且可验证无冲突的工作可继续，不把一个 unknown 扩为整个 Bot 全局冻结。能力证据缺失时持续 blocked 是正确结果，同时保留冷读、查回和精确 stop。模型、目标、验收或 owner 变更的最小路线仍先结算旧执行再续做。
11 多群 私聊 任务的资源隔离
隔离覆盖三层：模型输入、工具实际读取写入、检索候选集合。每个私聊和群有独立历史与 memory namespace；新群从角色预设与已获准共享知识建立，不 fork 私聊。不同群内的同一 Bot 不自动看到彼此材料。
Host 根据 Conversation、Task 和有效 grant 构造 ResourceScope。目录 scope 检查规范路径、symlink 解析与实际文件句柄边界；检索在取候选前做 scope 筛选，不能取出后只靠提示删除；工具必须接收 caller identity 和 scope，不开放不受限 raw shell、全盘检索或绕 Host 的直接客户端。
共享角色知识仅保存明确允许跨群的材料引用和版本，不汇入所有群的全文。跨群共享项目目录须由人类明确授权，列明共享内容和读写范围；单 OS 用户下的逻辑 scope 不宣称物理沙箱。若工具无法 enforce，禁用该工具或要求更强隔离环境，不能按“全访问默认”放开群边界。
双群测试用无敏感信息的独立 marker：私聊 P、群 G1、群 G2，各有文本、文件和检索项。检查实际 model input、工具输出、检索来源、产物和群发布，而不只询问模型“你看到了什么”。未获准 marker 不得出现。同一 Bot 同时受两群指派，写入共享资源时须明确锁或隔离 workspace；advisory scope 不等于互斥锁。
复合资源先提交 ResourcePlan。插件可协调的写锁与 quota 预留在短事务全有全无领取；不能让 A 持 X 等 Y、B 持 Y 等 X。无法原子领取的宿主实际资源必须采用稳定全序并禁止持有部分资源时跨异步等待其他冲突资源；领取不成即返回 blocked_resource，列出持有者、所需资源和解除证据，释放已证明可安全释放的预留。实际资源结果不明仍保留 unknown，不能用 lease 到期假释放。运行中新增资源须重新原子检验，不能增量等待形成环；能力不足就先停止结算或重排资源方案。
12 会议协议与正常协作链
12 1 议题与材料快照
startMeeting 事务建立独立 meetingId、主持 Bot、topicDigest、材料版本与 digest、成员 botId 和 membershipGeneration、截止时间、轮次与整场预算。空议题拒绝；材料不可读则 blocked_material。首个真实模型请求的输入证据必须包含正确议题 marker 和材料版本，不以 UI 标题出现议题替代。
12 2 独立意见由 Host 封存
Host 创建每成员 obligationId，在独立 participation turn 或 meeting 专用会话中投递同一材料快照。成员按 snapshot 给出意见，Host 把原始提交保存在 sealed 状态；不能让主持 Bot 收齐前提前读别人的意见，不能让成员自行 group_send 绕开封存。讨论输入和工具读取也受该阶段范围限制。
每个 obligation 只接纳一份主意见，修订须有单独 revision 与明确允许。全部提交，或截止时间与明确缺席判定完成后，Host 在同一事务封闭独立阶段并公开可见意见。missing、failed、revoked、unknown 分别记录，不能生成缺席者意见。若截止时模型结果不明，公开其缺席标签并保留旧 run 对账，不以缺席释放真实资源。
12 3 讨论 决策 行动项
主持 Bot 读取已公开意见，提出分歧议题和具名下一轮；Host 校验目标成员与新 round。用户可调整或结束会议，触发新的 meetingEpoch，晚到意见不能提交到新轮。
每条讨论记录 meetingId、roundId、causationId、parentMessageId、rootAuthorization 与 obligationId。规范 botId 去重在创建 Delivery 前完成。一个 Bot 可以在同群另一 meetingId 同时收到独立议题，两条链必须各自记账与封存。
防失控依据授权因果链、义务完成和预算，而非仅看 speaker 序列或“祖先出现过同一 Bot”。有明确议题和授权的 A→B→A 交接是合法链：B 回答 A 的请求，A 综合或追问形成新的有效 obligation。重复相同 operation 或 obligation、无进展自发续议、越权转发才拒绝。需要同时验收合法 A→B→A 全链成功与无授权回环被阻断。
整场预算持久化，至少含成员发言数、轮次、hop、模型请求、token 或花费额度、并发、wall-time 和重试；跨 Bot 汇总，不在每次续议重置。创建新 obligation 和每次真实模型 dispatch 或 retry 前，按同 meetingId 在短事务内原子 reserve；累计已消耗加未结算预留不得超过批准上限，并发占用加新预留不得超过并发上限。预留绑定 operationId 与 dispatch 身份，相同操作查回不重复扣额，真实新 retry 必须另计。token 或花费按可执行的请求与输出上限预留，只有权威结算后才能释放未使用部分；timeout 或 outcome_unknown 不退还未结算占额。超限只进入 blocked 或 pending_decision，不开新链重置额度，inspect、stop、revoke 等控制查询仍可用。
候选默认为1轮独立意见、最多3轮讨论、协调 maxHops 8，均是可评审默认，不能替代整场资源预算。授权主持续议只在人类授予范围内；增加额度或超出范围进入待决。
会议决定标明 decision owner 与依据；不把模型共识当人类批准。行动项创建 Task，带负责 Bot、依赖、范围和验收主体。首版默认人类最终验收；可以明确授权审核 Bot 做限定检查，执行 Bot 不自行 verified。会议结束并不停止已明确授权继续的独立任务，也不自动让它们扩大职责。
“请 B 帮忙”创建关联子任务，A 保留总交付责任；“改由 B 负责”是有界 owner 变更。待接手期间原 owner 仍负责，目标校验和 B 的 typed 接受都成功后，按预期 Task revision 在同事务切换 owner、递增 assignment revision 并 fence 旧 owner 的提交。运行中转移默认先停止并结算旧执行，再允许 B dispatch；转移失败明确“尚未转移，仍由 A 负责或待处理”，不能只凭 A 的发言报成功。旧 owner 已失效时保持 blocked，不默认授予 B 旧权限。
主持、owner、decision owner 或获准验收 Bot 被移除、归档、撤权或不可用时，保留会议、材料、意见、预算和 Task 身份，记录 blocked 的角色原因；submitted 可显示等待有效验收。人类经 existing adjust 或会议调整操作明确新主体，Host 校验其当前授权并原子变更角色 revision，旧主体迟到输出不得提交或公开。前置 Task cancelled、验收失败或无法确认时，后继为 blocked_dependency，列出重新完成前置、合法重定依赖或人类明确取消后继等解除条件，不能按“已终态”自动开跑。
13 停止 归档 恢复与迟到事件
13 1 停止协议
stopTurn 保留原生当前轮语义；stopTask 是目标责任的整树停止，两者不能混用。stopTask 事务内关闭新 dispatch 与投递，递增 taskEpoch，并 fence 当前 attempt；持久记录目标 sessionId、runGeneration、已接纳 operations、child lineage、工具与资源身份。
事务后按精确旧 runGeneration 发 stop，并取消该任务尚未接纳的 Outbox。旧 worker 在任何后续 await、工具启动、结果提交和发布处须失败。新 epoch 不等于旧树已停：继续查询 DSH 的旧 run、子代理、provider 请求、工具进程、pending inbox、资源锁，逐项记录 terminal 或 unknown。
confirmed_stopped 只在目标树不再有可运行消息、未终态模型、子代理、工具与占用资源，而且宿主停止屏障已经建立时成立。部分支持则 partially_stopped；失联则 unknown。重试只重发同一精确停止意图，不把停止上一个 run 的请求路由到当前新 run。
不能把 caller 超时、Agent idle、worker report done、watchdog 或 cancel ACK 当真正 settlement。每个 ResourceLease 记录占用者 attemptId 与 runGeneration；只有对应资源终态证据释放。未知资源保持隔离或 unknown 占用，lease expiry 不释放 provider 的真实占槽。
已有普通会话若混有其他职责或 inbox，返回明确范围和部分停止结果，不清空全共享队列。管理入口仍可查询和解释，不能以隐藏状态报停止完成。
13 2 归档协议
归档先阻断该对象新责任和新投递，递增 bot 或 conversation epoch；隐藏状态与停止状态分开保存。对关联工作调用上述停止协议，然后按选定对象调用 Registry。若原生 archive 先隐藏后停止，账本保留其真实先后，不追认已停。
普通会话只处理用户选定范围。归档 Bot 需列出其私聊、群参与和未完职责；活跃 execution 不因界面移除而消失。停止失败有精确重试入口，重复 archive 不作为重试机制。归档源管理会话由真实 UI 发起并显示 Host 收据，不让会话归档自己后继续宣称完成。
13 3 恢复协议
恢复先验证授权、目标身份及日志。stat 只能初筛存在；inspect 或等效完整只读观察还须确认 session identity 与完整事件日志可读。not_found、orphaned、unreadable 分开返回，此时不调用 unarchive。
恢复使用新 epoch，先对账旧 stop、run 与 effects，再恢复可见性并建立新 contact 映射。旧未知执行未解时可以恢复查看与联系入口，但不恢复执行许可；UI 明确显示阻塞。用户明确决定续办或重试某项责任时，可以登记新的待执行 attempt，但必须通过 §10.1 的同一准入谓词才能 dispatch；保留旧未知记录并核查冲突与外部效果，不能把确认当真实 settlement。
恢复不重放全部旧群消息、旧 wake 或历史任务。未接纳投递在旧 epoch 已撤销；需要补办由新操作明确发起。成员移除再加入用新的 membershipGeneration，旧投递不得恢复；其他成员的仍有效投递继续处理。
14 恢复和运行对账
宿主启动时 Reconciler 先读取插件账本和原生能力版本，再核对持久 operationId、sessionId、runGeneration、事件游标和资源占用。进程内 child 映射丢失时标 unknown，不能猜已完成或把 sessionId 当可停止 token。
对账顺序是身份和授权、原生操作状态、真实运行资源、未提交或未发布结果、最后才是可重试 Outbox。任何历史 grant 已撤销，禁止继续执行或公开；旧效果事实仍须记录。对账只做有界读查和已获准的精确停止，不定时唤醒模型反复“想下一步”。
事件订阅断线后以 lastCursor 补齐，并检测游标缺口；缺口无法完整补齐就 stale 或 unknown，不能用 recent 窗口补成确证。补流经 §8.3 的同世代 reducer，不以晚到或重复事件回退已结算状态。客户端待发送和回执不明记录与 Host Operation 对账后补显示，不自动创建新工作。数据库 migration 先备份并校验版本，失败进入 read-only recovery，避免半迁移后调度。
浏览器关闭不影响已加载 Host 的账本与调度；Host 自身离线时任务不能继续。UI 必须显示宿主在线状态及 observedAt，不承诺机器关机仍运行。
15 从首笔副作用开始的薄 UI
UI 不等待“框架全部做完”才接入。从阶段0的首笔 create 或 dispatch 就需要可见的 Operation 和未知状态，且 UI 和模型调用同一 Host command。
首版只需四个入口：管理会话、Bots、内部群与任务。默认显示结果、负责 Bot、阻塞原因、最近观察时间和下一步，停止与归档分开；unknown 始终醒目，不能藏进折叠区域。稳定 ID、source、epoch、fence、配置版本和收件到回复链放在技术详情，保留可追溯证据，不要求用户先理解它们。不能只显示“进行中”的动画。
创建 Bot 后先显示 registered，再显示原生 Session 与模型配置确认，首个真实模型轮成功后才显示聊天 ready；聊天就绪不能掩盖持续联络尚未验收。模型不可用或创建回执不明时保留同 botId，配置错误通过不依赖模型的 Bots 设置页修复，回执不明先查回，不再次创建。调整默认模型展示“后续请求生效”和当前 attempt 固定配置；部分同步或冲突可见。任务展示“已提交，待验收”、真实验收失败或无法确认，产物链接须按真实权限检查。
unknown 的操作提供查回或人工核对入口；没有权威未生效证据时不能给一个无条件“重试”按钮。恢复页面列旧执行未解项；停止页面列未结算资源。异常与归档对象仍能在统一管理找到，精确 stop 重试和恢复查看不能只留在已不可用的 Bot 私聊。管理会话自己被归档后，四入口中的独立管理界面仍提供授权恢复路径。坏日志分开解释 not_found、orphaned、unreadable 并保持归档。
每场会议有可回到的独立议题入口；群里显示阶段摘要、分歧、需人决定事项和行动项，原始意见可在会议内展开。封存中显示已收人数与缺席原因，不为减噪删除证据；结束会议提示已授权 Task 继续，取消任务另行明确。用户无须理解数据库，但必须能判断什么已发生、什么待确认。
16 分阶段实施与发布门
本节是设计层次的阶段安排，尚不是获准执行的实施计划。
阶段0 宿主能力证伪
固定 DSH 包、插件候选版本和隔离 Home，验证能力矩阵，尤其是最终 dispatch 冻结、operation 查回、run 世代 stop、资源结算、producer 和 scope enforce。首笔副作用有薄 UI 与操作账本。阶段结果只允许“通过”“需最小公开补强”“无法安全提供”，附失败证据，不用成功截图替代。
阶段1 单 Bot 闭环
一个长期 Bot、一个 contact、一个 execution attempt，完成创建、真实长任务、普通新话题答复、进度问答、调整、停止、提交验收、归档与恢复。注入回执丢失与宿主重启，验证不重复创建、不重放不明 Effect。
阶段2 三 Bot 两群
三个不同配置的真实 Bot，同一 Bot 参加两个群；验证 canonical 去重、群材料隔离、provider 共享限额、独立意见封存、同成员多会议、正常 A→B→A 与不授权回环、任务交接和人类验收。普通已有会话与 bot-owned 执行分别验收。
阶段3 发布
在批准负载和指标下跑完整故障矩阵，覆盖重启、限流、取消失败、外部 UI 改模型、权限撤销与迟到输出；确认迁移、观测、恢复和回滚路径。未知状态能解释且无错误成功宣称，才有发布候选。任何六项硬需求未通过都留为发布阻断项，不删需求降低标准。
17 故障注入与验收矩阵
下列 F01–F28 和 U1–U8 目前都是验收场景与不变量，并非已经编写、运行或通过的测试。所有测试使用合成资料和无危险副作用的工具，模拟故障代替真实攻击。
每例实施前须冻结 TestContract：fixture、授权、配置和负载；精确注入点与并发屏障；完整权威 trace；预期 typed state 或 error；调用次数、唯一性和事件顺序谓词；观测窗口与完成判据。trace 至少保留 operationId、requestId、epoch 与 fence、session 和 run 世代、实际 model input 和 route、效果收据、资源账本及 observedAt。必要证据缺失只能判 inconclusive，不能判 pass，也不能因观察窗口结束把未知资源当已结算。
F01–F12、F14–F19、F21–F22和F24–F28应转为机械断言。F13、F20及U类旅程的生命周期可机械验证，但实质答复、产物质量和用户可见结果还须预先指定确定性检查项或人类验收者，事件本身不能代替语义判断。F23须先冻结样本量、输入输出预算、同 route 无背景基线和批准阈值，才可作性能比较；有界公平服务测试另冻结 eligible 队列集合、短轮上限与服务界。
ID
注入或场景
必须保持的结果
F01
Message 与 Delivery 事务中途崩溃
两者一起提交或一起不提交；无半条消息；同 nonce 不重建对象
F02
宿主已创建或接纳，回执丢失
outcome_unknown；按 operationId 查回后补账，不能按 recent 缺失 fallback 重建
F03
lease 到期但旧 dispatcher 仍活
新 fence 接管；旧 fence 无法接纳、执行或发布；无重复副作用
F04
enqueue 前后崩溃与 wake 重试
未投递仍有持久 Outbox；不因提前 clear wake 丢工作；已生效不重放
F05
模型返回 await 期间停止、归档、撤权
提交和发布前再次核 epoch；晚到内容不推动新世代；旧资源继续对账
F06
caller timeout，但 provider 或工具仍在跑
不显示 settled；不提前释放占槽或锁；有真实终态后再结算
F07
cancel 失败、残留 inbox、child 或工具
分项 partially_stopped 或 unknown；精确重试；未全停不能 confirmed_stopped
F08
旧 run stop 回执晚于恢复新 run
不停新 run，不释放新 run 资源，不覆写新状态
F09
宿主重启且 in-process child 映射丢失
身份查回；无法证明则 unknown；不把 child done 的旧报告当验收
F10
外部 UI 换模型，核验到最终 dispatch 有竞争
请求在最终边界被阻断或仍用冻结值；无 TOCTOU、静默 fallback、全局污染
F11
图片 route、adapter 默认、冷恢复
有效 route 与快照一致；合法默认不误报；不可用显式失败
F12
不同模型共享限额，容量1、未知额度和429
联络保留策略成立；不足为 blocked_capacity；不抢停任务或伪造回复
F13
长模型和长工具被 barrier 持住，私聊及 G1 G2 各发新话题和进度问题
每个 eligible 入口在有限服务界内完成独立真实答复，先于阻塞背景结算；收件与完整答复分别量测
F14
两群 私聊 文件 检索 marker 同时输入
模型、工具、检索和产物均不越 scope；共享资源有显式授权和锁
F15
Bot 伪造 user 来源、sender、grant 或管理能力
Host 真实 caller 校验拒绝；Bot 或 Host producer 贯穿日志与冷恢复
F16
@A @a 别名同指一 Bot，成员移除重入
canonical 后唯一 Delivery；旧 generation 失效，其他成员不受影响
F17
空议题、材料变化、首个模型输入检查
空议题拒绝；冻结正确材料；首个 request 有议题 marker
F18
独立意见封存、缺席、同成员两个 meetingId
意见不泄漏；缺席不编造；议题与结果各自归属，不共用当前会议状态
F19
正常授权 A→B→A 与自发重复链
合法全链完成；重复 obligation 和越界续议被拒绝；整场预算不重置
F20
执行者 done、自称 verified、假的 A2A完成
有真实目标执行和交付证据；submitted 不自动 verified；人类或获准验收主体确认
F21
archive 先隐藏 stop 失败，恢复日志缺失不可读
隐藏不报已停；精确重试可查；坏日志不 unarchive；不重播旧任务
F22
UI 断线、event cursor 缺口、浏览器关闭
Host 独立推进；恢复游标；缺口显示 stale unknown，观察时间可见
F23
阶段2批准负载与基线比较
留完整样本与分位数；数值为真实测量后才称达标；六硬需求全部通过
F24
旧 run 或 Effect unknown 时续办 改模型 转移或点击重试
所有路径走统一准入；冲突责任资源quota不放行；独立无冲突工作仅有可验证隔离证据才继续
F25
A 和 B 同时申请 X Y 双资源，并发屏障制造交叉顺序
全有全无或稳定全序，无循环等待；至少一者可执行，另一者明确 blocked_resource；unknown 不假释放
F26
同 epoch 先收到 settled seq12 后补 running seq10，再重复事件
当前投影和资源账本不倒退；乱序与顺序 trace 一致；缺口不能冒充完整证据
F27
主持 owner 验收者失效，前置 Task cancelled 或无法验收
明确角色或依赖 blocker；人类原子调整且不自动转权限；旧主体迟到输出被 fence
F28
冷恢复后两相似 Task，用户说继续刚才那个
不按全局 latest 猜；必要时先澄清；task run epoch causation 精确绑定，模型输入不泄漏跨群 marker

17 1 用户旅程验收
U1 创建模型失败后经设置修复，同 botId 不重复创建；未发生真实请求不显示模型成功。
U2 超过 recent 窗口的旧普通、子任务和归档对象仍能按真实可用记录找到；重名不误操作，冷读不唤醒全部 Agent。
U3 后台长工具未终态时，新话题的独立真实 LLM 完整答复完成；同时验证私聊和群参与的有限服务。
U4 两项 Task 的歧义先澄清，优先级不抢停；目标替换在旧 attempt 结算并通过准入后生效，迟到结果不覆写。
U5 无 @ 只有指定协调者答复；合法 A→B→A 成立；协助不丢总 owner，接手失败仍保留原责任且无重复执行。
U6 同群两会议不混议题，独立意见不泄漏，摘要可追到原意见；结束会议与继续已授权任务的含义清楚。
U7 首次发送前、Host 提交后收据前、回执后分别断线重启，按持久原 operation 身份查回或安全重试；逻辑操作不重复，旧 stop 不命中新 run。
U8 停止部分失败后归档再恢复，仍可从统一管理查未解资源；恢复查看不重跑旧 Effect，坏日志不 unarchive，归档管理会话后仍有独立恢复入口。
上述旅程同样须冻结 TestContract，不能把本轮设计推演写成实际试用。验收者应检查真实 request 与资源证据，不能只读 Bot 自述。运行结束、状态绿灯和同一模型名称都不是验收充分条件。
18 待用户决定的少量事项
1. 同意以原生 DSH 加插件账本为主线，并把四项未证关键能力作为阶段0门槛：最终 dispatch 冻结、operation 查回、run 世代停止和 scope enforce。建议同意。
2. 是否采用候选发布负载及延迟目标。建议先批准负载和事件顺序要求，完整答复数值在确认实际 provider 基线后定稿；收件1秒仍仅为目标。
3. 最终验收主体是否默认人类。建议首版默认人类，审核 Bot 仅在明确限定材料、检查标准和后果的授权下代验。
这三项不要求先选择所有数据库、模型和预算数字。宿主探针、core 修改和产品实现须等设计评审及书面实施计划通过后分别启动；本稿不自动扩大此前权限。
19 主要来源
R1 用户附件 2026-10-04-dsh-bot-design.md。重点依据第1、4、5、7、8、10节：六项需求、首版边界、DSH 静态合同、模型冻结、群隔离、停止恢复与验收。该附件包含本机静态路径，本稿不把它们当作本轮重新核验的证据。
R2 用户附件 2026-10-04-github-absorption.md。重点依据第1、2、4、5节：五库固定提交、许可、十二项吸收机制、不可照搬边界及未运行声明。
R3 OpenMausBot 固定提交 6dd4403d8fbbbd5c17169724cb2a529f11d7543e。Bot Thread；durable delegation。
R4 Rakazo 固定提交 bd764d31a2888388ec794e4458caf81de1246dfb。模型解析；Task Run Attempt、fenced lease 与对账结论来自同日固定源码复核，不等于 DSH 实测。
R5 Cebus 固定提交 4aa3a79d5d9dd31e41ea17ef0088df97d01c586d。canonical target 映射；TL 顺序路径。
R6 Hydra 固定提交 20afb5ec69f6a63c9b01e1bf7a1300fca3de42b1。worker claim execution。
R7 dsh-discord-bot 固定提交 97a1b2b1a49ca86b1987b2d2b51c7cee72b28076。模型变更；archive 导出。
R8 OpenBot 固定提交 cb5dc32a44517622c6db4e527e61d3abb389b43c。Alpha 模板声明；已开始未知结果不重跑。
R9 grok-bot-0.18-reconstructed 固定提交 a9f633e09d49a85829b8236331b9e21f7e612634。work 与 turn 状态；许可边界。这是重建资料，不是官方完整源码。
R10 open-grokbot 固定提交 ea516084251a9ff95f32a447e61d2bfa2938a7d4。群材料与 await 边界；直接运行与内存 nonce。社区 GPL-3.0 实现，不复制代码。
