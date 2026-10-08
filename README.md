# DSH Bot 原生插件

DSH Bot 面向**已经安装并正常使用官方 DSH 的用户**。目标是在 DSH 内创建具名 Bot、延续每个 Bot 的记忆、管理会话和任务，并进行内部群聊、会议和协作。

**当前状态：原生插件第一版设计待审阅，产品调整及整体验收尚未完成。** 现有私有候选的可用链路依赖单独 profile 和修改过的 Host；它属于历史实验，不能作为“安装到官方原版 DSH 即可使用”的证明。

## 第一版的使用方式

- 在 DSH 侧栏的 **Bot 工作台**创建、命名和管理多个 Bot。
- 新建 Bot 会话时，选择**已经创建的 Bot**开始对话。
- 每个 Bot 有自己的长期记忆，管理自己的会话和任务；新会话自动带入身份、相关记忆和未完成任务，并按需查阅自身历史。
- Bot 之间默认只读；工作台可限定共享范围，授予只读或会话/任务控制权限，持续有效且可撤销。
- 长任务在原生工作会话中执行，Bot 同时继续联络、查询、调整、停止并回收结果。
- 第一版同时包含多 Bot、内部群聊、会议、任务协作，以及统一管理、可恢复归档和每 Bot 独立模型配置。

## 宿主与安装边界

产品通过官方 DSH 的插件机制安装、配置、启用、禁用和卸载。DSH 负责模型、凭据、Agent、Session、工具、审批、沙箱和日志；插件负责上述 Bot 业务。

插件安装不修改 DSH 本体，不分发另一套 Host/SDK，不要求启动独立应用。正式安装命令和下载包会在官方原版 DSH 的完整安装及 GUI 验收通过后发布。

## 设计与进度

规格和后续调整位于[原生插件调整分支](https://github.com/86cloudyun-afk/dsh-bot/tree/goal/native-dsh-plugin-v1-20261008)。默认分支目前保留历史程序代码，本轮更新仅更正产品说明。

请先阅读[中文原生插件第一版设计](https://github.com/86cloudyun-afk/dsh-bot/blob/e23a45b0506e0cf9a9aa6dbefd96b045882f82f3/docs/superpowers/specs/2026-10-08-native-dsh-plugin-v1-design.md)。它包含已确认需求、模块与持久状态、日常流程、共享权限、群与会议、旧源码处理和 **P01–P21 整体验收**。

后续按以下顺序推进：官方插件接入及基础合同 → Bot/记忆/会话 → 任务与持续联络 → 群聊/会议/协作 → 两平台安装、GUI、回归与分发审计。阶段完成不代替正式第一版交付。

## 历史资料

- [v0.2.1 历史需求提取](https://github.com/86cloudyun-afk/dsh-bot/blob/e23a45b0506e0cf9a9aa6dbefd96b045882f82f3/docs/spec-v0.2.1.md)：不等于 Library 后续版本的完整正文；本轮确认的产品边界优先。
- [历史 Host 能力核对](https://github.com/86cloudyun-afk/dsh-bot/blob/e23a45b0506e0cf9a9aa6dbefd96b045882f82f3/docs/host-capabilities.md)和[历史类型兼容说明](https://github.com/86cloudyun-afk/dsh-bot/blob/e23a45b0506e0cf9a9aa6dbefd96b045882f82f3/docs/types-and-compatibility.md)：需要区分官方原版、私有 SDK、静态依据和实际验证。
- [历史候选 Release](https://github.com/86cloudyun-afk/dsh-bot/releases/tag/v0.1.0-private.1)：保留资产及限定证据，已由新的原生插件路线取代。

历史独立安装脚本、loopback review UI 和私有 native 测试不能作为新版插件的启动教程或通过记录。包元数据目前仍为 `0.1.0-alpha.1 / private`；新设计不是已发布产品。仓库保持当前访问范围，PR #1 保持未合并。
