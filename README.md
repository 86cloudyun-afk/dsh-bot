# DSH Bot · 官方 DSH 原生插件

在已有官方 DSH 中创建并命名多个 Bot，为每个 Bot 保存独立记忆，管理自有会话和任务，通过可撤销授权协作，并支持内部群聊与真实会议。

**当前状态：规格已批准，按 goal 模式实施中，正式 v1 尚未交付。** 完成前进行多轮、多角度复审；正式交付需通过官方原版 Linux/macOS 安装、GUI、真实模型闭环和最终产物审计。

**旧独立软件版完全作废。** Host 装配、SDK 覆盖、owner 启动器、专用 Home/profile、旧安装器和独立网页不再使用。历史 Release `v0.1.0-private.1` 不是插件，请勿用于安装。见 [作废说明](docs/history/standalone-void.md)。

- [已批准产品规格](docs/superpowers/specs/2026-10-08-native-dsh-plugin-v1-design.md)
- [实施与复审计划](docs/superpowers/plans/2026-10-08-native-dsh-plugin-v1-plan.md)
- [插件安装说明](docs/install.zh-CN.md)

插件直接复用 DSH 的模型、凭据、Agent、Session、工具、审批和日志，不分发宿主。新建 Bot 会话从已创建的 Bot 中选择；每个 Bot 管理自己的会话和记忆。跨 Bot 默认只读，可在工作台设置共享范围、只读或控制权限，授权持续有效且可撤销。

首版同时包含六项需求：统一管理、可恢复归档、多 Bot、每 Bot 模型配置、内部群与会议、长任务期间持续独立联络及短任务并发。每 Bot 父工作、一级子工作和未结算 UNKNOWN 共用 15 槽。

开发分支：`goal/native-dsh-plugin-v1-20261008`。旧路线及旧通过记录不计入原生插件验收，PR #1 不合并。当前仓库为私有；正式发布状态以新插件验收报告和 Release 为准。
