# DSH Bot · 官方原生插件 v1

在正常工作的官方 DSH 中创建具名 Bot。每个 Bot 保存自己的记忆和会话；后台工作运行时仍能持续聊天、接受短任务、查看进度和响应停止。

**当前是已完成验收的私有插件候选。独立公开仓库尚待创建，正式公开发布未完成。**

[下载已验收安装包](https://github.com/86cloudyun-afk/dsh-bot/tree/delivery/native-dsh-plugin-v1/dist) · [安装与上手](../docs/install.zh-CN.md) · [使用手册](../docs/guide.zh-CN.md) · [完整验收记录](../docs/releases/v1.0.0-qualification.zh-CN.md) · [纯插件源码](https://github.com/86cloudyun-afk/dsh-bot/tree/delivery/native-dsh-plugin-v1)

## 第一版的能力

| 能力 | 使用方式 |
| --- | --- |
| 具名多 Bot | 先在工作台创建和命名 Bot，再选择已有 Bot 新建原生会话。 |
| 各自记忆与会话 | 新会话带入身份、长期记忆和未完成任务，细节按需查阅自己的其他会话。 |
| 持续聊天与后台任务 | 长任务运行时继续聊新话题、自主派发短任务、查询进度或停止；结果回到原会话。 |
| 共享与持续授权 | 跨 Bot 默认只读；工作台设置接收者、范围和只读／控制权限，持续有效、可撤销。 |
| 完整任务管理 | 登记、开始、查看实际执行、调整、接续、精确停止、结果回收、三态验收、归档和恢复。 |
| 内部群与会议 | 多个内部群；同群可开不同议题会议，独立意见、讨论、协调者决定及真实行动任务。 |

## 安装

基线为官方 `@deepseek-ai/dsh@0.2.0-rc.2`，Linux x64／macOS arm64，Node 22（≥22.19）或 24 及以上，官方插件安装器需要 pnpm。

从上述安装包目录下载 `dsh-bot-1.0.0.tgz` 和 `SHA256SUMS`，按平台核对哈希后安装到已有 Web profile。以 `web` 为例：

```bash
dsh plugin --profile web add ./dsh-bot-1.0.0.tgz --ignore-scripts --strict-peer-dependencies
dsh web
```

打开原 DSH 侧栏的 **Bot 工作台**。无需替换宿主、安装私有 SDK 或运行额外应用。

## 本次验收

同一冻结安装包通过：完整测试 **140/140**、Linux 与 Mac 各 **41/41** 原生 GUI 检查、Linux 真实 DeepSeek **22/22** 完整 GUI 流程。多轮独立复审所报问题已关闭，验证范围与限制见验收记录。

插件 SHA-256：`47cd2b2857f2ba6b56d95b04ee89438a5e2046dd70c04c5f45db77d24847a8a4`。

**旧独立软件版完全作废。** 主分支已移除旧软件代码、独立网页、旧安装说明和旧资产发布流程。旧记录仅在私有历史中保留追溯，不进入原生插件安装包或独立新仓库。PR #1 未合并。

原插件采用 [MIT License](../LICENSE)，宿主及其依赖仍由官方安装管理。
