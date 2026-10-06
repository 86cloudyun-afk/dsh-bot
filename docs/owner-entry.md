# 受限原生 owner 入口

本片提供实际 `dsh --profile dsh-bot-owner` 启动路径。调用者是显式启动进程、向继承 stdin 输入命令的 OS 用户；实际 `ctx.fiber` 只保留在 app 私有闭包。没有 HTTP/RPC service、后台启动项、新 token、BrowserAuth、账号、角色或持久访问授权。`publicHumanAuthorityVerified:false` 始终保留，普通 SDK/浏览器人类认证仍未提供。

Node 要求 `^22.19 || >=24`；云验收为 24.19.0。运行时是官方 npm `@deepseek-ai/dsh@0.2.0-rc.2` launcher，加固定 protected core `3fbedc25d3626caf4e401b14c31a7f0326a19ec7` 的私有产物覆盖，全部依赖归于同一个物理 package root。归档 manifest 声明 74 个 package，原始归档实有 75 个；装配 receipt 同时保存两个值。这是隔离验收组合，尚未发布为官方 npm 或产品 release。

## 安装与实际启动

此前验收运行时 `历史隔离位置〔runtime-final〕` 保持原字节。修正后的隔离 CLI 平台为 `历史隔离位置〔runtime-fixed-cli〕`，包含关闭与错误分类修正；其固定 launcher、工作树 patch 和 native 构建 SHA 单独记录于 `runtime-identity.json`。该平台的专项恢复验证使用仅存在于新副本的合成 provider fixture，不能作为真实 API 可用性证据。

以下仅为既有隔离 owner 入口的条件式装配示例，不是已通过完整 v1 验收的公开安装器。调用者先显式设置 NODE_BINARY、PRODUCT_SOURCE_DIRECTORY、OFFICIAL_RUNTIME_DIRECTORY、HOST_ARTIFACT_DIRECTORY、OWNER_RUNTIME_DIRECTORY、OWNER_HOME_DIRECTORY、OWNER_EVIDENCE_DIRECTORY；值均由调用者选择，缺少固定 Host 材料时不得执行。

在产品 worktree 执行以下离线文件操作。输入/输出均为绝对路径；输出运行时和 Home 须尚不存在，父目录须存在且 canonical。只复制公开 package 文件和产品源码快照，不复制旧 Home、配置、环境或凭据。

```sh
"$NODE_BINARY" "$PRODUCT_SOURCE_DIRECTORY/scripts/assemble-owner-runtime.mjs" \
  --official "$OFFICIAL_RUNTIME_DIRECTORY" \
  --candidate "$HOST_ARTIFACT_DIRECTORY" \
  --output "$OWNER_RUNTIME_DIRECTORY"
"$NODE_BINARY" "$PRODUCT_SOURCE_DIRECTORY/scripts/install-owner-profile.mjs" \
  --runtime "$OWNER_RUNTIME_DIRECTORY" \
  --home "$OWNER_HOME_DIRECTORY"
cd "$OWNER_HOME_DIRECTORY"
DSH_HOME="$OWNER_HOME_DIRECTORY" "$OWNER_RUNTIME_DIRECTORY/node_modules/.bin/dsh" \
  --profile dsh-bot-owner --init
```

`--help` 显示 app 参数。ready 回复包括两条不同的 Session ID、requested provider/model、零工具及模型请求关闭标记。profile 不继承 base/coding/sdk-minimal，不加载 BrowserAuth 或 shell/fs/HTTP 模型工具。程序状态固定在 Home 的 `owner-state/`，原生 Session 日志在 `sessions/`。

stdin 使用 UTF-8 JSON 行；每帧最多 8192 bytes，文本最多 4096 bytes。下面的命令逐条等待对应回复，尤其须先等待 admit 完成。

```json
{"command":"status"}
{"command":"prepare","operationId":"my-text-1","kind":"execution","text":"Harmless owner text."}
{"command":"admit","operationId":"my-text-1"}
{"command":"inspect","operationId":"my-text-1"}
{"command":"run","operationId":"my-text-1"}
{"command":"stop","operationId":"my-text-1"}
{"command":"close"}
```

