# Native DSH Bot v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在未修改的官方 DSH 中交付规格六项能力完整的 Bot 插件，完成多轮复审后发布中文 GitHub 页面与插件包，并明确作废旧独立软件。

**Architecture:** 一个标准 bundle 提供 Host 业务服务及 Client 原生插槽。官方 storage 的 `dsh_bot_v1` unit、`state/current` 聚合快照由一个写入队列管理；公开 Agent、Session、Tools、LLM 服务承担实际执行和持久证据。UI 和 Agent 工具共用业务方法，真实 Agent 会话绑定决定身份。

**Tech Stack:** ESM JavaScript、Node ^22.19.0 || >=24、官方 @deepseek-ai/dsh 0.2.0-rc.2 / Cordis 4.0.4、官方浏览器 React 模块、node:test、GitHub Actions Linux/macOS。

**Spec:** ../specs/2026-10-08-native-dsh-plugin-v1-design.md

## Global Constraints

- 直接安装到官方原版 DSH；DSH 本体不作修改。生产包不携带 DSH/Host/SDK，不建立专用应用/Home；隔离 Home 只用于测试。
- 第一版包含全部六项需求及 P01–P21；阶段通过不缩小正式首版范围。
- 一个 Bot 一份长期记忆；会话选择已创建 Bot；改名不改变 ID。
- 跨 Bot 默认只读；共享范围为上限；控制只针对会话与任务；配置和共享授权由人类设置。
- 每 Bot 父工作、一级子工作和未结算 UNKNOWN 共用十五个工作槽；深度最多一级；联络保留独立短轮容量。
- 新任务/续办/恢复/交接共用准入；停止接受与结算分开；UNKNOWN 不重放、不释放占用。
- 模型来源为宿主目录，联络/执行可分别配置；冻结最终调用；不改变全局默认。
- 官方 unit `dsh_bot_v1`，`state/current`，单快照原子写入；坏数据不变为空账本。
- 不替换应用根/Session 根数据，不关闭普通原生界面，不安装重复 React。
- 原始操作、世代、模型及产物身份持久保存；审批与撤权在实际调用边界检查。
- 旧独立软件完全作废并退出当前源码的运行/分发入口；Git 历史和作废说明保留追溯；PR #1 不合并。
- 原版 Linux/macOS、真实 GUI、真实模型、最终包审计分别有证据；合成 provider 不冒充真实模型。
- 用户已授权 goal 模式持续实施及多轮复审；本会话直接执行并使用独立只读复审，不再重复请求规格或常规实施批准。

## Review Focus

1. 重复点击、两浏览器同时提交、持久写成功但回执丢失：查回同一原始操作，不建立第二个 Bot/Session/任务（T2、T4、T7）。
2. 恢复期间损坏/未知 schema、未结算模型或工具：保留数据和 UNKNOWN，拒绝不安全续办，不伪造成功（T2、T7、T10）。
3. 读取开始后撤权/收紧共享、排队期间成员变化：发布前重新检查权限和世代，不泄漏缓存/迟到结果（T3、T6、T9）。
4. 会话切换 Bot/模型以及同 Bot 两会话同时写记忆：归属绑定不迁移，最终模型不漂移，记忆版本冲突显式返回（T4、T5、T6）。
5. 封存意见经同 Bot 另一会话、记忆、普通只读工具转发：会话/内容来源继承 meeting/epoch/phase 屏障，公开前不得外传（T5、T9）。

---

## 文件与共同接口

新的运行文件只放在 `src/native/`，浏览器产物为 `src/client/client.js`；旧运行代码从当前树删除，以冻结提交 `1f111d7` 为历史证据。新测试只放在 `test/native-plugin/`；旧独立运行测试从默认套件移除，历史通过记录不计入新验收。

