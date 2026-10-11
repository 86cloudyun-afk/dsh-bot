# DSH Bot · 原生多 Bot 插件

在现有的 **官方 DSH** 中拥有自己的 Bot 团队：每个 Bot 有名字、职责和独立记忆。在专用 **Bot 空间** 里继续私聊、组织群聊、开会和派发任务；后台工作运行时仍可继续对话。

[下载 v1.3.0 插件包](https://raw.githubusercontent.com/86cloudyun-afk/dsh-bot/v1.3.0/dist/dsh-bot-1.3.0.tgz) · [校验文件](https://raw.githubusercontent.com/86cloudyun-afk/dsh-bot/v1.3.0/dist/SHA256SUMS) · [安装与上手](docs/install.zh-CN.md) · [使用手册](docs/guide.zh-CN.md) · [版本说明](https://github.com/86cloudyun-afk/dsh-bot/blob/v1.3.0/docs/releases/v1.3.0-release-notes.zh-CN.md) · [GitHub Release](https://github.com/86cloudyun-afk/dsh-bot/releases/tag/v1.3.0)

## 实际界面

受控示例：官方原版 DSH 中的真实插件界面；回复由本地受控模型提供。

![嘟嘟私聊与独立记忆](https://raw.githubusercontent.com/86cloudyun-afk/dsh-bot/v1.3.0/docs/images/v1.3.0/bot-space-private-dark.png)

![三个 Bot 在产品协作群中分别回复](https://raw.githubusercontent.com/86cloudyun-afk/dsh-bot/v1.3.0/docs/images/v1.3.0/bot-space-group-light.png)

[浅色私聊](docs/images/v1.3.0/bot-space-private-light.png) · [深色群聊](docs/images/v1.3.0/bot-space-group-dark.png) · [窄屏群聊](docs/images/v1.3.0/bot-space-group-narrow.png) · [窄屏上下文](docs/images/v1.3.0/bot-space-context-narrow.png)

## 一个空间，和自己的 Bot 团队一起工作

左边选择 Bot、原有聊天或群；中间持续对话；右边查看当前对象的任务、记忆、成员和会议。名称与状态始终可见，重名 Bot 用稳定 ID 区分。深浅主题沿用 DSH，窄窗口可展开“会话”和“上下文”。

**Bot 空间是 DSH 内的专用面板。** 安装后从原有侧栏进入，无需另开服务。完整的 **Bot 工作台** 保留配置、授权、验收、资料和诊断入口。

| 能力 | 日常使用 |
| --- | --- |
| 具名多 Bot | 创建并命名 Bot，选择它已有的聊天继续原历史，或明确点击“开始新对话”。浏览列表不会自动创建会话或调用模型。 |
| 各自的长期记忆 | 同一 Bot 的新会话自动带入身份、长期记忆与未完成任务；需要细节时查阅自己的其他会话。多个 Bot 分别保存记忆。 |
| 聊天与后台任务 | 右栏登记并开始任务，长任务运行时继续聊天或派发短任务。每 Bot 的父工作、一级子工作及未结算工作共用 15 槽。 |
| 真正的内部群聊 | 选择已有 Bot 和协调者创建群。发送消息后，成员在各自的原生会话中按轮数与预算回复；可停止确切群轮，并查看结算状态。 |
| 会议与行动 | 同群可开不同议题会议。先收集封存的独立意见，再明确揭示、讨论和决定；把决定登记为真实任务，明确开始后执行。 |
| 原生工具、提问与计划 | 当前会话已挂载的工作工具默认可用。群与会议标明具体 Bot 的审批、提问和计划确认，提供原生答复入口及完整计划。带原始调用 ID 的未答请求收起后可重开；无 ID 请求的原生“放弃”会取消。空间弹层的关闭只隐藏显示，独立意见继续封存。 |
| 可撤销共享 | 跨 Bot 默认只读；在工作台设置共享范围、接收 Bot 和持续只读／控制授权。控制本 Bot 的所属会话；控制其他 Bot 的会话和任务需要当前有效授权。 |
| 知识与协作增强 | 记忆分类、搜索、固定、导入导出；文本／Markdown 资料和精确原文引用；团队模板、前置任务、验收与责任交接。 |
| 管理与恢复 | 调整、接续、停止、验收、归档和恢复任务或会话。Bot 可删除并恢复，原身份、记忆和历史保留；有活动或未知工作时先处理结算。 |
| 简报与定时 | 查看任务简报和未读结果，设置提醒和单次／间隔／每日／每周任务。关闭 DSH 时不运行，恢复规则明确。 |

## 安装并开始聊天

兼容基线：未修改的官方 **`@deepseek-ai/dsh@0.2.0-rc.2`**，Node **`^22.19.0 || >=24`**。官方插件管理器需要 `pnpm`；平台验收以本版 Release 记录为准。

1. 下载顶部的 `.tgz` 和 `SHA256SUMS`，核对哈希。首次安装 DSH、依赖检查与校验命令见 [安装说明](docs/install.zh-CN.md)。
2. 安装到日常使用的 DSH profile。以下使用 `web`：

```bash
dsh plugin --profile web add ./dsh-bot-1.3.0.tgz --ignore-scripts --strict-peer-dependencies
dsh web
```

3. 在侧栏打开 **Bot 空间 → 新建 Bot**，填名称、可选职责和模型，点击 **提交创建 Bot**。选择这个 Bot，再点 **开始新对话**。
4. 需要合作时点击 **新建群**，选择成员和协调者。发送一条共同问题，或在右栏 **发起会议**。

模型默认沿用 DSH 的当前有效配置，工作工具沿用原生会话；实际调用遵守 DSH 权限与审批。需要工作目录、独立执行模型或其他会话配置时，打开 **完整工作台**。

## 升级与历史保留

从 v1.0.0、v1.0.1、v1.0.2、v1.1.0、v1.1.1、v1.1.2、v1.1.3 候选、v1.1.4 或 v1.2.0 升级后，完全重启 DSH 并刷新浏览器，在完整工作台核对 **插件 1.3.0 / 服务 1.3.0**。原 Bot、记忆、会话、任务、资料、安排、操作 ID 和回执继续保存。原有联络聊天直接出现在 Bot 空间中，无需复制历史或重新创建 Bot。

v1.0.x 升级保留校验过的 schema 1 备份；v1.1.x 与 v1.2.0 延续 schema 2 和协议 2。旧版本资料的默认共享范围保持关闭。详细步骤及回退条件见 [升级说明](docs/install.zh-CN.md#6-升级禁用与卸载)。v1.1.3 仍为未发布稳定 Release 的历史候选。

停止被接受后仍须等待真实资源结算；无法确认的操作保留为“未知”，使用原始 ID 查回。会议取消与已经登记的行动任务分别管理；尚未揭示的独立意见在取消后仍封存。已有原生会话的工作目录固定，更换锁定的 preset 时新建会话。

## 与 DSH 的关系

插件复用官方 DSH 的模型、凭据、工具、审批、会话、日志和存储。安装包只包含插件代码和中文说明；DSH 本体无需修改，DSH 与 SDK 由官方安装管理。

正式交付状态、两平台真实安装与 GUI 检查、升级检查、模型调用类型及多轮独立复审，以对应 [Release](https://github.com/86cloudyun-afk/dsh-bot/releases) 的记录为准。

**此前独立软件版已完全作废。** 旧 Host 装配、启动器、独立网页和安装器已从当前运行及交付入口移除。旧分支、记录和归档资产仅保留供追溯，不参与本插件安装。见 [作废说明](docs/history/standalone-void.md)。

## 开发与许可

```bash
npm ci --ignore-scripts
npm test
npm run check
```

源代码采用 [MIT License](LICENSE)。DSH 及其依赖适用各自的许可，本插件不重新分发这些包。
