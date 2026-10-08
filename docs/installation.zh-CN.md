# 单 Bot 第一版：当前安装与使用指南

本指南对应源码 `1f111d7f3f5c54127a7523571c8ebc1a738575b8`，供本人私有安装和自用。本文件是本次交付的当前安装与使用说明；涉及安装步骤、工作结果大小和状态含义时，以本文件为准。薄包 common 材料中保留的较早说明作为技术与历史资料保留。它们保持原字节；本指南是包外的独立交付文件，不加入或修改冻结 descriptor 的文件闭集。

安装成功、服务启动和历史测试通过不能单独证明真实模型任务已通过全部验收。以本次最终交付清单注明的验收范围与原始回执为准。在本指南的源码准备阶段，尚不宣称最终四项真实模型验收已经全部完成。

## 先核对交付版本

| 项目 | 当前固定值 |
| --- | --- |
| 源码 commit | `1f111d7f3f5c54127a7523571c8ebc1a738575b8` |
| 源码 tree | `49ca850d8837da106996e9717fe30dfde5ae3039` |
| fresh package build | `0f63cb5c-7951-4cfc-bf95-28b21c7fac33` |
| 产品 manifest SHA-256 | `099ebd05140bbccfd4454c6c2e3b5d5142c17316a2e603c6a15f2fda448faf37` |
| 产品 tgz SHA-256 | `5898432a9e6a5dd670bdb1d9249eb904b5d8c1ee8a49c2d4775a0d439feb7473` |
| 薄包 archive | `final-1f111d7-m3-thin.tar.gz`，15,541,793 字节 |
| archive SHA-256 | `58e9b321840f557f317b9375a4e4e814665e7c6c60b0c26e8952be3f4b68b78d` |
| descriptor | `thin-install-descriptor.json`，635,464 字节 |
| descriptor SHA-256 | `5530e8316b6595d9141002eb1283f7b941007770b01238c1904f6a116f556c5c` |

从可信交付清单取得这些固定值，再核对收到的文件。仅对未知来源的下载自行计算哈希，不能确定其可信来源。该包包含 Linux x64 与 macOS arm64 材料；安装器只选择当前实际平台对应的材料。产品的 81 个 npm 文件和 tgz 与历史 0a04532 包保持相同字节，当前源码与构建来源使用上表的新固定值。历史回执仍属于各自原运行，不改记为本次运行。

## 安装准备与首次解压

使用恰好 **Node 24.19.0**，目标为 **Linux x64** 或 **macOS arm64**。其他 Node 版本或平台组合会被拒绝。先安装该版本 Node 及正常的公共 npm；安装过程需要访问公共 npm registry，按随包 lock 下载官方 DSH SDK。无需旧 DSH 安装、Git、旧 Home 或模型密钥。

将交付的 `final-1f111d7-m3-thin.tar.gz` 放在本人可写的交付目录。在该目录打开终端。下列命令用 `pwd -P` 取得该目录的实际规范绝对路径，后续路径都由它派生；不要直接照抄他人的 `/opt` 或 macOS npm 路径。

```sh
node --version
dsh_delivery_root="$(pwd -P)"
test -w "$dsh_delivery_root"
```

确认第一行输出恰好为 `v24.19.0`，并确认交付目录可写。然后按**当前操作系统**选择下面一个哈希核对命令。它使用上表可信交付清单提供的固定 archive SHA-256；输出必须为 `final-1f111d7-m3-thin.tar.gz: OK`，否则停止，不解压。

Linux x64：

```sh
(
  set -eu
  cd "$dsh_delivery_root"
  printf '%s  %s\n' '58e9b321840f557f317b9375a4e4e814665e7c6c60b0c26e8952be3f4b68b78d' 'final-1f111d7-m3-thin.tar.gz' | sha256sum --check -
)
```

macOS arm64：

```sh
(
  set -eu
  cd "$dsh_delivery_root"
  printf '%s  %s\n' '58e9b321840f557f317b9375a4e4e814665e7c6c60b0c26e8952be3f4b68b78d' 'final-1f111d7-m3-thin.tar.gz' | shasum -a 256 --check -
)
```

收到 `OK` 后，创建全新的 0700 薄包目录并解压。下面的名称必须尚不存在，且不能是符号链接；已有同名目录时，另选一个全新的名称。保留 `umask 077` 与 `tar -p`：前者限制新建目录的权限，后者恢复 archive 声明的**文件**权限，保留 0600、0700 和 0755 中的原可执行位。Linux GNU tar 与 macOS BSD tar 的 `-p` 都用于保留权限；这里使用已经核对的同一份 regular-only USTAR archive，没有链接、特殊成员或目录成员。不要用会统一重写文件权限的解压方式。