| 文件 | 唯一责任 |
| --- | --- |
| `src/native/plugin.mjs` | 注入公开服务、挂接业务服务/RPC/Tools、注册与关闭 |
| `src/native/store.mjs` | schema、snapshot、串行提交、操作查重、只读复制 |
| `src/native/policy.mjs` | 实际 caller、共享上限、控制、阶段屏障、撤权 |
| `src/native/bots.mjs` | Bot 配置、命名、暂停及记忆版本/遗忘 |
| `src/native/sessions.mjs` | 先登记再创建、归属、冷读分页、归档恢复 |
| `src/native/adapter.mjs` | 官方 Agent/Session/LLM/Tools/Storage 薄适配 |
| `src/native/tasks.mjs` | task/attempt 准入、十五槽、调整、停止与验收 |
| `src/native/broker.mjs` | 有界联络、结果及群消息 durable outbox |
| `src/native/collaboration.mjs` | 群成员、真实会议阶段/独立意见/行动项 |
| `src/native/recovery.mjs` | 原始操作查回、UNKNOWN、冷启动恢复 |
| `src/native/service.mjs` | UI/工具共用业务分派和可安全返回 DTO |
| `src/client/client.js` | 本地化工作台、已创建 Bot 选择、原生导航 |
| `test/native-plugin/official-fixture.mjs` | 测试专用官方服务组合及可控外部 provider |
| `scripts/test.mjs`, `scripts/check.mjs` | 新插件默认测试和包闭包检查 |

共同类型为 JSON 数据：`Actor = {kind:'human'} | {kind:'bot',botId,sessionId,agent}`（agent 只留进程内，禁止序列化）；`Command = {operationId,action,input,expectedRevision?}`；`Outcome = {ok:true,value} | {ok:false,error:{code,message}}`。Snapshot 包含 `schema:1,revision,bots,sessions,memories,grants,tasks,attempts,groups,meetings,operations,outbox`。引用 ID 不提供权限。

### T1：原生运行门及旧路线退出（P01/P19/P21）

**Files:** 修改 `package.json`、`cordis.patch.yml`、`README.md`、`scripts/test.mjs`、`scripts/check.mjs`；新建 `test/native-plugin/package.test.mjs`、`official-fixture.mjs`、`official-probes.test.mjs`、`docs/history/standalone-void.md`；删除旧生产启动器/owner/native-run 导出及分发工具。

**Interfaces:** Consumes 官方公开 SDK。Produces `createOfficialFixture(options):Promise<{ctx,dir,close()}>`；探针记录 actual owned create/setup、真实 stream、工具结算、原生日志、KV persistence。

- [ ] 写 `production_pack_has_only_native_plugin`：真实 `npm pack` 不含 server、owner、私有 native-run、Host、专用 profile 或安装器；manifest 无 start/owner exports。
- [ ] 运行 `node --test test/native-plugin/package.test.mjs`，应因旧包仍包含独立入口失败。
- [ ] 移除旧有效入口；保留冻结源码引用和“作废：独立软件版”中文说明；README 清楚区分未交付插件与已作废旧候选。
- [ ] 用官方公开 Context 创建 owned Agent，setup 在首输入前生效；证明 dispose 结算本 Agent/model/tool，普通另一 Agent 不被取消；通过标准 pluginManager 安装真实包并读取 application。
- [ ] 运行 package 与 official-probes 测试；预期通过并包含原版来源与边界证明。如必需能力阻塞，保留失败证据、研究公开替代，不继续冒充通过。
- [ ] 提交 `refactor: retire standalone product and establish official plugin gate`。

### T2：原生 Storage 原子快照与原始操作（P18/P19）

**Files:** 新建 `src/native/store.mjs`、`test/native-plugin/store.test.mjs`。

**Interfaces:** `PluginStore.open(kvFacet):Promise<PluginStore>`；`read():Snapshot`；`transact(command,mutate:(draft:Snapshot)=>JSON):Promise<JSON>`；`drain():Promise<void>`；`close():Promise<void>`。幂等比较 action+规范 JSON input+expectedRevision，原始 ID 相同而内容不同拒绝。

- [ ] 写 `snapshot_failure_preserves_committed_state`、`same_operation_returns_original_result`、`same_id_changed_input_conflicts`、`concurrent_operations_serialize`、`unknown_schema_never_overwrites`，分别断言失败写不发布、重复仅一次 revision、内容冲突、FIFO、坏数据仍原样存在。
- [ ] 运行 `node --test test/native-plugin/store.test.mjs`，应因缺实现失败。
- [ ] 实现指定 unit/table/key，schema/revision 校验，单写入链，事务内无网络 await，返回深拷贝；关闭先封准入再 drain/close。
- [ ] 同命令应全部通过；官方 JSON KV 重开读回同 revision/ID。运行默认 `npm test` 后提交 `feat: persist atomic plugin state and original operations`。

