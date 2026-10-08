# 从 GitHub 下载这一版

本仓库和发布资产保留私有权限。使用有权限的 GitHub 账号登录，打开[私有第一版下载页](https://github.com/86cloudyun-afk/dsh-bot/releases/tag/v0.1.0-private.1)。

## 选择正确文件

在 **Assets** 中下载以下文件：

| 文件 | 用途 |
| --- | --- |
| `dsh-bot-v1-private-delivery-20261008-r2.tar.gz` | 完整交付包，安装从这里开始 |
| `dsh-bot-v1-private-delivery-20261008-r2.tar.gz.sha256` | 完整交付包的 SHA-256 校验值 |
| `CURRENT_INSTALLATION_GUIDE.zh-CN.md` | 可单独阅读的当前中文安装指南，完整包中也包含它 |
| `QUALIFICATION.json` | 版本、构建、平台、CI 与真实模型验收范围，完整包中也包含它 |
| `dsh-bot-v1-private-delivery-20261008-r2.final-audit.json` | 冻结私有交付的最终审计报告 |
| `GITHUB-ASSETS.sha256` | 本下载页上传的五份冻结文件的校验清单 |

GitHub 自动生成的 “Source code (zip)” 和 “Source code (tar.gz)” 是标签对应的源码快照。它们没有这份完整安装交付包及其最终装配材料。

## 校验完整交付包

完整包大小为 **15,558,289 字节**，可信 SHA-256 固定为：

```text
375c4801c92996c6a5d4c6644abaf8d6965c307501f55be13444b8e8a16cf58f
```

在两个下载文件所在目录打开终端，Linux 使用：

```sh
sha256sum --check dsh-bot-v1-private-delivery-20261008-r2.tar.gz.sha256
```

macOS 使用：

```sh
shasum -a 256 --check dsh-bot-v1-private-delivery-20261008-r2.tar.gz.sha256
```

收到 `OK` 后，按[首页](../README.md)的解压命令解压到尚不存在的目录。该目录名为 `dsh-bot-v1-private-delivery-20261008-r2`，内含五个文件：

```text
dsh-bot-v1-private-delivery-20261008-r2/
├── CURRENT_INSTALLATION_GUIDE.zh-CN.md
├── DELIVERY.zh-CN.md
├── QUALIFICATION.json
├── SHA256SUMS
└── final-1f111d7-m3-thin.tar.gz
```

进入这个目录，Linux 执行 `sha256sum --check SHA256SUMS`，macOS 执行 `shasum -a 256 --check SHA256SUMS`。全部为 `OK` 后，阅读当前指南，核对并解压内部薄包，完成安装。完整包、内部薄包和产品 npm tgz 是不同层级，分别有固定校验值。

## 交给 dot 或其他工具

下载完整交付包、中文指南和最终审计后，将文件作为附件交给自己的工具读取。可以附上以下说明：

> 这是 DSH Bot 私有第一版。请先读取中文安装指南和最终审计，核对交付包与内部 SHA256SUMS，再按指南完成安装与验证。使用 Node 24.19.0，仅支持 Linux x64 或 macOS arm64。UNKNOWN 查询原回执，不重放。仅作私有使用，保持 PR #1 未合并。

仅传云端工作区文件路径不能传递文件字节。私有 GitHub 链接也要求读取工具自身具有对应仓库权限；将下载文件作为附件传入，可以让工具取得本次实际交付内容。

## 下载失败

私有仓库对未登录或无权限访问可能返回 404。先核对登录账号及仓库权限；保持原仓库的私有访问范围。校验失败时停止解压，重新下载正确资产并核对固定校验值。
