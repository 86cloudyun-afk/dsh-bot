window.__ModuleLoader__.load({
  id: "dsh-bot",
  factory(require) {
    const {
      createElement: h,
      useState,
      useEffect,
      useRef,
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
    const styles = `.dsh-bot{font:inherit;color:var(--dsw-alias-label-primary);padding:24px;overflow:auto;height:100%;box-sizing:border-box}.dsh-bot *{box-sizing:border-box}.dsh-bot h1{font-size:24px;margin:0}.dsh-bot h2{font-size:17px;margin:0 0 16px}.dsh-bot h3{font-size:15px;margin:0 0 8px}.dsh-bot p{line-height:1.65}.dsh-bot small,.dsh-bot .muted{color:var(--dsw-alias-label-secondary)}.dsh-bot header,.dsh-bot nav,.dsh-bot .actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dsh-bot header{justify-content:space-between;margin-bottom:20px}.dsh-bot nav{margin-bottom:20px}.dsh-bot button,.dsh-bot input,.dsh-bot select,.dsh-bot textarea{font:inherit;color:inherit;border:1px solid var(--dsw-alias-border-l2,currentColor);border-radius:8px;background:var(--dsw-alias-bg-layer-2,transparent);padding:9px 12px}.dsh-bot button{cursor:pointer}.dsh-bot button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsh-bot button:disabled{opacity:.5;cursor:wait}.dsh-bot button[aria-selected=true],.dsh-bot button.primary{background:var(--dsw-alias-state-business-primary);color:white}.dsh-bot form{display:grid;gap:12px}.dsh-bot label{display:grid;gap:6px;font-size:13px}.dsh-bot input,.dsh-bot select,.dsh-bot textarea{width:100%;min-width:0}.dsh-bot textarea{min-height:92px;resize:vertical}.dsh-bot .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px;align-items:start}.dsh-bot .card{border:1px solid var(--dsw-alias-border-l2,currentColor);border-radius:12px;padding:18px;margin-bottom:16px;background:var(--dsw-alias-bg-layer-1,transparent)}.dsh-bot .error{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}.dsh-bot pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 monospace;max-height:360px;overflow:auto}.dsh-bot .status{font-size:12px;padding:4px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,transparent)}.dsh-bot details.advanced{margin:8px 0}.dsh-bot summary{cursor:pointer;font-size:13px;color:var(--dsw-alias-label-secondary);padding:6px 0}.dsh-bot .advanced-content{display:grid;gap:12px;padding-top:10px}.dsh-bot .check{display:flex;align-items:center;gap:8px}.dsh-bot .check input{width:auto}.dsh-bot-dialog{position:fixed;inset:0;display:grid;place-items:center;pointer-events:auto;background:rgba(0,0,0,.35);z-index:90}.dsh-bot-dialog .dsh-bot{height:auto;width:min(480px,calc(100vw - 32px));background:var(--dsw-alias-bg-layer-1,Canvas);border-radius:16px;max-height:90vh;overflow:auto}`;
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
        const pluginVersion = "1.1.0", clientProtocol = 2;
        let interval,
          refreshing,
          pendingLoaded = false,
          pendingStoreId;
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
            materials: [],
            schedules: [],
            notices: [],
          },
          catalog: { providers: [], presets: [] },
          error: "",
          busy: false,
          chooser: false,
          deleting: null,
          briefing: null,
          requestedTab: null,
          focusTaskId: null,
          pending: [],
          retained: [],
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
          `dsh-bot.pending.v1.${pendingStoreId ?? state.snapshot.storeId ?? "unknown"}`;
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
              details: reply.error.details,
            });
          return reply.value;
        }
        async function refresh(catalog = false) {
          if (refreshing) return refreshing;
          refreshing = (async () => {
            try {
              const snapshot = await rpc("snapshot");
              let pending = state.pending, retained = state.retained;
              if (!pendingLoaded && snapshot.storeId) {
                pendingLoaded = true;
                pendingStoreId = snapshot.storeId;
                try {
                  const stored = JSON.parse(
                    localStorage.getItem(
                      `dsh-bot.pending.v1.${snapshot.storeId}`,
                    ) ?? "[]",
                  );
                  if (Array.isArray(stored) && stored.length <= 30)
                    pending = stored;
                  const history=JSON.parse(localStorage.getItem(`${storageKey()}.retained`)??"[]");
                  if(Array.isArray(history))retained=history;
                } catch {
                  /* invalid browser cache cannot modify host state */
                }
              }
              publish({
                snapshot,
                pending,
                retained,
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
        async function requireCompatible() {
          const snapshot = await rpc("snapshot");
          if (snapshot.pluginVersion !== pluginVersion || snapshot.clientProtocol !== clientProtocol)
            throw Object.assign(Error(`Bot 插件版本不一致：界面 ${pluginVersion}，运行服务 ${snapshot.pluginVersion ?? "旧候选／未知"}。请安装同一新版插件，完全重启 DSH 后刷新此页面。`), {code:"plugin_version_mismatch",beforeWrite:true});
          if ((pendingStoreId ?? state.snapshot.storeId) && (pendingStoreId ?? state.snapshot.storeId) !== snapshot.storeId)
            throw Object.assign(Error("当前 DSH profile 已改变。原始操作仍保留在原 profile，请刷新页面后再操作。"), {code:"profile_changed",beforeWrite:true});
          return snapshot;
        }
        function forgetPending(operationId) {
          publish({pending:state.pending.filter(row=>row.operationId !== operationId)});
          savePending();
        }
        function retainPending(request) {
          if(state.busy)return;
          const retained=state.retained.some(row=>row.operationId===request.operationId)?state.retained:[...state.retained,request];
          try {localStorage.setItem(`${storageKey()}.retained`,JSON.stringify(retained));}
          catch {publish({error:"无法保存原始请求历史；待查回记录仍保留，请先恢复浏览器存储。"});return;}
          publish({retained});forgetPending(request.operationId);
        }
        async function readOperation(request) {
          return rpc("command",{action:"operation.lookup",input:{operationId:request.operationId,request}});
        }
        async function lookupOperation(request) {
          if (state.busy) return;
          publish({busy:true,error:""});
          try {
            await requireCompatible();
            const receipt = await readOperation(request);
            if (receipt.state === "committed") {
              forgetPending(request.operationId);
              await refresh();
              return receipt.result;
            }
            publish({error:`原始操作 ${request.operationId} 暂无已提交回执，结果仍未确认。原请求已保留；查回不会执行任务或发送模型请求。`});
          } catch (error) {
            publish({error:`${error.code ?? "connection"}：${error.message}\n原始操作 ${request.operationId} 仍保留。`});
          } finally {publish({busy:false});}
        }
        async function command(action, input, original, metadata = {}) {
          const request = original ?? {
            ...metadata,
            operationId: crypto.randomUUID(),
            action,
            input,
          };
          if (state.busy) return;
          publish({ busy: true, error: "" });
          try {
            await requireCompatible();
            if (!state.pending.some(row=>row.operationId === request.operationId)) {
              if (state.pending.length >= 30)
                throw Object.assign(Error("待查回操作已达 30 条，请先查回，或将不再接续的请求“保留并收起”；原 ID 均保留在历史中。"),{code:"pending_limit",beforeWrite:true});
              publish({pending:[...state.pending,request]});
              savePending();
            }
            if (original) {
              const receipt = await readOperation(request);
              if (receipt.state === "committed") {
                forgetPending(request.operationId);
                await refresh();
                return receipt.result;
              }
            }
            const value = await rpc("command", request);
            forgetPending(request.operationId);
            await refresh();
            return value;
          } catch (error) {
            publish({
              error: `${error.code ?? "unknown"}：${error.message}${error.beforeWrite ? "\n原始请求未发送。" : error.details?.rejectedBeforeWrite ? `\n${["bot.create","bot.update"].includes(request.action) ? "提交被拒，未写入 Bot 配置。" : "提交被拒，未执行本次修改。"}原始操作 ${request.operationId} 已保留；处理提示的问题后可重新提交，也可先查回原始操作。` : `\n原始操作 ${request.operationId} 已保留，结果未确认，请先查回。`}`,
            });
          } finally {
            publish({ busy: false });
          }
        }
        async function query(action, input = {}) {
          try { return await rpc("command", {action, input}); }
          catch (error) { if (!lifetime.signal.aborted) publish({error: `${error.code ?? "connection"}：${error.message}`}); }
        }
        function downloadText(text, name, type = "text/plain;charset=utf-8") {
          const url = URL.createObjectURL(new Blob([text], {type})), link = document.createElement("a");
          link.href = url; link.download = name; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        async function readUtf8(file, maxBytes) {
          if (!file || file.size <= 0 || file.size > maxBytes) throw Error("文件为空或超过允许大小。");
          try { return new TextDecoder("utf-8", {fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer()); }
          catch { throw Error("无法读取 UTF-8 文件，请检查编码后重试。"); }
        }
        async function fileDigest(text) {
          const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
          return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2,"0")).join("");
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
            { className: "card", key, id:key?`dsh-resource-${key}`:undefined },
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
        const advanced = (label, ...children) =>
          h("details", { className: "advanced" },
            h("summary", null, label),
            h("div", { className: "advanced-content" }, ...children),
          );
        const botLabel = (bot) => bot
          ? state.snapshot.bots.filter((row) => row.name === bot.name).length > 1
            ? `${bot.name} · ${bot.botId}`
            : bot.name
          : "Bot";
        const botsOptions = () =>
          state.snapshot.bots.map((bot) => ({
            value: bot.botId,
            label: botLabel(bot),
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
            blocked: "受限，需检查",
            planned:"待触发",
            claimed:"已认领，待准入",
            missed:"已错过",
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
        function BotEditor({ bot: latestBot }) {
          const [bot, setDraftBase] = useState(latestBot),
            [formEpoch, setFormEpoch] = useState(0);
          const models = modelsOptions(), preferred = state.catalog.defaultModel;
          const selected = models.find(row => {
            const model = JSON.parse(row.value);
            return model.provider === preferred?.provider && model.model === preferred?.model;
          })?.value ?? models[0]?.value ?? "";
          const initialContact = bot
            ? JSON.stringify({provider: bot.contact.provider, model: bot.contact.model})
            : selected;
          const separateExecution = bot && bot.executionMode !== "inherit";
          const [draftChoices,setChoices]=useState({contact:initialContact,execution:separateExecution?JSON.stringify({provider:bot.execution.provider,model:bot.execution.model}):"",preset:bot?.presetId??""});
          const contact=draftChoices.contact;
          const sameRoute = (a, b) => a?.provider === b?.provider && a?.model === b?.model;
          const configuredModels = configuration => {
            const value = configuration && JSON.stringify({provider:configuration.provider,model:configuration.model});
            return value && !models.some(row=>row.value === value)
              ? [...models,{value,label:`${configuration.provider} / ${configuration.model}（当前不可用，请重新选择）`}]
              : models;
          };
          const newDefaults = sameRoute(JSON.parse(contact || "{}"), preferred) ? preferred : undefined;
          const presetOptions=state.catalog.presets.filter(row=>!row.broken).map(row=>({value:row.id,label:row.name??row.id}));
          if(draftChoices.preset && !presetOptions.some(row=>row.value===draftChoices.preset))presetOptions.push({value:draftChoices.preset,label:`${draftChoices.preset}（当前不可用，请重新选择）`});
          const modelInput = (selection, effort, tokens, previous) => ({
            ...selection,
            ...(effort ? {reasoningEffort: effort} : {}),
            ...(tokens ? {maxTokens: Number(tokens)} : {}),
            ...(previous?.temperature === undefined ? {} : {temperature: previous.temperature}),
          });
          return card(
            bot ? "编辑 Bot" : "创建具名 Bot",
            latestBot && bot && latestBot.revision !== bot.revision && h(
              "div", null,
              h("p", {role: "status"}, "此 Bot 的配置已在其他页面更新。当前草稿已保留，保存将检查原版本。"),
              button("重新载入最新配置", () => {
                setDraftBase(latestBot);
                setChoices({contact:JSON.stringify({provider:latestBot.contact.provider,model:latestBot.contact.model}),execution:latestBot.executionMode!=="inherit"?JSON.stringify({provider:latestBot.execution.provider,model:latestBot.execution.model}):"",preset:latestBot.presetId??""});
                setFormEpoch(epoch => epoch + 1);
              }),
            ),
            h("div", {key: formEpoch}, form(
              bot ? "保存配置" : "创建 Bot",
              async data => {
                const chosen = JSON.parse(data.get("contact"));
                const inheritsExecution = !data.get("execution");
                const contactConfiguration = modelInput(chosen, data.get("contactEffort"), data.get("contactMaxTokens"),
                  bot?.contact ?? (sameRoute(chosen, preferred) ? preferred : undefined));
                const configuration = {
                  name: data.get("name"), role: data.get("role"),
                  contact: contactConfiguration,
                  execution: modelInput(data.get("execution") ? JSON.parse(data.get("execution")) : chosen,
                    data.get("executionEffort") || (inheritsExecution ? contactConfiguration.reasoningEffort : ""),
                    data.get("executionMaxTokens") || (inheritsExecution ? contactConfiguration.maxTokens : ""),
                    bot?.execution ?? (inheritsExecution ? contactConfiguration : undefined)),
                  executionMode: inheritsExecution ? "inherit" : "explicit",
                  presetId: data.get("preset") || null,
                  ...(data.get("cwd")?.trim() ? {cwd: data.get("cwd").trim()} : {}),
                };
                const saved = await command(bot ? "bot.update" : "bot.create", {
                  ...configuration,
                  ...(bot ? {botId: bot.botId, expectedVersion: bot.revision} : {}),
                });
                if (bot && saved) {
                  setDraftBase(saved);
                  setChoices({contact:JSON.stringify({provider:saved.contact.provider,model:saved.contact.model}),execution:saved.executionMode!=="inherit"?JSON.stringify({provider:saved.execution.provider,model:saved.execution.model}):"",preset:saved.presetId??""});
                  setFormEpoch(epoch => epoch + 1);
                }
                return saved;
              },
              field("名称", "name", {value: bot?.name, maxLength: 100}),
              field("身份与职责", "role", {value: bot?.role, textarea: true, required: false, maxLength: 8192}),
              field("模型", "contact", {value: contact, options: configuredModels(JSON.parse(contact || "null")), onChange: event => {
                const controls = event.currentTarget.form.elements;
                const value=event.currentTarget.value, chosen = JSON.parse(value);
                controls.contactEffort.value = !bot && sameRoute(chosen, preferred) ? preferred?.reasoningEffort ?? "" : "";
                if (!controls.execution.value) controls.executionEffort.value = "";
                setChoices(choices=>({...choices,contact:value}));
              }}),
              advanced("更多设置",
                field("工作目录（DSH 所在机器）", "cwd", {
                  value: bot?.cwd ?? state.catalog.defaultCwd ?? "",
                  required: false, placeholder: "默认使用 DSH 当前工作目录",
                }),
                field("执行模型", "execution", {
                  value: draftChoices.execution,
                  options: [{value: "", label: "与聊天模型相同"}, ...configuredModels(JSON.parse(draftChoices.execution || "null"))], required: false,
                  onChange: event => {
                    const value=event.currentTarget.value,chosen = value ? JSON.parse(value) : null;
                    if (!sameRoute(chosen, bot?.execution)) event.currentTarget.form.elements.executionEffort.value = "";
                    setChoices(choices=>({...choices,execution:value}));
                  },
                }),
                field("联络思考程度（留空使用当前模型默认）", "contactEffort", {
                  value: (bot ? bot.contact.reasoningEffort : newDefaults?.reasoningEffort) ?? "", required: false,
                }),
                field("联络每轮回复上限（tokens）", "contactMaxTokens", {
                  type: "number", min: 1, max: 262144, step: 1,
                  value: (bot ? bot.contact.maxTokens : newDefaults?.maxTokens) ?? "", required: false, placeholder: "使用模型默认值",
                }),
                field("执行思考程度", "executionEffort", {value: bot?.execution.reasoningEffort ?? "", required: false}),
                field("执行每轮回复上限（tokens）", "executionMaxTokens", {
                  type: "number", min: 1, max: 262144, step: 1,
                  value: bot?.execution.maxTokens ?? "", required: false, placeholder: "使用模型默认值",
                }),
                field("原生 Agent preset", "preset", {
                  value: draftChoices.preset,
                  options: [{value: "", label: "使用 DSH 默认会话配置"},
                    ...presetOptions],
                  required: false,
                  onChange:event=>{const value=event.currentTarget.value;setChoices(choices=>({...choices,preset:value}));},
                }),
              ),
              h("small", null, models.length ? "工作工具默认沿用 DSH，任务在后台运行，可随时继续聊天。" : "请先在 DSH 中配置模型，再创建 Bot。"),
            )),
          );
        }
        function TemplateCreator({teamOnly=false}) {
          const view=useView(),[templates,setTemplates]=useState([]),[choice,setChoice]=useState(""),[baseRevision,setBaseRevision]=useState(view.snapshot.revision),[epoch,setEpoch]=useState(0),[selections,setSelections]=useState({}),initialRoute=useRef(null);
          useEffect(()=>{let active=true;query("template.list").then(value=>{if(active&&value)setTemplates(Array.isArray(value)?value:value.templates??[]);});return()=>{active=false;};},[]);
          const choices=templates.filter(row=>!!row.coordinatorRoleKey===teamOnly),template=choices.find(row=>row.templateId===choice)??choices[0],models=modelsOptions();
          const defaults=models.find(row=>{const parsed=JSON.parse(row.value);return parsed.provider===view.catalog.defaultModel?.provider&&parsed.model===view.catalog.defaultModel?.model;})?.value??models[0]?.value??"";
          if(initialRoute.current===null)initialRoute.current=defaults;
          const templateModels = selected => selected&&!models.some(row=>row.value===selected) ? [...models,{value:selected,label:`${JSON.parse(selected).provider} / ${JSON.parse(selected).model}（当前不可用，请重新选择）`}] : models;
          const templatePresets = selected => {const presets=view.catalog.presets.filter(item=>!item.broken).map(item=>({value:item.id,label:item.name??item.id}));return selected&&!presets.some(row=>row.value===selected)?[...presets,{value:selected,label:`${selected}（当前不可用，请重新选择）`}]:presets;};
          return advanced(teamOnly?"从团队模板创建":"从 Bot 模板创建",
            h("p",null,"模板创建全新的 Bot，可先修改名称和分工。创建完成后再开始聊天或任务。"),
            field("模板","template",{value:template?.templateId??"",required:false,options:choices.map(row=>({value:row.templateId,label:row.name})),onChange:event=>{setChoice(event.target.value);setBaseRevision(view.snapshot.revision);setSelections({});initialRoute.current=defaults;setEpoch(n=>n+1);}}),
            template&&h("div",{key:`${template.templateId}:${epoch}`},
              baseRevision!==view.snapshot.revision&&h("div",null,h("p",{role:"status"},"工作台已更新，模板草稿保留在原版本。"),button("按最新工作台重新准备模板",()=>{setBaseRevision(view.snapshot.revision);setSelections({});initialRoute.current=defaults;setEpoch(n=>n+1);})),
              form(teamOnly?"创建团队与内部群":"创建模板 Bot",async data=>{
                const roles=template.roles.map(row=>({roleKey:row.roleKey,config:{name:data.get(`${row.roleKey}.name`),role:data.get(`${row.roleKey}.role`),contact:JSON.parse(data.get(`${row.roleKey}.model`)),executionMode:data.get(`${row.roleKey}.execution`)?"explicit":"inherit",...(data.get(`${row.roleKey}.execution`)?{execution:JSON.parse(data.get(`${row.roleKey}.execution`))}:{}),presetId:data.get(`${row.roleKey}.preset`)||null,...(data.get(`${row.roleKey}.cwd`)?.trim()?{cwd:data.get(`${row.roleKey}.cwd`).trim()}:{})}}));
                await command("template.instantiate",{templateId:template.templateId,templateVersion:template.templateVersion,roles,...(teamOnly?{group:{name:data.get("groupName"),rounds:Number(data.get("groupRounds")),maxRequests:Number(data.get("groupRequests"))}}:{})},undefined,{expectedRevision:baseRevision});
              },...template.roles.map(row=>{const recipe=templates.find(item=>item.templateId===row.botTemplateId)??template;return h("section",{className:"card",key:row.roleKey},h("h3",null,recipe.name),field("Bot 名称",`${row.roleKey}.name`,{value:recipe.suggestedName??recipe.name,maxLength:100}),field("身份与分工",`${row.roleKey}.role`,{value:recipe.role,textarea:true,required:false,maxLength:8192}),field("聊天模型",`${row.roleKey}.model`,{value:selections[`${row.roleKey}.model`]??initialRoute.current,options:templateModels(selections[`${row.roleKey}.model`]??initialRoute.current),onChange:event=>setSelections(draft=>({...draft,[`${row.roleKey}.model`]:event.target.value}))}),advanced("更多设置",field("执行模型",`${row.roleKey}.execution`,{value:selections[`${row.roleKey}.execution`]??"",options:[{value:"",label:"与聊天模型相同"},...templateModels(selections[`${row.roleKey}.execution`])],required:false,onChange:event=>setSelections(draft=>({...draft,[`${row.roleKey}.execution`]:event.target.value}))}),field("工作目录",`${row.roleKey}.cwd`,{value:view.catalog.defaultCwd??"",required:false}),field("原生会话配置",`${row.roleKey}.preset`,{value:selections[`${row.roleKey}.preset`]??"",required:false,options:[{value:"",label:"使用 DSH 默认配置"},...templatePresets(selections[`${row.roleKey}.preset`])],onChange:event=>setSelections(draft=>({...draft,[`${row.roleKey}.preset`]:event.target.value}))})));}),
                teamOnly&&field("内部群名称","groupName",{value:template.name,maxLength:100}),teamOnly&&advanced("群设置",field("成员轮数","groupRounds",{type:"number",value:template.group?.rounds??1,min:1,max:3}),field("每次群轮的请求预算","groupRequests",{type:"number",value:template.group?.maxRequests??12,min:1,max:60})))));
        }
        function BotsPane() {
          const [editing, setEditing] = useState(null),
            view = useView();
          const selected = view.snapshot.bots.find(
            (bot) => bot.botId === editing && !bot.deletedAt,
          );
          useEffect(()=>{if(editing&&!selected)setEditing(null);},[editing,selected]);
          const cards = view.snapshot.bots.filter(bot=>!bot.deletedAt).map((bot) =>
            resourceCard(
              bot.botId,
              botLabel(bot),
              h("p", { className: "muted" }, bot.role || "未设置职责"),
              h(
                "p",
                null,
                `模型 ${bot.contact.model}${bot.execution.model !== bot.contact.model ? ` · 任务 ${bot.execution.model}` : ""}`,
              ),
              h(
                "p",
                null,
                `工作槽 ${view.snapshot.attempts.filter((row) => row.botId === bot.botId && row.reservationHeld).length}/15 · ${stateName(bot.lifecycle)}`,
              ),
              h(
                "div",
                { className: "actions" },
                button("开始聊天", async () => {
                  const contact = await command("session.create", {botId: bot.botId});
                  if (contact?.state === "ready") await openSession(contact.sessionId);
                }, {className: "primary", disabled: view.busy || bot.lifecycle !== "active"}),
                button("编辑", () => setEditing(bot.botId)),
                button("删除", event => publish({deleting:{botId:bot.botId,expectedVersion:bot.revision,name:botLabel(bot),returnFocus:event.currentTarget},error:""})),
                advanced("状态管理", button(bot.lifecycle === "active" ? "暂停" : "启用", () =>
                  command("bot.update", {
                    botId: bot.botId, expectedVersion: bot.revision,
                    lifecycle: bot.lifecycle === "active" ? "paused" : "active",
                  }),
                )),
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
              view.snapshot.bots.some(bot=>bot.deletedAt) && advanced("已删除的 Bot",
                h("p",{className:"muted"},"原会话、记忆与任务保留。恢复后先暂停，启用后可继续使用同一 Bot。"),
                ...view.snapshot.bots.filter(bot=>bot.deletedAt).map(bot=>h("article",{key:bot.botId},
                  h("p",null,botLabel(bot)),
                  button("恢复",()=>command("bot.restore",{botId:bot.botId,expectedVersion:bot.revision})),
                )),
              ),
              editing && button("创建另一个 Bot", () => setEditing(null)),
            ),
            h("div",null,h(BotEditor, {key: selected?.botId ?? "new",bot: selected}),h(TemplateCreator)),
          );
        }
        const categories = [{value:"fact",label:"事实"},{value:"preference",label:"偏好"},{value:"decision",label:"决定"},{value:"responsibility",label:"职责"}];
        const categoryName = value => categories.find(row=>row.value===value)?.label ?? `其他（${value ?? "未分类"}）`;
        const updatedName = value => value ? new Date(value).toLocaleString() : "未知";
        function MemoryEditor({memory:latestMemory,botId,onSaved}) {
          const [base,setBase]=useState(latestMemory),[epoch,setEpoch]=useState(0);
          const choices = base && !categories.some(row=>row.value===base.category) ? [...categories,{value:base.category,label:categoryName(base.category)}] : categories;
          return card(base?"编辑记忆":"添加记忆",
            latestMemory && latestMemory.version!==base.version && h("div",null,h("p",{role:"status"},"记忆已在其他页面更新。草稿保留，保存会检查开始编辑时的版本。"),button("重新载入最新记忆",()=>{setBase(latestMemory);setEpoch(n=>n+1);})),
            h("div",{key:epoch},form(base?"保存记忆修改":"保存到所选 Bot",async data=>{
              const saved=await command("memory.write",{botId,text:data.get("text"),category:data.get("category"),pinned:data.get("pinned")==="on",...(base?{memoryId:base.memoryId,expectedVersion:base.version}:{})});
              if(saved){setBase(saved);setEpoch(n=>n+1);onSaved?.(saved);}
            },field("内容","text",{value:base?.text,textarea:true,maxLength:8192}),field("分类","category",{value:base?.category??"fact",options:choices}),check("pinned","固定重要记忆（每 Bot 最多 8 条）",base?.pinned??false))),
            h("small",null,"长期记忆随对话按预算带入；编辑与遗忘保留真实来源。"));
        }
        function MemoryTransfer({botId}) {
          const view=useView(),[draft,setDraft]=useState(null),[unpin,setUnpin]=useState([]),[selected,setSelected]=useState([]),[loading,setLoading]=useState(false);
          const activeMemories=view.snapshot.memories.filter(row=>row.botId===botId&&!row.forgotten);
          return advanced("导入导出",
            h("p",null,"只迁移当前 Bot 的长期记忆。导入仅追加；不可验证的受保护来源会保留为不可用。"),
            field("导出条目（可多选；留空导出全部，最多 500 条）","memoryIds",{options:activeMemories.map(row=>({value:row.memoryId,label:row.text.slice(0,60)})),multiple:true,required:false,value:selected,onChange:event=>setSelected([...event.target.selectedOptions].map(row=>row.value))}),
            button("导出记忆 JSON",async()=>{const result=await query("memory.export",{botId,...(selected.length?{memoryIds:selected}:{})});if(result)downloadText(result.fileText,result.fileName??"bot-memory.json","application/json;charset=utf-8");}),
            field("导入 JSON 文件","importFile",{type:"file",required:false,accept:".json,application/json",disabled:loading,onChange:async event=>{
              const file=event.target.files?.[0];if(!file)return;setLoading(true);
              try{const fileText=await readUtf8(file,4*1024*1024),digest=await fileDigest(fileText),preview=await query("memory.import.preview",{botId,fileText,fileDigest:digest});if(preview){setDraft({botId,fileText,fileDigest:digest,preview,fileEntries:JSON.parse(fileText).entries});setUnpin([]);}}
              catch(error){publish({error:error.message});}finally{setLoading(false);}
            }}),
            draft && h("div",null,
              h("p",null,`预览 ${draft.preview.entries.length} 条；目标记忆版本 ${draft.preview.memoryRevision}。并发修改将拒绝整批导入，当前预览保留。`),
              draft.preview.pinConflict && h("p",{role:"status"},"固定项超过额度，请在下方取消部分固定项后确认。"),
              ...draft.preview.entries.map((entry,index)=>h("article",{className:"card",key:index},
                h("p",null,entry.text??draft.fileEntries[entry.index??index]?.text??""),h("small",null,`${categoryName(entry.category??draft.fileEntries[entry.index??index]?.category)} · ${{skip:"重复，跳过",inactive:"来源待验证，不可用",append:"新增"}[entry.decision]??"待确认"} · ${{external_description:"外部来源说明",source_unverified:"来源待验证",external_protected_source:"外部受保护来源",verified_local_source:"本地来源已验证",source_revoked:"来源权限已撤销"}[entry.sourceVerification]??"来源待验证"}`),
                entry.pinned && entry.decision!=="skip" && h("label",{className:"check"},h("input",{type:"checkbox",checked:unpin.includes(index),onChange:event=>setUnpin(ids=>event.target.checked?[...ids,index]:ids.filter(id=>id!==index))}),"导入时取消固定"))),
              button("确认整批追加",async()=>{const result=await command("memory.import",{botId:draft.botId,fileText:draft.fileText,fileDigest:draft.fileDigest,expectedMemoryRevision:draft.preview.memoryRevision,...(unpin.length?{unpinnedEntryIndexes:unpin}:{})});if(result){setDraft(null);setUnpin([]);}}, {disabled:view.busy||draft.botId!==botId||(draft.preview.pinCount??0)-unpin.filter(index=>draft.preview.entries.some(entry=>entry.index===index&&entry.pinned&&entry.decision!=="skip")).length>8}),
              button("取消导入",()=>{setDraft(null);setUnpin([]);}),
            ));
        }
        function MaterialReader({docId,chunkId,onClose}) {
          const [page,setPage]=useState(null),[cursor,setCursor]=useState(null);
          useEffect(()=>{let active=true;query("material.page",{docId,...(chunkId?{chunkId}:{})}).then(value=>{if(active&&value){setPage(value);setCursor(value.nextCursor);}});return()=>{active=false;};},[docId,chunkId]);
          return card(page?.title??"资料正文",button("关闭正文",onClose),page&&h("div",null,
            h("p",{className:"muted"},`资料 ${docId}${chunkId?` · 引用 ${chunkId}`:""}`),
            h("pre",null,page.text??page.items?.map(row=>row.text??row.excerpt??"").join("\n")??""),
            page.chunkId&&h("small",null,`行 ${page.startLine}–${page.endLine}${page.section?` · ${page.section}`:""}`),
            page.source?.status==="verified"&&page.source.sessionId&&button("打开已核对的原生来源",()=>openSession(page.source.sessionId)),
            page.source&&h("p",{className:"muted"},({verified:"原生片段来源已核对",changed:"原生来源已变化；此处保留收录时的不可变正文",unavailable:"原生来源暂不可用；此处保留收录时的不可变正文",derived:"由 Bot 整理的资料",description:"用户提供的资料"})[page.source.status]??"来源说明"),
            cursor&&button("下一页正文",async()=>{const value=await query("material.page",{docId,cursor});if(value){setPage(value);setCursor(value.nextCursor);}}),
            button("下载此份资料",async()=>{const result=await query("material.download",{docId});if(result)downloadText(result.text,result.fileName??`${result.title??"material"}.txt`);})
          ));
        }
        function MaterialsPane({botId}) {
          const view=useView(),[hits,setHits]=useState(null),[opened,setOpened]=useState(null),[draft,setDraft]=useState({text:"",fileName:"",mediaType:"text/plain"}),[epoch,setEpoch]=useState(0);
          const rows=(view.snapshot.materials??[]).filter(row=>row.botId===botId);
          return h("div",{className:"grid"},card("资料检索",
            form("搜索资料",async data=>{const result=await query("material.search",{botId,query:data.get("query"),limit:20});if(result)setHits(result);},field("关键词","query",{maxLength:500})),
            ...(hits??rows).map(row=>h("article",{className:"card",key:row.chunkId??row.docId},
              h("h3",null,row.title),row.excerpt&&h("pre",null,row.excerpt),
              h("small",null,row.chunkId?`行 ${row.startLine??row.lineStart}–${row.endLine??row.lineEnd} · ${row.contentHash}`:`${row.archived?"已归档 · ":""}更新 ${updatedName(row.updatedAt??row.createdAt)}`),
              button(row.chunkId?"打开此引用":"打开正文",()=>setOpened({docId:row.docId,chunkId:row.chunkId})),
              !row.chunkId&&button("修订这份资料",async()=>{const result=await query("material.download",{docId:row.docId});if(result){setDraft({text:result.text,fileName:row.fileName??"",mediaType:row.mediaType??"text/plain",title:row.title,replacesDocId:row.docId});setEpoch(n=>n+1);}}),
              !row.chunkId&&!row.archived&&button("归档资料",()=>command("material.archive",{docId:row.docId,expectedVersion:row.version})),
            )),hits&&button("显示全部资料",()=>setHits(null))),
            card("收录资料",
              field("UTF-8 文本或 Markdown 文件","materialFile",{type:"file",required:false,accept:".txt,.md,text/plain,text/markdown",onChange:async event=>{const file=event.target.files?.[0];if(!file)return;try{if(!/\.(txt|md)$/i.test(file.name))throw Error("请选择 .txt 或 .md 文件。");const text=await readUtf8(file,65536);setDraft({text,fileName:file.name,mediaType:/\.md$/i.test(file.name)?"text/markdown":"text/plain"});setEpoch(n=>n+1);}catch(error){publish({error:error.message});}}}),
              h("div",{key:epoch},form("保存不可变资料",async data=>{
                const enteredText=String(data.get("text")??""),displayText=text=>text.replace(/\r\n?/g,"\n");
                // Textareas normalize line endings; an untouched upload retains its original bytes.
                const text=displayText(enteredText)===displayText(draft.text)?draft.text:enteredText;
                const result=await command("material.ingest",{botId,title:data.get("title"),text,mediaType:draft.mediaType,...(draft.replacesDocId?{replacesDocId:draft.replacesDocId}:{}),...(draft.fileName?{fileName:draft.fileName}:{})});if(result){setDraft({text:"",fileName:"",mediaType:"text/plain"});setEpoch(n=>n+1);}},field("资料标题","title",{value:draft.title??draft.fileName,maxLength:200}),field("正文","text",{value:draft.text,textarea:true}),h("small",null,draft.replacesDocId?"正在修订所选资料：保存形成新资料，旧正文、来源和引用保留。":"每份最多 64 KiB。修订形成新资料，引用保留原文。"),draft.replacesDocId&&button("改为收录新资料",()=>{setDraft({...draft,replacesDocId:undefined});}))),
              advanced("从原生会话摘录",form("收录真实会话片段",data=>command("material.ingest",{botId,title:data.get("title"),source:{sessionId:data.get("sessionId"),eventSeq:Number(data.get("eventSeq")),partIndex:Number(data.get("partIndex")),startOffset:Number(data.get("startOffset")),endOffset:Number(data.get("endOffset"))}}),field("标题","title"),field("来源会话","sessionId",{options:view.snapshot.sessions.map(row=>({value:row.sessionId,label:`${view.snapshot.bots.find(bot=>bot.botId===row.botId)?.name??"会话"} · ${row.sessionId}`}))}),field("事件序号","eventSeq",{type:"number",min:0}),field("文本部分序号","partIndex",{type:"number",min:0,value:0}),field("文本开始位置","startOffset",{type:"number",min:0,value:0}),field("文本结束位置","endOffset",{type:"number",min:1}),h("small",null,"范围由真实原生日志核对；不会用粘贴文字替代该来源。")))
            ),opened&&h(MaterialReader,{...opened,onClose:()=>setOpened(null),key:`${opened.docId}:${opened.chunkId??""}`}));
        }
        function ContextPreview({botId}) {
          const view=useView(),[preview,setPreview]=useState(null);
          return advanced("上下文预览",h("p",null,"查看当前预算下可带入此 Bot 下一轮的记忆摘要与未完成任务。实际对话仍按当时的权限与查询选择。"),
            form("查看上下文预览",async data=>{const value=await query("memory.context.preview",{botId,...(data.get("query")?{query:data.get("query")}:{})});if(value){
              const items = prefix => {try{const line=value.context?.split("\n").find(row=>row.startsWith(prefix));return line?JSON.parse(line.slice(prefix.length)):[];}catch{return [];}};
              setPreview({...value,memoryPreviews:value.memoryPreviews??items("长期记忆（记录带来源，引用不授予控制权）："),taskPreviews:value.taskPreviews??items("未完成任务：")});
            }},field("当前话题关键词","query",{required:false,maxLength:500})),
            preview&&h("div",null,h("h3",null,"可带入的记忆"),...(preview.memoryPreviews??[]).map(row=>h("p",{key:row.memoryId},row.text)),h("h3",null,"未完成任务"),...(preview.taskPreviews??[]).map(row=>h("p",{key:row.taskId},`${row.title} · ${stateName(row.state)}`)),
              advanced("未带入原因",...(preview.omitted??[]).map(row=>h("p",{key:row.memoryId},`${view.snapshot.memories.find(memory=>memory.memoryId===row.memoryId)?.text.slice(0,40)??"记忆"} · ${{forgotten:"已遗忘",inactive:"来源待验证",inaccessible:"来源暂不可读",budget:"本轮预算不足",relevance_or_recency:"按相关性与最近更新选择其他记忆"}[row.reason]??"本轮未选择"}`)))));
        }
        function MemoryPane() {
          const view=useView(),[id,setId]=useState(""),[section,setSection]=useState("memory"),[editing,setEditing]=useState(null),[hits,setHits]=useState(null),[sourceRef,setSourceRef]=useState(null),[creationEpoch,setCreationEpoch]=useState(0);
          const botId=id||view.snapshot.bots.find(bot=>!bot.deletedAt)?.botId, rows=(hits?hits.map(hit=>view.snapshot.memories.find(row=>row.memoryId===hit.memoryId)).filter(Boolean):view.snapshot.memories).filter(row=>row.botId===botId&&!row.forgotten),selected=view.snapshot.memories.find(row=>row.memoryId===editing&&row.botId===botId&&!row.forgotten);
          return h("div",null,
            h("label",null,"所属 Bot",h("select",{"aria-label":"所属 Bot",value:botId??"",onChange:event=>{setId(event.target.value);setEditing(null);setHits(null);setSourceRef(null);}},botsOptions().map(row=>option(row.value,row.label)))),
            h("nav",{"aria-label":"记忆与资料"},button("长期记忆",()=>setSection("memory"),{"aria-selected":section==="memory"}),button("资料",()=>setSection("materials"),{"aria-selected":section==="materials"})),
            !botId?h("p",null,"请先创建 Bot。") : section==="materials"?h(MaterialsPane,{botId,key:botId}):h("div",{className:"grid"},card("长期记忆",
              form("搜索记忆",async data=>{const result=await query("memory.search",{botId,query:data.get("query"),...(data.get("category")?{category:data.get("category")}:{})});if(result)setHits(result);},field("内容关键词","query",{required:false,maxLength:500}),field("分类筛选","category",{required:false,options:[{value:"",label:"全部分类"},...categories,...[...new Set(rows.map(row=>row.category))].filter(value=>!categories.some(row=>row.value===value)).map(value=>({value,label:categoryName(value)}))]})),
              ...[...rows].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||String(b.updatedAt).localeCompare(String(a.updatedAt))).map(row=>h("article",{className:"card",key:row.memoryId},h("p",null,row.text),h("small",null,`${categoryName(row.category)} · ${row.pinned?"已固定 · ":""}更新 ${updatedName(row.updatedAt)}${row.inactive?" · 来源待验证，不可用":""}`),h("div",{className:"actions"},button("编辑记忆",()=>setEditing(row.memoryId)),button(row.pinned?"取消固定":"固定",()=>command("memory.pin",{memoryId:row.memoryId,expectedVersion:row.version,pinned:!row.pinned})),row.source?.kind==="material"?button("查看资料来源",()=>setSourceRef({docId:row.source.docId,chunkId:row.source.chunkId})):row.source?.sessionId&&button("查看来源",()=>openSession(row.source.sessionId)),button("遗忘此记忆",()=>command("memory.forget",{memoryId:row.memoryId,expectedVersion:row.version}))))),
              hits&&button("显示全部记忆",()=>setHits(null)),button("添加另一条记忆",()=>{setEditing(null);setCreationEpoch(epoch=>epoch+1);}),h(MemoryTransfer,{botId,key:botId}),h(ContextPreview,{botId,key:`context:${botId}`})),
              h(MemoryEditor,{memory:selected,botId,onSaved:saved=>setEditing(saved.memoryId),key:selected?.memoryId??`new:${botId}:${creationEpoch}`})),sourceRef&&h(MaterialReader,{...sourceRef,onClose:()=>setSourceRef(null),key:`source:${sourceRef.docId}:${sourceRef.chunkId}`}));
        }
        function TaskRelations({task:latestTask}) {
          const view=useView(),[task,setBase]=useState(latestTask),[epoch,setEpoch]=useState(0);
          return advanced("前置任务与责任交接",
            latestTask.version!==task.version&&h("div",null,h("p",{role:"status"},"任务已更新。当前关系草稿保留，提交将检查原版本。"),button("重新载入任务关系",()=>{setBase(latestTask);setEpoch(n=>n+1);})),
            h("div",{key:epoch},form("保存前置任务",async data=>{const saved=await command("task.dependencies.set",{taskId:task.taskId,expectedVersion:task.version,dependsOn:data.getAll("dependsOn")});if(saved){setBase(saved);setEpoch(n=>n+1);}},field("前置任务（可多选，全部有效验收后可开始）","dependsOn",{options:view.snapshot.tasks.filter(row=>row.taskId!==task.taskId).map(row=>({value:row.taskId,label:`${row.title} · ${stateName(row.acceptance)}`})),value:task.dependsOn??[],multiple:true,required:false}))),
            form("确认交给所选 Bot",data=>command("task.handoff",{taskId:task.taskId,expectedVersion:task.version,toBotId:data.get("toBotId"),note:data.get("note")}),field("接手 Bot","toBotId",{options:botsOptions().filter(row=>row.value!==task.botId)}),field("交接说明","note",{textarea:true,maxLength:2000}),h("small",null,"交接需等待工作结算。旧运行记录保留原负责人，下一次开始由新负责人执行。")));
        }
        function TaskAdjustment({task:latestTask}) {
          const [task,setBase]=useState(latestTask),[formEpoch,setFormEpoch]=useState(0);
          return advanced("调整与接续",
            latestTask.version !== task.version && h("div",null,
              h("p",{role:"status"},"任务已更新。当前目标草稿已保留；保存将检查原版本。"),
              button("重新载入最新任务",()=>{setBase(latestTask);setFormEpoch(epoch=>epoch+1);}),
            ),
            h("div",{key:formEpoch},form("调整目标",async data=>{
              const saved=await command("task.adjust",{taskId:task.taskId,expectedVersion:task.version,goal:data.get("goal")});
              if(saved){setBase(saved);setFormEpoch(epoch=>epoch+1);}return saved;
            },field("新目标","goal",{value:task.goal,textarea:true}))),
          );
        }
        function TaskAcceptance({task:latestTask,attempt}) {
          const [task,setBase]=useState(latestTask),[formEpoch,setFormEpoch]=useState(0);
          return advanced("验收结果",
            latestTask.version !== task.version && h("div",null,
              h("p",{role:"status"},"任务或验收已更新。当前证据草稿已保留；保存将检查原版本。"),
              button("重新载入最新验收",()=>{setBase(latestTask);setFormEpoch(epoch=>epoch+1);}),
            ),
            h("div",{key:formEpoch},form("记录验收",async data=>{
              const saved=await command("task.accept",{taskId:task.taskId,expectedVersion:task.version,attemptId:attempt.attemptId,outcome:data.get("outcome"),evidence:data.get("evidence")});
              if(saved){setBase(saved);setFormEpoch(epoch=>epoch+1);}return saved;
            },field("结论","outcome",{value:task.acceptance,options:[{value:"unknown",label:"待定"},{value:"passed",label:"通过"},{value:"failed",label:"不通过"}]}),field("实际证据","evidence",{textarea:true}))),
          );
        }
        function openTask(taskId) {
          publish({briefing:null,requestedTab:"tasks",focusTaskId:taskId});
          ctx.layout.selectPanel("dsh-bot");
        }
        function NoticeList({notices=[]}) {
          return h("div",null,...notices.map(row=>h("article",{className:"card",key:row.noticeId},
            h("h3",null,row.title??(row.kind==="reminder"?"提醒":"任务结果")),h("p",null,row.text??row.message??row.preview??""),...(row.previews??[]).map((preview,index)=>h("pre",{key:index},preview.text)),
            h("small",null,`${row.dueAt?`原定 ${updatedName(row.dueAt)} · `:""}${row.late?"迟到 · ":""}${row.acknowledgedAt||row.ackedAt||row.read?"已读":"未读"}`),
            row.taskId&&button("查看任务",()=>openTask(row.taskId)),
            row.sessionId&&button("查看会话",()=>openSession(row.sessionId)),
            !row.acknowledgedAt&&!row.ackedAt&&!row.read&&button("确认已读",()=>command("notice.ack",{noticeId:row.noticeId,expectedVersion:row.version})))));
        }
        function BriefingDialog() {
          const view=useView(),request=view.briefing,[data,setData]=useState(null),modal=useRef(null);
          useEffect(()=>{let active=true;setData(null);if(request)query("briefing",{botId:request.botId}).then(value=>{if(active)setData(value);});return()=>{active=false;};},[request,view.snapshot.revision]);
          useEffect(()=>{const element=modal.current;if(!request||!element)return;element.showModal();return()=>{if(element.open)element.close();if(request.returnFocus?.isConnected)request.returnFocus.focus();};},[request]);
          if(!request)return null;
          return h("dialog",{ref:modal,className:"dsh-bot-briefing-modal","aria-label":"任务简报",onCancel:event=>{event.preventDefault();if(!view.busy)publish({briefing:null});}},h("section",{className:"dsh-bot"},h("style",null,styles+".dsh-bot-briefing-modal{border:0;padding:0;background:transparent;color:inherit;width:min(680px,calc(100vw - 32px));max-height:90vh;overflow:auto;border-radius:16px}.dsh-bot-briefing-modal::backdrop{background:rgba(0,0,0,.35)}.dsh-bot-briefing-modal .dsh-bot{height:auto;background:var(--dsw-alias-bg-layer-1,Canvas)}"),
            h("header",null,h("h2",null,"任务简报"),button("关闭简报",()=>publish({briefing:null}))),
            !data?h("p",null,"读取简报…"):h("div",null,h("p",null,`${data.unreadCount??0} 条未读通知`),
              ...(data.tasks??[]).map(row=>h("article",{className:"card",key:row.taskId},h("h3",null,row.title),h("p",null,`${stateName(row.attemptState??row.state)} · 验收 ${stateName(row.acceptance)}`),...(row.previews??[]).map((preview,index)=>h("pre",{key:index},preview.text)),
                row.attemptId&&button("查看执行",()=>{const attempt=view.snapshot.attempts.find(item=>item.attemptId===row.attemptId);if(attempt?.sessionId)openSession(attempt.sessionId);}),
                button("打开工作台任务",()=>openTask(row.taskId)))),h(NoticeList,{notices:data.notices??[]})),
            view.error&&h("p",{className:"error",role:"alert"},view.error)));
        }
        function ScheduleEditor({schedule:latestSchedule,onSaved}) {
          const view=useView(),[base,setBase]=useState(latestSchedule),[epoch,setEpoch]=useState(0),[kind,setKind]=useState(latestSchedule?.kind??"reminder"),[ruleKind,setRuleKind]=useState(latestSchedule?.rule?.kind??"once"),[owner,setOwner]=useState(latestSchedule?.ownerBotId??view.snapshot.bots[0]?.botId);
          const timezone=base?.rule?.timezone??"Asia/Shanghai";
          const submit=async data=>{
            const selectedKind=data.get("ruleKind"),rule={kind:selectedKind,timezone:data.get("timezone")};
            if(selectedKind==="interval"){if(!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(data.get("anchorAt")))throw Error("首次时间需要包含时区偏移或 Z。");rule.anchorAt=new Date(data.get("anchorAt")).toISOString();rule.everyMinutes=Number(data.get("everyMinutes"));}
            else {rule.time=data.get("time");if(selectedKind==="once")rule.date=data.get("date");else if(data.get("startDate"))rule.startDate=data.get("startDate");if(selectedKind==="weekly")rule.weekdays=data.getAll("weekdays").map(Number);}
            const ownerBotId=data.get("ownerBotId"),input={ownerBotId,kind:data.get("kind"),rule,enabled:data.get("enabled")==="on",missedPolicy:data.get("missedPolicy")};
            if(input.kind==="reminder")input.message=data.get("message");
            else input.recipe={botId:ownerBotId,title:data.get("title"),goal:data.get("goal"),criteria:String(data.get("criteria")??"").split("\n").filter(Boolean),dependsOn:data.getAll("dependsOn"),...(data.get("originSessionId")?{originSessionId:data.get("originSessionId")}:{})};
            const saved=await command(base?"schedule.update":"schedule.create",{...input,...(base?{scheduleId:base.scheduleId,expectedVersion:base.version}:{})});
            if(saved){setBase(saved);onSaved?.(saved);}
          };
          return h("div",null,
            latestSchedule&&latestSchedule.version!==base.version&&h("div",null,h("p",{role:"status"},"定时安排已更新。草稿保留，保存将检查原版本。"),button("重新载入最新安排",()=>{setBase(latestSchedule);setKind(latestSchedule.kind);setRuleKind(latestSchedule.rule.kind);setOwner(latestSchedule.ownerBotId);setEpoch(n=>n+1);})),
            h("div",{key:epoch},form(base?"重新确认并保存安排":"确认创建安排",data=>{submit(data).catch(error=>publish({error:error.message}));},
              field("负责 Bot","ownerBotId",{value:owner,options:botsOptions(),onChange:event=>setOwner(event.target.value)}),
              kind==="task"&&h("p",{className:"muted"},`执行模型：${view.snapshot.bots.find(bot=>bot.botId===owner)?.execution?.model??"当前不可用"}`),
              field("安排类型","kind",{value:kind,options:[{value:"reminder",label:"提醒（不启动任务）"},{value:"task",label:"定时任务"}],onChange:event=>setKind(event.target.value)}),
              kind==="reminder"?field("提醒内容","message",{value:base?.message,textarea:true,maxLength:4000}):h("div",null,field("任务标题","title",{value:base?.recipe?.title,maxLength:200}),field("目标","goal",{value:base?.recipe?.goal,textarea:true,maxLength:16000}),field("验收条件（每行一项）","criteria",{value:base?.recipe?.criteria?.join("\n"),textarea:true,required:false}),advanced("前置任务与结果接收",field("前置任务（可多选）","dependsOn",{value:base?.recipe?.dependsOn??[],multiple:true,required:false,options:view.snapshot.tasks.map(row=>({value:row.taskId,label:row.title}))}),field("结果接收会话","originSessionId",{value:base?.recipe?.originSessionId??"",required:true,options:[{value:"",label:"请选择接收会话"},...view.snapshot.sessions.filter(row=>row.purpose==="contact"&&row.state==="ready"&&!row.archived).map(row=>({value:row.sessionId,label:`${view.snapshot.bots.find(bot=>bot.botId===row.botId)?.name??"Bot"} · ${row.name??row.sessionId.slice(0,8)}`}))]}))),
              field("频率","ruleKind",{value:ruleKind,options:[{value:"once",label:"单次"},{value:"interval",label:"固定间隔"},{value:"daily",label:"每天"},{value:"weekly",label:"每周"}],onChange:event=>setRuleKind(event.target.value)}),field("时区","timezone",{value:timezone,maxLength:100}),
              ruleKind==="interval"?h("div",null,field("首次时间（带时区，例如 2026-10-10T09:00:00+08:00）","anchorAt",{value:base?.rule?.anchorAt}),field("间隔分钟（至少 15）","everyMinutes",{type:"number",value:base?.rule?.everyMinutes??60,min:15,step:1})):h("div",null,ruleKind==="once"?field("当地日期","date",{type:"date",value:base?.rule?.date}):field("开始日期","startDate",{type:"date",value:base?.rule?.startDate,required:false}),field("当地时间","time",{type:"time",value:base?.rule?.time??"09:00"}),ruleKind==="weekly"&&field("每周哪几天（可多选）","weekdays",{value:(base?.rule?.weekdays??[1]).map(String),multiple:true,options:["日","一","二","三","四","五","六"].map((day,index)=>({value:String(index),label:`星期${day}`}))})),
              kind==="task"&&field("错过时如何处理","missedPolicy",{value:base?.missedPolicy??"skip",options:[{value:"skip",label:"跳过并提醒"},{value:"latest",label:"恢复后只补最近一次"}]}),kind==="reminder"&&h("input",{type:"hidden",name:"missedPolicy",value:"skip"}),
              check("enabled","启用安排",base?.enabled??true),h("small",null,kind==="task"?"确认后按以上负责人、目标、频率和结果位置开始独立任务，使用该 Bot 的执行模型。关闭 DSH 时不运行，原生工具审批继续生效。":"到期保存插件内通知。关闭 DSH 时不运行，恢复后显示原定时间和迟到标记。"))));
        }
        function ScheduleHistory({scheduleId}) {
          const view=useView(),[rows,setRows]=useState([]),[selected,setSelected]=useState([]),[confirm,setConfirm]=useState(false),[pruneDraft,setPruneDraft]=useState(null);
          const load=async()=>{const value=await query("occurrence.list",{scheduleId,limit:100});if(value)setRows(Array.isArray(value)?value:value.items??[]);};
          useEffect(()=>{let active=true;query("occurrence.list",{scheduleId,limit:100}).then(value=>{if(active&&value)setRows(Array.isArray(value)?value:value.items??[]);});return()=>{active=false;};},[scheduleId,view.snapshot.revision]);
          return advanced("触发历史",...rows.map(row=>h("article",{key:row.occurrenceId},h("p",null,`${updatedName(row.dueAt)} · ${stateName(row.state)}`),row.taskId&&h("small",null,`任务 ${row.taskId}`),["settled","missed"].includes(row.state)&&h("label",{className:"check"},h("input",{type:"checkbox",checked:selected.includes(row.occurrenceId),onChange:event=>{setConfirm(false);setPruneDraft(null);setSelected(ids=>event.target.checked?[...ids,row.occurrenceId]:ids.filter(id=>id!==row.occurrenceId));}}),"选择清理此已结算触发记录"))),
            selected.length>0&&h("div",null,button("清理所选历史",()=>{setPruneDraft({occurrenceIds:[...selected],expectedVersions:Object.fromEntries(rows.filter(row=>selected.includes(row.occurrenceId)).map(row=>[row.occurrenceId,row.version]))});setConfirm(true);}),confirm&&h("div",null,h("p",null,`确认清理 ${pruneDraft?.occurrenceIds.length??0} 条已结算触发记录？原任务和操作回执保留。`),button("确认清理所选记录",async()=>{const result=await command("occurrence.prune",{...pruneDraft,confirm:true});if(result){setSelected([]);setConfirm(false);setPruneDraft(null);await load();}}),button("取消清理",()=>{setConfirm(false);setPruneDraft(null);}))));
        }
        function SchedulesPane() {
          const view=useView(),[rows,setRows]=useState([]),[editing,setEditing]=useState(null),[notices,setNotices]=useState([]),[creationEpoch,setCreationEpoch]=useState(0);
          useEffect(()=>{let active=true;Promise.all([query("schedule.list"),query("notice.list")]).then(([s,n])=>{if(active){if(s)setRows(Array.isArray(s)?s:s.items??[]);if(n)setNotices(Array.isArray(n)?n:n.notices??[]);}});return()=>{active=false;};},[view.snapshot.revision]);
          const selected=rows.find(row=>row.scheduleId===editing);
          return advanced("提醒与定时",h(NoticeList,{notices}),...rows.map(row=>h("article",{className:"card",key:row.scheduleId},h("h3",null,row.kind==="task"?row.recipe?.title:row.message),h("p",null,`${view.snapshot.bots.find(bot=>bot.botId===row.ownerBotId)?.name??"Bot"} · ${row.archived?"已归档":row.enabled?"已启用":"已暂停"} · ${row.rule.timezone} · 下次 ${updatedName(row.nextDueAt)}`),button("编辑并重新确认",()=>setEditing(row.scheduleId)),!row.archived&&button(row.enabled?"暂停安排":"启用安排",()=>command("schedule.state",{scheduleId:row.scheduleId,expectedVersion:row.version,enabled:!row.enabled})),!row.archived&&button("归档安排",()=>command("schedule.state",{scheduleId:row.scheduleId,expectedVersion:row.version,enabled:false,archived:true})),row.archived&&button("恢复安排（保持暂停）",()=>command("schedule.state",{scheduleId:row.scheduleId,expectedVersion:row.version,enabled:false,archived:false})),h(ScheduleHistory,{scheduleId:row.scheduleId}))),
            editing&&button("创建新的安排",()=>{setEditing(null);setCreationEpoch(epoch=>epoch+1);}),h(ScheduleEditor,{schedule:selected,onSaved:saved=>{setRows(previous=>[...previous.filter(row=>row.scheduleId!==saved.scheduleId),saved]);setEditing(saved.scheduleId);},key:selected?.scheduleId??`new-schedule:${creationEpoch}`}));
        }
        function TasksPane() {
          const view = useView();
          useEffect(()=>{if(view.focusTaskId)document.getElementById?.(`dsh-resource-${view.focusTaskId}`)?.scrollIntoView?.({block:"center"});},[view.focusTaskId]);
          const [recipients, setRecipients] = useState([]),
            reloadRecipients = useRef(null);
          useEffect(() => {
            let active = true, running, requested = false;
            const load = () => {
              requested = true;
              if (running) return;
              running = (async () => {
                while (active && requested) {
                  requested = false;
                  try {
                    const rows = [];
                    let cursor;
                    do {
                      const page = await rpc("command", {
                        action: "session.list",
                        input: { limit: 500, ...(cursor ? { cursor } : {}) },
                      });
                      rows.push(...page.items);
                      cursor = page.nextCursor;
                    } while (active && cursor);
                    if (active) setRecipients(rows);
                  } catch (error) {
                    if (active) publish({ error: error.message });
                  }
                }
              })().finally(() => {
                running = undefined;
                if (active && requested) load();
              });
            };
            reloadRecipients.current = load;
            load();
            return () => {
              active = false;
              reloadRecipients.current = null;
            };
          }, []);
          useEffect(() => { reloadRecipients.current?.(); }, [view.snapshot]);
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
                  (task.dependsOn??[]).length>0&&h("p",{className:"muted"},`前置任务：${task.dependsOn.map(id=>view.snapshot.tasks.find(row=>row.taskId===id)?.title??"不可读任务").join("、")}`),
                  (task.blockedReasons??[]).length>0&&h("p",{role:"status"},`暂不能开始：${task.blockedReasons.map(row=>typeof row==="string"?row:row.reason??row.code).join("；")}`),
                  task.dependencyStatus?.blocked&&h("p",{role:"status"},`暂不能开始：${task.dependencyStatus.reason}`),
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
                    advanced("子工作", form(
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
                    )),
                  attempt?.result &&
                    h(
                      "pre",
                      null,
                      attempt.result.content
                        .map((block) => block.text ?? "")
                        .join("\n"),
                    ),
                  attempt && advanced("运行详情", h(
                    "small", null,
                    `本地资源：${attempt.reservationHeld ? "尚未结算" : "已结算"}；外部副作用：${attempt.externalEffects}；用量：${attempt.usage === "UNKNOWN" ? "未知" : JSON.stringify(attempt.usage)}`,
                  )),
                  h(TaskRelations,{task,key:`relations:${task.taskId}`}),
                  h(TaskAdjustment,{task,key:task.taskId}),
                  attempt &&
                    !attempt.reservationHeld &&
                    h(TaskAcceptance,{task,attempt,key:attempt.attemptId}),
                );
              }),
            ),
            card(
              "新任务",
              h(SchedulesPane),
              form(
                "登记任务",
                (data) =>
                  command("task.create", {
                    botId: data.get("botId"),
                    title: data.get("title"),
                    goal: data.get("goal"),
                    dependsOn: data.getAll("dependsOn"),
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
                advanced("验收与结果接收",
                field("前置任务（可多选）","dependsOn",{options:view.snapshot.tasks.map(row=>({value:row.taskId,label:row.title})),multiple:true,required:false}),
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
            ),
          );
        }
        function SharingEditor({bot:latestBot}) {
          const view=useView(),[bot,setBase]=useState(latestBot),[receivers,setReceivers]=useState(null),[formEpoch,setFormEpoch]=useState(0);
          const selected=receivers??view.snapshot.bots.filter(row=>row.botId!==bot.botId && (bot.share.receivers.includes("*")||bot.share.receivers.includes(row.botId))).map(row=>row.botId);
          return resourceCard(bot.botId,`${botLabel(bot)} 的共享范围`,
            latestBot.revision !== bot.revision && h("div",null,
              h("p",{role:"status"},"共享范围或 Bot 配置已更新。当前权限草稿已保留；保存将检查原版本。"),
              button("重新载入最新共享范围",()=>{setBase(latestBot);setReceivers(null);setFormEpoch(epoch=>epoch+1);}),
            ),
            h("div",{key:formEpoch},form("保存共享上限",async data=>{
              const saved=await command("share.set",{botId:bot.botId,expectedVersion:bot.revision,share:{
                enabled:data.get("enabled")==="on",receivers:data.getAll("receiver"),
                scope:Object.fromEntries(["sessions","tasks","memories","materials"].map(key=>[key,data.get(key)==="on"?["*"]:[]])),
              }});
              if(saved){setBase({...bot,share:saved,revision:bot.revision+1});setReceivers(null);setFormEpoch(epoch=>epoch+1);}return saved;
            },check("enabled","允许其他 Bot 只读了解",bot.share.enabled),
            ...view.snapshot.bots.filter(row=>row.botId!==bot.botId).map(row=>h("label",{className:"check",key:row.botId},
              h("input",{type:"checkbox",name:"receiver",value:row.botId,checked:selected.includes(row.botId),onChange:event=>{
                const checked=event.target.checked;setReceivers(draft=>{const ids=draft??selected;return checked?[...new Set([...ids,row.botId])]:ids.filter(id=>id!==row.botId);});
              }}),botLabel(row))),
            check("sessions","共享会话",bot.share.scope.sessions?.includes("*")),
            check("tasks","共享任务",bot.share.scope.tasks?.includes("*")),
            check("memories","共享记忆",bot.share.scope.memories?.includes("*")),
            check("materials","共享资料",bot.share.scope.materials?.includes("*")),
            )),
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
              ...view.snapshot.bots.map(bot=>h(SharingEditor,{bot,key:bot.botId})),
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
                      ...botsOptions(),
                      { value: "", label: "普通 DSH 会话（需指定具体会话）" },
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
                  check("tasks", "允许任务"),
                  advanced("指定会话和任务（可选）",
                  field(
                    "会话 ID（逗号分隔；Bot 资源留空表示全部）",
                    "sessionsIds",
                    { required: false },
                  ),
                  field("任务 ID", "tasksIds", { required: false }),
                  ),
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
                      expectedVersion: grant.version,
                    }),
                  ),
                ),
              ),
            ),
          );
        }
        function GroupMembersEditor({group:latestGroup}) {
          const [group,setBase]=useState(latestGroup),[formEpoch,setFormEpoch]=useState(0);
          return advanced("管理群成员",
            latestGroup.version !== group.version && h("div",null,
              h("p",{role:"status"},"群成员或群状态已更新。当前成员草稿已保留；保存将检查原版本。"),
              button("重新载入最新群成员",()=>{setBase(latestGroup);setFormEpoch(epoch=>epoch+1);}),
            ),
            h("div",{key:formEpoch},form("更新群成员",async data=>{
              const saved=await command("group.members",{groupId:group.groupId,expectedVersion:group.version,botIds:data.getAll("botIds"),coordinatorBotId:data.get("coordinator")});
              if(saved){setBase(saved);setFormEpoch(epoch=>epoch+1);}return saved;
            },field("成员（可多选）","botIds",{options:botsOptions(),multiple:true,value:group.members.filter(row=>row.active).map(row=>row.botId)}),field("协调者","coordinator",{options:botsOptions(),value:group.coordinatorBotId}))),
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
                  advanced("开会", form(
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
                  )),
                  h(GroupMembersEditor,{group,key:group.groupId}),
                ),
              ),
            ),
            card(
              "新建内部群",
              h(TemplateCreator,{teamOnly:true}),
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
                advanced("群设置",
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
            ),
          );
        }
        function MeetingTopicEditor({meeting:latestMeeting}) {
          const [meeting,setBase]=useState(latestMeeting),[formEpoch,setFormEpoch]=useState(0);
          return advanced("修改议题",
            latestMeeting.epoch !== meeting.epoch && h("div",null,
              h("p",{role:"status"},"会议议题已变更。当前议题草稿保留在原会议世代；不会覆盖新议题。"),
              button("重新载入最新议题",()=>{setBase(latestMeeting);setFormEpoch(epoch=>epoch+1);}),
            ),
            h("div",{key:formEpoch},form("修改议题并重开独立意见",async data=>{
              const saved=await command("meeting.topic",{meetingId:meeting.meetingId,epoch:meeting.epoch,topic:data.get("topic"),materials:data.get("materials")});
              if(saved){setBase(saved);setFormEpoch(epoch=>epoch+1);}return saved;
            },field("新议题","topic",{value:meeting.topic,maxLength:1000}),field("新材料","materials",{value:meeting.materials,textarea:true,required:false,maxLength:32000}))),
          );
        }
        function MeetingActionEditor({meeting:latestMeeting}) {
          const [meeting,setBase]=useState(latestMeeting),[formEpoch,setFormEpoch]=useState(0);
          return advanced("登记行动任务",
            latestMeeting.epoch !== meeting.epoch && h("div",null,
              h("p",{role:"status"},"会议决定所属世代已改变。当前行动草稿仍属于原决定；请先查阅最新决定。"),
              button("重新载入最新会议决定",()=>{setBase(latestMeeting);setFormEpoch(epoch=>epoch+1);}),
            ),
            h("div",{key:formEpoch},form("生成真实行动任务",data=>command("meeting.action",{
              meetingId:meeting.meetingId,epoch:meeting.epoch,botId:data.get("botId"),title:data.get("title"),goal:data.get("goal"),criteria:String(data.get("criteria")).split("\n").filter(Boolean),
            }),field("负责人","botId",{options:botsOptions()}),field("任务标题","title",{maxLength:200}),field("行动目标","goal",{textarea:true,maxLength:16000}),field("验收条件","criteria",{textarea:true}))),
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
                  h(MeetingActionEditor,{meeting,key:`action:${meeting.meetingId}`}),
                !["complete", "cancelled"].includes(meeting.phase) &&
                  h(MeetingTopicEditor,{meeting,key:`topic:${meeting.meetingId}`}),
              ),
            ),
          );
        }
        function SessionEditor({binding:latestBinding,onSaved}) {
          const [base,setBase]=useState(latestBinding),[epoch,setEpoch]=useState(0),[choices,setChoices]=useState({configure:"",fork:"",preset:""}),view=useView();
          const model=base.model?JSON.stringify({provider:base.model.provider,model:base.model.model}):"",models=modelsOptions();
          if(model&&!models.some(row=>row.value===model))models.push({value:model,label:`${base.model.provider} / ${base.model.model}（当前不可用）`});
          const sessionModels = selected => selected&&!models.some(row=>row.value===selected)?[...models,{value:selected,label:`${JSON.parse(selected).provider} / ${JSON.parse(selected).model}（当前不可用，请重新选择）`}]:models;
          const presets=view.catalog.presets.filter(row=>!row.broken).map(row=>({value:row.id,label:row.name??row.id}));
          if(choices.preset&&!presets.some(row=>row.value===choices.preset))presets.push({value:choices.preset,label:`${choices.preset}（当前不可用，请重新选择）`});
          return advanced("配置与接续",
            (latestBinding.revision??1)!==(base.revision??1)&&h("div",null,h("p",{role:"status"},"会话配置已更新。草稿保留，保存会检查原版本。"),button("重新载入最新会话配置",()=>{setBase(latestBinding);setChoices({configure:"",fork:"",preset:""});setEpoch(n=>n+1);})),
            h("div",{key:epoch},form("保存此会话配置",async data=>{
              const saved=await command("session.configure",{sessionId:base.sessionId,expectedVersion:base.revision??1,name:data.get("name"),...(data.get("model")?{model:JSON.parse(data.get("model"))}:{}),...(data.get("presetId")?{presetId:data.get("presetId")}:{})});if(saved){setBase(saved);onSaved?.();}
            },field("会话名称","name",{value:base.name??view.snapshot.bots.find(bot=>bot.botId===base.botId)?.name,maxLength:100}),base.purpose==="contact"&&field("此会话模型","model",{value:choices.configure,required:false,options:[{value:"",label:`保留当前模型${base.model?.model?`（${base.model.model}）`:""}`},...sessionModels(choices.configure)],onChange:event=>setChoices(draft=>({...draft,configure:event.target.value}))}),base.purpose==="contact"&&field("原生会话配置（首次对话后锁定）","presetId",{value:choices.preset,required:false,options:[{value:"",label:"保留当前配置"},...presets],onChange:event=>setChoices(draft=>({...draft,preset:event.target.value}))}),h("small",null,"请先等待当前回复、排队消息与工作结算。原会话工作目录固定，模型修改从下一轮生效。"))),
            base.purpose==="contact"&&form("创建接续会话",async data=>{
              const row=await command("session.fork",{sessionId:base.sessionId,expectedVersion:base.revision??1,...(data.get("name")?{name:data.get("name")}:{}) ,...(data.get("model")?{model:JSON.parse(data.get("model"))}:{}),...(data.get("cwd")?.trim()?{cwd:data.get("cwd").trim()}:{}),...(data.get("atSeq")!==""?{atSeq:Number(data.get("atSeq"))}:{})});
              if(row?.state==="ready"){onSaved?.();await openSession(row.sessionId);}
            },field("新会话名称","name",{value:base.name,required:false,maxLength:100}),field("新会话模型","model",{value:choices.fork,required:false,options:[{value:"",label:"沿用原会话模型"},...sessionModels(choices.fork)],onChange:event=>setChoices(draft=>({...draft,fork:event.target.value}))}),advanced("接续范围与目录",field("原生日志结束事件序号（留空沿用最近完成轮次）","atSeq",{type:"number",min:0,required:false}),field("新会话工作目录","cwd",{required:false,value:base.cwd??""})),h("small",null,"创建新会话保留可核对的原日志来源，原会话与旧记录保留。接续沿用原生会话配置；需要另一配置时创建空白新会话。")));
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
                    binding?.name || row.sessionId.slice(0, 8),
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
                binding&&h(SessionEditor,{binding,onSaved:()=>load(),key:binding.sessionId}),
              );
            }),
            page.cursor && button("加载下一页", () => load(page.cursor)),
            h(DiagnosticsPane),
          );
        }
        function DiagnosticsPane() {
          const view=useView(),[preview,setPreview]=useState(""),[selected,setSelected]=useState([]),[copied,setCopied]=useState(false);
          const operations=[...view.pending,...view.retained];
          return advanced("诊断",h("p",null,"在本机读取版本、功能状态、对象数量、错误码和选定的操作 ID。预览与复制内容相同；不会上传，正文、路径和凭据不包含在内。"),
            field("附带的原始操作（可多选）","operationIds",{options:operations.map(row=>({value:row.operationId,label:row.operationId})),multiple:true,required:false,value:selected,onChange:event=>{setSelected([...event.target.selectedOptions].map(row=>row.value));setPreview("");setCopied(false);}}),
            button("预览诊断",async()=>{const value=await query("diagnostics.read",{operationIds:selected});if(value){setPreview(JSON.stringify(value,null,2));setCopied(false);}}),
            preview&&h("div",null,h("pre",null,preview),button("复制以上诊断",async()=>{try{await navigator.clipboard.writeText(preview);setCopied(true);}catch{publish({error:"无法写入剪贴板，请从预览选择并复制。"});}}),copied&&h("p",{role:"status"},"已复制诊断。")));
        }
        function OutboxPane() {
          const view = useView();
          return h(
            "div",
            null,
            h(DiagnosticsPane),
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
            [tab, setTab] = useState("bots"),
            [collaborationTab, setCollaborationTab] = useState("groups"),
            [manageTab, setManageTab] = useState("sharing");
          useEffect(()=>{if(view.requestedTab){setTab(view.requestedTab);publish({requestedTab:null});}},[view.requestedTab]);
          const paneKey = tab === "collaboration" ? collaborationTab : tab === "manage" ? manageTab : tab;
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
                h("small", null, `原生多 Bot · 独立记忆 · 协作任务 · 插件 ${pluginVersion} / 服务 ${view.snapshot.pluginVersion ?? "未知"}`),
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
                    button("查回原始操作", () => lookupOperation(row)),
                    button("用原 ID 接续", () =>
                      command(row.action, row.input, row),
                    ),
                    button("保留并收起",()=>retainPending(row)),
                  ),
                ),
              ),
            view.retained.length>0 && advanced("保留的原始操作",
              h("p",{className:"muted"},"收起只改变浏览器记录的显示；原始请求和 ID 保留，任务和未知状态不受影响。"),
              ...view.retained.map(row=>h("div",{className:"actions",key:row.operationId},
                h("small",null,`${row.action} · ${row.operationId}`),
                button("查回原始操作",()=>lookupOperation(row)),
                button("用原 ID 接续",()=>command(row.action,row.input,row)),
              )),
            ),
            h(
              "nav",
              { "aria-label": "Bot 工作台功能" },
              ...Object.entries({
                bots: "Bots",
                memory: "记忆",
                tasks: "任务",
                collaboration: "协作",
                manage: "管理",
              }).map(([key, label]) =>
                button(label, () => setTab(key), {
                  "aria-selected": tab === key,
                }),
              ),
            ),
            (tab === "collaboration" || tab === "manage") && h("nav", {
              "aria-label": tab === "collaboration" ? "协作功能" : "管理功能",
            }, ...Object.entries(tab === "collaboration"
              ? {groups: "内部群", meetings: "会议"}
              : {sharing: "共享与授权", sessions: "会话管理", outbox: "结果与投递"}
            ).map(([key, label]) => button(label,
              () => tab === "collaboration" ? setCollaborationTab(key) : setManageTab(key),
              {"aria-selected": paneKey === key},
            ))),
            view.loading ? h("p", null, "连接原生插件…") : h(panes[paneKey]),
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
                        ...(data.get("name")?{name:data.get("name")}:{}) ,
                        ...(data.get("model")?{model:JSON.parse(data.get("model"))}:{}),
                        ...(data.get("presetId")?{presetId:data.get("presetId")}:{}) ,
                        ...(data.get("cwd")?.trim()?{cwd:data.get("cwd").trim()}:{}),
                      });
                      if (result?.state === "ready") {
                        publish({ chooser: false });
                        openSession(result.sessionId);
                      }
                    },
                    field(t("choose"), "botId", {
                      options: bots.map((bot) => ({
                        value: bot.botId,
                        label: botLabel(bot),
                      })),
                    }),
                    advanced("会话设置",field("会话名称","name",{required:false,maxLength:100}),field("此会话模型","model",{required:false,options:[{value:"",label:"使用 Bot 的聊天模型"},...modelsOptions()]}),field("原生会话配置","presetId",{required:false,options:[{value:"",label:"使用 Bot 的默认配置"},...view.catalog.presets.filter(row=>!row.broken).map(row=>({value:row.id,label:row.name??row.id}))]}),field("此会话工作目录","cwd",{required:false})),
                    h("small",null,"新会话自动带入该 Bot 的身份、长期记忆与未完成任务。"),
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
          const identity=bot.deletedAt
            ? `${botLabel(bot)} · 已删除 Bot 的历史会话`
            : binding.purpose === "contact"
              ? `正在与${botLabel(bot)}聊天${bot.lifecycle === "active" ? "" : " · 已暂停"}`
              : `${botLabel(bot)} · ${binding.purpose === "execution" ? "工作会话" : "协作会话"}`;
          return h("div",{className:"actions",style:{display:"flex",gap:"8px",alignItems:"center",flexWrap:"wrap"}}, h(
            "button",
            {
              type: "button",
              title: `${identity} · ${t("manage")}`,
              "aria-label": identity,
              style: {font:"inherit",color:"var(--dsw-alias-label-primary)",background:"var(--dsw-alias-bg-layer-2,transparent)",border:"1px solid var(--dsw-alias-border-l2,currentColor)",borderRadius:"8px",padding:"6px 12px",cursor:"pointer",maxWidth:"100%",overflowWrap:"anywhere"},
              onClick: () => ctx.layout.selectPanel("dsh-bot"),
            },
            identity,
          ),binding.purpose==="contact"&&button(`任务简报${(view.snapshot.notices??[]).filter(row=>row.botId===bot.botId&&!row.acknowledgedAt&&!row.ackedAt&&!row.read).length?` · ${(view.snapshot.notices??[]).filter(row=>row.botId===bot.botId&&!row.acknowledgedAt&&!row.ackedAt&&!row.read).length}`:""}`,event=>publish({briefing:{botId:bot.botId,returnFocus:event.currentTarget}}),{style:{font:"inherit",border:"1px solid var(--dsw-alias-border-l2,currentColor)",borderRadius:"8px",padding:"6px 10px",background:"var(--dsw-alias-bg-layer-2,transparent)",color:"inherit"}}));
        }
        function DeleteDialog() {
          const view=useView(),request=view.deleting,modal=useRef(null);
          useEffect(()=>{
            const element=modal.current;
            if(!request||!element)return;
            element.showModal();
            return ()=>{
              if(element.open)element.close();
              if(request.returnFocus?.isConnected)request.returnFocus.focus();
            };
          },[request?.botId,request?.expectedVersion]);
          if(!request)return null;
          const current=view.snapshot.bots.find(bot=>bot.botId===request.botId);
          return h("dialog",{ref:modal,className:"dsh-bot-delete-modal","aria-label":"删除 Bot",
            onCancel:event=>{event.preventDefault();if(!view.busy)publish({deleting:null,error:""});},
            onKeyDown:event=>{
              if(event.key!=="Tab")return;
              const controls=[...event.currentTarget.querySelectorAll('button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(node=>node.getClientRects().length);
              const first=controls[0],last=controls.at(-1);
              if(!first){event.preventDefault();return;}
              if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
              else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
            },
          },
            h("style",null,".dsh-bot-delete-modal{border:0;padding:0;background:transparent;color:inherit;width:min(480px,calc(100vw - 32px));max-height:90vh;overflow:auto;border-radius:16px}.dsh-bot-delete-modal::backdrop{background:rgba(0,0,0,.35)}.dsh-bot-delete-modal .dsh-bot{height:auto;background:var(--dsw-alias-bg-layer-1,Canvas)}"),
            h("section",{className:"dsh-bot"},
              h("style",null,styles),
              h("h2",null,`删除 ${request.name}？`),
              h("p",null,"删除后从 Bots 列表和新建聊天选择中移除。原会话、记忆、任务与执行记录保留，可以恢复。"),
              h("p",{className:"muted"},"正在回复、排队、未完成群/会议或未结算的工作会阻止删除。请先停止并等待结算；未知工作需先查回。"),
              current?.revision!==request.expectedVersion && h("p",{role:"status"},"Bot 已被其他页面修改，请取消后按最新配置重新确认删除。"),
              view.error && h("p",{role:"alert",className:"error"},view.error),
              h("div",{className:"actions"},
                button("取消",()=>publish({deleting:null,error:""}),{autoFocus:true}),
                button("确认删除",async()=>{
                  const deleted=await command("bot.delete",{botId:request.botId,expectedVersion:request.expectedVersion});
                  if(deleted?.deletedAt)publish({deleting:null});
                },{disabled:view.busy||!current||current.revision!==request.expectedVersion}),
              ),
            ),
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
        ctx.slots.inject("shell.overlay", () =>
          ctx.slots.register(
            {name:"shell.overlay",id:"dsh-bot.delete",order:260},
            DeleteDialog,
          ),
        );
        ctx.slots.inject("shell.overlay", () => ctx.slots.register({name:"shell.overlay",id:"dsh-bot.briefing",order:255},BriefingDialog));
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
        ctx.slots.inject("conversation.input.dock", () =>
          ctx.slots.register(
            {name:"conversation.input.dock",id:"dsh-bot.identity",order:250},
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
