# 正常入口与受限 owner 入口核查

后续交付：[受限 owner app/profile](owner-entry.md) 已实现并通过实际官方 launcher 的零模型初始化/停止/恢复。以下核查保留原阶段结论；普通 SDK/浏览器的人类授权链缺口仍在。

2026-10-04；产品基线 `a09222cc35b097f5b690ca6c5dbd53baf4e450cd`，原生候选 `3fbedc25d3626caf4e401b14c31a7f0326a19ec7`。本轮是固定源码、已构建包和既有验收输入的核查；新增真实模型请求、模型工具执行、监听和子进程启动均为 0。产品运行代码没有改动，既有未知 journal 没有恢复、重放或改写。未 push / merge。

## 入口结论

**当前没有可供正常 SDK / 主会话继承的完整用户授权链。** Gateway 的宿主 peer 注入真实存在，但不携带人类身份或权限；SDK 的固定分发也未连接 Gateway。可交付的最小下一片是专用原生 profile 中的本机 runtime-owner 命令入口，继承启动器拥有的 Context/fiber；这与经认证的普通 SDK / 浏览器入口是不同的支持范围。

| 调用路径 | 固定版本实际行为 | 对 dsh-bot 的影响 |
| --- | --- | --- |
| Typert Gateway | `prepareInvocation` 用宿主持有的 peer 构造 `RemoteInvocation`，将其注入接收服务的 `this.ctx.invocation`；缺省取 Connection.operator，或创建同进程 operator | 可以证明宿主调用归属。PeerScope 明说不记录“是谁、可做什么”，不能推导人类授权 |
| Connection HTTP | origin 检查后再检查既有 BrowserAuth；admit 返回 actual operator | 已挂载且已认证的宿主可供将来的薄接入使用；本轮未取得可复用的已挂载、已认证宿主入口。为取得身份而新挂载 Connection 会调用 `BrowserAuth.create`，超出本轮范围 |
| 普通 SDK stdio | 私有 transport/server；方法固定为 `initialize`、`session/prompt`、`shutdown` | 没有产品方法注册口、Gateway bridge 或每次调用的 principal。实际 native 包探针的两次 `dshBot/execute` 均返回 unsupported method，包括带 JSON actor 的一次 |
| Agent / 主会话 | 创建与执行可继承 lifecycle fiber；用户 prompt 标为 `source.kind='user'` | fiber、SessionID、消息角色和谱系都不是人类身份。不得因此开放公有插件的 execute |
| 原生 cmdline | `provideCmdline` 给 app plugin 提供冻结的 argv、appReady 与 appExit | 可作为受限 OS/runtime-owner 入口；实际包已验证 argv 冻结，仍须交付 owner app plugin 和一致的 profile 安装 |

主要源码位置：固定 core 的 `packages/api/gateway/src/index.ts:468,719`、`packages/typert/protocol/src/types.ts:377`、`packages/client/connection/src/index.ts:134`、`packages/client/connection/src/rpc-host.ts:101`、`packages/sdk/server/src/index.ts:59`、`packages/sdk/server/src/server.ts:189,248`、`packages/boot/cmdline/src/index.ts:84`。Agent 的注册不代表授权，见 `packages/core/agent/src/index.ts:248`。

当前 archive 有 `dsh-cmdline`、`dsh-sdk-jsonrpc-server`、`dsh-sdk-protocol`；没有 `dsh-api-gateway`、`dsh-client-connection` 或完整 `dsh` launcher。官方 rc.2 安装和保护候选 archive 各有独立的 Cordis/core 包目录；不能凭相同版本号拼接它们，声称候选已完成原生 profile 启动。当前未交付项是 owner app plugin/profile 尚未实现，以及完整候选 profile 尚未验收；独立 Cordis 包目录仅表示组合未验证，未证明具体不兼容，也不阻止先实现产品 app plugin。

## 最薄受限入口的交付设计

