**用户说明（约430字）**

AgentPreset 是创建 Session 时绑定的原生工具/提示词组合 ID。它不跟随后续配置变化：修改 Bot 默认预设，只影响此后显式新建的 Session；已有会话不热切、不自动迁移。恢复时按保存的预设 ID 查当前健康定义，不保证旧内存代际，也无跨重启不可变指纹；定义缺失或损坏则拒绝，不回退到其他预设。预设本身不授予权限，不能把 JSON actor/grant 当身份。

本 owner preview 必须由 OS 用户显式执行原生 `dsh --profile dsh-bot-owner` 启动，权限核验标记为 false。CLI 仅固定 owner/empty 空预设、两条独立 contact/execution Session、零模型工具、deepseek-official/deepseek-flash、reasoning off；没有动态选模式或选模型的命令。

stdin 命令为 `status`、`prepare(operationId,kind,text)`、`admit/run/inspect/stop(operationId)`、`close`。相同 ID 且相同输入复用，冲突拒绝。默认 `run` 禁用，必须显式加本进程参数 `--enable-model-requests`。文本每段最多 4096 字节，每帧 8192 字节。`stop` 按 Session generation 设 fence，该 generation 不再接新 `prepare`；没有 reset。EOF/close/unload 关闭输入。`--resume` 按原 ID 查回，不自动重发，不清 unknown。

**边界区分**：help/invalid/init/resume、双空 Session、prepare/admit/inspect、默认 run 拒绝、pre-stop fence、关闭与原 ID 冷恢复已测；真实 API 成功、内容质量、普通授权目录、archive/restore、多 Bot、群协作、长任务自然语言联络未测。HTTP 成功不等于合格；local abort/drain 不证明远端停止或 unknown 释放。

**8 项可执行测试清单**

1. 动作：`status`。预期：返回空预设与 Session 状态。证据：退出码与 stdout。
2. 动作：`init`。预期：建立两条不同空 Session。证据：两条 ID 与会话状态。
3. 动作：相同 ID 相同输入连续 `prepare`。预期：复用不重复创建。证据：两次返回一致。
4. 动作：相同 ID 不同输入 `prepare`。预期：冲突拒绝。证据：错误码。
5. 动作：默认 `run`。预期：拒绝，未发模型请求。证据：拒绝信息与零网络。
6. 动作：`stop` 后同 generation `prepare`。预期：被 fence 拒绝。证据：拒绝
