# 开发与源码说明

## 源码、文档与交付入口

| 入口 | 用途 |
| --- | --- |
| `v0.1.0-private.1` 标签 / `1f111d7` | 本版固定产品源码，对应已验证的构建身份 |
| `main` | 默认中文首页；同步文档和上传工作流，产品代码保留原基线 |
| `release/v0.1.0-private-v1-20261008` | 中文文档、图示与按固定哈希上传资产的手动工作流 |
| `distribution/v0.1.0-private.1` | 六份冻结交付文件的私有上传来源，绑定 `fdec1ba` |
| GitHub Release 的完整交付包 | 安装材料和冻结交付记录，不需本地先构建旧 Host |

产品源码 tree 固定为 `49ca850d8837da106996e9717fe30dfde5ae3039`。产品 npm 元数据仍为 `0.1.0-alpha.1`；中文文档更新不重建、重打包或重新命名历史测试证据。

开发这一版时，先检出 `v0.1.0-private.1` 标签。main 本次只同步中文文档和发布工作流，产品代码仍对应原 `13d1fb15` 基线；PR #1 保持草稿未合并。实际安装使用 Release 中的冻结完整交付包。

手动上传工作流只在指定私有仓库和中文发布分支运行，从固定 distribution commit 核对六份文件的字节和 SHA-256，再使用 GitHub 的仓库 token 上传到固定草稿 Release。它不执行产品或安装任务，不覆盖已有资产；最终发布由交付步骤另行完成。

## 开发检查

在自己的源码检出目录中，按正常公共 npm 安装固定依赖，再运行仓库检查。保持生命周期脚本关闭：

```sh
git checkout --detach v0.1.0-private.1
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run check
```

上述检查入口与原生、真实安装和模型验收分开核对。已有正式原生 CI、安装 CI 和 Host CI 的固定链接见[发布说明](releases/private-v1.zh-CN.md)。本地检查结果只描述该次实际执行。

`npm start` 是早期 loopback review UI。安装和运行本版使用完整交付包与 `dsh-bot-gui` profile，步骤以[当前中文指南](installation.zh-CN.md)为准。

## 历史设计与材料

仓库保留的 `docs/spec-v0.2.1.md`、旧设计、旧安装说明和独立复审记录继续属于各自时点与执行范围。它们不能独自证明当前版本的完整功能状态；优先读取中文首页、当前指南和冻结 `QUALIFICATION.json`。

完整安装薄包中的来源、构建材料和依赖 notice 保持原字节。当前授权状态为私有使用；不据此推定可公开发布。
