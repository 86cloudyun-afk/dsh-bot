import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { LlmAdapter } from "@deepseek-ai/dsh-llm";
import { createLaunchEnvironmentSnapshot } from "@deepseek-ai/dsh-launch-environment";
import { chromium } from "playwright-core";
import Terminals from "@deepseek-ai/dsh-terminal";
import * as TerminalBash from "@deepseek-ai/dsh-terminal-bash";

const require = createRequire(import.meta.url),
  official = dirname(require.resolve("@deepseek-ai/dsh/package.json"));
const { runProfile } = await import(
  pathToFileURL(join(official, "lib/profile-boot.js")).href
);
export const controlledProvider = "controlled-stock-gui";
export async function* textReply(text) {
  yield { type: "block-start", index: 0, blockType: "text" };
  yield { type: "text-delta", index: 0, text };
  yield { type: "block-end", index: 0, block: { type: "text", text } };
  yield {
    type: "usage",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  };
  yield { type: "finish", reason: { kind: "stop" } };
}
export async function* toolReply(name, args, id) {
  yield { type: "block-start", index: 0, blockType: "tool-call" };
  yield {
    type: "block-end",
    index: 0,
    block: { type: "tool-call", id, name, arguments: JSON.stringify(args) },
  };
  yield { type: "finish", reason: { kind: "tool-calls" } };
}
export async function waitFor(check, label, timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error(`Timed out: ${label}`);
}

