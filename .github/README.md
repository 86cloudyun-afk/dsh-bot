# DSH Bot · 原生多 Bot 插件

在你现有的 **官方 DSH** 中创建有名字、长期记忆和独立职责的 Bot。后台任务继续运行时，Bot 仍能聊天、接受新任务、查询进度和响应停止指令。

[下载插件包](https://raw.githubusercontent.com/86cloudyun-afk/dsh-bot/v1.0.1/dist/dsh-bot-1.0.1.tgz) · [校验文件](https://raw.githubusercontent.com/86cloudyun-afk/dsh-bot/v1.0.1/dist/SHA256SUMS) · [安装与上手](../docs/install.zh-CN.md) · [使用手册](../docs/guide.zh-CN.md) · [版本与验收](https://github.com/86cloudyun-afk/dsh-bot/releases) · [产品规格](../docs/superpowers/specs/2026-10-08-native-dsh-plugin-v1-design.md)

## 第一版包含什么

| 能力 | 日常使用 |
| --- | --- |
| 具名多 Bot | 在「Bot 工作台」创建 Bot 只需名称；职责选填、模型默认沿用 DSH。点击卡片“开始聊天”，或新建对话时选择已有 Bot。重名时用稳定 ID 区分。 |
| 各自的长期记忆 | 同一 Bot 的新会话自动带入身份、记忆与未完成任务；细节按需查阅自有会话。其他 Bot 的记忆分别保存。 |
| 持续聊天与后台工作 | 联络与执行分开；长任务未结束时，仍能回复新话题并运行另一个短任务。每个 Bot 的父工作、一级子工作和未结算未知任务共用 15 槽。 |
| 共享与持续授权 | 跨 Bot 默认只读；设置接收 Bot、共享范围及只读／控制权限。授权持续有效，可随时撤销。 |
| 任务闭环 | 登记、开始、查看原生执行、调整、接续、精确停止、投递结果和三态验收；归档后恢复原身份与日志。 |
| 内部群与会议 | 多 Bot 群聊；同群可同时开不同议题会议，先独立意见，再讨论、协调者决定和实际行动任务。 |
| 普通会话管理 | 分页查看普通会话及 Bot 会话；停止当前回复、归档和恢复，任务结果也可以投递到普通会话。 |
| 每 Bot 模型配置 | 从 DSH 已配置的模型中选择；联络和执行可分别配置，全局默认保持原值。 |

## 安装

兼容基线为 **官方 `@deepseek-ai/dsh@0.2.0-rc.2`**、Node **22（≥22.19）或 24 及以上**，验证平台为 Linux 与 macOS。官方插件安装命令需要 `pnpm`。

1. 从页面顶部的链接下载插件 `.tgz` 和 `SHA256SUMS`，核对文件哈希。对应 [Release](https://github.com/86cloudyun-afk/dsh-bot/releases/tag/v1.0.1) 提供本版源码和验收记录。
2. 将插件安装到你日常使用的 DSH profile。以 `web` 为例：

```bash
dsh plugin --profile web add ./dsh-bot-1.0.1.tgz --ignore-scripts --strict-peer-dependencies
dsh web
```

3. 在原有 DSH 侧栏打开 **Bot 工作台**，填写名称创建 Bot，然后点击卡片上的 **开始聊天**。原生工作工具默认可用，无需逐项配置。

完整的依赖检查、首次安装、升级和卸载步骤见 [安装说明](../docs/install.zh-CN.md)。版本是否正式交付，以对应 Release 的验收报告为准。

**v1.0.1 修复版**增加界面／服务版本检查和原操作只读查回，修复默认 preset 恢复、模型目录变化及多页面草稿覆盖。旧共享草稿不能重新打开已撤销的共享。已安装 v1.0.0 时，先按安装说明升级，再完全重启 DSH 并刷新浏览器；原 Bot、记忆、会话、任务及操作 ID 保留。

## 几个使用例子

- 「把这项工作放到后台。现在我们继续聊另一个问题。」
- 「查阅你自己的其他会话，告诉我还有哪些任务没完成。」
- 「让资料 Bot 只读查看进展；需要控制任务时，我会在工作台授权。」
- 「开一场会议，各自先提出意见，再讨论并把决定登记成行动任务。」

工作台的常用导航为 Bots、任务、记忆、协作、管理；特殊模型参数、任务调整与验收、群设置按需展开。工作台提供相同操作的可视入口。停止被接受后，界面会继续等待真实资源结算；结果已返回与验收通过分别记录。无法确认的请求保留为“未知”，使用原始操作查回。

## 与 DSH 的关系

插件复用 DSH 的模型、凭据、工具、审批、会话、日志和存储。安装包只包含插件代码和中文说明，不携带 DSH／Host／SDK，也不要求改写 DSH 本体或另建应用。

正式版本以同一不可变包完成两平台安装与 GUI 检查，另外保留真实模型和多轮独立复审证据。受控模型、真实模型和资源停止证据在验收报告中分别注明。

**此前独立软件版已完全作废。** 旧 Host 装配、owner 启动器、专用 Home/profile、独立网页和旧安装器退出运行及分发入口；本仓库只交付原生插件。见 [作废说明](../docs/history/standalone-void.md)。

## 开发与许可

```bash
npm ci --ignore-scripts
npm test
npm run check
```

源代码采用 [MIT License](../LICENSE)。DSH 及其依赖由官方安装管理，适用各自的许可；本插件不重新分发这些包。

## 本版验收

v1.0.1 同一冻结安装包本地通过 **178 项自动化测试**、**64 项官方原生 GUI 检查**和 **4 项 v1.0.0 升级检查**；两平台 CI 结果见版本报告和发布说明。本轮 GUI 使用受控模型，新增查回与升级检查未调用外部模型。

[完整验收报告](../docs/releases/v1.0.1-qualification.zh-CN.md) · [机器可读证据](../docs/releases/v1.0.1-qualification.json) · [两平台 CI](https://github.com/86cloudyun-afk/dsh-bot/actions/workflows/ci.yml)

插件 SHA-256：`e3eca64ca596c1609e5f447e2c0ba8e2e4a778bf0e583e22a07623e00c3fa1dd`。v1.0.0 的真实模型证据单独保留，不能视作新版重新实测。旧独立软件不再提供运行及安装入口。
