> **已作废：旧独立软件版。禁止按此页安装或启动。** 原生 DSH 插件使用已有官方 DSH；本页仅为历史证据。参见 [作废说明](https://github.com/86cloudyun-afk/dsh-bot/blob/goal/native-dsh-plugin-v1-20261008/docs/history/standalone-void.md)。

# 单 Bot 第一版安装与使用

本说明用于交付清单所绑定的薄安装包。请先核对该清单中的源码、Host、目标平台和验收范围；目录存在、服务启动或历史测试通过，都不单独表示正式版本已通过验收。

## 安装准备

支持的安装目标为 Linux x64 与 macOS arm64，使用 Node **24.19.0** 及其正常安装的 npm。安装需要访问公共 npm registry，下载由随包 lock 锁定的官方 DSH SDK；无需已有 DSH 安装、Git、旧 Home 或模型密钥。安装不会启动服务或模型。

把薄安装包解压到自己的固定目录。从交付清单取得 `thin-install-descriptor.json` 的实际 SHA-256；仅对未知来源的下载自行计算哈希，不能确定其可信来源。所有路径使用没有符号链接别名的绝对路径。

选择尚不存在的安装目录，并先创建其父目录。安装结束前不要同时修改、移动或替换安装目录。以下示例假定安装包位于 `/opt/dsh-bot-v1-thin`，已创建父目录 `/opt/dsh-bot-installations`，npm 入口为 `/usr/local/lib/node_modules/npm/bin/npm-cli.js`。按自己的 Node 安装位置和可写目录替换这些路径。

```sh
node /opt/dsh-bot-v1-thin/scripts/install-v1.mjs \
  --bundle /opt/dsh-bot-v1-thin \
  --descriptor /opt/dsh-bot-v1-thin/thin-install-descriptor.json \
  --descriptor-sha256 交付清单中的实际64位SHA256 \
  --output /opt/dsh-bot-installations/my-bot-v1 \
  --npm-cli /usr/local/lib/node_modules/npm/bin/npm-cli.js \
  --npm-timeout-ms 120000
```

成功时终端打印安装回执，并在安装目录保存 `installation-manifest.json`。回执提供 `manualStartup` 的执行文件、参数和 `DSH_HOME`。失败时保留已创建的目录和固定错误分类；不要把失败目录当作可用安装，也不要在该目录重新运行安装器。先处理失败原因，再选择新的安装目录。

## 启动与创建 Bot

按安装回执中的 `manualStartup` 启动。上述目录示例对应：

```sh
DSH_HOME=/opt/dsh-bot-installations/my-bot-v1/profile/home \
  node /opt/dsh-bot-installations/my-bot-v1/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js \
  --profile dsh-bot-gui --port 3080 --no-open
```

打开进程打印的本地浏览器连接地址。输入 Bot 名称，点击“创建 Bot”。若创建结果为 UNKNOWN，使用“查询原回执”查询该操作，不另建 Bot 代替它。

默认启动为查看模式。要发送模型任务，在启动环境中安全提供 `DEEPSEEK_API_KEY`，并在同一启动命令末尾添加 `--enable-model-requests`。密钥由环境提供，不填写到安装包、profile 或文档中。停止进程后省略该选项重启，即回到查看模式。

## 提交、查看与接续

在主对话中写明目标和完成条件，再提交。Bot 可以为目标创建独立工作对话；工作列表显示各任务的目标、结果和状态。较长工作进行时，可继续在主对话交流，并提交另一个独立目标。

“消息已保存”表示入队成功。以界面显示的原生结束状态和完整用量核对结果为准；出现一段回复或显示空闲，不单独表示该轮已结算。工作结果送回主对话并核对结束后，满足接续条件的任务会显示“接续原工作”。接续保留原任务和工作对话，在其中开始新一轮。

同一个 Bot 共用 **15 个工作槽**。父工作、一级子工作和状态 UNKNOWN 的工作都计入该上限；主对话不占工作槽。父工作可以创建一层子工作，子工作不能再次分派。达到上限时等待已核对结束的工作释放槽位。

## 停止、归档与重启

在工作详情中停止原工作。停止请求被接受后，继续查看原回执的实际结束状态；只有精确原生结算已知时才释放相应槽位。响应中断或用量不完整时保留 UNKNOWN，查询原操作，不重复发送、重放输入或更换身份绕过它。

“Bot 管理”提供“归档 Bot”和“恢复原 Bot”。恢复使用同一 Bot、主对话和工作对话，要求原历史和操作结果完整已知。归档、恢复或接续结果不确定时，查询该操作的原回执。

重启仍使用同一安装目录、`DSH_HOME` 和 profile。界面能力尚未核对时保持只读；UNKNOWN 历史不会因为重启或启用模型选项而自动重发。多 Bot、内部群聊和会议协作不属于本版范围。

## 常见故障

- Node 版本或平台被拒绝：使用交付清单注明的 Node 24.19.0 与目标平台。
- npm 下载失败或超时：检查正常网络、代理和证书配置；保留失败输出，修复后使用新的安装目录。
- 服务启动但无法发送：核对本次启动是否启用了模型请求，以及原会话能力与历史是否已确认。
- 接续暂不可用：等待原工作结果回到主对话并完成结算核对；原结果未知时继续查询原回执。
- 状态 UNKNOWN 或响应丢失：查询原操作；不要自动重试任务或创建替代身份。

构建来源、完整依赖通知和私有修改授权以交付清单为准。公开分发资格必须单独通过最终审计，不能从本说明或安装成功推定。
