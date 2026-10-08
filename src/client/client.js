window.__ModuleLoader__.load({
  id: "dsh-bot",
  factory(require) {
    const {
      createElement: h,
      useState,
      useEffect,
      useSyncExternalStore,
    } = require("react");
    const translations = {
      zh: {
        title: "Bot 工作台",
        newSession: "新建 Bot 会话",
        close: "关闭",
        refresh: "刷新",
        empty: "请先在工作台创建并命名一个 Bot",
        choose: "选择已创建的 Bot",
        start: "开始对话",
        manage: "管理此 Bot",
      },
      en: {
        title: "Bot workbench",
        newSession: "New Bot conversation",
        close: "Close",
        refresh: "Refresh",
        empty: "Create and name a Bot in the workbench first",
        choose: "Choose an existing Bot",
        start: "Start conversation",
        manage: "Manage this Bot",
      },
    };
    const styles = `.dsh-bot{font:inherit;color:var(--dsw-alias-label-primary);padding:24px;overflow:auto;height:100%;box-sizing:border-box}.dsh-bot *{box-sizing:border-box}.dsh-bot h1{font-size:24px;margin:0}.dsh-bot h2{font-size:17px;margin:0 0 16px}.dsh-bot h3{font-size:15px;margin:0 0 8px}.dsh-bot p{line-height:1.65}.dsh-bot small,.dsh-bot .muted{color:var(--dsw-alias-label-secondary)}.dsh-bot header,.dsh-bot nav,.dsh-bot .actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dsh-bot header{justify-content:space-between;margin-bottom:20px}.dsh-bot nav{margin-bottom:20px}.dsh-bot button,.dsh-bot input,.dsh-bot select,.dsh-bot textarea{font:inherit;color:inherit;border:1px solid var(--dsw-alias-border-l2,currentColor);border-radius:8px;background:var(--dsw-alias-bg-layer-2,transparent);padding:9px 12px}.dsh-bot button{cursor:pointer}.dsh-bot button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsh-bot button:disabled{opacity:.5;cursor:wait}.dsh-bot button[aria-selected=true],.dsh-bot button.primary{background:var(--dsw-alias-state-business-primary);color:white}.dsh-bot form{display:grid;gap:12px}.dsh-bot label{display:grid;gap:6px;font-size:13px}.dsh-bot input,.dsh-bot select,.dsh-bot textarea{width:100%;min-width:0}.dsh-bot textarea{min-height:92px;resize:vertical}.dsh-bot .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px;align-items:start}.dsh-bot .card{border:1px solid var(--dsw-alias-border-l2,currentColor);border-radius:12px;padding:18px;margin-bottom:16px;background:var(--dsw-alias-bg-layer-1,transparent)}.dsh-bot .error{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}.dsh-bot pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 monospace;max-height:360px;overflow:auto}.dsh-bot .status{font-size:12px;padding:4px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,transparent)}.dsh-bot .check{display:flex;align-items:center;gap:8px}.dsh-bot .check input{width:auto}.dsh-bot-dialog{position:fixed;inset:0;display:grid;place-items:center;pointer-events:auto;background:rgba(0,0,0,.35);z-index:90}.dsh-bot-dialog .dsh-bot{height:auto;width:min(480px,calc(100vw - 32px));background:var(--dsw-alias-bg-layer-1,Canvas);border-radius:16px;max-height:90vh;overflow:auto}`;
    return {
      inject: [
        "slots",
        "locale",
        "connection",
        "layout",
        "uiWorkspace",
        "sessions",
      ],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register("dsh.bot", translations));
        const t = ctx.locale.bind("dsh.bot"),
          listeners = new Set(),
          lifetime = new AbortController();
        let interval,
          refreshing,
          pendingLoaded = false;
        let state = {
          snapshot: {
            bots: [],
            tasks: [],
            sessions: [],
            memories: [],
            grants: [],
            groups: [],
            meetings: [],
            outbox: [],
            attempts: [],
          },
          catalog: { providers: [], presets: [] },
          error: "",
          busy: false,
          chooser: false,
          pending: [],
          loading: true,
        };
        const publish = (patch) => {
          state = { ...state, ...patch };
          for (const listener of listeners) listener();
        };
        const useView = () =>
          useSyncExternalStore(
            (listener) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
            () => state,
            () => state,
          );
        const storageKey = () =>
          `dsh-bot.pending.v1.${state.snapshot.storeId ?? "unknown"}`;
        function savePending() {
          try {
            localStorage.setItem(storageKey(), JSON.stringify(state.pending));
          } catch {
            /* live original ids remain visible in this workbench */
          }
        }
        async function rpc(endpoint, payload = {}) {
          const signal = AbortSignal.any([
              lifetime.signal,
              AbortSignal.timeout(15000),
            ]),
            reply = await ctx.connection.rpc.call(
              "/api",
              `dsh.bot/${endpoint}`,
              payload,
              signal,
            );
          if (!reply.ok)
            throw Object.assign(Error(reply.error.message), {
              code: reply.error.code,
            });
          return reply.value;
        }
        async function refresh(catalog = false) {
          if (refreshing) return refreshing;
          refreshing = (async () => {
            try {
              const snapshot = await rpc("snapshot");
              let pending = state.pending;
              if (!pendingLoaded && snapshot.storeId) {
                pendingLoaded = true;
                try {
                  const stored = JSON.parse(
                    localStorage.getItem(
                      `dsh-bot.pending.v1.${snapshot.storeId}`,
                    ) ?? "[]",
                  );
                  if (Array.isArray(stored) && stored.length <= 30)
                    pending = stored;
                } catch {
                  /* invalid browser cache cannot modify host state */
                }
              }
              publish({
                snapshot,
                pending,
                loading: false,
                ...(catalog ? { catalog: await rpc("catalog") } : {}),
              });
            } catch (error) {
              if (!lifetime.signal.aborted)
                publish({
                  error: `${error.code ?? "connection"}：${error.message}`,
                  loading: false,
                });
            } finally {
              refreshing = null;
            }
          })();
          return refreshing;
        }
        async function command(action, input, original) {
          const request = original ?? {
            operationId: crypto.randomUUID(),
            action,
            input,
          };
          if (state.busy) return;
          if (
            !state.pending.some(
              (row) => row.operationId === request.operationId,
            )
          ) {
            publish({ pending: [...state.pending, request].slice(-30) });
            savePending();
          }
          publish({ busy: true, error: "" });
          try {
            const value = await rpc("command", request);
            publish({
              pending: state.pending.filter(
                (row) => row.operationId !== request.operationId,
              ),
            });
            savePending();
            await refresh();
            return value;
          } catch (error) {
            publish({
              error: `${error.code ?? "unknown"}：${error.message}\n原始操作 ${request.operationId} 已保留，请查回后接续。`,
            });
          } finally {
            publish({ busy: false });
          }
        }
        const button = (text, onClick, extra = {}) =>
          h(
            "button",
            { type: "button", onClick, disabled: state.busy, ...extra },
            text,
          );
        const option = (value, label) =>
          h("option", { key: value, value }, label);
        const field = (
          label,
          name,
          {
            value = "",
            type = "text",
            required = true,
            options,
            textarea = false,
            ...extra
          } = {},
        ) =>
          h(
            "label",
            null,
            label,
            options
              ? h(
                  "select",
                  {
                    name,
                    "aria-label": label,
                    defaultValue: value,
                    required,
                    ...extra,
                  },
                  options.map((row) => option(row.value, row.label)),
                )
              : textarea
                ? h("textarea", {
                    name,
                    "aria-label": label,
                    defaultValue: value,
                    required,
                    ...extra,
                  })
                : h("input", {
                    name,
                    "aria-label": label,
                    type,
                    defaultValue: value,
                    required,
                    ...extra,
                  }),
          );
        const resourceCard = (key, title, ...children) =>
          h(
            "section",
            { className: "card", key },
            h("h2", null, title),
            ...children,
          );
        const card = (title, ...children) =>
          resourceCard(undefined, title, ...children);
        const form = (label, submit, ...children) =>
          h(
            "form",
            {
              key: label,
              onSubmit: (event) => {
                event.preventDefault();
                submit(new FormData(event.currentTarget));
              },
            },
            ...children,
            h(
              "button",
              { type: "submit", className: "primary", disabled: state.busy },
              label,
            ),
          );
        const check = (name, label, checked = true) =>
          h(
            "label",
            { className: "check" },
            h("input", { type: "checkbox", name, defaultChecked: checked }),
            label,
          );
        const botsOptions = () =>
          state.snapshot.bots.map((bot) => ({
            value: bot.botId,
            label: bot.name,
          }));
        const modelsOptions = () =>
          state.catalog.providers.flatMap((provider) =>
            (provider.models ?? []).map((model) => ({
              value: JSON.stringify({ provider: provider.id, model: model.id }),
              label: `${provider.name ?? provider.id} / ${model.name ?? model.id}`,
            })),
          );
        const stateName = (value) =>
          ({
            queued: "待开始",
            running: "执行中",
            starting: "准备中",
            stopping: "停止已接受，待结算",
            stop_requested: "停止已接受，待结算",
            returned: "已返回",
            awaiting_acceptance: "待验收",
            completed: "已完成",
            stopped: "已停止",
            failed: "失败",
            UNKNOWN: "未知，需查回",
            ready: "可接续",
            settled: "已结算",
            creating: "创建中",
            independent: "独立意见封存中",
            discussion: "讨论",
            decision: "决定",
            complete: "已完成",
            cancelled: "已取消",
            active: "启用",
            paused: "暂停",
            archived: "归档",
            passed: "通过",
            unknown: "待定",
            accepted: "已投递",
            available: "结果已保存",
            blocked: "投递受限",
          })[value] ?? value;
        const openSession = async (sessionId, nativeRow) => {
          const row =
            nativeRow ??
            state.snapshot.sessions.find((row) => row.sessionId === sessionId);
          try {
            await ctx.sessions.refresh();
            const parentSessionId =
              row?.parentSessionId ?? row?.header?.parentSession;
            ctx.uiWorkspace.openSession(
              parentSessionId
                ? {
                    parentSessionId,
                    childSessionId: sessionId,
                    mode: row?.parentSessionId ? "one-shot" : "unknown",
                  }
                : sessionId,
            );
          } catch (error) {
            publish({ error: `无法打开原生会话：${error.message}` });
          }
        };
        function BotEditor({ bot }) {
          const models = modelsOptions(),
            contact = bot
              ? JSON.stringify({
                  provider: bot.contact.provider,
                  model: bot.contact.model,
                })
              : models[0]?.value;
          return card(
            bot ? "编辑 Bot" : "创建具名 Bot",
            form(
              bot ? "保存配置" : "创建 Bot",
              (data) => {
                const configuration = {
                  name: data.get("name"),
                  role: data.get("role"),
                  cwd: data.get("cwd"),
                  contact: {
                    ...JSON.parse(data.get("contact")),
                    reasoningEffort: data.get("contactEffort") || undefined,
                    maxTokens: Number(data.get("contactMaxTokens")),
                    ...(bot?.contact.temperature === undefined
                      ? {}
                      : { temperature: bot.contact.temperature }),
                  },
                  execution: {
                    ...JSON.parse(data.get("execution")),
                    reasoningEffort: data.get("executionEffort") || undefined,
                    maxTokens: Number(data.get("executionMaxTokens")),
                    ...(bot?.execution.temperature === undefined
                      ? {}
                      : { temperature: bot.execution.temperature }),
                  },
                  presetId: data.get("preset") || null,
                  capabilities: String(data.get("capabilities") || "")
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean),
                };
                for (const selected of [
                  configuration.contact,
                  configuration.execution,
                ])
                  if (selected.reasoningEffort === undefined)
                    delete selected.reasoningEffort;
                return command(bot ? "bot.update" : "bot.create", {
                  ...configuration,
                  ...(bot
                    ? { botId: bot.botId, expectedVersion: bot.revision }
                    : {}),
                });
              },
              field("名称", "name", { value: bot?.name, maxLength: 100 }),
              field("身份与职责", "role", {
                value: bot?.role,
                textarea: true,
                required: false,
                maxLength: 8192,
              }),
              field("工作目录（DSH 所在机器）", "cwd", {
                value: bot?.cwd ?? state.catalog.defaultCwd ?? "",
                placeholder: "/absolute/workspace",
              }),
              field("联络模型", "contact", { value: contact, options: models }),
              field("联络思考程度（留空使用当前模型默认）", "contactEffort", {
                value: bot?.contact.reasoningEffort ?? "",
                required: false,
              }),
              field("联络每轮回复上限（tokens）", "contactMaxTokens", {
                type: "number",
                min: 1,
                max: 262144,
                step: 1,
                value: bot?.contact.maxTokens ?? 4096,
              }),
              field("执行模型", "execution", {
                value: bot
                  ? JSON.stringify({
                      provider: bot.execution.provider,
                      model: bot.execution.model,
                    })
                  : contact,
                options: models,
              }),
              field("执行思考程度", "executionEffort", {
                value: bot?.execution.reasoningEffort ?? "",
                required: false,
              }),
              field("执行每轮回复上限（tokens）", "executionMaxTokens", {
                type: "number",
                min: 1,
                max: 262144,
                step: 1,
                value: bot?.execution.maxTokens ?? 4096,
              }),
              field("原生 Agent preset", "preset", {
                value: bot?.presetId ?? "",
                options: [
                  { value: "", label: "使用原生默认 preset" },
                  ...state.catalog.presets
                    .filter((row) => !row.broken)
                    .map((row) => ({
                      value: row.id,
                      label: row.name ?? row.id,
                    })),
                ],
                required: false,
              }),
              field("允许使用的原生工具（逗号分隔名称）", "capabilities", {
                value: (bot?.capabilities ?? []).join(","),
                required: false,
              }),
              h(
                "small",
                null,
                `填写原生注册名，区分大小写，例如 bash。当前可查到：${(state.catalog.nativeTools ?? []).join("、") || "请先选择 preset 并创建会话"}`,
              ),
              h(
                "small",
                null,
                "模型取自当前 DSH；执行尝试启动后保持当次配置。工具权限由你授予。",
              ),
            ),
          );
        }
        function BotsPane() {
          const [editing, setEditing] = useState(null),
            view = useView();
          const selected = view.snapshot.bots.find(
            (bot) => bot.botId === editing,
          );
          const cards = view.snapshot.bots.map((bot) =>
            resourceCard(
              bot.botId,
              bot.name,
              h("p", { className: "muted" }, bot.role || "未设置职责"),
              h(
                "p",
                null,
                `联络 ${bot.contact.provider}/${bot.contact.model} · 执行 ${bot.execution.provider}/${bot.execution.model}`,
              ),
              h(
                "p",
                null,
                `工作槽 ${view.snapshot.attempts.filter((row) => row.botId === bot.botId && row.reservationHeld).length}/15 · ${stateName(bot.lifecycle)}`,
              ),
              h(
                "div",
                { className: "actions" },
                button("新会话", () => publish({ chooser: true })),
                button("编辑", () => setEditing(bot.botId)),
                button(bot.lifecycle === "active" ? "暂停" : "启用", () =>
                  command("bot.update", {
                    botId: bot.botId,
                    expectedVersion: bot.revision,
                    lifecycle: bot.lifecycle === "active" ? "paused" : "active",
                  }),
                ),
              ),
            ),
          );
          return h(
            "div",
            { className: "grid" },
            h(
              "div",
              null,
              ...cards,
              button("创建另一个 Bot", () => setEditing(null)),
            ),
            h(BotEditor, {
              key: selected ? `${selected.botId}:${selected.revision}` : "new",
              bot: selected,
            }),
          );
        }
        function MemoryPane() {
          const view = useView(),
            [id, setId] = useState(""),
            botId = id || view.snapshot.bots[0]?.botId;
          return h(
            "div",
            { className: "grid" },
            card(
              "长期记忆",
              h(
                "label",
                null,
                "Bot",
                h(
                  "select",
                  {
                    "aria-label": "Bot",
                    value: botId ?? "",
                    onChange: (event) => setId(event.target.value),
                  },
                  botsOptions().map((row) => option(row.value, row.label)),
                ),
              ),
              ...view.snapshot.memories
                .filter((row) => row.botId === botId)
                .map((row) =>
                  h(
                    "article",
                    { className: "card", key: row.memoryId },
                    h("p", null, row.text),
                    h("small", null, `版本 ${row.version}`),
                    row.source?.sessionId &&
                      button("查看来源", () =>
                        openSession(row.source.sessionId),
                      ),
                    button("遗忘此记忆", () =>
                      command("memory.forget", {
                        memoryId: row.memoryId,
                        expectedVersion: row.version,
                      }),
                    ),
                  ),
                ),
            ),
            card(
              "添加记忆",
              form(
                "保存到所选 Bot",
                (data) =>
                  command("memory.write", {
                    botId,
                    text: data.get("text"),
                    category: "fact",
                  }),
                field("内容", "text", { textarea: true, maxLength: 8192 }),
                h(
                  "small",
                  null,
                  "每个 Bot 分别保存；遗忘保留原始会话和来源记录。",
                ),
              ),
            ),
          );
        }
        function TasksPane() {
          const view = useView();
          const [recipients, setRecipients] = useState([]);
          useEffect(() => {
            let active = true;
            (async () => {
              const rows = [];
              let cursor;
              do {
                const page = await rpc("command", {
                  action: "session.list",
                  input: { limit: 500, ...(cursor ? { cursor } : {}) },
                });
                rows.push(...page.items);
                cursor = page.nextCursor;
              } while (cursor);
              if (active) setRecipients(rows);
            })().catch((error) => {
              if (active) publish({ error: error.message });
            });
            return () => {
              active = false;
            };
          }, []);
          return h(
            "div",
            { className: "grid" },
            h(
              "div",
              null,
              ...view.snapshot.tasks.map((task) => {
                const attempt = view.snapshot.attempts.find(
                    (row) => row.attemptId === task.currentAttemptId,
                  ),
                  owner = view.snapshot.bots.find(
                    (row) => row.botId === task.botId,
                  );
                return resourceCard(
                  task.taskId,
                  task.title,
                  h(
                    "p",
                    null,
                    `${owner?.name ?? "Bot"} · ${stateName(task.state)} · 验收 ${stateName(task.acceptance)}`,
                  ),
                  h("p", null, task.goal),
                  h("small", null, `验收条件：${task.criteria.join("；")}`),
                  h(
                    "div",
                    { className: "actions" },
                    attempt &&
                      button("查看执行", () => openSession(attempt.sessionId)),
                    button(
                      "开始／接续",
                      () =>
                        command("task.start", {
                          taskId: task.taskId,
                          expectedVersion: task.version,
                        }),
                      {
                        disabled:
                          view.busy ||
                          !!attempt?.reservationHeld ||
                          task.archived,
                      },
                    ),
                    attempt?.reservationHeld &&
                      button("停止本次尝试", () =>
                        command("task.stop", {
                          taskId: task.taskId,
                          attemptId: attempt.attemptId,
                          epoch: attempt.epoch,
                        }),
                      ),
                    button(
                      task.archived ? "恢复" : "归档",
                      () =>
                        command(
                          task.archived ? "task.restore" : "task.archive",
                          {
                            taskId: task.taskId,
                            expectedVersion: task.version,
                          },
                        ),
                      { disabled: view.busy || !!attempt?.reservationHeld },
                    ),
                  ),
                  !task.archived &&
                    !attempt?.reservationHeld &&
                    view.snapshot.attempts.some(
                      (row) =>
                        row.botId === task.botId &&
                        row.depth === 0 &&
                        row.reservationHeld &&
                        row.taskId !== task.taskId,
                    ) &&
                    form(
                      "作为一级子工作开始",
                      (data) =>
                        command("task.start", {
                          taskId: task.taskId,
                          expectedVersion: task.version,
                          parentAttemptId: data.get("parentAttemptId"),
                        }),
                      field("所属父工作", "parentAttemptId", {
                        options: view.snapshot.attempts
                          .filter(
                            (row) =>
                              row.botId === task.botId &&
                              row.depth === 0 &&
                              row.reservationHeld &&
                              row.taskId !== task.taskId,
                          )
                          .map((row) => ({
                            value: row.attemptId,
                            label: `${view.snapshot.tasks.find((task) => task.taskId === row.taskId)?.title ?? "父工作"} · ${row.attemptId.slice(0, 12)}`,
                          })),
                      }),
                    ),
                  attempt?.result &&
                    h(
                      "pre",
                      null,
                      attempt.result.content
                        .map((block) => block.text ?? "")
                        .join("\n"),
                    ),
                  attempt &&
                    h(
                      "small",
                      null,
                      `本地资源：${attempt.reservationHeld ? "尚未结算" : "已结算"}；外部副作用：${attempt.externalEffects}；用量：${attempt.usage === "UNKNOWN" ? "未知" : JSON.stringify(attempt.usage)}`,
                    ),
                  form(
                    "调整目标",
                    (data) =>
                      command("task.adjust", {
                        taskId: task.taskId,
                        expectedVersion: task.version,
                        goal: data.get("goal"),
                      }),
                    field("新目标", "goal", {
                      value: task.goal,
                      textarea: true,
                    }),
                  ),
                  attempt &&
                    !attempt.reservationHeld &&
                    form(
                      "记录验收",
                      (data) =>
                        command("task.accept", {
                          taskId: task.taskId,
                          expectedVersion: task.version,
                          attemptId: attempt.attemptId,
                          outcome: data.get("outcome"),
                          evidence: data.get("evidence"),
                        }),
                      field("结论", "outcome", {
                        value: task.acceptance,
                        options: [
                          { value: "unknown", label: "待定" },
                          { value: "passed", label: "通过" },
                          { value: "failed", label: "不通过" },
                        ],
                      }),
                      field("实际证据", "evidence", { textarea: true }),
                    ),
                );
              }),
            ),
            card(
              "新任务",
              form(
                "登记任务",
                (data) =>
                  command("task.create", {
                    botId: data.get("botId"),
                    title: data.get("title"),
                    goal: data.get("goal"),
                    criteria: String(data.get("criteria"))
                      .split("\n")
                      .filter(Boolean),
                    ...(data.get("origin")
                      ? { originSessionId: data.get("origin") }
                      : {}),
                  }),
                field("负责人", "botId", { options: botsOptions() }),
                field("标题", "title", { maxLength: 200 }),
                field("目标", "goal", { textarea: true, maxLength: 16000 }),
                field("验收条件（每行一项）", "criteria", {
                  textarea: true,
                  required: false,
                }),
                field("结果接收会话", "origin", {
                  options: [
                    { value: "", label: "保存在工作台" },
                    ...view.snapshot.sessions
                      .filter(
                        (row) =>
                          row.purpose === "contact" &&
                          !row.archived &&
                          row.state === "ready",
                      )
                      .map((row) => ({
                        value: row.sessionId,
                        label: `${view.snapshot.bots.find((bot) => bot.botId === row.botId)?.name} · ${row.sessionId.slice(0, 8)}`,
                      })),
                    ...recipients
                      .filter((row) => row.type === "ordinary" && !row.archived)
                      .map((row) => ({
                        value: row.sessionId,
                        label: `普通会话 · ${row.header?.title ?? "未命名"} · ${row.sessionId.slice(0, 8)}`,
                      })),
                  ],
                  required: false,
                }),
              ),
            ),
          );
        }
        function SharingPane() {
          const view = useView();
          return h(
            "div",
            { className: "grid" },
            h(
              "div",
              null,
              ...view.snapshot.bots.map((bot) =>
                resourceCard(
                  bot.botId,
                  `${bot.name} 的共享范围`,
                  form(
                    "保存共享上限",
                    (data) =>
                      command("share.set", {
                        botId: bot.botId,
                        share: {
                          enabled: data.get("enabled") === "on",
                          receivers: data.getAll("receiver"),
                          scope: Object.fromEntries(
                            ["sessions", "tasks", "memories"].map((key) => [
                              key,
                              data.get(key) === "on" ? ["*"] : [],
                            ]),
                          ),
                        },
                      }),
                    check(
                      "enabled",
                      "允许其他 Bot 只读了解",
                      bot.share.enabled,
                    ),
                    ...view.snapshot.bots
                      .filter((row) => row.botId !== bot.botId)
                      .map((row) =>
                        check(
                          "receiver",
                          row.name,
                          bot.share.receivers.includes("*") ||
                            bot.share.receivers.includes(row.botId),
                        ),
                      )
                      .map((element, index) =>
                        h(
                          "label",
                          { className: "check", key: index },
                          h("input", {
                            type: "checkbox",
                            name: "receiver",
                            value: view.snapshot.bots.filter(
                              (row) => row.botId !== bot.botId,
                            )[index].botId,
                            defaultChecked:
                              bot.share.receivers.includes("*") ||
                              bot.share.receivers.includes(
                                view.snapshot.bots.filter(
                                  (row) => row.botId !== bot.botId,
                                )[index].botId,
                              ),
                          }),
                          view.snapshot.bots.filter(
                            (row) => row.botId !== bot.botId,
                          )[index].name,
                        ),
                      ),
                    check(
                      "sessions",
                      "共享会话",
                      bot.share.scope.sessions?.includes("*"),
                    ),
                    check(
                      "tasks",
                      "共享任务",
                      bot.share.scope.tasks?.includes("*"),
                    ),
                    check(
                      "memories",
                      "共享记忆",
                      bot.share.scope.memories?.includes("*"),
                    ),
                  ),
                ),
              ),
            ),
            h(
              "div",
              null,
              card(
                "持续授权",
                form(
                  "授予权限",
                  (data) =>
                    command("grant.set", {
                      grantId: crypto.randomUUID(),
                      ownerBotId: data.get("owner") || null,
                      recipientBotId: data.get("recipient"),
                      level: data.get("level"),
                      active: true,
                      scope: Object.fromEntries(
                        ["sessions", "tasks"].map((key) => [
                          key,
                          data.get(key) === "on"
                            ? data.get(`${key}Ids`)?.trim()
                              ? String(data.get(`${key}Ids`))
                                  .split(",")
                                  .map((x) => x.trim())
                              : ["*"]
                            : [],
                        ]),
                      ),
                    }),
                  field("资源归属", "owner", {
                    options: [
                      { value: "", label: "普通 DSH 会话（只授权明确 ID）" },
                      ...botsOptions(),
                    ],
                    required: false,
                  }),
                  field("接收 Bot", "recipient", { options: botsOptions() }),
                  field("权限", "level", {
                    options: [
                      { value: "read", label: "只读" },
                      { value: "control", label: "控制会话和任务" },
                    ],
                  }),
                  check("sessions", "允许会话"),
                  field(
                    "会话 ID（逗号分隔；Bot 资源留空表示全部）",
                    "sessionsIds",
                    { required: false },
                  ),
                  check("tasks", "允许任务"),
                  field("任务 ID", "tasksIds", { required: false }),
                  h(
                    "small",
                    null,
                    "控制授权受资源所有者的共享上限约束；配置、授权和他 Bot 记忆仍由人类管理。",
                  ),
                ),
              ),
              ...view.snapshot.grants.map((grant) =>
                resourceCard(
                  grant.grantId,
                  "已保存的授权",
                  h(
                    "p",
                    null,
                    `${view.snapshot.bots.find((bot) => bot.botId === grant.recipientBotId)?.name} · ${grant.level === "control" ? "控制" : "只读"} · ${grant.active ? "有效" : "已撤销"}`,
                  ),
                  h("small", null, JSON.stringify(grant.scope)),
                  button(grant.active ? "撤销" : "重新启用", () =>
                    command("grant.set", {
                      grantId: grant.grantId,
                      ownerBotId: grant.ownerBotId,
                      recipientBotId: grant.recipientBotId,
                      level: grant.level,
                      scope: grant.scope,
                      active: !grant.active,
                    }),
                  ),
                ),
              ),
            ),
          );
        }
        function GroupsPane() {
          const view = useView();
          return h(
            "div",
            { className: "grid" },
            h(
              "div",
              null,
              ...view.snapshot.groups.map((group) =>
                resourceCard(
                  group.groupId,
                  group.name,
                  h(
                    "p",
                    null,
                    group.members
                      .filter((row) => row.active)
                      .map(
                        (row) =>
                          view.snapshot.bots.find(
                            (bot) => bot.botId === row.botId,
                          )?.name,
                      )
                      .join("、"),
                  ),
                  ...group.messages
                    .slice(-30)
                    .map((row) =>
                      h(
                        "p",
                        { key: row.messageId },
                        h(
                          "strong",
                          null,
                          row.producer.kind === "human"
                            ? "你："
                            : `${view.snapshot.bots.find((bot) => bot.botId === row.producer.botId)?.name ?? "Bot"}：`,
                        ),
                        row.text,
                      ),
                    ),
                  form(
                    "发送给群成员",
                    (data) =>
                      command("group.post", {
                        groupId: group.groupId,
                        text: data.get("text"),
                      }),
                    field("消息", "text", { textarea: true }),
                  ),
                  form(
                    "发起会议",
                    (data) =>
                      command("meeting.start", {
                        groupId: group.groupId,
                        topic: data.get("topic"),
                        materials: data.get("materials"),
                      }),
                    field("议题", "topic", { maxLength: 1000 }),
                    field("共同材料", "materials", {
                      textarea: true,
                      required: false,
                      maxLength: 32000,
                    }),
                  ),
                  form(
                    "更新群成员",
                    (data) =>
                      command("group.members", {
                        groupId: group.groupId,
                        expectedVersion: group.version,
                        botIds: data.getAll("botIds"),
                        coordinatorBotId: data.get("coordinator"),
                      }),
                    field("成员（可多选）", "botIds", {
                      options: botsOptions(),
                      multiple: true,
                      value: group.members
                        .filter((row) => row.active)
                        .map((row) => row.botId),
                    }),
                    field("协调者", "coordinator", {
                      options: botsOptions(),
                      value: group.coordinatorBotId,
                    }),
                  ),
                ),
              ),
            ),
            card(
              "新建内部群",
              form(
                "创建群",
                (data) =>
                  command("group.create", {
                    name: data.get("name"),
                    botIds: data.getAll("botIds"),
                    coordinatorBotId: data.get("coordinator"),
                    rounds: Number(data.get("rounds")),
                    maxRequests: Number(data.get("requests")),
                  }),
                field("群名称", "name", { maxLength: 100 }),
                field("成员（可多选）", "botIds", {
                  options: botsOptions(),
                  multiple: true,
                }),
                field("协调者（必须在成员中）", "coordinator", {
                  options: botsOptions(),
                }),
                field("每条人类消息的最大成员轮数", "rounds", {
                  type: "number",
                  value: 1,
                  min: 1,
                  max: 3,
                }),
                field("每次群轮的模型请求预算", "requests", {
                  type: "number",
                  value: 12,
                  min: 1,
                  max: 60,
                }),
              ),
            ),
          );
        }
        function MeetingsPane() {
          const view = useView();
          return h(
            "div",
            null,
            ...view.snapshot.meetings.map((meeting) =>
              resourceCard(
                meeting.meetingId,
                meeting.topic,
                h(
                  "p",
                  null,
                  `${stateName(meeting.phase)} · 已收到独立意见 ${Object.keys(meeting.opinions).length}/${meeting.participants.filter((row) => row.active).length} · 请求 ${meeting.requests}/${meeting.maxRequests}`,
                ),
                h("p", { className: "muted" }, meeting.materials),
                meeting.phase !== "independent" &&
                  h(
                    "div",
                    null,
                    ...Object.values(meeting.opinions).map((row) =>
                      h(
                        "article",
                        { className: "card", key: row.botId },
                        h(
                          "h3",
                          null,
                          view.snapshot.bots.find(
                            (bot) => bot.botId === row.botId,
                          )?.name,
                        ),
                        h("p", null, row.text),
                      ),
                    ),
                  ),
                ...Object.values(meeting.discussion).map((row) =>
                  h(
                    "p",
                    { key: row.botId },
                    `${view.snapshot.bots.find((bot) => bot.botId === row.botId)?.name}：${row.text}`,
                  ),
                ),
                meeting.decision &&
                  card("真实协调者决定", h("p", null, meeting.decision.text)),
                Object.keys(meeting.absences).length > 0 &&
                  h(
                    "p",
                    { className: "error" },
                    `缺席原因：${Object.values(meeting.absences)
                      .map((row) => row.reason)
                      .join("；")}`,
                  ),
                h(
                  "div",
                  { className: "actions" },
                  !["complete", "cancelled"].includes(meeting.phase) &&
                    button(
                      {
                        independent: "揭示并讨论",
                        discussion: "进入决定",
                        decision: "结束会议",
                      }[meeting.phase],
                      () =>
                        command("meeting.advance", {
                          meetingId: meeting.meetingId,
                          epoch: meeting.epoch,
                          phase: meeting.phase,
                        }),
                    ),
                  !["complete", "cancelled"].includes(meeting.phase) &&
                    button("取消会议", () =>
                      command("meeting.cancel", {
                        meetingId: meeting.meetingId,
                        epoch: meeting.epoch,
                      }),
                    ),
                ),
                meeting.decision &&
                  form(
                    "生成真实行动任务",
                    (data) =>
                      command("meeting.action", {
                        meetingId: meeting.meetingId,
                        epoch: meeting.epoch,
                        botId: data.get("botId"),
                        title: data.get("title"),
                        goal: data.get("goal"),
                        criteria: String(data.get("criteria"))
                          .split("\n")
                          .filter(Boolean),
                      }),
                    field("负责人", "botId", { options: botsOptions() }),
                    field("任务标题", "title"),
                    field("行动目标", "goal", { textarea: true }),
                    field("验收条件", "criteria", { textarea: true }),
                  ),
                !["complete", "cancelled"].includes(meeting.phase) &&
                  form(
                    "修改议题并重开独立意见",
                    (data) =>
                      command("meeting.topic", {
                        meetingId: meeting.meetingId,
                        epoch: meeting.epoch,
                        topic: data.get("topic"),
                        materials: data.get("materials"),
                      }),
                    field("新议题", "topic", { value: meeting.topic }),
                    field("新材料", "materials", {
                      value: meeting.materials,
                      textarea: true,
                      required: false,
                    }),
                  ),
              ),
            ),
          );
        }
        function SessionsPane() {
          const [page, setPage] = useState({ items: [], cursor: null }),
            [error, setError] = useState("");
          const load = (cursor) =>
            rpc("command", {
              action: "session.list",
              input: { limit: 50, ...(cursor ? { cursor } : {}) },
            })
              .then((next) =>
                setPage((previous) => ({
                  items: cursor
                    ? [...previous.items, ...next.items]
                    : next.items,
                  cursor: next.nextCursor,
                })),
              )
              .catch((e) => setError(e.message));
          useEffect(() => {
            load();
          }, []);
          return card(
            "原生会话管理",
            button("刷新会话", () => load()),
            h(
              "p",
              { className: "muted" },
              "包含普通会话、Bot 联络、执行、群会议和归档对象。查看历史沿用原生日志。",
            ),
            error && h("p", { className: "error" }, error),
            ...page.items.map((row) => {
              const binding = state.snapshot.sessions.find(
                (item) => item.sessionId === row.sessionId,
              );
              return h(
                "article",
                { className: "card", key: row.sessionId },
                h(
                  "h3",
                  null,
                  row.header?.title ||
                    state.snapshot.bots.find((bot) => bot.botId === row.botId)
                      ?.name ||
                    row.sessionId.slice(0, 8),
                ),
                h(
                  "p",
                  null,
                  `${row.purpose ?? "普通会话"} · ${stateName(binding?.state ?? "ready")}`,
                ),
                h("small", null, row.sessionId),
                h(
                  "div",
                  { className: "actions" },
                  button("查看原生会话", () => openSession(row.sessionId, row)),
                  row.activity &&
                    !row.attemptId &&
                    !row.parentSessionId &&
                    !row.header?.parentSession &&
                    !row.lineage &&
                    button("停止当前回复", async () => {
                      await command("session.stop", {
                        sessionId: row.sessionId,
                        expectedTurn: row.activity.token,
                      });
                      load();
                    }),
                  button(row.archived ? "恢复" : "归档", async () => {
                    await command(
                      row.archived ? "session.restore" : "session.archive",
                      { sessionId: row.sessionId },
                    );
                    load();
                  }),
                ),
              );
            }),
            page.cursor && button("加载下一页", () => load(page.cursor)),
          );
        }
        function OutboxPane() {
          const view = useView();
          return h(
            "div",
            null,
            ...view.snapshot.outbox.map((row) =>
              resourceCard(
                row.outboxId,
                row.kind === "result" ? "任务结果" : "消息投递",
                h("p", null, stateName(row.state)),
                h(
                  "pre",
                  null,
                  row.message?.content
                    ?.map((block) => block.text ?? "")
                    .join("\n"),
                ),
                row.sessionId &&
                  button("查看接收会话", () => openSession(row.sessionId)),
                (["UNKNOWN", "admitting"].includes(row.state) ||
                  (row.state === "blocked" && row.nativeAdmission === false)) &&
                  button(
                    row.state === "blocked" ? "重新检查并投递" : "查回原始投递",
                    () =>
                      command("outbox.reconcile", { outboxId: row.outboxId }),
                  ),
              ),
            ),
          );
        }
        function Workbench() {
          const view = useView(),
            [tab, setTab] = useState("bots");
          const panes = {
            bots: BotsPane,
            memory: MemoryPane,
            tasks: TasksPane,
            sharing: SharingPane,
            groups: GroupsPane,
            meetings: MeetingsPane,
            sessions: SessionsPane,
            outbox: OutboxPane,
          };
          useEffect(() => {
            refresh(true);
          }, []);
          return h(
            "section",
            { className: "dsh-bot", "aria-label": t("title") },
            h("style", null, styles),
            h(
              "header",
              null,
              h(
                "div",
                null,
                h("h1", null, t("title")),
                h("small", null, "原生多 Bot · 独立记忆 · 协作任务"),
              ),
              h(
                "div",
                { className: "actions" },
                button(t("newSession"), () => publish({ chooser: true })),
                button(t("refresh"), () => refresh(true)),
              ),
            ),
            view.error &&
              h("p", { role: "alert", className: "error" }, view.error),
            view.pending.length > 0 &&
              card(
                "待查回的原始操作",
                ...view.pending.map((row) =>
                  h(
                    "div",
                    { className: "actions", key: row.operationId },
                    h("small", null, `${row.action} · ${row.operationId}`),
                    button("用原始操作查回／接续", () =>
                      command(row.action, row.input, row),
                    ),
                  ),
                ),
              ),
            h(
              "nav",
              { "aria-label": "Bot 工作台功能" },
              ...Object.entries({
                bots: "Bots",
                memory: "记忆",
                tasks: "任务",
                sharing: "共享与授权",
                groups: "内部群",
                meetings: "会议",
                sessions: "会话管理",
                outbox: "结果与投递",
              }).map(([key, label]) =>
                button(label, () => setTab(key), {
                  "aria-selected": tab === key,
                }),
              ),
            ),
            view.loading ? h("p", null, "连接原生插件…") : h(panes[tab]),
          );
        }
        function Chooser() {
          const view = useView();
          useEffect(() => {
            if (view.chooser) refresh();
          }, [view.chooser]);
          if (!view.chooser) return null;
          const bots = view.snapshot.bots.filter(
            (bot) => bot.lifecycle === "active",
          );
          return h(
            "div",
            { className: "dsh-bot-dialog" },
            h(
              "section",
              {
                className: "dsh-bot",
                role: "dialog",
                "aria-modal": true,
                "aria-label": t("newSession"),
              },
              h("style", null, styles),
              h(
                "header",
                null,
                h("h2", null, t("newSession")),
                button(t("close"), () => publish({ chooser: false })),
              ),
              bots.length
                ? form(
                    t("start"),
                    async (data) => {
                      const result = await command("session.create", {
                        botId: data.get("botId"),
                      });
                      if (result?.state === "ready") {
                        publish({ chooser: false });
                        openSession(result.sessionId);
                      }
                    },
                    field(t("choose"), "botId", {
                      options: bots.map((bot) => ({
                        value: bot.botId,
                        label: bot.name,
                      })),
                    }),
                    h(
                      "small",
                      null,
                      "新会话自动带入该 Bot 的身份、长期记忆与未完成任务。",
                    ),
                  )
                : h("p", null, t("empty")),
              view.error &&
                h("p", { role: "alert", className: "error" }, view.error),
              button(t("title"), () => {
                publish({ chooser: false });
                ctx.layout.selectPanel("dsh-bot");
              }),
            ),
          );
        }
        function Header({ sessionId }) {
          const view = useView(),
            binding = view.snapshot.sessions.find(
              (row) => row.sessionId === sessionId,
            ),
            bot = view.snapshot.bots.find(
              (row) => row.botId === binding?.botId,
            );
          if (!bot) return null;
          return h(
            "button",
            {
              type: "button",
              title: t("manage"),
              onClick: () => ctx.layout.selectPanel("dsh-bot"),
            },
            bot.name,
          );
        }
        ctx.slots.inject("main", () =>
          ctx.slots.register(
            { name: "main", key: "dsh-bot", id: "dsh-bot" },
            Workbench,
          ),
        );
        ctx.slots.inject("sidebar.panellist", () =>
          ctx.slots.register(
            {
              name: "sidebar.panellist",
              id: "dsh-bot",
              order: 250,
              label: () => t("title"),
              locale: "dsh.bot",
            },
            ({ size = 20 }) =>
              h(
                "span",
                { "aria-hidden": true, style: { fontSize: `${size}px` } },
                "♧",
              ),
          ),
        );
        ctx.slots.inject("sidebar.footer.action", () =>
          ctx.slots.register(
            {
              name: "sidebar.footer.action",
              id: "dsh-bot.new-session",
              order: 250,
            },
            ({ wide }) =>
              h(
                "button",
                {
                  type: "button",
                  title: t("newSession"),
                  "aria-label": t("newSession"),
                  onClick: () => publish({ chooser: true }),
                  style: {
                    font: "inherit",
                    color: "var(--dsw-alias-label-primary)",
                    background: "transparent",
                    border: "none",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    cursor: "pointer",
                    width: "100%",
                    textAlign: "left",
                  },
                },
                wide ? t("newSession") : "B+",
              ),
          ),
        );
        ctx.slots.inject("shell.overlay", () =>
          ctx.slots.register(
            { name: "shell.overlay", id: "dsh-bot.chooser", order: 250 },
            Chooser,
          ),
        );
        ctx.slots.inject("conversation.session.header.utilities", () =>
          ctx.slots.register(
            {
              name: "conversation.session.header.utilities",
              id: "dsh-bot.identity",
              order: 250,
            },
            Header,
          ),
        );
        ctx.effect(() => {
          refresh(true);
          interval = setInterval(() => {
            if (listeners.size) refresh();
          }, 1000);
          return () => {
            clearInterval(interval);
            lifetime.abort();
            listeners.clear();
          };
        });
      },
    };
  },
});
