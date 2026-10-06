# DSH Bot 候选源码

当前包元数据仍为 **0.1.0-alpha.1 / private**。`v0.1.0`、`v0.1.0-rc.1` 是拟议发布名称，尚不表示已发布版本或完整原生验收。此树包含持久控制账本、实际 DSH Loader 客户端与受限 owner 适配源码；DSH 自身负责 Agent、Session、模型与工具执行。

设计来源需区分：仓库保留的 [v0.2.1 历史提取](docs/spec-v0.2.1.md) 不等于当前 Library version 2 的 v0.2.2 正文，也不证明任一完整设计已经实现。当前交付与限制以源码、限定验收和[候选安装说明](docs/install-candidate.zh-CN.md)为准。

## 离线控制检查

Node 要求 `^22.19.0 || >=24`；已执行的本地候选检查使用 Node 24.19.0。独立 SQLite 控制层使用 Node 内置 `node:sqlite`，不需要外部运行时包。这不适用于 DSH plugin/client/native 入口。

在调用者自己的源码目录中执行已有脚本：

```sh
cd "$PRODUCT_SOURCE_DIRECTORY"
node scripts/test.mjs test/adapter.test.mjs test/autonomy.test.mjs test/collaboration.test.mjs test/control.test.mjs test/recovery.test.mjs test/safety.test.mjs test/ui.test.mjs test/legacy-meeting.test.mjs test/ui-ledger-identity.test.mjs
npm run check
```

文件选择必须与实际源码核对；[安装说明](docs/install-candidate.zh-CN.md)列出检查范围与依赖缺口。默认 `npm test` 会选择全部 `test/*.test.mjs`，当前部分历史原生验收数据未随候选分发，因此不得把限定子集 GREEN 宣称为默认全集 GREEN。

`npm start` 是旧 loopback review UI：会创建本地 SQLite 与 review token，不能作为真实 DSH Loader GUI 启动步骤。本阶段没有运行它。当前受限客户端具备选定 Bot 主目标提交、工作列表/详情/结果、原操作查询续接与 accepted-only stop；受信任 owner 安装、真实浏览器认证、完整功能验收仍须分别完成。

## 权限、恢复与验收边界

公开 `/dsh-bot` snapshot 是只读；`/dsh-bot-owner` 由私有可信 owner 绑定窄动作。浏览器不能提供 peer、caller、Host、epoch、provider 或能力。账本实例、operationId、nonce 与原始消息身份必须一致；UNKNOWN 先查询原身份，不换 ID 重发。

15 个工作槽与一级子工作约束有离线覆盖，没有15模型并发压力证据。请求停止 accepted 不代表精确原生停止或结算，UNKNOWN 的 reservation 继续保留。归档/恢复不能恢复旧 epoch 的提交权限。旧 schema1 会议任一参与者缺少可信正整数 botEpoch 时，在 submit/reveal 写入前返回 migration_required；无自动回填或真实账本迁移。

历史 [UI fixture 独立复审脱敏副本](docs/reviews/ui-fixture-alignment-20261006.md)仅绑定9a8915的190文件来源，不是当前全产品 PASS。[能力矩阵](docs/host-capabilities.md)、[工作会话](docs/work-sessions.md)、[公开类型兼容](docs/types-and-compatibility.md)与[owner入口](docs/owner-entry.md)继续区分静态、离线合成、实际宿主和真实 provider 证据。

完整发布仍需要可公开复现的固定 Host 依赖/构建、许可证闭包，以及独立新环境的真实 GUI→Bot→自主工作→结果、在工作执行中有意义主回复/续接、精确停止结算、非取消归档恢复、重启身份与历史一致验收。现有真实请求中 raw_usage UNKNOWN 未重放，也没有因此证明 A/B 并发或完整 producer 闭环。