### T3：真实身份、共享范围与授权（P05/P06）

**Files:** 新建 `src/native/policy.mjs`、`test/native-plugin/policy.test.mjs`。

**Interfaces:** `PermissionPolicy(store)`；`fromAgent(agent):Actor` 验证实际会话绑定；`require(actor,action,resource,snapshot?):void`；`canRead(actor,resource,context?,snapshot?):boolean`；`authorizeShare(actor,command):Promise<JSON>`。Human 只来自真实认证 RPC 适配，不接受请求 actor。

- [ ] 写 `forged_bot_parameter_is_not_authority`、`default_read_cannot_control_or_write_foreign_memory`、`control_remains_inside_sharing_ceiling`、`revocation_rechecked_before_publish`；普通会话未纳入拒读，人类独占配置/grant。
- [ ] 同测试命令应先失败；实现持久 scope/receiver/level/active/version 与 sealed 资源的独立屏障。
- [ ] 同命令通过，默认套件通过，提交 `feat: enforce bot identity and revocable sharing`。

### T4：Bot 目录与原生会话（P02/P03/P16/P17）

**Files:** 新建 `src/native/bots.mjs`、`sessions.mjs`、`adapter.mjs`、`test/native-plugin/bots-sessions.test.mjs`。

**Interfaces:** `BotDirectory(store,policy,adapter).create/update(actor,command):Promise<Bot>`；`SessionOwnership(...).create(actor,command):Promise<Binding>`；`read/page/list/archive/restore(actor,input,signal):Promise<JSON>`；`NativeDshAdapter(ctx).createOwned(binding,setup):Promise<AgentHandle>`、`readNative(sessionId,signal)`、`listNative(request,signal)`、`models():Promise<ModelCatalog>`。

- [ ] 写 `three_bots_have_stable_distinct_ids`、`existing_bot_selected_before_first_input`、`retry_create_uses_original_session`、`blank_session_cannot_rebind`、`cold_paginated_management_does_not_wake_agents`、`archive_restores_same_identity`。
- [ ] 单文件先失败；实现 catalog 校验、每 Bot contact/execution model、配置 revision；会话意图在创建前持久，真实 Agent setup 注册身份/配置，禁止跨 Bot 换绑。
- [ ] 官方宿主实测 create/resume/read/archive/restore，实际分页含普通/归档/异常对象，保留普通 DSH 功能；测试及默认套件通过，提交 `feat: add named bots and owned native sessions`。

### T5：每 Bot 记忆与自动上下文（P03/P04/P14）

**Files:** 扩展 `bots.mjs`，新建 `test/native-plugin/memory.test.mjs`。

**Interfaces:** `memoryWrite(actor,command):Promise<Memory>`；`memoryForget(actor,command):Promise<Memory>`；`context(actor,binding,{maxChars}):string`；`searchMemory(actor,input):JSON[]`。每条来源 `{sessionId,eventSeq,meetingId?,epoch?,phase?}`，版本 CAS，遗忘 source tombstone。

- [ ] 写 `new_session_gets_identity_memory_unfinished_tasks`、`concurrent_memory_revision_conflicts`、`foreign_read_never_becomes_foreign_write`、`forgotten_source_cannot_auto_reappear`、`sealed_opinion_cannot_enter_other_conversation_context`。
- [ ] 先失败；实现有界相关上下文，用官方 `agent.inject()` 记录进入原生日志；按需冷读工具保留来源，不塞全部历史。
- [ ] 重启后记忆和来源保留；同命令和默认套件通过，提交 `feat: add isolated durable bot memory and contextual recall`。

### T6：最终模型/工具边界与生命周期（P06/P10/P19）

**Files:** 扩展 `adapter.mjs`、新建 `plugin.mjs`、`service.mjs`、`test/native-plugin/boundaries.test.mjs`。

**Interfaces:** `bindAgent(agent,binding,{model,epoch,signal}):Disposer`；`resolveCaller(exec):Actor`；`trackResources(agent):{settled():Promise<Evidence>}`；`BotService.dispatch(actor,command,signal):Promise<Outcome>`；`apply(ctx,config):Promise<Service>`。底层 llm hook 不修改非本插件 request；prepared stream 原 call/config 保留。

