# 发布可移植性：限定独立复审脱敏副本

本附件绑定9a之后冻结的195份源码（canonical map见相邻provenance），包含原partial报告与随后当场绑定的exact6 GREEN补充。附件自身不在原195 map或该6项执行范围内。仅隐藏内部绝对位置及操作身份；保留原结论、时间、来源hash、旧RED局限和当前GREEN证据。不是原报告原字节；未分发日志、原diff、Home或真实历史fixture。

**releaseEligible=false；公开发布/完整原生功能门未通过。** final gate仅为PASS_SCOPED_PRIVATE_SOURCE_PORTABILITY_EXACT_CURRENT_SIX_GREEN。当前exact6补充不追溯改写旧RED/旧GREEN的当场source绑定缺口。

## 原partial报告

# A 副本 portability 增量的限定独立复审

结论：**PASS_SCOPED_PRIVATE_SOURCE_PORTABILITY_WITH_PARTIAL_EXECUTION_SOURCE_BINDING**。未发现阻断此次用户授权的本地 checkpoint 和私有 source-only 分支交付的重大源码问题。运行时安装器 SHA 的绑定有下述明确限制。**releaseEligible=false**；这不代表公开 release、冷安装、完整产品或真实 provider 验收通过。

复审只读固定 9a 基底、新冻结源码、指定 diff、执行证据和脱敏材料；未运行或导入测试/runtime，未启动模型/服务，未联网安装，未读取 Home/ledger/key/环境值，未重跑旧 69/27，未编辑候选或执行 Git mutation。最终全局扫描由 root 负责。

## 精确来源

实际 HEAD/基底为 `9a8915c8f916cebdceee1e51a85e617c9c8f6712`，冻结目录为 `历史隔离位置〔dsh-bot-release-source-closure-20261006〕`，新 overlay 尚未提交。

| 身份 | SHA-256 |
| --- | --- |
| 195 文件 manifest | `48117ef5c695589f9be8d1ad66691d9cf15dd6ce7088dfdebe1b8c338119ea5e` |
| canonical source map | `746d393f044a99a4421ae1ecd33872bb95034f5af886a608694b9757f6329f44` |
| final diff | `31d5a450b1410a9a7db17b9e0aaa782c0513258e5777101be9b7037db430113d` |
| review handoff | `04be8acd0c00f07a0e8c1ae591bb685f8684c8897c92431e8dfb7fac0e84e735` |
| native profile installer | `9996c9638b897d7625bd746a86ea21dd4923965c9cdd2ad0596820641943b870` |
| 新 options test | `d5ce6728838bbe6d581644794852af37fd386047af03d5a086c4d960a0f2b531` |

独立读取 manifest 白名单的全部 195 份源码计算 hash，逐项一致；canonical map 重算一致。17 changed、5 added、173 unchanged，无移除。diff 的 22 文件/32 hunk 逐项核对其固定基底及冻结后正文，全部一致。所有 src、ui、package.json 与 9a 字节相同；原 cold owner、owner/ledger 身份、usage/cost/UNKNOWN/reservation/cancel 防御均保持。

## 语义与测试审查

native installer 不再默认历史 Bot/main Session/digest。captureBaseline 在任何文件 await、mkdir、write 前同步运行；要求恰三个 own data property、字符串类型、小写 UUID/session-UUID/SHA256 格式，拒绝 accessor、额外字段及隐式强转，并返回冻结副本。调用者在后续 await 期间改原对象不会改 profile baseline。CLI 三个参数与中文安装说明一致，错误输出保留 opaque category。

这只是格式检查。格式合法但历史错误的参数仍须由原 cold owner 的实际历史 digest、ledger/Session、队列和 ACK 校验拒绝；本轮既未打开真实历史，也未声称安装器认证了它。没有读取真实 baseline、自动替换身份、回填 epoch 或重放 UNKNOWN 的新逻辑。

原 profile 测试只将两处内部 runtime 路径替换为新隔离 metadata 目录，并明确其不证明 SDK 安装。机械撤销这些目录替换及说明后，与 9a 原文件字节完全相同，原两测试定义和断言未减弱。新增四测试覆盖缺失 baseline 无写入、非法 baseline 无写入、只序列化调用者 synthetic baseline、await 前捕获。fixture 仅含新临时 metadata，不制造真实历史或启动 SDK。

