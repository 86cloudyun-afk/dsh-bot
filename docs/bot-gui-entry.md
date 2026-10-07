# 单 Bot 图形入口

这一入口使用正式 DSH Web Loader，在新的独立 Home 中创建一个 Bot。主对话用于提交目标、查看回复和继续交流；工作对话用于查看分派的目标、完成条件、结果与停止状态。默认使用中文，主对话仅提供 `dsh_bot_delegate`。新建顶层工作可为原任务分派一层子工作，子工作不能继续分派；父工作、子工作与 UNKNOWN 工作共同占用同一个 Bot 的 15 个工作槽位。

安装需要已审核的 DSH runtime、产品源导出，以及随导出提供的包清单路径、SHA256 和 buildId。安装器只接受与该清单完全相同的产品文件、文件模式和包内容。Home 与工作目录必须是新的独立绝对路径。

```sh
node /absolute/export/scripts/install-bot-gui-profile.mjs \
  --verified-export \
  --directory /absolute/new-installation \
  --product /absolute/export \
  --runtime /absolute/verified-runtime \
  --cwd /absolute/new-work \
  --snapshot-manifest /absolute/package/manifest.json \
  --snapshot-digest MANIFEST_SHA256 \
  --snapshot-build-id BUILD_ID
```

`--verified-export` 明确允许已验证的产品文件移动到新的路径，无需 `.git`。安装回执保留原构建的源路径、commit、tree 和清洁状态，并另外记录实际验证的导出路径。它不会改写原清单。直接从清单记录的原 checkout 安装时省略此选项，默认仍要求精确匹配原路径。导出需包含 `scripts/install-bot-gui-profile.mjs` 与 `scripts/package-snapshot.mjs`；产品包本身继续保持已有的 `src`、`cordis.patch.yml`、`README.md` 发布闭包。

启动后，打开标准 DSH 进程打印的本地连接地址。浏览器成功连接后，地址会清除连接参数。首次进入时为 Bot 命名并点击“创建 Bot”。创建回执会绑定原 Bot 和主对话；结果未知时，点击“查询原回执”，不要另建身份来代替原操作。

```sh
DSH_HOME=/absolute/new-installation/home \
  /absolute/verified-runtime/node_modules/.bin/dsh \
  --profile dsh-bot-gui --port 3080 --no-open
```

默认启动为查看模式，不发模型请求。此 profile 需要已审核 runtime 提供官方的保护执行入口和 provider 注册服务；不支持该服务的旧 runtime 会拒绝启动。正式发送目标还需原会话通过能力和历史校验，并显式添加 `--enable-model-requests`。官方 provider 使用环境变量引用 `DEEPSEEK_API_KEY`；安装器和产品 Home 不写入模型密钥值。能力尚未确认时，界面保持只读并保留已有 Bot 和对话身份。

“消息已保存”表示原消息已持久入队；“停止请求已接受”表示已请求停止。回复、空闲状态和已接受的停止都不能单独证明工作已结束。状态为 UNKNOWN 时保留原代次和工作槽位，查询原回执，不重复发送。只有原生入口提供精确、可核对的终态证据后，才能回收对应槽位。

上一轮仍在处理或结束状态为 UNKNOWN 时，新目标输入会暂停。处理中会自动刷新原状态；也可以点击“刷新回复与工作”或“查询原回执”。界面只有在该轮结束状态、完整用量和原生证明一致时显示“结束状态已核对”。未启动的排队工作显示“未占用槽位”，与已核对结束后的“已回收”区分。

重启使用同一个 `DSH_HOME` 与 profile。已知身份可以恢复查看；完整接续还需要保护入口验证原对话历史和日志。未封存历史、未知原操作或不支持的恢复会保留原身份并停止新提交，不创建替代 Bot 或主对话。当前浏览器验收覆盖真实 Loader、连接认证、创建/核对和同身份的只读重启；它没有发起真实 provider 请求。