/** Fresh standard profile, standard package install, real stock shell/browser. */
export async function stockGui({
  stream,
  artifact = process.argv[2],
  output = process.env.DSH_BOT_GUI_OUTPUT,
  existingRoot,
} = {}) {
  const root = existingRoot ?? await mkdtemp(join(tmpdir(), "dsh-bot-stock-gui-")),
    evidence = output ? resolve(output) : join(root, "evidence"),
    profile = "plugin-qualification";
  for (const dir of [evidence, join(root, "work"), join(root, "packages")])
    await mkdir(dir, { recursive: true });
  const previousDshHome = process.env.DSH_HOME,
    env = { ...process.env, DSH_HOME: join(root, "home") },
    cli = join(official, "lib/bin.js");
  const command = (args) =>
    execFileSync(process.execPath, [cli, ...args], {
      env,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
  const common = [
    "--store-dir",
    join(root, "cache"),
    "--strict-peer-dependencies",
    "--config.strict-ssl=true",
    "--config.registry=https://registry.npmjs.org",
  ];
  if (!artifact) {
    const packed = JSON.parse(
      execFileSync(
        "npm",
        ["pack", "--json", "--pack-destination", join(root, "packages")],
        { cwd: resolve(import.meta.dirname, "../.."), encoding: "utf8" },
      ),
    )[0];
    artifact = join(root, "packages", packed.filename);
  }
  artifact = resolve(artifact);
  const sha = createHash("sha256")
    .update(await readFile(artifact))
    .digest("hex");
  if (process.env.DSH_BOT_GUI_SHA256 && process.env.DSH_BOT_GUI_SHA256 !== sha)
    throw Error("Artifact SHA256 mismatch");
  const report = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    officialVersion: JSON.parse(
      await readFile(join(official, "package.json"), "utf8"),
    ).version,
    artifactSha256: sha,
    standardProfile: true,
    standardPluginInstall: true,
    controlledProvider: true,
    realModelRequests: 0,
    checks: {},
    requests: [],
  };
  const source = resolve(import.meta.dirname, "../..");
  report.sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: source,
    encoding: "utf8",
  }).trim();
  report.sourceTreeDirty = !!execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=normal"],
    { cwd: source, encoding: "utf8" },
  ).trim();
  if (!existingRoot) await writeFile(
    join(evidence, "initialization.log"),
    command([
      profile,
      "--from-default-profile",
      "web",
      "--dump-default-config",
    ]),
    { mode: 0o600 },
  );
  if (!existingRoot) await writeFile(
    join(evidence, "installation.log"),
    command([
      "plugin",
      "--profile",
      profile,
      "add",
      artifact,
      "--ignore-scripts",
      ...common,
    ]),
    { mode: 0o600 },
  );
  let app, browser, page, context, bootCount=0;
  const errors = [];
  report.browserErrors = errors;
  const state = {
    root,
    evidence,
    report,
    get app() {
      return app;
    },
    get page() {
      return page;
    },
    get context() {
      return context;
    },
    errors,
    activeSignals: new Map(),
  };
  state.boot = async () => {
    const firstBoot=++bootCount===1;
    process.env.DSH_HOME = env.DSH_HOME;
    const server = createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    app = await runProfile({
      environment: createLaunchEnvironmentSnapshot([
        { source: "process", values: env },
      ]),
      profile,
      patchFiles: [],
      args: ["--host", "127.0.0.1", "--port", String(port), "--no-open"],
    });
    await app.ctx.loader.await();
    if (!app.ctx.get("dshBot"))
      throw Error("Plugin not active in stock profile");
    // Exercise the optional official PTY services through Cordis' public API.
    if (!app.ctx.get("terminals")) {
      await app.ctx.plugin(Terminals).await();
      await app.ctx.plugin(TerminalBash, { backendType: "bash" }).await();
    }
    report.optionalOfficialPtyServices = true;
    class Provider extends LlmAdapter {
      providerInfo(id) {
        return { id, name: "Controlled stock GUI verification" };
      }
      async listModels(provider) {
        return ["model-a", "model-b", "model-c"].map((id) => ({
          provider,
          id,
          name: id,
        }));
      }
      async resolveModel(provider, model, signal) {
        if (signal !== undefined) {
          if (!(signal instanceof AbortSignal))
            throw Error("Invalid native AbortSignal");
          signal.throwIfAborted();
        }
        return {
          provider,
          id: model,
          name: model,
          context: { contextWindow: 32768 },
          maxTokens: 256,
        };
      }
      async *stream(options) {
        if ((options.purpose ?? "conversation") === "conversation")
          state.activeSignals.set(options.sessionId, options.signal);
        const row = {
          sessionId: options.sessionId,
          purpose: options.purpose ?? "conversation",
          provider: options.provider,
          model: options.model,
          finish: "UNKNOWN",
        };
        report.requests.push(row);
        for await (const chunk of stream(options, state)) {
          if (chunk.type === "finish") row.finish = chunk.reason.kind;
          yield chunk;
        }
      }
    }
    app.ctx.llm.registerAdapter([controlledProvider], new Provider());
    app.ctx.on(
      "llm/stream",
      async function* (options, next) {
        if (options.provider !== controlledProvider)
          throw Error("Controlled qualification does not call external models");
        yield* next();
      },
      { global: true },
    );
    await app.ctx.agentDefaultModel.saveSelection({
      provider: controlledProvider,
      model: "model-c",
    });
    browser = await chromium.launch({
      ...(process.env.DSH_BOT_CHROMIUM
        ? { executablePath: process.env.DSH_BOT_CHROMIUM }
        : {}),
      headless: true,
      args: process.platform === "linux" ? ["--no-sandbox"] : [],
    });
    context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 1366, height: 900 },
    });
    page = await context.newPage();
    page.on("pageerror", (error) =>
      errors.push({ stage: report.stage, message: error.message }),
    );
    state.url = app.ctx.connection.authenticatedUrl(`http://127.0.0.1:${port}`);
    await page.goto(state.url, { waitUntil: "networkidle", timeout: 45000 });
    const previewContinue = page.getByRole("button", {
      name: "继续",
      exact: true,
    });
    if(firstBoot && !existingRoot){
      await previewContinue.waitFor({ state: "visible" });
      await previewContinue.click();
      await previewContinue.waitFor({ state: "hidden" });
    }
  };
  state.shutdown = async () => {
    await browser?.close();
    browser = null;
    page = null;
    await app?.shutdown.shutdown(0);
    app = null;
    if (previousDshHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousDshHome;
  };
  state.uninstall = () =>
    command([
      "plugin",
      "--profile",
      profile,
      "remove",
      "dsh-bot",
      "--config.ignore-scripts=true",
      ...common,
    ]);
  state.reinstall = (packageArtifact = artifact) =>
    command([
      "plugin",
      "--profile",
      profile,
      "add",
      resolve(packageArtifact),
      "--ignore-scripts",
      ...common,
    ]);
  state.snapshot = () =>
    page.evaluate(async () => {
      const response = await fetch("/api/dsh.bot/snapshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: crypto.randomUUID(),
          method: "dsh.bot/snapshot",
          payload: {},
        }),
      });
      const value = await response.json();
      if (!value.result?.ok)
        throw Error(value.result?.error?.code ?? "Snapshot failed");
      return value.result.value;
    });
  state.until = async (check, label) => {
    let snapshot;
    await waitFor(async () => {
      snapshot = await state.snapshot();
      return check(snapshot);
    }, label);
    return snapshot;
  };
  state.card = (title) =>
    page
      .locator("section.card")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  state.workbench = async (tab) => {
    await page.getByRole("button", { name: "Bot 工作台", exact: true }).click();
    if (["内部群", "会议"].includes(tab)) await page.getByRole("button", {name: "协作", exact: true}).click();
    if (["共享与授权", "会话管理", "结果与投递"].includes(tab)) await page.getByRole("button", {name: "管理", exact: true}).click();
    if (tab) await page.getByRole("button", { name: tab, exact: true }).click();
  };
  state.expand = async (card, label) => {
    const summary = card.locator("summary").filter({hasText: label});
    if (await summary.evaluate(el => !el.parentElement.open)) await summary.click();
  };
  state.save = async (name) => {
    await writeFile(
      join(evidence, `${name}.txt`),
      await page.locator("body").innerText(),
      { mode: 0o600 },
    );
    await page.screenshot({
      path: join(evidence, `${name}.png`),
      fullPage: true,
    });
  };
  state.check = (name, value) => {
    if (!value) throw Error(`Failed: ${name}`);
    report.checks[name] = true;
  };
  state.original = async (sid) => {
    const handle = await app.ctx.sessionPersistence.open(sid, "read");
    try {
      return (await handle.read(0)).events;
    } finally {
      await handle.close();
    }
  };
  state.writeReport = () =>
    writeFile(
      join(evidence, "stock-gui-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      { mode: 0o600 },
    );
  return state;
}
