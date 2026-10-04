# 来源、许可与实际证据

代码为独立实现；没有复制 OpenMausBot、Rakazo、Hydra、Cebus、OpenBot、dsh-discord-bot、Grok 重建版或 GPL 社区项目代码。设计仅使用用户提供 v0.2.1 的机制与不变量；外部源码参考保持在源规格来源章节。没有引入第三方 runtime 实现；可选 Cordis 使用宿主已有公开 peer（4.0.4），没有复制到仓库。

原规格由 Library `libfile_f43fd167ce68819189d4487c1bb98f8d` version 1 消费端本地物化。下载 helper 来自本轮当前 Library skill，放 `.local/`，不提交 GitHub。文档原字节 69,666；SHA-256 `675c37eadc4e4c815870fb8c12f37c287ffa4213a6dd251103fc15ae7d58bfe6`。DOCX 保留本地，GitHub 交付用户设计的全文与拓扑清单。

`docs/spec-v0.2.1.md` 由整个 word/document.xml 下全部 w:p 提取，含所有表格单元格段落及 hyperlink 显示文本，未只遍历 body 顶层；392 段，26,635 字符（含换行）。`docs/spec-extraction.json` 保存 5 表、198 个单元格的行/列拓扑、14 个 hyperlink target、external relationships、fields、章节及 F01–F28 / U1–U8。原文无 drawing。19 主章节完整，附带子章节一并保留；页面 23 是源稿标注，本轮没有渲染重测页数。

公开宿主能力证据只来自固定安装包 0.2.0-rc.2 的 package.json 与 lib/types，详见 host-capabilities.md；未读取原生 Session、凭据或加载状态。静态证据支持发现接口，不能支持现场行为结论。

测试权威分层：SQLite/Host 命令结果为实际本地代码执行；resource 与 observation trace 是 deterministic synthetic evidence；原生长任务、LLM 输入、自然语言联络、provider quota、完整停止、工具/检索 ACL、宿主重启与性能均未测。不会把测试 double 或手工意见称模型调用或产品完整验收。

代码作为私有工作成果交付，没有声明可重新许可第三方源实现；目前不发布 npm、网站或生产插件。