默认 run 返回 `owner_model_requests_disabled`。发请求前停止返回 fenced、reservationHeld=false；该 Session generation 随后不再接受新 prepare。本片没有重置 generation 的命令。contact 文本将 kind 改为 contact。命令不能含 actor/caller/peer/grant，command 必须为字符串。operationId 为 1–128 个 ASCII 字符，以字母或数字开头，后续可含 `_.:-`。相同 ID/text/kind 重用原 envelope，冲突输入拒绝；内部 stop ID 使用 caller 不能提交的 `/` 命名空间。

同一可信 stdin 现在可查看当前绑定任务的进度、提交并记录内容验收，默认仍为零模型请求：

```json
{"command":"progress"}
{"command":"plan","operationId":"manual-plan-1","expectedRevision":1,"steps":[{"title":"检查内容","evidence":"完整文本 digest"}]}
{"command":"advance","operationId":"manual-check-1","planId":"从 plan 回复取得的 planId","expectedRevision":1,"cursor":1}
```

`progress` 返回 task.revision、acceptanceVersion、authorityEpoch、内容回执和单独的 native operations；`plan` 的 expectedRevision 来自当前 task，`advance` 的 expectedRevision 来自 plan。推进只记录 authorized_check checkpoint，不执行步骤、不调用模型。在途或 unknown 仍显示 reconciling_unknown，无重发。提交和验收按以下字段发送，digest 必须替换为完整原始 artifact 的 64 位小写 SHA256：

```json
{"command":"submit","operationId":"manual-submit-1","expectedRevision":1,"expectedAuthorityEpoch":1,"artifactDigest":"替换为完整文本 SHA256","evidence":"显式内容审查依据"}
{"command":"accept","operationId":"manual-accept-1","expectedRevision":2,"artifactDigest":"同一完整文本 SHA256","acceptanceVersion":1,"outcome":"inconclusive"}
```

revision/epoch/version 从当前回复读取，不固定为示例值。outcome 可为 passed、failed、inconclusive；成功 submit 将 task.revision 加一，accept 再加一。也可将下文 helper 的 payload 转成这两帧：移除 taskId，附加 command/operationId/expectedRevision；taskId 由 app 的既有 execution creation binding 取得，stdin 不允许选择其他任务。证据字符串最多 4096 UTF-8 bytes、计划最多 20 步，整帧仍限 8192 bytes。相同 operationId 的 payload 或 expectedRevision 改变均拒绝；foreign plan、旧 revision/epoch、错误 digest/version 不能写入验收。

这些命令复用已有 native-owner 私有 capability/grant，scope 仍为 owned-text-sessions，不创建 human root。submission.producer 和 acceptanceCheck.actor 为 host；publicHumanAuthorityVerified 仍为 false。内容 passed 仅将 task responsibility 标成 verified，submission.nativeExecutionVerified 仍为 false；不改 native UNKNOWN、usage、receipt、预留或原 ID。提交导致 task revision 改变后，旧原生绑定的后续 dispatch 仍按既有 task_changed 守卫拒绝，不自动刷新 binding。显式 resume 可读取原内容和 native 回执，不能把恢复当成重新授权执行。

关闭后显式重新启动同一个 Home：

```sh
DSH_HOME="$OWNER_HOME_DIRECTORY" "$OWNER_RUNTIME_DIRECTORY/node_modules/.bin/dsh" \
  --profile dsh-bot-owner --resume
```

恢复前只读核对 canonical Home/state/Session 路径、SQLite sidecar 和 lock 链接、产品 binding/owner fence、原生 journal format/identity/capacity/digest/targets，以及两条实际 Session artifact 的 header/存在性。不完整或不匹配状态在 writer 前拒绝，不修 grant、不迁移、不自动重发。Session 路径检查上限为 256 个 entry、16 层；此独立 Home 仅支持本片两条 Sessions，不作已有 Home 导入。完整原生日志语义仍由 core 在正常恢复时检查。

原生日志可在有效结算后记录本地清理或消息投影错误。此时 state 仍为 settled，receipt/usage 保留，owner 回复的 errorCategory 非空；调用者必须同时检查错误类别，不能仅凭 settled 判成功。消费端只记录 1–128 个 ASCII 字母、数字、下划线或连字符组成的字符串错误码，其他值记为 NATIVE_CONSUMER_FAILURE；公开协议也过滤历史非法类别，不输出错误对象或原始消息。`close` 的 closing 回复只表示关闭请求已接受，完整验收还须检查实际进程退出、IO receipt 与清理错误。