仅增加产品 app plugin、一个不继承 coding/base 工具的专用 profile 和使用说明，不增加第二套 Agent loop、SDK 通用扩展、网络服务或认证系统。

可信入口是用户用 OS 权限启动的专用 `dsh --profile dsh-bot-owner` 进程。插件在受信任启动阶段保留 actual `ctx.fiber`，私有地构造现有 `OwnedNativeController`；命令处理只使用这个保留对象。身份不得来自参数、JSON actor、Context 外形、OperatorPeer 构造器、首个请求或回环地址。`ownerLabel` 只是本机状态标签，`publicHumanAuthorityVerified` 继续为 false。与该进程同权限的插件已经在同一信任范围内。

第一片用户动作只包含：初始化一组 contact/execution Session、提交一条有界文本、按原 operationId 查结果、停止原 operation、关闭进程、重新打开原 owner 状态。文本回复仍由现有 native controller/Session/provider 执行；无 shell/fs/HTTP 模型工具。检查、停止和退出必须能在文本等待期间被处理，不能把整个入口锁在 drive 的 await 上。新请求只由显式文本命令启动；恢复和 inspect 不自动重发。unknown 保留现有拒绝与预留规则。

启动器必须先验证明确的绝对状态目录、单一 writer、零工具、空健康 preset、固定 provider/model、容量与 maxTokens；新初始化采用独占目录，拒绝静默复用失败验收目录。复开采用相同 ledger/native binding 原 ID，不提供 force-unlock、清 unknown 或“重试为新 ID”。身份对象不注册到 ctx，也不返回给用户。

正常 SDK 仍缺少的接口是：**由宿主持有的产品请求分发接缝及不可由 JSON 指定的调用上下文**。如果以后接 Gateway，宿主应绑定 exact operator 到明确的 runtime-owner 策略。已有已认证 Connection 可直接使用其 actual operator。无 Connection 时，可由受信任启动代码用私有 bootstrap args 引用调用 Gateway，验证 `invocation.request.args === privateArgs` 后捕获缺省 peer 并关闭 bootstrap；这只证明 runtime-owner，不能补成 verified human。当前 SDK 没有调用这条 Remote 的路由，不能靠添加 Remote service 解决。

本轮已对上述机制取得独立只读审查；没有交付或声称完成 owner CLI。下一步只实现这个 app plugin/profile：先离线 TDD，再完成一致的候选 profile 组合与无模型 native 验收，不新增 SDK、Gateway 或 Agent 底座功能。

1. 先做失败测试：客户端 actor/caller 字段不能取得权限；伪造对象不能通过 exact-fiber；丢失 native services、非零工具、坏 preset、旧/不匹配目录均在创建或 dispatch 前拒绝。
2. 验证命令上限、原 operationId 保留、并发 inspect/stop 可达，以及 EOF/退出等待现有 native close；不新建子执行器。
3. 用一致的实际 native profile、实际零工具 provider factory，但不 drive：初始化两条空持久 Session，prepare/admit/inspect，dispatch 前 stop，复开原 ID，再确认新工作被 generation fence 阻止；全程断言模型请求为 0。外部响应 mock 只用于离线测试，另记账，不能替代 native 现场证据。
4. 保留所有失败、未通过项和旧 unknown，不换样本、不重做真实审查来提高通过率。

用户需要完成的最小设置是：选定一个新的独立 DSH Home/状态目录，并明确使用仅限本机 OS/runtime-owner 的专用 profile；交付后由用户启动该 profile。沿用已经注入的 provider 认证通路，只配置 `deepseek-official` / `deepseek-flash`、官方 Messages base、空 preset 等非秘密字段。无需创建 token、BrowserAuth 或另填原始 key。当前未交付 profile，不能把上述命令描述成现在已可运行的成品。

## 用户可见动作矩阵

