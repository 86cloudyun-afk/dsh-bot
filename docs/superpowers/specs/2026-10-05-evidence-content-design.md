# 来源一致性与内容验收设计

用户已批准将第二轮规划纳入并继续推进 Bot；执行方式为本线程唯一源码 writer、独立只读复审、离线 TDD。沿用已有隔离 worktree，不恢复已取消的付费单次调用。正式产品上传仍须首版实测，当前只更新同 identity 的审查交接包。

## P0-A：当前事实必须有可复验的来源

权威记录为 `dsh-cli-recovery-20261005/final-summary.json` 与 `runtime-identity.json`，不是旧 `actual-cli-fixed/results.json` 或聊天中的手填数量。当前证据为 core59、product native52、control104、最终 CLI8/8 与独立最终3/3，外部 provider 合成、本阶段 API0。旧候选的56/50复跑中仅作为历史保留。

新增一个纯数据来源模块和一个离线准备/复验脚本。读取路径由可信调用参数选择，不从候选自报路径读取。绑定 canonical source path、原始字节 SHA256、明确的 synthetic scope、runtime identity SHA、product/core overlay 的实际 patch SHA、launcher/native build/product runtime 文件 SHA。format=1 只是 schema 版本；base679a/3fbe不能代表未提交工作树。事实块由摘要字段白名单确定性生成；模式说明和八项任务原文不改写。binding 留在 modelInput.text 外。

复验要重读三个可信来源、两份 patch 和四个公开 runtime 文件，核对原始字节及当前事实/完整文本。缺失或改变则拒发旧候选，不回退旧缓存。返回实际核验的 text/prepare frame，调用方不得随后重读另一个候选替换它。该脚本没有网络或 run 功能，复验成功不等于付费授权；候选仍为 PREPARED_NOT_SENT。

在已有 owner app 配置中增加可选 trusted acceptanceSource 路径组，不从 stdin 接收路径或授权。已有 prepare 和 controller 的最终同步 provider guard 复用同一 verifier；auth await 后再次核验，来源变化时零 HTTP，不影响保留有效 receipt/unknown 的规则。不配置此路径组的普通文本行为沿用现状，不新增 owner stdin 验收命令、provider 权限或网络面。

## P0-B：结算与内容验收分别保存

复用已有 submitTask/acceptTask 及 acceptanceVersion/artifactDigest/outcome，不另建 ledger、DSL 或状态机。薄 helper 产生这两个现有命令的 payload；只有持有原有权限的 Host 调用方可记录。owner stdin 尚无验收命令，不将 helper 宣称为已有 owner 命令。

指南标准为恰好八项、动作/条件与预期/证据完整，正确 --init 与 contact 角色，stop 区分未发/已发，unknown 保留原 ID/预留/不重放。确定性结构与字面覆盖只给前置结论；完整语义须显式人工/授权审查结果。输出截断为 inconclusive，不自动 retry；历史两份 FAIL 不重写。执行 receipt/usage/state 独立保留，内容失败或 inconclusive 不改原生结算、不清 unknown。原 artifactDigest 或 acceptanceVersion 不匹配仍由现有 acceptTask 拒绝。

## P0-C：三项确定性结论

从现有 safeOperation/status 字段解释操作结果，并由父级观测独立解释实际 CLI exit 与 cleanup。有效 receipt 可与非零关闭和 UNCONFIRMED 共存；closing 仅是请求 ACK。模型自由文字不参与 state/结论升级，尤其不能将 unknown 提升成功。

新增纯 explainOperation 模块；owner 输出可附操作结论，尚未观测到的 exit/cleanup 明确保留。父级以真实 process/IO receipt 调用同一 helper。SIGKILL 不要求被杀进程 finally 执行；只测试父级子进程终态、writer 锁可释放与原 ID 重开等外部事实，未证范围保持 UNCONFIRMED。

## P0-D：收尾已知文档与类型缺口

使用现有锁定 pnpm11.7.0、Node24.19.0、官方 rc.2，不升级依赖或改变网络权限。补 deepseekProtectedProviders 服务角色分类，重新生成配置目录中英文及配对记录，修 fullhost source/lib 来源混用和三处旧 maxRetries fixture。逐项区分用户本轮变更、既有 base 缺口和执行布局错误；不把缩小检查范围写成全量通过。

## P1：下一阶段的小工作集

复用现有 goalDigest、evidence、eventCursor、sourceSeq、generation、freshness，在分派/恢复等关键点构造小工作集，并验证它实际进入真实 surface。此轮仅记录后续方案，不改 DSH loop、不加向量库/ledger、不增加 preset 跨重启冻结门槛。动态模型、公共入口与完整协作记录为未验收，不能笼统写不存在。

用户最新采纳的协作拓扑目标为：纵向任务发布与结果回传、横向同级咨询，以及任意有权单元的灵活沟通。通信关系不自动赋予执行权限或跨数据 scope。后续复用现有 task 版本、message ledger 和 acceptance，不另造 scheduler；父级独立设计线核对 task/message/Team seams 后再纳入后续小交付。本段只记录目标，不扩展当前 P0-B/C 实现。

## 全局验收与保护

所有步骤保持零真实 API、零新模型工具、零公网服务、零凭据值读取/打印/保存。76 保护文件、26701 原运行时文件、旧 preview/observer/两份指南与 unknown 证据不改写；新测试只用新 Home、临时数据库和明确 owned 子进程。源文件交付为固定 base 上可 apply 的 patch 与未提交工作树快照，不 push/merge/deploy。交接包替换同 Library identity，阶段证据与实际/合成/未证范围分列。
