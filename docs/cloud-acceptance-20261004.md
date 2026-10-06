# 云端阶段结果（控制 alpha；未发布）

冻结来源：私有 `backup/mac-handoff-20261004`，HEAD `13d1fb15c0dbb59434ae066fb2b5a56e90d8b683`、tree `606baa9a7286466389fdb1455860c29c8e28c652`。该 ref 仍只读。唯一开发 worktree 为 `历史隔离位置〔dsh-bot-development〕`；最终 local candidate HEAD/tree 在 `历史隔离位置〔cloud-candidate-receipt.json〕`，本轮不 push/PR/merge。

四个移交 RED 均已修复：归档恢复 fence 旧 Task/Delivery、旧会议 Bot obligation 失效、pendingRevision 禁止旧条件提交/验收、跨标签页 prepare 不产生两份操作。另修 UI unknown 在折叠详情外醒目显示，所有状态维度保持可见。完整 Node permission/无网络 guard **67/67**，静态 **25 模块**；真实浏览器仍未测。

独立 **GPT-6.1 Sol/xhigh** 只读审查的七项发现已逐一复现和修复：持久账本 instance 绑定、verified 责任下未结算 Attempt fence、成员撤销保留 unknown、retry 不新建身份或改绑、旧 canonicalVersion1 兼容、并发初次实例初始化、终态投递历史保留。最后复审无剩余 P1/P2；另有四项 app 级合成 DOM/HTTP 回归。详见 [审查证据](evidence/cloud-20261004/review.json)。

| 实际测量阶段 | 结果及限制 |
| --- | --- |
| 固定平台/最小 API | Node 24.19.0，DSH npm实际0.2.0-rc.2；官方 tag commit 639ed015397290b3745d163aafe02ffee4aa3f84。deepseek-official/deepseek-flash 真实最小请求 completed，32 tokens，1.58 s |
| 原生脚本诊断 | 非公开 ctx.scope 改为 scopeOf；补必填 source:{kind:user}。旧错误日志原样保留，冷读 corruption；它不是 key/403/网络错误。合法新日志 cold read/resume 完整，实际前答逐字回忆成功；请求的固定 seed 口令格式未符，单列 false，不反复试到通过 |
| 会话模型 | A low 真实请求成功，B standing selection off，default off；显式保存 default low 后冷读仍 low，独立 control Home off。不是最终 Task/grant dispatch freeze，也没有另发 B 的模型请求 |
| 并发联络底座 | A first text 后发 B 的真实算术请求；B在3.094 s完成，A在3.217 s完成。一次零工具双 Agent 样本，不是候选 Bot contact、长工具占用或p95证明 |
| cancel/归档/恢复底座 | running archive 被 workspace/session-active 拒绝；cancel 后 aborted、idle，再 archive/unarchive；dispose 保留日志，resume新真实回答成功。取消 usage未知，不声称 provider退款、槽位释放或整树已停 |
| 真实候选插件加载 | 真实 Cordis fiber 上注册 dshBot 服务、卸载移除并关闭账本；没有新增模型工具。execute仍 unsupported_host_identity；snapshot nativeRuntimeVerified=false/releaseReady=false |

共 **9次**有目的真实文本请求；8次返回可记录usage合计 **1042 tokens**，1次取消usage未知。maxRetries=0。没有私有源码或用户资料进入模型请求，没有读取/打印/保存 key，没有生成新认证凭据，没有公网服务、生产或系统安全配置修改。

完整 Bot 单机闭环仍被 caller、durable admission、最终 epoch/scope dispatch、精确 run stop/settlement、共享 interaction capacity 阻断。计划/权限模式仍为 null，持久目标仅按事件推进，unknown不重放。F01–F28/U1–U8 **没有一行完整原生 PASS**；实现、局部测试、底座测量、unsupported和unmeasured分列于 [矩阵](acceptance-matrix.md) 和 [精确测试映射](test-evidence-map.json)。

[下一片最小设计](superpowers/plans/2026-10-04-native-loop-next.md) 已给主控审定：公开扩展先做会话/观测/模型/具名来源/零工具隔离/独立contact；隔离官方源码副本再补K1最终dispatch guard、K2准入journal、K3run/resource barrier、K4共享容量，K5逐工具实际scope仅后续批准时启用。明确每项接口、不变量、故障点和有界实测顺序。尚未修改 core。