| 用户动作 | 当前实际支持 |
| --- | --- |
| 从普通 SDK / 主会话给 dsh-bot 发命令 | 未支持：分发与调用者授权接口缺失；public execute 继续拒绝 |
| 从浏览器管理并运行真实 Bot | 未支持：现有 UI 是离线控制预览；本轮未启动它 |
| 创建并保持真实联络/执行会话 | 私有受信任 owner 路径已实测两条持久 Session；普通入口未交付 |
| 联络时后台文本仍在运行 | 私有路径已实测不同 Session 并发；正常用户入口未交付 |
| 按原 ID 查回复、停止、重启查 unknown | 私有路径已实测；unknown 不重发、不释放未知预留；当前正常入口未交付 |
| 选择其他 Bot 模型 / 多长期 Bot | 未完成；本切片固定 deepseek-flash、两条零工具 Session |
| 归档恢复、群聊会议和工具工作 | 产品原生闭环未完成；旧底座测量不视为产品支持 |

## 既有代码审查质量

只分析原来的两次真实审查，不增加模型请求。首轮 4,077 bytes，复核 4,089 bytes；本轮逐字比较发现，两份文件都等于 product steps、native steps 和持久 Session user text，保存的回答也等于 native answer。另两条已发送的联络/取消探针输入同样一致。原容量拒绝的第三个 product operation 没有 native row 或 Session 输入，仍保留 unknown。provider wire 全文未留存，因此远端模型内部是否完整消费不能独立观测；源码最后一跳还校验 Session history、step 和 wire messages 一致。现有证据不支持“控制器丢输入”。

首轮只提供了三个代码片段，没有完整 SessionCreationDriver、native intent/unknown 与 close 路径；prompt 允许最多三项 finding，未明确要求不能证实时报告无 finding。回答中第一项忽略片段已有的 `#durableCreations` 早退和磁盘 readback，并把 execution deadline 误套到 creation inspect；外围 driver 实际在 inspect 前后检查 creation deadline/grant/config。第二项把原 ID authoritative reconciliation 当重放，但 native 未确认 intent/unknown 仍阻断新请求。不能据此修改代码或把两项标成已证实缺陷。

复核仍用三个片段，但补充外围保护摘要，明确允许“未证明缺陷”，并限制 250 中文字符。回答确实说未证明缺陷，却仍混淆 `!driver || …` 的短路访问，并推测重复 creationId 会造成 TypeError；`.find()` 只选首个匹配，没有给出这种异常的可达路径。质量只能标为有限/未证明缺陷，不能用这次替换首轮失败。首轮输出 1,096/1,200 tokens；复核 135/600 tokens，均没有用量证据表明耗尽输出上限。

目前能确认材料不完整、提示要求变化和具体推理错误；两次不同 prompt/上下文/限额的样本不能因果区分模型能力与提示效果。下一次获得真实调用授权时，应先离线构造带调用者、前后 fence、最终 wire guard 和 reconcile 路径的完整证据包，再对预先固定的缺陷/无缺陷样本与标准判定；不以继续挑有利样本过门。此次不执行。

## 证据

现场证据目录：`历史隔离位置〔identity-entry-assessment〕`。

- `static-input-chain.json` / `.py`：5 个原 operation 的输入链及旧 product/native SQLite、WAL、SHM 前后 hash。
- `native-entry-probe.json` / `.mjs`：实际 native SDK apply 与真实 line transport 的两次 unsupported 请求、实际 cmdline 冻结事实；不是完整 profile boot、用户鉴权或 owner-controller 集成通过。
- `probe-failures.json`：保留本轮探针首次误用不存在 receipt 字段的失败及修正；没有产品修复或 journal 写入。
- `independent-review.json`：独立源码审查与设计复核。
- `checkpoint.json`、`SHA256SUMS`：本轮基线、历史证据校验和范围。

历史 `product-acceptance` 和 `remaining-acceptance` 的失败、未知状态与质量结论全部保留；旧能力矩阵是其对应阶段的记录，以本页的用户动作表描述当前可用范围。
