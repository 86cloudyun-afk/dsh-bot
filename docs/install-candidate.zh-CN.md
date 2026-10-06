# 候选安装与依赖边界

这是一份源码候选说明，不是完整 v1 已发布安装包。package.json 仍为0.1.0-alpha.1、private；没有修改版本、tag、npm发布设置或许可证授予。根目录已有固定 devDependency @deepseek-ai/dsh=0.2.0-rc.2 与 package-lock.json（v3），仅补公共 SDK 的锁定安装；产品 LICENSE 仍缺。完整公开分发需先核权利、私有 Host 接口与可复现构建，不能从上游 MIT 元数据推断所有本地补丁均已完成授权核验。

## 三种入口分别处理

| 入口 | 依赖与实际状态 |
| --- | --- |
| 独立离线控制账本 | Node 内置 node:sqlite；限定控制测试可隔离执行，不加载模型。Node22的SQLite仍有实验性提示。 |
| 实际 DSH Loader plugin/client | 包内 src/plugin.mjs、src/client/client.js；需要固定 DSH 服务与UI模块。只读snapshot不等于已安装私有owner写绑定，合成React/RPC检查不等于认证浏览器验收。 |
| native owner/验收profile | 需要固定、可审查的Host源码/构建材料和同根依赖；仅官方rc.2包不保证拥有候选所用Host API。既有装配示例是条件式验收配方，不能宣称公开冷安装已成功。 |

当前元数据声明Cordis4.0.4及8个DSH0.2.0-rc.2可选peer，并用固定devDependency锁定公开DSH。既有静态literal import库存另发现未直接在dependencies/peerDependencies声明的5项：@deepseek-ai/dsh-cmdline、@deepseek-ai/dsh-deepseek-llm-api-extensions、@deepseek-ai/dsh-experimental-native-run、@deepseek-ai/dsh-llm-deepseek、react。库存覆盖src/ui/scripts的33个唯一specifier，仅表示源码引用；新增公共SDK lock的安装证据不能外推这些入口的版本兼容或私有Host接口。experimental-native-run属于开发Host材料，不能仅改包名或用SDK wrapper制造缺少的Host接口/终态证明。

package.json的files仅包含src、cordis.patch.yml、README.md。现有npm打包白名单不包含scripts、docs、tests；这里的源码树检查配方不能直接当成npm tar内可用命令。公共SDK lock不包含完整开发Host产物配方；当前没有承诺公开安装器、完整native依赖或已验证OS组合。

## 公共 SDK 的锁定安装

在对应候选源码目录、已确认的Node/npm工具链下，开发与CI使用同一命令：

```sh
cd "$PRODUCT_SOURCE_DIRECTORY"
npm ci --ignore-scripts --no-audit --no-fund
```

固定package输入与原样v3 lock已有独立空Home/cache的npm ci成功记录；本次源码集成没有重新生成lock或重做联网安装。这一步忽略全部lifecycle scripts，只验证公共SDK安装，不是完整Host冷构建、私有native exports或产品功能验收。CI随后仍执行原受限npm test与npm run check；本补丁的完整CI结果待精确head核验，不以安装成功推定测试全部通过。

Host原生模块构建还需要与目标Node版本精确匹配的完整官方headers（包括node_api.h与config.gypi），以及受支持的Python、make和C/C++工具链；macOS通常由Xcode Command Line Tools提供编译工具。仅有Node可执行文件与版本号不足以满足此前置条件。node-gyp的--nodedir可指定相应源码/headers，使用该选项时从headers分发读取config.gypi；这里不提供未验证的消费路径或跨npm版本的环境变量命令。参见[node-gyp官方说明](https://github.com/nodejs/node-gyp/blob/main/README.md)。固定Host构建与运行时导出装配仍须分别验收，不能用旧产物复制代替可复现配方。

## 兼容性声明

| 组合 | 证据范围 |
| --- | --- |
| Node24.19.0 + 原云隔离目录 | 69控制与27客户端合成历史检查，以及本轮限定profile元数据测试；不是独立新机器安装。 |
| Node22.23.2 + Ubuntu/macOS CI | 旧PR控制68项/静态25模块及本候选UI夹具、目录规范化的限定真实CI证据；公共SDK集成后的完整suite仍待核，不能外推完整GUI/native兼容。 |
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
# CI 与发布验证的当前源码快照

两种安装模式明确分开：本地开发默认 `packagePlacement: 'symlink'`；CI 与发布验证显式选择 `packagePlacement: 'snapshot'`，没有自动回退。

`npm test` 每次调用都会先在新的临时目录中执行离线 `npm pack --ignore-scripts`，使用独立空 npm 配置及缓存，再进入原文件系统、网络及 addon 守卫。包内源码必须与当前 Git HEAD 的 tracked 文件一致；打包文件、当前源码和安装后文件逐项核对。每轮绑定 HEAD、tree、包 SHA-256、文件索引及新 buildId，安装目标排他创建。不得传入上一轮或缓存快照。完整工作区是否干净另行记录，不能把未提交的工作区说成对应提交。

发布验证先运行 `scripts/prepare-package-snapshot.mjs`，提供源码检出根和全新临时根。将其返回的 `manifestPath`、`manifestSHA256`、`buildId` 原样作为 `packageSnapshot`，并明确设置 snapshot 模式。两个安装器的 CLI 对应参数为 `--package-placement snapshot`、`--snapshot-manifest`、`--snapshot-digest`、`--snapshot-build-id`。同一目录拒绝复用；源码、包或构建标识变化必须重新打包。

快照只证明本包常规文件、导出和相对运行时引用的闭包，不包含外部 SDK 依赖，也不证明完整 Loader 或 native 恢复能力。冷恢复测试保留成功解析原 Agent 的要求；固定错误分类只描述阻塞，不能视为恢复成功。原固定 assembler、身份合同及安全权限保持不变。
