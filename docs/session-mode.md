# 每 Bot 会话模式：公开定义与待决项

新增用户需求 2026-10-04 11:19。公开固定 `0.2.0-rc.2` 有多个正交 mode 含义；当前没有一项单一的 SessionMode 枚举能替代它们。

| 含义 | 精确公开合同 | 配置与生效 |
| --- | --- | --- |
| 计划协作状态 | `dsh-plan-mode/lib/types/index.d.ts` PlanModeController.get(agent) / set(agent, boolean) → committed / queued / cancelled / noop；types.d.ts PlanProjection {active,pending} | `plan/mode` 日志，冷恢复与 fork 折叠。空闲立即记录，open turn 到下一 accepted pre-step 生效；PlanModeConfig.section 是部署指导文本，不是 per Bot 可写全局默认 |
| 权限模式 | `dsh-permission-presets/lib/types/index.d.ts` catalog() / current(session) / resolve(name) / set(session,name)；types.d.ts PermissionCatalog {options,defaultOptions,defaultPreset} | live catalog 给实际 key；配置 presets/defaultPreset 属宿主，插件不改。权限组合 sandbox/mode + approval/policy；custom 是派生值不能选，auto 仅 live integration 存在时支持 |
| 投递方式 | SessionPromptRequest.mode queue / steer | 不等于持续会话工作模式 |
| 原生 Agent preset | SessionCreateRequest.agentPreset | composition 身份，不是 plan 或权限状态，不假定等价 |
| reasoning | ModelSelection / route | 与上述独立 |

官方来源：[权限模式定义](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/permission-presets.md)、公开 plan-mode 类型（本地固定包）。文档 master 会变化，本轮实施依据固定类型 manifest。

最小待决：用户指计划模式、权限模式，还是两者都需要？建议分别保留两个轴，等待主控集中确认。当前 alpha 配置预留 `sessionModes: {plan:null, permissions:null}`，无 loaded host live catalog 时非空选择返回 `unsupported_session_mode`，UI 禁用选择并显示原因。不会把静态包存在当作现场能力，更不会把权限预设改为全盘权限。模型/route/reasoning 与 mode 独立版本化。

后续正式 bridge 的生效协议：BotConfigVersion 保存明确 domain/value、catalog revision 与 mode policy 版本。新 contact/participation turn 和新 execution attempt 冻结配置；当前 attempt 不被默认修改改变。创建前固定目标 Session，首请求前读取持久 mode 确认；冷恢复按同一有效模式及撤权检查，回执未知先查回。模式变更影响后续 turn / attempt；旧执行需停止真实结算后才能换模式重做。权限选择只能在工具/scope/grant ceiling 内收紧；任何放宽需要新明确授权，不以模式字段授权。

只用已有公开 get/set/catalog，仍需 operation identity、最终 dispatch 快照和 scope 门配合；当前不调用它们。孤立读取 catalog 可安全设计，真实设置、冷恢复和行为验证未运行。可以在独立 checkout / 隔离 Home / 合成 provider 做公开服务单元测试；能否完整加载当前包与强隔离环境未测，不需新权限的结论保持未知。