EOF、close 或 native plugin disposal 撤销输入准入；disposal 的同步 fiber 状态转换先于异步清理。EOF/close 在请求进程退出前等待同一次 controller/native close，然后关闭产品 ledger；清理异常输出 command=close 的安全错误类别并请求非零退出。入口最多等待五秒，超时报 owner_cleanup_timeout；启动器随后保留原有五秒或重复中断强制退出边界。强制退出不能证明远端取消、完整清理或 unknown 释放。下一次显式 resume 查原 ID，不替换不确定操作。

`--enable-model-requests` 是每次显式启动的功能开关，不持久化。启用后的文本 drive 走已有 native controller/Session/provider，固定 `deepseek-official` / `deepseek-flash`、reasoning off、官方 Anthropic base `https://api.deepseek.com/anthropic`、retry=0、contact maxTokens=160、execution=600。只有已有 provider 正常凭据引用通路在 dispatch 时解析 `DEEPSEEK_API_KEY`；app/安装脚本不读取或保存 key。本轮没有运行这个付费入口，也没有为验证注入 key。

## 支持与证据

| 能力 | 当前证据 / 限制 |
| --- | --- |
| 实际 profile、两条持久空 Session | 官方 launcher + 固定候选单根组合实际启动；model tools=0 |
| prepare/admit/inspect、原 ID/冲突检查、发请求前 stop | 实际 native CLI 零模型验证；pre-stop fenced，释放未使用 reservation |
| progress/plan/advance/submit/accept | 本轮实际官方 rc.2 CLI init/resume 两进程完成手动内容闭环，均 exit 0/IO 全零；新增控制 7/7，受影响 Owner native fixtures 31/31（实际组件，外部 transport/auth 合成）。UNKNOWN/usage/预留/原 ID 冷恢复保持，未增加真实质量请求 |
| close、EOF、关闭异常、显式冷恢复 | 修正平台的真实 CLI/SQLite/JSONL + 合成响应：正常退出 0；关闭前后异常与挂起退出 1；原 ID 和有效 receipt 冷恢复保持 |
| exact-fiber 与 JSON caller 拒绝 | 实际候选 Cordis 测试；公开 plugin execute 仍拒绝；无认证人类 claim |
| 等待期间 inspect/stop、在途 unknown | 真实 CLI/OS exit17 与 SIGKILL，各两次冷恢复原 ID；unknown/null usage/held reservation 保留，自动和显式重放均为 0；SIGKILL 缺最终 IO 清理证明，仍未确认。外部 auth/响应为合成，本阶段无真实 API |
| Bot 模型选择、多 Bot/群/会议、归档恢复、工具/自然语言调度 | 本入口不提供；六个一般产品发布门继续未通过 |
| 普通 SDK/浏览器人类入口 | 宿主授权链缺口仍在；Gateway peer 不等于人类身份 |

实际零模型 runner：

```sh
"$NODE_BINARY" "$PRODUCT_SOURCE_DIRECTORY/scripts/verify-owner-profile.mjs" \
  --runtime "$OWNER_RUNTIME_DIRECTORY" \
  --evidence "$OWNER_EVIDENCE_DIRECTORY"
# 下列检查从产品目录运行，并分别遵守其隔离运行器前置条件。
npm run test:native
npm test
npm run check
```

runner 创建临时独立 Home，用真实官方 bin/profile 启动；子进程显式清空凭据/proxy 环境，cwd 为新 Home，fetch/network/listener/child 熔断并计数。每阶段单独保存 stdout/stderr、安全 JSON 回执和 IO receipt，失败也保留。产物 wrapper 测试的外部模拟与实际 profile 证据分开。不得直接运行 test 文件；npm start 是旧 review UI，会生成新 review token，不属于此入口。

云验收根为 `历史隔离位置〔dsh-owner-entry-acceptance〕`。profile-first 保存首轮真实 CLI help/init/resume；每个修复的 RED/GREEN 和装配失败均保留，最终快照另记 profile-final。旧两组共 12 个 SQLite/WAL/SHM 只作 hash 比对，不打开恢复、不改写。没有新增真实 API/模型工具调用、push/merge、生产配置或网络权限修改。

## 后续审查材料约束

