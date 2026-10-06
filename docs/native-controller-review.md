# 私有 controller 独立审查与修复记录

独立只读审查针对 d9501d5e37008c9e9f019c8a04b4e66e3cb844cc 后的整片产品改动，包括未提交的新 controller、声明、实际构建产物测试及说明。reviewer 为 fresh-context 独立 agent，无 live provider、凭据读取、文件修改或测试重跑。初轮确认 103 control / 9 artifact integration tests 的日志，发现以下 2 个 P1 和 5 个 P2；发布与公开人类入口一直未声称通过。

| 发现 | 修复 | RED→GREEN 验证 |
| --- | --- | --- |
| P1 空白 flush/readback 失败仍可由 memory proof 回 `created` | 只有已成功 durable readback 的 driver 可 inspect，inspect 再读实际 header/events | failed blank flush or readback cannot become a created acknowledgement from an in-memory fallback |
| P1 operation deadline 在准备时丢失 | deadline 持久化；admit/drive 与 final guard 对 exact active product operation 复查 | exact product operation deadline is rechecked after authentication before provider dispatch |
| P2 product 接受超过固定 native 的输入与 ID | 输入上限 4096 bytes；product IDs 以 ledger identity+ID digest 映射 native/control IDs | native text size；mapped operation and control identities |
| P2 owner disposal 仍留权限及 writer | 注册 Context effect，卸载同步禁用，再关闭 native host；同一个 root fiber restart 也不能恢复旧 controller | owner disposal invalidates retained controller and releases its native writer |
| P2 failed startup 泄漏 writer/部分 driver | pending startup 由 owner cleanup 等待；startup catch 回滚 host、driver、durable-proof marks | missing factory startup；second Session cold-resume failure |
| P2 await 前 product 快照可抹 stop link | native projection 在 product transaction 中重读最新记录 | drive projection preserves a product stop link committed while the response was pending |
| P2 cold startup 未投影 native unknown | restore 后先查 authoritative native operations；gate 也直接检查 Session unknown | startup reconciles a stale product driving row from authoritative native unknown |

修复前的 18 项运行：9 passed / 9 failed，覆盖上述具体触发条件。一次修复 pass 后 18/18 passed；外部 provider auth/HTTP 为 fake，实际 product Host/controller/creation driver、Cordis、opaque factory、native journal、Session 与 durable readback 均运行。没有第二次 reviewer 重审；修复以对应 RED→GREEN 回归及原控制层 suite 为依据。没有未处理 minor。完整用户产品六项硬需求、普通 startAttempt、多 Bot/群/会议、动态模式 revision、工具 scope、公开平台人类认证和发布门仍单列未完成。

Ruling：沿用已隔离 cloud worktree；云端是唯一 writer，先前“等待 Mac”归属错误已纠正，不再据此暂停。Ruling：固定候选 native admission 的输入限额为 4096 bytes，真实 review packet 相应缩小；不改 core。Ruling：固定 execution target 的输出 cap=1200，contact=160；最多四次请求的总输出 cap=3760，未绕 final guard 临时改 wire，停止后的用量可为 unknown。

新增私有 entry 的 NodeNext strict consumer 以 skipLibCheck=false 检查。初次额外导入既有 `dsh-bot` 根 entry 时遇其既有 exports 缺 types branch 的 TS7016；缩小 consumer 到本片新增 native-controller entry 后再验证。根 entry 的 NodeNext 问题未在本片修复，不声称整个旧包类型发布面通过。

## 真实验收结果与预算回归

实际加载产品提交 b6bfc60a64763b95e10b606e70ddb2de2f108ab0 与固定 core 3fbedc25d3626caf4e401b14c31a7f0326a19ec7 的构建产物。零 HTTP 预检创建并验证两个 durable blank protected Sessions。随后唯一真实 launcher 发出 2 次模型请求，均 HTTP 200、实际模型 deepseek-flash、各一 provider attempt，并形成真实 Session receipt：主审查 1116 input / 1096 output / 2212 total；独立 contact 33 / 73 / 106。contact 接纳时 execution transport 仍 open，两个 Session 不同。

第三个产品操作在 native admission 被 HOST_CAPACITY_BLOCKED 拒绝；原生 journal 没有该 operation，0 HTTP。验收 launcher 错将 lifetime execution/contact token 总额各设成单次 reservation 的 20000；core 永久记账已结算用量，contact 剩 19894，不能再预留 20000。该错误属于验收预算设置，不是 API/auth/proxy 失败。遵守拒绝即停，未继续请求、重放、更改原 journal capacity 或换认证/网络路线。原产品记录保留 unknown；零 HTTP 的新运行时冷重开验证两份已知真实 receipt/usage 完整，拒绝原 ID 仍 unknown，contact 新准备被 outcome_unknown 阻断。真实新 followup 和在途 stop 未运行，不能声称四阶段通过。