```sh
dsh_bundle_root="$dsh_delivery_root/dsh-bot-v1-thin-1f111d7"
(
  set -eu
  umask 077
  test ! -e "$dsh_bundle_root"
  test ! -L "$dsh_bundle_root"
  mkdir -m 700 "$dsh_bundle_root"
  tar -xzpf "$dsh_delivery_root/final-1f111d7-m3-thin.tar.gz" -C "$dsh_bundle_root"
)
```

任何一步失败都停止后续步骤，并保留已创建的目录；不要向该目录重复解压或把不完整目录当作输入。成功的 archive 含恰好 2369 个 regular 文件，文件模式分别为 2363 个 0600、4 个 0700、2 个 0755。后面的安装器还会根据独立固定的 descriptor 核对所选平台的实际输入字节与模式。本指南说明跨平台解压命令的语义；实际 OS 安装验收以最终清单中的独立原始回执为准。

`--npm-cli` 必须是本机实际公共 npm 的 CommonJS `npm-cli.js` 的规范绝对路径，不是 `npm` 命令名、Shell 包装器或猜测的路径。解析实际 Node 执行文件和正常 npm 命令链接：

```sh
dsh_node_exec="$(node --input-type=module -e 'import { realpathSync } from "node:fs"; console.log(realpathSync(process.execPath));')"
dsh_npm_cli="$("$dsh_node_exec" --input-type=module -e 'import { realpathSync } from "node:fs"; console.log(realpathSync(process.argv[1]));' "$(command -v npm)")"
printf '%s\n' "$dsh_npm_cli"
```

核对输出实际是正常公共 npm 的 `bin/npm-cli.js`。若本机 `npm` 是其他包装器，直接从 Node/npm 正常安装目录找到真实 CommonJS 入口，并将其规范绝对路径赋给 `dsh_npm_cli`。macOS 的位置取决于 Node 安装方式；使用本机刚解析得到的真实路径。

下面例子在本人交付目录中创建一个 0700 输出父目录（仅在该父目录不存在时创建），再选择其下**尚不存在**的安装输出目录。如需使用已有的本人规范、可写父目录，可将 `dsh_install_parent` 换成其实际绝对路径；下面的命令会核对它的规范路径并保留它。输出目录始终必须不存在。安装结束前保持这些目录及祖先路径不被其他进程同时修改、移动或替换。

```sh
dsh_install_parent="$dsh_delivery_root/dsh-bot-installations-1f111d7"
dsh_install_output="$dsh_install_parent/my-bot-v1"
(
  set -eu
  umask 077
  test ! -L "$dsh_install_parent"
  if [ ! -d "$dsh_install_parent" ]; then
    test ! -e "$dsh_install_parent"
    mkdir -m 700 "$dsh_install_parent"
  fi
  test -d "$dsh_install_parent"
  test -w "$dsh_install_parent"
  test "$("$dsh_node_exec" --input-type=module -e 'import { realpathSync } from "node:fs"; console.log(realpathSync(process.argv[1]));' "$dsh_install_parent")" = "$dsh_install_parent"
  test ! -e "$dsh_install_output"
  test ! -L "$dsh_install_output"
  "$dsh_node_exec" "$dsh_bundle_root/scripts/install-v1.mjs" \
    --bundle "$dsh_bundle_root" \
    --descriptor "$dsh_bundle_root/thin-install-descriptor.json" \
    --descriptor-sha256 5530e8316b6595d9141002eb1283f7b941007770b01238c1904f6a116f556c5c \
    --output "$dsh_install_output" \
    --npm-cli "$dsh_npm_cli" \
    --npm-timeout-ms 120000
)
```

安装器使用新的 Home、npm 配置和缓存，按官方 SDK lock 执行公共 npm 安装，保持严格 TLS，跳过生命周期脚本，并设置 120,000 毫秒的 npm 超时。它不启动 CLI 或模型，不导入旧 Home，也不复制密钥。

成功时终端打印安装回执，并在输出目录保存 `installation-manifest.json`。核对其中的版本和 descriptor 固定值，再使用它提供的 `manualStartup`。失败输出会保留；失败目录不能视为已接受的安装，也不要在该目录重跑安装器。处理原因后，另选新的、尚不存在的输出目录。

若安装器报告 `SDK_INSTALL_STOP_UNKNOWN`，原 npm 子进程是否已停止仍不确定。保留该失败目录，先核对原进程身份及原进程组的停止结果；不要仅凭记录的 PID 对后来复用该号码的进程操作，不要自动删除可能仍有写入者的目录。

## 启动与创建 Bot

以实际安装回执 `manualStartup` 中的 Node 执行文件、官方 CLI 路径和 `DSH_HOME` 为准。延续上面实际安装输出路径的等价命令是：