现有准确 baseline RED 日志为 4/4 fail：两项 Missing expected rejection、两项 baseline 不同的 deep equality failure；最终 GREEN 为原两项加新四项，6/6、exit 0、0 skip/cancel。初次 options-red 的 6 fail 包含路径/权限 setup 失败，单独保留，不作为四项有效行为 RED 的替代。三份受影响源码 syntax receipt 均 exit 0。审查者没有补跑。

**运行源码绑定限制：** 首次 RED 与最终 GREEN 的 receipt 捕获了同一新测试 SHA；准确 baseline RED 的 installer 身份由固定 9a 与唯一 writer 的命令顺序事后重建，GREEN installer 身份由后续冻结 manifest 验证。两次执行均没有当场完整捕获 installer SHA，因此不能声称完整 contemporaneous execution-source attestation。补充 `release-portability-execution-source-reconstruction.json` SHA `dea69d027159d3214b0c0735276a9d38387ed91ab48882fc603db16a9afded47` 明确为 POST_EXECUTION_RECONSTRUCTION；原 receipt/index 没有被改写。此限制保留于 gate 和相邻 JSON。

## 文档与交付边界

14 份文档原有 44 个内部位置已处理：12 个可执行例子改成调用者参数，32 个历史位置隐藏。13 份纯历史变换文件在标准化位置文本后与基底完全一致；owner-entry 的条件式装配参数和警示另作语义复核。位置之外的证据 hex 保留，未改写历史成败。所有当前 docs 中无原内部 workspace 绝对路径。

中文安装说明和 README 保留 alpha/private 现状，区分 Node 内置离线控制、真实 Loader/client 和开发 Host/native 路径；明确缺产品 LICENSE、lock、打包 scripts/docs、依赖/冷安装与真实浏览器/native 门。dependency inventory 仅静态 literal specifier，未猜版本或补授 license。历史 UI 复审脱敏副本仅绑定 9a/190，原 report/proof 的实际 SHA 与 provenance 一致，不能当成新 195 或完整产品 PASS。

旧 sealed 源码/proof/证据保留；旧 69/27 仅为 9a 修正的历史结果。两份 private history fixture 继续排除，相关 acceptance 仍 BLOCKED。公开依赖权利、lock/build、独立冷安装、认证 GUI、实际自主闭环和精确 native settlement 等门继续未通过。原 raw_usage 请求仍 UNKNOWN/no replay，未以此轮打包改变状态。

相邻 `release-portability-independent-review.json` 保存字节、hunk、文档、原断言、执行限制及源码防御核对证明。本结论支持本次受限私有源码评估交付，不能替代 root 的最终扫描或授权公开上传/发布。


## 当场exact6补充

# 当前冻结候选六项 GREEN 的源码绑定补充独审

结论：**PASS_SCOPED_PRIVATE_SOURCE_PORTABILITY_EXACT_CURRENT_SIX_GREEN**。此补充与原 portability 独审共同支持用户授权的本地 checkpoint 和私有 source-only 分支交付；releaseEligible=false，完整发布/冷安装/认证浏览器/native settlement 门仍未通过。

唯一 writer 经父线程新授权，于 UTC 13:22:31 在当前冻结 195 文件候选上只重跑原两项 profile 和新四项 baseline 测试，exit 0、6/6、fail/skip/cancel 0。原 69/27 未重跑，models/service/networkInstall 均为 0。复审者未执行或导入测试、未读取 Home/ledger/key/环境值，未修改源码。

新 receipt SHA 为 `da5963c54a04e1dd0102ab64a390fbdc7ea1e30ddab9fb046bf15744564a6e8a`，日志实际 SHA 与其一致，为 `ca0996b7399719019d3e89d08f758cb544b850b2822fb34c5c5d0bb16ccbe00f`。日志六项结果与 receipt 相同。

独立核对运行前后捕获的 installer、两份 tests、runner、native safety guard 五份 hash，与当前字节及冻结 manifest 全部一致；前后 manifest SHA 均为 `48117ef5c695589f9be8d1ad66691d9cf15dd6ce7088dfdebe1b8c338119ea5e`，source count 均为195，canonical map 均为 `746d393f044a99a4421ae1ecd33872bb95034f5af886a608694b9757f6329f44`，与本次独立重算一致。此补充关闭当前候选 GREEN 的执行源码绑定缺口。

原报告及 proof 保持原字节，仍记录历史执行缺少当场 installer SHA 的限制；旧 RED 仍是固定9a/唯一writer命令顺序的事后重建，未被追溯改成当场证明。新 GREEN 只证明这六项 metadata fixture 的实际执行，不证明 SDK 安装、真实历史、模型、生产恢复或完整产品验收。相邻 supplement JSON 保存全部精确核对值。
