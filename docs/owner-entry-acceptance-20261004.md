# 受限 owner 入口验收记录

实现基于设计提交 ecb527c；固定 core 3fbedc25d3626caf4e401b14c31a7f0326a19ec7 未修改。设计先经独立审查，无新增持久访问授权需求；代码最终独立只读复审无剩余 P1/P2。实际调用者限显式启动的 OS/runtime-owner，不提供认证人类身份。安装、命令和支持矩阵见 [owner-entry.md](owner-entry.md)。

| 阶段 | 实测结果 | 证据目录 `历史隔离位置〔dsh-owner-entry-acceptance〕` |
| --- | --- | --- |
| 固定公开产物装配 | 官方 CLI bin 保持；归档实际75、manifest74均记账；产品与公开 runtime entry 96项hash匹配 | assembly-final.log、runtime-snapshot-final.json |
| 真实 native help/非法参数 | 退出0/2，均无 owner-state writer | profile-final/help.*、invalid.* |
| 真实 native 初始化/命令 | 两条不同空 Session；原ID重复稳定，冲突/JSON actor拒绝；prepare/admit/inspect、默认run拒绝、pre-stop fenced、close退出0 | profile-final/init.*、native-empty-sessions-final.json |
| 真实 native 冷恢复 | 原Session/operation IDs，fenced保留，停止generation拒绝新prepare，退出0 | profile-final/resume.* |
| 定向 native owner | 19/19；生命周期、恢复前拒绝、原ID与输入检查；外部drive只作离线模拟 | schema-journal-corrected-green.log |
| 完整 native 产物回归 | 42/42；外部auth/HTTP为模拟，与真实CLI证据分开 | native-final-regression.log |
| 控制层回归 / 静态 | 104/104；47模块语法、F01–F28/U1–U8 inventory与diff格式通过 | control-final-regression.log、static-final.log |
| 旧状态保存 | 原两组12个SQLite/WAL/SHM bytes与SHA全部未变；只hash未打开SQLite | old-state-preservation-final.json |

四个实际CLI阶段的 fetch/network/listener/child attempts均为0；新真实模型/API请求0、模型工具0、凭据环境继承false。profile只配置既有provider引用，零模型验证没有解析认证；requestedModel不是本轮真实模型响应证明。CLI付费run、普通SDK/浏览器人类授权、Bot模型选择/多Bot/群/会议/归档恢复与六个一般产品发布门仍未新验收。

所有失败保留：入口缺失和legacy human grant RED、const-enum错误导入、profile installer缺失RED、装配依赖链接ELOOP、错误test lane的fs.symlink拒绝、归档manifest包数不符、恢复Session ID/sidecar/缺失artifact、stop ID冲突、disposal微任务窗口、非字符串command、native journal缺失/foreign metadata，以及SQLite null-prototype row canonicalizer的首轮回归失败。它们在证据根各自独立日志中；没有改写旧review失败或通过换材料选模型结果。

只装配独立运行时与临时验收Home，不启动daemon/服务，不改生产配置、网络权限或安全设置；未push/merge。现存0.0.0.0:1040为任务前平台listener，本任务新增listener为0。运行时为私有官方launcher/候选覆盖组合，不能等同stock npm rc.2或release-ready。
