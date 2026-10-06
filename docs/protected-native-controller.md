# 私有产品 controller 与 protected native Session

后续已有实际 [owner app/profile 入口](owner-entry.md)：由原生启动器持有私有 fiber，默认关闭模型请求。本片的零模型 CLI 证据与下述 controller 既有真实 provider 验收分开记账。

云端是唯一产品 writer，Mac 已冻结停写。本片在已隔离的 cloud/control-alpha-fixes worktree 实现；不更换生产 installed runtime，不 push/merge。核心固定候选 3fbedc25，实际构建产物从独立候选目录加载。

新增私有 `dsh-bot/native-controller` entry 只供可信 launcher 持有，不能注册到公开 Cordis/RPC/HTTP service。constructor 要求实际 Cordis Context 与本运行时 llm/persistence；caller 只接受该 Context 的实际 fiber 对象。产品 ledger 的 native-owner grant 标记 host/runtime-owner，不把配置的人类标签、JSON actor、grant 记录或 Session ID 当认证能力。现有公开插件 execute() 继续拒绝 unsupported_host_identity，公开平台人类认证未验证。

该 controller 实际调用产品 Host、SessionCreationDriver 和持久操作 ledger；不是跳过产品的底座 fixture。创建两个不同的 contact/execution Sessions：先持久化 product creation intent 和 cross-journal identity，再以实际 provider-owned opaque factory 调用 NativeSessionDriver.createOwned。保护先于 Session 发布与 inbox wake，实际 handle/driver 由私有 map 保留。空白 Session 也必须 flush、open/readback 验证 header/cwd/preset 与 0 events，才可形成创建回执。

执行入口 `prepareNativeTextOperation` 固定已加载的 Session/AgentPreset、产品 config UUID、bot/task/authority epochs、原生 generation、provider/model/endpoint、reasoning off、maxTokens、operation deadline 和单步自有文本。UUID 映射到 controlConfigId，numeric native configVersion 独立保存。输入先匹配固定 native artifact 的 4096-byte 限制；opaque product operation/control IDs 经 ledger identity 与 ID 的 digest 映射成符合原生规则的短 ID。controller.admit 持久化 product admission intent，再调用 native journal；controller.drive 使用对应实际 driver。最终 provider guard 在 auth await 之后同步重查精确 active operation 的 deadline，以及产品 grant/config/epochs、创建确认、generation fence、原生 Session identity 与精确 wire。每次 provider attempt 都须先经过此门。

产品 `received` 仍只表示 command ledger 接纳。真实结果必须经 Session flush 和完整 readback，由 native journal 保存 terminal text、known usage、receipt 坐标和 digest，产品再投影该原始 operation。unknown 保留 capacity；拒绝、lost acknowledgement 或 lookup 不确认时不重放、不生成替代 operation。检查只查原 ID，不创建或唤醒 Session。已知的显式 startup/resume 则重新打开两个 authoritative journals，并在恢复 inbox 前调用 resumeOwned 附着 protection。不能从 JSONL 合成缺失的 native authority。

`stopNativeTextOperation` 先提交 product exact-generation fence 和 stop receipt，controller.stop 再调用实际 driver.stop。投影在同一个同步事务中重读产品字段，不能用 await 前的快照抹去已提交的 stop link。撤权后真实 owner 仍可 inspect/control，以便清理；撤权不能恢复 dispatch。发请求前 stop 的已接纳操作为 fenced、0 HTTP；在途 stop 若不能证明 provider 输出/用量则为 unknown、reservation held。local drain/idle/close 不是远端结算或已停止的证明。controller 注册真实 owner disposal effect，卸载开始即禁用命令/dispatch，再等待 startup 回滚与 native host/consumers 关闭；失败 startup 也释放已取得的 writer 与部分 driver。之后 launcher 才处置 product ledger。

范围为一 Bot、固定 healthy named empty preset、两个 fresh Sessions、零工具、单步文本。普通 startAttempt、动态 target/config/generation 同步、通用工具 scope、多 Bot/群/会议、公开人类入口和发布门仍未实现。`privateProductPathVerified` 仅表示该私有 controller 路径观察到 durable native settlement，不能单独证明真实 API、模型鉴权、公开身份或发布就绪。nativeRuntimeVerified/releaseReady 保持 false。

## 验证与真实任务

`npm test` 的原 103 个 guarded control tests 保持不变。`npm run test:native` 是另一个独立、凭据清空、禁止网络/监听/子进程的产物测试 launcher；实际 Cordis、产品 controller、native Session/journal/receipt 都运行，只替换外部 provider auth/HTTP response。需先在本隔离 worktree 的 ignored node_modules 链接固定 candidate artifacts，不能将测试 fake response 当真实 API。

针对性测试覆盖 owner 伪造拒绝、durable blank creation、actual receipt settling、auth await 中 config/revoke 阻断、独立 contact capacity、先 fence 再 drain、冷恢复与旧 caller 拒绝，以及 unknown 持久占用与零重放。

离线全通过和独立 review 后，以用户已授权的自有模式绑定只读审查执行最多四次真实 provider dispatch，retry=0、每 request 总截止 30 秒、cleanup 最多 7 秒。主审查/恢复跟进/在途 stop probe 使用固定 execution target 的 maxTokens=1200，contact maxTokens=160，总输出 cap=3760；固定 native target 不支持单次临时改为 400，不能绕 guard 修改 wire。顺序为有用审查与独立联络、contact 发请求前停止、authoritative reopen/readback 与 execution 新 followup、最后一次在途 stop probe 与只读重开。若上一项 unknown/拒绝/401/403/429/proxy/timeout，立即停后续请求；保留不确定结果，禁止换路或盲重试。只使用既有正规认证与 proxy 引用，报告仅允许模型名、状态/错误类别、用量、耗时与持久回执。原始 key/header/环境值/配置全文从未作为输入材料或报告读取。
