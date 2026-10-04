# 最小公开宿主补强（设计，尚未实现）

对固定 0.2.0-rc.2 的公开合同做增量扩展；不修改当前生产安装源。下列接口不因在插件中声明而成为宿主能力。

```ts
type NativeOperationId = string;
type Generation = string;
type Receipt = { operationId: NativeOperationId; sessionId: string; runGeneration: Generation | null; sourceRevision: number };
interface NativeBotControl {
  selectSessionModel(request: { operationId: NativeOperationId; sessionId: string; selection: { provider: string; model: string; reasoningEffort: string | null }; expectedSelectionRevision: number }): Promise<{ selection: Readonly<object>; selectionRevision: number; durable: true }>;
  admitOperation(request: { operationId: NativeOperationId; sessionId: string; producer: Readonly<object>; payloadDigest: string; fence: number; generation: Generation; configVersion: string; authorizationRef: string; scopeRef: string }): Promise<Receipt>;
  inspectOperation(request: { operationId: NativeOperationId; authorizedActor: string }): Promise<{ state: 'not_admitted_fenced' | 'admitted' | 'consumed' | 'settled' | 'outcome_unknown'; receipt: Receipt | null; evidence: Readonly<object> }>;
  stopRun(request: { operationId: NativeOperationId; sessionId: string; runGeneration: Generation; expectedFence: number; ownedTree: true }): Promise<{ state: 'requested' | 'partially_stopped' | 'confirmed_stopped' | 'unknown'; barrierRevision: number | null; resources: readonly Readonly<object>[] }>;
}
```

`dispatchPermit` 必须位于最终 provider 调用边界：解析 effective route/default 后比对不可变 ConfigSnapshot，校验 caller、fence、task/bot/membership/authority 世代和 scope，把同一不可变参数传给真实调用并记录 requestId。插件在 await 前读 ref 不能代替此原子边界。此门也用于后续每一步与 retry。

scope 是宿主授予的不透明引用：历史/检索候选在取出前过滤；每个工具以真实 caller 和 scopeRef 执行；路径包含 realpath/symlink/实际句柄边界。工具不能 enforce 就禁用，不能安装 unrestricted shell 再依赖提示词。插件自己的目录检查不是原生 sandbox 证明。

资源枚举按精确 owned tree / runGeneration：provider request、子代理、工具进程、inbox、quota 和锁逐项给权威终态或 unknown；请求 ACK、idle、caller timeout、lease expiry 都不得释放。旧 generation stop 永不影响新 generation；旧 effect 仍对账，不能自动重放。

## 独立开发与测试条件

公开上游允许在新 checkout 中开发；该 checkout、依赖缓存和隔离 DSH Home 均放本任务工作区。先用纯单元 contract tests 和合成 provider，禁止读取现有 home、credentials、Session 或连接生产端口。是否能完整安装公开依赖、固定上游提交并加载隔离宿主当前未验证，不能直接宣称无需新权限即可现场运行。

独立 tests：选型不改 Host default / 首 prompt 前 durable；外部 UI 改选与 dispatch barrier 竞态；图片 route/default 不默默 fallback；admit 成功回执丢失后 operation 查回零重放；高 fence 接管拒旧 worker；旧 run stop 晚到不伤新 run；timeout 工具残留保持占用；P/G1/G2 input/file/retrieval markers 不越域；真实 producer 贯穿冷恢复。测试不调用付费 provider。

这些单元 tests 可证明新接口实现的不变量，不能证明真实 provider 配额、取消时延、权限隔离或自然语言联络。后者须固定隔离加载版本、scope 工具与真实 provider 的单独授权。需要新持久访问、系统权限、凭据或生产补丁时停止，并由原主控集中协调。

## 对既有行为的影响

保留现有 selectModel 的全局 default 保存行为，新 selectSessionModel 只改目标；既有 prompt queue/steer 和 current-turn cancel 不变。新的 generation stop 不作为旧 cancel 的别名。持久 operation 表/事件增加 migration 与备份，缺少新能力的旧 host 返回 typed unsupported。archive/unarchive 保留现有语义，插件在其前后独立核验日志和 settlement，不追认 ACK 等同结束。

## 本次阻塞

Mac executor exec-server transport disconnected，consumer-local recovery timeout；Codex app message transport 也 closed。接口扩展仅设计，未开发或运行，不绕权限换环境。
