# 开发与源码说明

## 三个入口

| 入口 | 用途 |
| --- | --- |
| `v0.1.0-private.1` 标签 / `1f111d7` | 本版固定产品源码，对应已验证的构建身份 |
| `release/v0.1.0-private-v1-20261008` | 中文仓库首页、下载说明与当前指南；只新增文档与图示 |
| GitHub Release 的完整交付包 | 安装材料和冻结交付记录，不需本地先构建旧 Host |

产品源码 tree 固定为 `49ca850d8837da106996e9717fe30dfde5ae3039`。产品 npm 元数据仍为 `0.1.0-alpha.1`；中文文档更新不重建、重打包或重新命名历史测试证据。

## 开发检查

在自己的源码检出目录中，按正常公共 npm 安装固定依赖，再运行仓库检查。保持生命周期脚本关闭：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run check
```

上述检查入口与原生、真实安装和模型验收分开核对。已有正式原生 CI、安装 CI 和 Host CI 的固定链接见[发布说明](releases/private-v1.zh-CN.md)。本地检查结果只描述该次实际执行。

`npm start` 是早期 loopback review UI。安装和运行本版使用完整交付包与 `dsh-bot-gui` profile，步骤以[当前中文指南](installation.zh-CN.md)为准。

## 历史设计与材料

仓库保留的 `docs/spec-v0.2.1.md`、旧设计、旧安装说明和独立复审记录继续属于各自时点与执行范围。它们不能独自证明当前版本的完整功能状态；优先读取中文首页、当前指南和冻结 `QUALIFICATION.json`。

完整安装薄包中的来源、构建材料和依赖 notice 保持原字节。当前授权状态为私有使用；不据此推定可公开发布。