- [ ] 写 `final_stream_matches_frozen_model_and_actual_session`、`ui_model_change_rejects_current_attempt`、`tools_use_actual_exec_agent`、`dispose_removes_agent_scoped_registrations`、`revoked_queued_mutation_fails`。
- [ ] 先失败；实施 agent-local model selection + request/stream 比较；注册 tools restrict/guard；绑定处与卸载处都持 disposer，RPC 来源不能自报 actor，错误返回具体原因。
- [ ] 原版受控 provider 实际执行验证 config、signals、guards，普通未绑定 Session 不受影响；全套通过提交 `feat: enforce native request and tool execution boundaries`。

### T7：任务、容量、精确停止及恢复（P09/P11/P12/P17/P18）

**Files:** 新建 `tasks.mjs`、`recovery.mjs`、`test/native-plugin/tasks-recovery.test.mjs`。

**Interfaces:** `TaskController(...).create/start/adjust/stop/submit/accept/archive/restore(actor,command):Promise<JSON>`；`Reconciler(...).reconcile():Promise<Report>`；每 attempt 有 `attemptId,taskId,epoch,sessionId,depth,parentAttemptId,model,state,reservationHeld`。验收 `'passed'|'failed'|'unknown'` 与执行/投递状态分离。

- [ ] 写 `parents_children_unknown_share_fifteen_slots`、`depth_two_denied`、`old_stop_does_not_cancel_new_attempt`、`cancel_ack_does_not_release_unsettled_tools`、`adjustment_fences_old_result`、`lost_receipt_does_not_replay`、`restart_preserves_unknown_slot`、`acceptance_three_states`。
- [ ] 先失败；实现一个准入函数覆盖全部入口，启动前持久 attempt；停止先 fence，再 owned dispose，按真实资源终态释放；未证明留 UNKNOWN，provider usage 与外部副作用单独 unknown。
- [ ] 官方真实 Agent+可控长工具验证 stop/drain；坏日志不替代创建；默认套件通过，提交 `feat: add bounded native tasks exact stop and recovery`。

### T8：独立联络、短任务与结果 outbox（P07/P08/P12/P18）

**Files:** 新建 `broker.mjs`、`test/native-plugin/broker.test.mjs`、`long-work-contact.native.test.mjs`。

**Interfaces:** `ConversationBroker(...).enqueue(actor,command):Promise<Message>`；`deliver(outboxId):Promise<Delivery>`；`reconcileDelivery(outboxId):Promise<Delivery>`。原生 message source 带 original operation/outbox，冷读查回，不重放未知投递；按 Bot 和会话有界轮转。

- [ ] 写 `long_barrier_allows_independent_contact_and_short_work`：长工具 barrier 保持开启；新联络真实独立 assistant/message；短 work 完成时长仍 active。
- [ ] 写 `closed_origin_page_keeps_result`、`lost_delivery_ack_checks_native_log`、`contact_capacity_reserved`；先失败。
- [ ] 实施分离 contact 与 execution owned Agents 和 bounded queue/outbox；投递前权限重查，结果有来源/产物/验收。
- [ ] 受控 provider 原版测试通过，再运行真实已配置 provider 并保存实际请求/usage（未知保留）；默认套件通过提交 `feat: maintain independent contact during native work`。

### T9：内部群与真实会议（P13/P14/P15）

**Files:** 新建 `collaboration.mjs`、`test/native-plugin/collaboration.test.mjs`、`meetings.native.test.mjs`。

**Interfaces:** `GroupMeetingController(...).createGroup/post/startMeeting/submitOpinion/advance/changeMembers/changeTopic/cancel/actionTask(actor,command):Promise<JSON>`。每独立意见对应真实 model turn/session，材料 frozen，meeting/topic/member epochs 持久。

- [ ] 写 `two_groups_have_real_bounded_member_rounds`、`simultaneous_meetings_never_mix_material`、`sealed_opinions_block_all_read_paths`、`own_other_session_cannot_forward_sealed_opinion`、`late_opinion_after_member_rejoin_is_excluded`、`decision_actions_use_current_task_permission`。
- [ ] 先失败；真实 participant 原生短轮→封存→揭示→讨论→决定→行动项，异常缺席有原因，群回环因果/轮次/预算有界。
- [ ] 原版受控 provider 与真实模型三 Bot/两群/两会议分别验证；默认套件通过，提交 `feat: orchestrate internal groups and independent meetings`。

