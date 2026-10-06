> 历史独立复审的脱敏副本。结论绑定本地9a8915源码/原190文件map；不是后续候选完整验收。仅隐藏内部绝对位置，原报告字节不随候选分发。

# UI fixture 对齐的限定范围独立复审

结论：**PASS_SCOPED_UI_FIXTURE_CONTRACT_ALIGNMENT**。未发现阻断此次测试 fixture 对齐或其本地源码 checkpoint 提交的重大问题。当前 **releaseEligible=false；整体发布审计未通过**。此报告不替代公共路径、B 类依赖、license、lockfile、启动路径、native settlement 或 private fixture 的独立发布审计。

实际复审于 UTC 2026-10-06 12:23 开展。只读指定冻结 checkpoint 的源码身份、两份测试 delta、原断言和现有执行证据；未导入或运行测试/runtime，未调用模型/API/SQL，未读取 Home、环境或凭据，未修改产品、候选或既有封存记录，未执行 Git mutation。

冻结目录 `历史隔离位置〔dsh-bot-release-source-closure-20261006〕`，实际 HEAD `fc72db583150015a2a22750d93aff651d34d5924`，为尚未提交新 overlay 的基底。

| 冻结证据 | SHA-256 |
| --- | --- |
| final checkpoint manifest | `841b840a2dc5015caccfaf21445284e050872e5b354602210d0b57b2a689f0ee` |
| review handoff | `1176fa81c1933ffa341a90f61d59947b36443a9a18f273ee13e38bbb2539b90d` |
| minimal diff | `b580558134777c6a2d772ce096bfed60892d5b7e8d41360a91e52b72bc58b864` |
| 190 文件 canonical source hash map | `ef7616858d2910fbb81f5bf49adae66267ec448c79b9c74b80e7b8b8f969cd71` |
| `test/ui.test.mjs` | `5acc808bbaf5438550f97c4725e464d0f9b72fe3ac81f501cfdf8d24efd650d2` |
| `test/ui-ledger-identity.test.mjs` | `95fb8095eb7f79b3ba0e0c742742f330d17b11def0f291d13981dbb6d04f830e` |

独立重算 manifest 指定的全部 190 份源码哈希，逐项匹配冻结记录，并重算 canonical map 摘要一致。相对原 189 文件 map，仅修改 `test/ui.test.mjs`、新增 `test/ui-ledger-identity.test.mjs`，无缺失路径，其他 188 份源码哈希保持一致。此操作仅用于精确 source identity；没有扩展为源码内容的全局隐私或许可审计。

两处原 fixture 现在先创建隔离 Host，再将该 Host 的真实 ledgerInstanceId 提供给 prepareCommand；并保留/补足 fixture 关闭。机械撤销这些指定 fixture 编辑后，原 UI 文件与保存的 189 checkpoint 字节完全相同。5 个原 UI 测试名及 18 个断言调用正文逐字节一致，其他原测试文件也保持原字节。不存在删除测试、改弱断言或增加 production fallback 的修改。

新增负例有实质验证作用：无 ledger identity 时拒绝且尚无 pending persistence；将 A ledger 的真实 envelope 提交给 B ledger 时拒绝，B 的 objects/operations/observations 前后相同，pending operation 保持，两个 fixture 在 finally 中关闭。此例只使用隔离 synthetic fixture，不伪造历史账本或恢复记录。

既有 RED 日志 SHA `589f61d4bc438f127260c2b6594415a143d40605ec4cc81f08e46379f4d20d68` 与 receipt 一致，保留其 66/68、exit 1 的真实结果。两次 ledger_identity_conflict 出现在 prepareCommand、早于原断言调用；此次通过补齐真实 fixture 身份使原断言实际执行，没有通过弱化身份边界消除失败。

| 现有执行证据 | 已核对的结果 | 日志 SHA-256 |
| --- | --- | --- |
| 原 68 项加新增负例 | exit 0；69/69；0 fail/skip/cancel | `ebbe4cfa7cccade3b490f2ea265ff619c981cb82d57abeeac49776e8e940ef05` |
| runtime UI + actual Loader client 的 synthetic 回归 | exit 0；27/27；0 fail/skip/cancel | `f13f7f770d7c85e2742e21962c41040c9d928634f5b1507b374c3d9d402fc604` |
| 两份受影响测试的 syntax | 现有 static proof 均 exit 0 | proof hash 见相邻 JSON |

两份 GREEN 日志实际字节、结果计数及 receipt 中执行测试文件 hash 均与本冻结 checkpoint 一致。这是已有 offline 执行证据的独立核对，复审者未重新运行测试。synthetic React/transport 和 Loader client 覆盖不能作为 authenticated browser 或真实 provider 证明。

全部 production 文件身份与前一冻结 checkpoint 一致，因此 owner/ledger 防御、usage acceptance/cost/UNKNOWN/cancel、权限及安全边界均未因本次 fixture 对齐变动。原 private JSON 排除与 dependent acceptance 的 BLOCKED 状态继续保留；原 189 manifest 未修改，其旧 canonical hash 仅绑定旧快照。

相邻 `release-ui-alignment-independent-review.json` 保存精确字节、断言、source identity 与 receipt 核对证明。限定 gate 允许沿用户授权继续本地 checkpoint 处理；不能据此提交远端、发布或宣称完整 release GREEN。

> 原报告所称相邻完整proof JSON不随此候选分发。当前仅提供 ui-fixture-alignment-20261006.provenance.json 的明确脱敏摘要和原字节hash；两者不能混同。