P0-A 离线候选由 `scripts/prepare-quality-candidate.mjs prepare|verify` 读取可信参数选定的摘要、runtime identity 和模板，绑定 canonical path/原始字节 SHA、scope、实际 overlay patch 与公开 runtime 文件。复验返回同一份 text/frame，不授予发送权限；候选保持 PREPARED_NOT_SENT。事实中的59/52/104与恢复CLI8/8、独立3/3明确属于前序冻结 runtime，不能算新来源门的CLI验收。

现有 owner-app 可通过受信任的 profile 配置 `acceptanceSource` 路径组启用来源门；stdin 不接受这些路径。prepare 将 sourceVersion 存入原 nativeOperation。最终 provider guard 在 auth 等待后重新核对这个固定版本，重新生成的同文本候选也不能替代原版本。owner 启动时另捕获实际 launcher/native/owner/controller 的路径和 SHA，复验同时比对该快照、当前字节及候选所绑定的 runtime；运行新 owner 验旧 runtime 会拒绝。未配置来源门的普通 owner 行为沿用原接口，没有新命令、权限或模型工具。

以相同原 operationId 绑定材料 digest、完整调用/生命周期/最终 permit/持久化链、实际 native input 与 wire 比对、terminal/unknown/usage/receipt。明确材料总大小、逐文件覆盖和截断；容量不足应拒绝，不改发较小的有利样本。区分 source/static、离线模拟、实际 native 与真实 provider 证据。保留原两个不合格 review 输出和所有失败；不能因结论不利换样本或重跑选结果。本轮只改善材料要求，没有新模型审查请求。

## 内容验收与操作说明

`src/guide-acceptance.mjs` 的 `guideAcceptancePayloads({task,text,stopReason,automaticVerdict,semanticVerdict,executionEvidence,expectedAuthorityEpoch})` 是可信 Host 调用方使用的纯 payload helper。它不增加 owner stdin 命令或身份能力。artifactDigest 是完整原始文本 UTF-8 字节的 SHA256，不 trim；显式语义审查必须同时绑定这个 digest 与现有 acceptanceVersion。恰八项、完整三列及 --init/contact/stop/unknown 的字面检查只作前置条件，词面 passed 不会自动成为内容 passed。max_tokens 无论人工结论如何都记 inconclusive，不触发 retry；旧两份指南 FAIL 保持。

返回的 `submitTask`/`acceptTask` payload 和 `expectedRevisions` 交给原有 Host 命令；当前 grant、任务 revision、artifactDigest/acceptanceVersion 的检查继续由 Host 执行。只有 submitTask 接收并校验 expectedAuthorityEpoch；acceptTask 沿用已有 active grant/revision/digest/version 检查。helper 不持有 actor 或 capability，也不创建 ledger。

`content.outcome` 与 acceptTask.outcome 只表示内容三态；`execution` 和 `overallOutcome` 另列。内容 passed 可与 native unknown 并存，任务的 verified 责任标记不代表 native 结算。整体 passed 还要求 known settled、有效完整 receipt、known usage、无本地错误，并且同一原 operation 输出的恰一条 answers 原始文本 digest 与当前 artifact 一致。缺失或不同的执行输出只能整体 inconclusive。内容失败、待确认及记录验收都不改原生 state、receipt、usage、unknown 或预留。

`src/operation-explanation.mjs` 的 `explainOperation(operation,observations={})` 只解释可信的产品/native 行或既有安全 owner projection。所有 safeOperation 回复及 status.operations[*] 增加 `explanation.operation`、`explanation.cliExit`、`explanation.cleanup`。owner 进程内没有未来退出事实，后两项保持 UNCONFIRMED；父级可把其真实 process/IO receipt 的 actualExitCode/actualExitSignal、io、readerThreadsClosed、records 传给同一 helper。模型 answers 不参与结算或清理升级。

有效 native receipt/usage 与退出非零、cleanup UNCONFIRMED 可同时成立；closing ACK 和 parentSentSigkill 请求都不是退出证明。实际退出信号或 Python -9 可证明被信号终止，不能推定 finally。实际普通 exit、匹配 IO exit receipt、零 IO 违规计数及 reader 完成至多记 OBSERVED_LOCAL_COMPLETION；fullOsCleanupProven 仍为 false。writer lock 释放与原 ID 重开只按父级明确观测另列，SIGKILL 的最终 IO 保持未确认。新字段不授权发送、不改变停止或恢复规则。