新增 lifetime-budget 回归先失败（fixture 未接受指定 budget），再使 fixture 可注入独立测试 capacity；19/19 artifact integration tests 通过。单 reservation 总额复现同一 HOST_CAPACITY_BLOCKED，增加 headroom 的 fresh fixture（execution 60000/contact 40000/reservation 20000）可完成审查、contact、请求前 stop、reopen、新 followup、在途 unknown 与零重放恢复。外部响应仍是明确 fake，不能替代未完成的两次真实阶段。生产 implementation 未因预算问题修改。

真实模型给出两条候选意见，经过完整源码核对未直接采纳：其一声称 creation inspect 绕过 deadline/durability，但 SessionCreationDriver 在 inspect 前后均对 creation deadline/authority/config fence，inspect 本身要求 durable-proof mark 并读 persisted blank header/events；operation dispatch 只能发生在 creation 已 created 之后，不能用 dispatch deadline 推导其创建失败。其二要求产品 unknown 永远不允许被精确原 ID 的已知 native receipt 更新；这会阻止明确允许的只读 authoritative reconciliation。真实 native unknown/intent 仍被 Session-level gate 直接阻断，原生 journal 不会无凭据回退为 admitted。两项都没有建立可达的违规 trigger，保留原审查文本与核对结论，不按猜测更改 controller。

## 最终独立审查与有界补充验收

用户明确授权在新隔离 journal 继续原剩余最多两次请求。配置各 maxTokens=600、零工具、retry=0、单请求 30 秒。每 step reservation=20000，新 execution lifetime=40000，contact lifetime=20000 且不请求。累计 reservation 为 2×20000=40000，只有一个 execution slot；首轮 known usage K 后第二轮需 40000−K≥20000，实际 K 不满足则停止，不能改 budget 绕过 refusal。此确切配置由新增 artifact regression 验证：首轮 settle、第二轮 admit/inflight stop、unknown reservation held、只读 reopen 与零重放。旧 journal 的 HOST_CAPACITY_BLOCKED、预算与回执保持原样。

独立 fresh reviewer 对提交 4256d8fa1bc7c843a1ddd5e2ff11db1b2d02a27b / tree e28726fc494da743e876c57da0743da977698522 再核对最终 guard、durable creation、stop fence、unknown recovery 与生命周期，只发现一个 Important：controller 缓存 rejected closePromise，native LOCAL_SETTLEMENT_UNKNOWN 后即便任务后来完成本地 drain 也不能再次释放 writer。core 原生 close 本身支持安全重试。先以忽略 abort 的离线 transport 复现（21 项：20 passed/1 failed），再仅于 rejected promise 时清理缓存；#closing 与 invocation denial 保持，native writer 只在真实消费者 drain 后释放。21/21 artifact tests、103/103 原测试、35 modules static syntax 通过。没有强制解锁或把本地 drain 当远端已结算。

历史两提交的 package/src runtime 文件完全一致：b6bfc60a64763b95e10b606e70ddb2de2f108ab0 / tree d4d0aea0fc4ba765a8d875e9a43a1371b30ffc4e，与 4256d8fa1bc7c843a1ddd5e2ff11db1b2d02a27b / tree e28726fc494da743e876c57da0743da977698522。此次关闭修复则明确改变 native-controller.mjs，不能称新候选与历史 runtime 完全一致；其余 package/src 文件不变。新候选需重新固定 hash 后加载，不替换 installed runtime。

任务质量与 transport 独立判断。前轮主审查确实返回结构完整的两条意见与验收检查，但两条意见均未证明当前代码的可达缺陷，因此不判 actionable review 内容合格、不应用建议。前轮独立 contact 给出绑定/配置副作用与持久回执一致性两点，短中文、相关、零工具，符合该联络任务要求。补充 followup 的内容标准为：一项有源码证据/可达触发/后果/最小修正/验收检查的判断，或明确证据不足且给出具体可执行验证；HTTP200 alone 不满足。最后 stop probe 的标准为实际请求发出、durable fence 在 abort 前、unknown/已知回执分类真实、reservation 正确保留和零 HTTP 冷恢复，不声称取消任务完成了模型审查。
