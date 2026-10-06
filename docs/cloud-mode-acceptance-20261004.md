# AgentPreset 离线最小适配验收

本阶段基于控制候选 `318df1a1d94915bf05298cc63c160ec69190d6a4`（tree `11f9e10fb256eca0e58788dfc85a8d2faeaeec53`）。唯一 writer 仍为云端 `历史隔离位置〔dsh-bot-development〕`；冻结 Mac backup 和独立安全切片未改。

## 已实现

- 明确用户模式为 AgentPreset；opaque ID 与自定义名称、model/reasoning、旧 plan/permissions 分开。
- 从受信 registry 的直接 list/defaultId 接口显式刷新健康元数据；无效/失败/替换清缓存，只有最新刷新可发布。不读 YAML 或凭据。
- 独立 agentPreset 配置版本；省略更新保留原选择，显式 null 只改变未来选择。schema 1 与旧字段、配置行、回执、Attempt/ProgressPlan 快照保留。
- 纯创建/blank 选择预检及 client/offline projection 回读；所有请求描述仍 blocked，不调用 native create/select/resolveAgent。
- 认证后的只读 metadata endpoint 和动态 UI helper；自定义名称显示，ID 原样入配置；未连接宿主时禁用。当前 Cordis 插件的命令入口仍拒绝 unsupported_host_identity。

## 验证与审查

基线 guard 67/67。新增产品模式16项与 UI/metadata3项，总计 **86/86**；静态28模块及严格 NodeNext 兼容类型消费者通过，diff-check通过。RED证据分别为8、8、3个缺功能失败，然后对应GREEN。原生模式46项与安全切片90项是此前独立证据，不加入本阶段计数。

独立设计审查发现2项接口歧义（client投影DTO与legacy可选字段），实施前修正后无剩余P1/P2。最终独立代码审查无P1/P2/minor；9个功能文件哈希匹配，指纹为 `e4ef97892db952ff1ea2d9f690009b6a5a90f6974f06568f8686a507992c52af`。审查没有替代测试或声称真实 runtime 验收。

见 [verification.json](evidence/cloud-mode-20261004/verification.json)、[review.json](evidence/cloud-mode-20261004/review.json)、[functional-files.json](evidence/cloud-mode-20261004/functional-files.json) 与 [完整 guard](evidence/cloud-mode-20261004/full-green.log)。本地最终 commit/tree 与 patch 在 `历史隔离位置〔candidate-receipt.json〕` 和 `agent-preset-adaptation.patch`。

## 未验收与边界

实际用户 roster、自定义模式现场、浏览器渲染、当前新 diff 在真实宿主加载、真正创建/选择及首请求、恢复与漂移检测均未验收。公开 rc.2 无可信持久 composition revision；YAML hash不作为运行时证明。原生写入、整个Bot闭环与六项发布门仍阻塞。

本阶段真实模型请求0、native写调用0、服务启动0；未改core、生产/安全配置或网络权限，未生成凭据、push、merge或发布。安全切片patch SHA256保持 `1515086b03e060a2acf5b77f69a24be90c463e793e4f363c3c8e00944f767261`。