```sh
DSH_HOME="$dsh_install_output/profile/home" \
  "$dsh_node_exec" "$dsh_install_output/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  --profile dsh-bot-gui --port 3080 --no-open
```

打开进程当次打印的本地浏览器连接地址，通过正常认证进入界面。不要将认证地址、token、cookie、密钥或原 Home 放入报告、截图或共享材料；截图前确认地址栏已经恢复为干净的本地页面地址。

输入 Bot 名称，点击“创建 Bot”一次，等待真正创建完成。创建状态为 UNKNOWN 或响应丢失时，使用“查询原回执”查询原操作；不重复点击创建、不另建身份绕过原操作。

默认启动**禁用模型请求**，可查看界面与历史。需要实际发送模型任务时，在进程启动环境中安全提供 `DEEPSEEK_API_KEY`，并在同一条真实 CLI 启动命令末尾添加 **`--enable-model-requests`**。密钥只通过环境提供，不写入包、profile、命令示例、文档或回执。停止原进程后，省略该选项重启即回到查看模式。安装器不会自动添加该选项；开启该选项也不代表真实模型验收已经通过。

## 提交、查看与接续

在主对话写明目标、完成条件和需要返回的结果，再提交。Bot 可以为目标创建独立工作对话；工作列表显示任务、结果与状态。主对话可继续交流，另一个独立目标可单独提交。

“消息已保存”表示入队成功。出现回复、显示空闲或收到停止请求确认，都不单独表示原工作已完成精确原生结算；应核对原生结束状态和完整用量。工作结果送回主对话并核对结束后，满足条件的任务才显示“接续原工作”。接续继续使用原任务和原工作对话。

本版工作结果回送主对话的上限是 **4096 UTF-8 字节**。建议每个工作返回**不超过 3400 UTF-8 字节**，给编号和标点留出余量。中文字符通常占三个 UTF-8 字节，字数不能代替字节数。较大的输出拆成多个独立、较小的任务。

工作可以已经完成原生结算，但结果因超过上限而没有送达主对话。先查看原工作对话中保留的回复，再提交新的较小任务。**原生结算已知与结果已送达是两个需要分别核对的状态**；结算已知不能据此推定主对话已确认该结果。

同一个 Bot 共用 **15 个工作槽**。父工作、一级子工作以及状态 UNKNOWN 的工作都计入该上限；主对话不占工作槽。父工作只能创建**一层子工作**，子工作不能再次分派。达到上限时，等待已经核对原生结束状态的工作释放槽位。本版范围是单 Bot；多 Bot、内部群聊与会议协作不属于本版。

## 停止、归档与重启

在工作详情中停止原工作，然后查询原回执的实际结束状态。只有精确原生结算已知时才释放相应槽位。响应中断、用量不完整或原结束状态不明时保留 UNKNOWN 和槽位占用；查询原操作，不自动重试、不重放输入，也不换身份绕过它。

“Bot 管理”中的“归档 Bot”和“恢复原 Bot”继续使用同一 Bot、主对话与工作对话，要求原历史和操作结果完整已知。归档、恢复或接续结果不确定时，同样查询该操作的原回执。

重启使用同一安装目录、`DSH_HOME` 和 `dsh-bot-gui` profile。原 CLI 进程及其原进程组停止后，再启动新进程。能力尚未核对时保持只读；UNKNOWN 历史不会因为重启或启用模型选项而自动重发。不要同时用多个 CLI 进程写入同一 Home。

## 常见情况

- Node 版本或平台被拒绝：改用上表的 Node 24.19.0 和实际受支持的平台。
- npm 下载失败或超时：核对正常网络、代理和证书配置，保留失败输出；修复后使用新的输出目录。
- 服务可查看但不能发送：核对本次进程是否显式启用了模型请求，以及环境密钥、原会话能力和历史是否已确认。
- 接续暂不可用：核对原工作结果是否已回到主对话且结束状态已确认；未知结果继续查询原回执。
- 工作原生结算已知但主对话没有结果：先查看原工作回复，核对 UTF-8 字节大小；较大的输出改为新的较小任务。
- 状态 UNKNOWN 或响应丢失：保留原身份和原操作，查询原回执，不自动重试。

## 私有使用与交付边界

本交付仅供本人私有安装与自用。Bot 及私有 Host 修改的公开再分发授权仍为 **UNKNOWN**；node-addon 的 BSD 与 MIT 通知适用范围仍为 **UNKNOWN**。因此公开发布状态是 **NOT_CLEARED**，不能从安装成功、技术测试或本指南推定已有公开发布许可。完整依赖通知及最终验收范围以交付清单为准。

冻结薄包的 common 303 文件、M3 来源材料、公共依赖、通知与五个工具继续保持原字节。此指南补充当前使用步骤和结果大小边界，保留旧材料作为历史证据，不覆盖或重写它们。