### T10：原生 Client 工作台与完整生命周期（P01/P16/P19）

**Files:** 重写 `src/client/client.js`；新建 `locale/zh.json`、`locale/en.json`、`test/native-plugin/client-lifecycle.test.mjs`；更新 `plugin.mjs`。

**Interfaces:** RPC `catalog/snapshot/command/page` 返回同 BotService DTO；工作台按钮生成 operationId 保留到查回；已创建 Bot 选择器 `create` 成功后 `ctx.uiWorkspace.openSession(sessionId)`；slots 注册归属插件 effect。

- [ ] 写 `workbench_uses_existing_bots_and_native_navigation`、`two_pages_share_identity_capacity`、`disable_preserves_data_and_unrelated_session`、`reenable_restores_same_bot_ids`。
- [ ] 先失败；工作台用 `main` keyed 面板与 `sidebar.panellist`，新建 Bot 会话用 `sidebar.footer.action` 打开 `shell.overlay` 选择器，Bot 信息用 `conversation.session.header.actions/utilities`；不占用原生 single preset 插槽。React 来自 ModuleLoader，只使用 theme tokens/locale，输入验证及错误可见，工作台含 Bot/记忆/授权/任务/群/会议/管理分页。
- [ ] 实际运行 GUI 点击提交→查看→接续→停止→收集→归档→恢复→禁用→启用→卸载；光暗与 console 验证；默认套件通过提交 `feat: integrate native bot workbench and session selection`。

### T11：多轮多角度复审与双平台验收（P01–P20）

**Files:** 新建 `.github/workflows/native-plugin-v1.yml`、`docs/verification/native-plugin-v1.md`、`scripts/verify-native-plugin.mjs`、P01–P21 机器可读证据索引。

**Interfaces:** `verify-native-plugin` 输出 `{commit,packageSHA256,platform,arch,dshVersion,dshHashes,tests,modelUsage,limitations}`，每 P 有实际证明及类型；无法验证项保持未通过。

- [ ] 第一轮独立复审规格覆盖/官方接缝/旧路线闭包；第二轮功能与权限/阶段屏障；第三轮恢复/并发/停止和分发/用户安装。Critical/Important 每项先复现 RED 再修 GREEN，新修复后复审涉改边界；不能以评审表代替实测。
- [ ] 使用最后同一包在 Linux/macOS 官方 rc.2 运行安装、业务、生命周期和 GUI；准确保存官方文件哈希、包提交及请求计数。CI 无私有 SDK、无 sysctl 禁止探针。
- [ ] 执行 `npm test`、`npm run check` 和完整官方 native/GUI 检查，P01–P20 全过；提交 `test: verify native plugin across platforms and review boundaries`。

### T12：最终包审计与中文 GitHub 交付（P21）

**Files:** 更新 `README.md`、`docs/install.zh-CN.md`、`docs/usage.zh-CN.md`、`docs/history/standalone-void.md`；生成插件 tgz、SHA256、安装说明、验收/审计索引，不携带宿主依赖字节。

**Interfaces:** 标准 pluginManager 本地 tgz/目录安装，Release 指向已核验提交及同包。GitHub 首页/安装页/Releases 均中文明确旧路线作废。

- [ ] 实际 `npm pack`、离线解包闭包与 standard install；敏感/许可审计扫描最终包、全部相关 refs/assets/history，关闭真实发现；未清审不公开。
- [ ] 审计和 P01–P21 全过后创建新合格插件 Release，发布资产后下载核验与中文链接；如创建 PR 必须附到任务，PR #1 不合并。
- [ ] 验证 repo 当前访问范围/权限与发布结果；权限限制报告具体拒绝，不绕过；提供可直接访问的真实 GitHub 文件/资产 URL。
- [ ] 提交 `docs: publish verified native plugin v1 in Chinese` 并记录完整验收结论。

## 覆盖自审

P01→T1/T10/T11，P02→T4，P03→T4/T5，P04→T5，P05/P06→T3/T6，P07/P08→T8，P09→T7，P10→T6，P11/P12→T7/T8，P13/P14/P15→T9，P16→T4/T10，P17/P18→T2/T7/T8，P19→T2/T6/T10，P20→T11，P21→T1/T12。五类 Review Focus 各有拥有者和明确断言；共同接口统一，后续变更需在执行账本记录原因。
