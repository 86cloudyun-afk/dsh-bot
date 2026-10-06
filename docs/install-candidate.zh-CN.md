# 候选安装与依赖边界

这是一份源码候选说明，不是完整 v1 已发布安装包。package.json 仍为0.1.0-alpha.1、private；没有修改版本、tag、npm发布设置或许可证授予。当前根目录没有产品 LICENSE，也没有产品 lockfile。完整公开分发需先核权利与可复现依赖，不能从上游 MIT 元数据推断所有本地补丁均已完成授权核验。

## 三种入口分别处理

| 入口 | 依赖与实际状态 |
| --- | --- |
| 独立离线控制账本 | Node 内置 node:sqlite；限定控制测试可隔离执行，不加载模型。Node22的SQLite仍有实验性提示。 |
| 实际 DSH Loader plugin/client | 包内 src/plugin.mjs、src/client/client.js；需要固定 DSH 服务与UI模块。只读snapshot不等于已安装私有owner写绑定，合成React/RPC检查不等于认证浏览器验收。 |
| native owner/验收profile | 需要固定、可审查的Host源码/构建材料和同根依赖；仅官方rc.2包不保证拥有候选所用Host API。既有装配示例是条件式验收配方，不能宣称公开冷安装已成功。 |

当前元数据声明Cordis4.0.4及8个DSH0.2.0-rc.2可选peer。静态literal import库存另发现未在dependencies/peerDependencies声明的5项：@deepseek-ai/dsh-cmdline、@deepseek-ai/dsh-deepseek-llm-api-extensions、@deepseek-ai/dsh-experimental-native-run、@deepseek-ai/dsh-llm-deepseek、react。库存覆盖src/ui/scripts的33个唯一specifier，仅表示源码引用；没有联网解析、安装或版本兼容证明。experimental-native-run属于开发Host材料，不能仅改包名或用SDK wrapper制造缺少的Host接口/终态证明。

package.json的files仅包含src、cordis.patch.yml、README.md。现有npm打包白名单不包含scripts、docs、tests；这里的源码树检查配方不能直接当成npm tar内可用命令。当前没有承诺公开安装器、完整锁定依赖或已验证OS组合。

## 兼容性声明

| 组合 | 证据范围 |
| --- | --- |
| Node24.19.0 + 原云隔离目录 | 69控制与27客户端合成历史检查，以及本轮限定profile元数据测试；不是独立新机器安装。 |
| Node22.23.2 + Ubuntu/macOS既有PR CI | 仅旧PR控制68项/静态25模块；不能外推本候选完整GUI/native或Node22声明兼容。 |
| 新环境固定Host材料 + 空profile/Home/cache | 待冷构建/依赖与真实功能验收；尚不在支持组合中。 |

## 可执行的限定离线检查

先由用户设置 PRODUCT_SOURCE_DIRECTORY 为实际候选源码目录、NODE_BINARY 为符合版本要求的Node可执行文件。下列命令仅运行保留的控制子集，不运行服务、模型或native fixture：

```sh
cd "$PRODUCT_SOURCE_DIRECTORY"
"$NODE_BINARY" scripts/test.mjs test/adapter.test.mjs test/autonomy.test.mjs test/collaboration.test.mjs test/control.test.mjs test/recovery.test.mjs test/safety.test.mjs test/ui.test.mjs test/legacy-meeting.test.mjs test/ui-ledger-identity.test.mjs
"$NODE_BINARY" scripts/check.mjs
```

此候选限定子集历史结果69/69，相关实际客户端模块的离线合成检查27/27；本轮路径清理不重跑它们。旧PR1的68控制CI不能代表完整候选的浏览器、native或OS兼容。默认npm test及test:native需先核各自前置条件；缺失历史fixture的检查仍BLOCKED，不以skip冒充通过。

## 显式profile目录与基线

[owner入口](owner-entry.md)的NODE_BINARY、PRODUCT_SOURCE_DIRECTORY、OFFICIAL_RUNTIME_DIRECTORY、HOST_ARTIFACT_DIRECTORY、OWNER_RUNTIME_DIRECTORY、OWNER_HOME_DIRECTORY、OWNER_EVIDENCE_DIRECTORY必须由调用者提供。输出位置使用调用者新建的隔离目录；不能复制已有Home、缓存、凭据、私人配置或真实历史到分发树。固定Host材料未完成冷构建核验时停在BLOCKED。

scripts/install-bot-native-phase-profile.mjs只生成隔离验收profile，不启动模型。调用者必须显式提供原Bot ID、原main Session ID及完整历史digest；不提供历史默认值，不创建替代身份。ID必须为小写UUID，main Session ID为session-加小写UUID，historyDigest为64位小写SHA256；无类型强转。缺失或格式错误在profile写入前拒绝；格式合法并不证明历史真实，现有cold owner随后核对实际Bot/main、完整历史、队列与原ACK，核失败不得发送、重放或解除UNKNOWN。此接受阶段使用已有受控Home，不能作为任意旧Home迁移入口。

```sh
"$NODE_BINARY" "$PRODUCT_SOURCE_DIRECTORY/scripts/install-bot-native-phase-profile.mjs" \
  --home "$OWN_CONTROLLED_HOME" --product "$PRODUCT_SOURCE_DIRECTORY" \
  --runtime "$PINNED_RUNTIME_DIRECTORY" --cwd "$EMPTY_HARMLESS_DIRECTORY" \
  --bot-id "$ORIGINAL_BOT_ID" --main-session-id "$ORIGINAL_MAIN_SESSION_ID" \
  --history-digest "$ORIGINAL_HISTORY_DIGEST"
```

这些身份由可信调用者从其自己的已审查原记录取得，示例不含真实ID。安装器不读取凭据；profile只保存apiKeyEnv:DEEPSEEK_API_KEY引用。实际合法模型配置仍通过宿主正规provider通路解析凭据，不在文档或示例中填写key。API缺失时只能验离线/UI，不能宣称真实功能通过。

## 故障与发布门

- chain_native_baseline_required / chain_native_baseline_invalid：补齐同一原身份的可信参数；不要生成fakeID或重建UNKNOWN。
- 缺Host接口、依赖或历史fixture：停在对应BLOCKED层，补充可公开取得的源码、固定补丁、构建lock及实际加载配方；不回退到不受支持API。
- receipt未知或响应中断：查询原operation/message/task/generation，不换nonce，不自动重发。
- stop accepted：只表示请求接受或产品fence，不能作为精确原生结算或释放槽位的证据。

每个声称支持的OS/DSH/Node组合都需独立新VM、容器或机器，以及空profile/Home/cache。当前同云新目录、静态清单和合成RPC均不能替代该门。完整门包括实际GUI输入→主Bot自主委派→来源绑定结果、工作期间有意义主响应与续接、精确停止结算、非取消归档恢复、重启身份/映射/历史一致；当前完整门未通过。15槽/一级子工作仅离线覆盖。UNKNOWN先reconcile再考虑新建，不能通过重新打包使它变成成功。
