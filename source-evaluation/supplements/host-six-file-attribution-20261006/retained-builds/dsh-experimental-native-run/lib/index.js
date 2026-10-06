import { existsSync, statSync } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tryLockExclusive } from "@deepseek-ai/node-addon-system/flock";
import { deepFreeze } from "@deepseek-ai/dsh-util-values";
import { DeepSeekAdapter, isDeepSeekProviderFactory } from "@deepseek-ai/dsh-llm-deepseek";
import { BlockAssembler, LlmError, ReasoningEffortId, assembleAssistantStream, createAssistantMessage, createUserMessage } from "@deepseek-ai/dsh-llm";
import { createHash } from "node:crypto";
import { brandString } from "@deepseek-ai/dsh-brand";
import { isNativeAgentHandle, isProtectedNativeRequest } from "@deepseek-ai/dsh-agent-loop";
import { SessionId, deriveEventMessage } from "@deepseek-ai/dsh-session";
import { scopeOf } from "@deepseek-ai/dsh-scope";
//#region lib/types/ids.js
/** Journal-local identifiers carry no caller authority. */
/** Brand a journal-local operation label without granting authority.
* @param value Journal-local operation label.
* @returns The branded label, subject to admission validation.
*/
const NativeOperationId = (value) => brandString(value);
/** Brand a journal-local target label without granting authority.
* @param value Journal-local target label.
* @returns The branded target label.
*/
const NativeTargetId = (value) => brandString(value);
/** Brand a journal-local control receipt label without granting authority.
* @param value Journal-local control receipt label.
* @returns The branded receipt label.
*/
const NativeControlId = (value) => brandString(value);
//#endregion
//#region lib/types/values.js
/** Strict durable-record parsing and deterministic, non-secret input hashing. */
/** Reject a controlled operation with its exact machine-readable reason. */
function reject(code) {
	throw new LlmError(code, code);
}
/** Encode JSON with sorted object keys; unsupported values reject. */
function canonical(value) {
	if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
	if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
	if (record(value)) return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
	return reject("INVALID_JSON_INPUT");
}
/** Hash only the supplied non-secret input; authentication is never passed here. */
function digest(value) {
	return createHash("sha256").update(canonical(value)).digest("hex");
}
/** Reproduce only the accepted zero-tool text Messages projection at final wire validation.
* Empty native system anchors carry no prompt and are omitted by the provider.
* @param input Frozen native or direct text history.
* @returns Canonical user/assistant wire turns, merging adjacent equal roles.
*/
function textWire(input) {
	const messages = [];
	for (const message of input) {
		if (message.content.some((block) => block.type !== "text")) reject("FINAL_INPUT_CONFLICT");
		if (message.role === "system" && message.content.every((block) => block.type === "text" && block.text.length === 0)) continue;
		if (message.role !== "user" && message.role !== "assistant") reject("FINAL_INPUT_CONFLICT");
		const content = message.content.flatMap((block) => block.type === "text" && block.text.length > 0 ? [{
			type: "text",
			text: block.text
		}] : []);
		if (message.role === "user" && content.length === 0) continue;
		const previous = messages.at(-1);
		if (previous?.role === message.role) previous.content.push(...content);
		else messages.push({
			role: message.role,
			content
		});
	}
	return messages;
}
/** Narrow a parsed JSON object. */
function record(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Recognize a nonnegative exact integer. */
function integer(value) {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}
/** Validate a journal-local identifier. */
function id(value) {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
}
/** Parse the complete persisted native Session relationship.
* @param value Parsed candidate binding.
* @returns Validated detached binding.
*/
function sessionBinding(value) {
	if (!record(value) || Object.keys(value).length !== 4 || !id(value.sessionId) || typeof value.agentPreset !== "string" || value.agentPreset.length === 0 || value.agentPreset.length > 200 || typeof value.controlConfigId !== "string" || value.controlConfigId.length === 0 || value.controlConfigId.length > 200 || typeof value.cwd !== "string" || !value.cwd.startsWith("/") || value.cwd.includes("\0")) reject("INVALID_SESSION_BINDING");
	return {
		sessionId: value.sessionId,
		agentPreset: value.agentPreset,
		controlConfigId: value.controlConfigId,
		cwd: value.cwd
	};
}
/** Parse exact flushed native settlement coordinates and integrity digests.
* @param value Candidate receipt.
* @returns Validated detached receipt.
*/
function sessionReceipt(value) {
	if (!record(value) || Object.keys(value).length !== 8 || !id(value.sessionId) || !integer(value.turn) || value.turn < 1 || !integer(value.step) || value.step < 1 || !integer(value.startSeq) || !integer(value.assistantSeq) || !integer(value.endSeq) || value.startSeq > value.assistantSeq || value.assistantSeq >= value.endSeq || typeof value.assistantDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.assistantDigest) || typeof value.endDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.endDigest)) reject("INVALID_SESSION_RECEIPT");
	return {
		sessionId: value.sessionId,
		turn: value.turn,
		step: value.step,
		startSeq: value.startSeq,
		assistantSeq: value.assistantSeq,
		endSeq: value.endSeq,
		assistantDigest: value.assistantDigest,
		endDigest: value.endDigest
	};
}
/** Validate every required authority field read from disk or admission JSON. */
function target(value) {
	if (!record(value) || !id(value.id) || value.scopeRef !== "text-only" || value.provider !== "deepseek-official" || !id(value.model) || !integer(value.maxTokens) || value.maxTokens < 1 || value.reasoningEffort !== "off" || value.endpoint !== "https://api.deepseek.com/anthropic/v1/messages" || ![
		"active",
		"revoked",
		"archived"
	].includes(String(value.state))) reject("INVALID_BINDING");
	for (const key of [
		"runGeneration",
		"botEpoch",
		"taskEpoch",
		"taskRevision",
		"authorityEpoch",
		"membershipGeneration",
		"configVersion"
	]) if (!integer(value[key]) || Number(value[key]) < 1) reject("INVALID_BINDING");
	if (Object.keys(value).length !== (value.sessionBinding === void 0 ? 15 : 16)) reject("INVALID_BINDING");
	const state = value.state;
	if (state !== "active" && state !== "revoked" && state !== "archived") reject("INVALID_BINDING");
	return {
		id: NativeTargetId(value.id),
		runGeneration: Number(value.runGeneration),
		botEpoch: Number(value.botEpoch),
		taskEpoch: Number(value.taskEpoch),
		taskRevision: Number(value.taskRevision),
		authorityEpoch: Number(value.authorityEpoch),
		membershipGeneration: Number(value.membershipGeneration),
		configVersion: Number(value.configVersion),
		scopeRef: "text-only",
		provider: "deepseek-official",
		model: value.model,
		maxTokens: value.maxTokens,
		reasoningEffort: "off",
		endpoint: value.endpoint,
		state,
		...value.sessionBinding === void 0 ? {} : { sessionBinding: sessionBinding(value.sessionBinding) }
	};
}
/** Validate one complete immutable queued input. */
function admission(value, maxSteps) {
	if (!record(value) || !id(value.id) || !id(value.targetId) || !["contact", "execution"].includes(String(value.kind)) || !Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > maxSteps || value.steps.some((step) => typeof step !== "string" || step.length < 1 || Buffer.byteLength(step) > 4096)) reject("INVALID_ADMISSION");
	const binding = target(value.binding);
	if (value.targetId !== binding.id || Object.keys(value).length !== 5) reject("INVALID_ADMISSION");
	const kind = value.kind;
	if (kind !== "contact" && kind !== "execution") reject("INVALID_ADMISSION");
	return {
		id: NativeOperationId(value.id),
		targetId: NativeTargetId(value.targetId),
		kind,
		binding,
		steps: value.steps.map((step) => typeof step === "string" ? step : reject("INVALID_ADMISSION"))
	};
}
/** Hash the admitted text and generation together. */
function admissionDigest(value) {
	return digest({
		id: value.id,
		targetId: value.targetId,
		kind: value.kind,
		binding: value.binding,
		steps: value.steps
	});
}
/** Accept usage only from an observed terminal response with exact counts. */
function usage(value) {
	if (!record(value) || !integer(value.inputTokens) || !integer(value.outputTokens)) return false;
	for (const key of [
		"totalTokens",
		"cacheReadTokens",
		"cacheWriteTokens",
		"reasoningTokens"
	]) if (value[key] !== void 0 && !integer(value[key])) return false;
	const total = Number(value.inputTokens) + Number(value.outputTokens) + Number(value.cacheReadTokens ?? 0) + Number(value.cacheWriteTokens ?? 0);
	return value.totalTokens === void 0 || value.totalTokens === total;
}
/** Sum independently observed step usage; unknown attempts are never counted as zero. */
function knownUsage(op) {
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let cacheWriteTokens = 0;
	for (const attempt of op.attempts) {
		if (attempt.usage === null) continue;
		inputTokens += attempt.usage.inputTokens;
		outputTokens += attempt.usage.outputTokens;
		cacheReadTokens += attempt.usage.cacheReadTokens ?? 0;
		cacheWriteTokens += attempt.usage.cacheWriteTokens ?? 0;
	}
	return {
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheWriteTokens,
		totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
	};
}
/** Validate complete durable operation rows before any driver or inspection reads them. */
function operation(value, maxSteps) {
	if (!record(value)) reject("JOURNAL_CORRUPT");
	let input;
	try {
		input = admission({
			id: value.id,
			targetId: value.targetId,
			kind: value.kind,
			binding: value.binding,
			steps: value.steps
		}, maxSteps);
	} catch (_invalidDurableAdmission) {
		reject("JOURNAL_CORRUPT");
	}
	if (![
		"admitted",
		"consumed",
		"settled",
		"fenced",
		"unknown"
	].includes(String(value.state)) || !integer(value.nextStep) || !Array.isArray(value.steps) || value.nextStep > value.steps.length || !Array.isArray(value.answers) || value.answers.length !== value.nextStep || value.answers.some((v) => typeof v !== "string") || !Array.isArray(value.attempts) || !integer(value.reservedTokens) || value.reservedTokens < 1 || value.reservedSlots !== 1 || typeof value.reservationHeld !== "boolean" || ![
		"not_started",
		"open",
		"closed",
		"unknown"
	].includes(String(value.localTransport)) || ![
		"not_started",
		"response_observed",
		"unknown"
	].includes(String(value.remoteExecution)) || !(value.usage === null || usage(value.usage)) || !(value.failureCode === null || typeof value.failureCode === "string")) reject("JOURNAL_CORRUPT");
	for (const attempt of value.attempts) {
		if (!record(attempt) || !integer(attempt.step) || attempt.step >= value.steps.length || typeof attempt.wireDigest !== "string" || !/^[a-f0-9]{64}$/.test(attempt.wireDigest) || ![
			"intent",
			"observed",
			"unknown"
		].includes(String(attempt.state)) || !(attempt.usage === null || usage(attempt.usage))) reject("JOURNAL_CORRUPT");
		if (attempt.sessionReceipt !== void 0) {
			const receipt = sessionReceipt(attempt.sessionReceipt);
			if (input.binding.sessionBinding === void 0 || receipt.sessionId !== input.binding.sessionBinding.sessionId || attempt.state !== "observed") reject("JOURNAL_CORRUPT");
		}
		if (input.binding.sessionBinding !== void 0 && attempt.state === "observed" && attempt.sessionReceipt === void 0) reject("JOURNAL_CORRUPT");
	}
	const op = {
		...input,
		inputDigest: typeof value.inputDigest === "string" ? value.inputDigest : reject("JOURNAL_CORRUPT"),
		state: value.state,
		nextStep: value.nextStep,
		answers: value.answers.map((answer) => typeof answer === "string" ? answer : reject("JOURNAL_CORRUPT")),
		attempts: value.attempts.map((attempt) => ({
			step: Number(attempt.step),
			wireDigest: String(attempt.wireDigest),
			state: attempt.state,
			usage: attempt.usage === null ? null : usage(attempt.usage) ? attempt.usage : reject("JOURNAL_CORRUPT"),
			...attempt.sessionReceipt === void 0 ? {} : { sessionReceipt: sessionReceipt(attempt.sessionReceipt) }
		})),
		reservedSlots: 1,
		reservedTokens: value.reservedTokens,
		reservationHeld: value.reservationHeld,
		localTransport: value.localTransport,
		remoteExecution: value.remoteExecution,
		usage: value.usage === null ? null : usage(value.usage) ? value.usage : reject("JOURNAL_CORRUPT"),
		failureCode: value.failureCode === null ? null : typeof value.failureCode === "string" ? value.failureCode : reject("JOURNAL_CORRUPT")
	};
	if (op.inputDigest !== admissionDigest(op) || op.state === "unknown" && (!op.reservationHeld || op.usage !== null) || op.state === "settled" && (op.reservationHeld || op.nextStep !== op.steps.length || op.usage === null)) reject("JOURNAL_CORRUPT");
	return op;
}
//#endregion
//#region lib/types/driver.js
/** Bounded text-only consumer: every input comes from the authoritative journal. */
/** Owns a controlled adapter instance; no foreign adapter, JSON actor or message queue can bypass it. */
var NativeRunDriver = class {
	host;
	#adapter;
	#bindings = /* @__PURE__ */ new WeakMap();
	#active = /* @__PURE__ */ new Map();
	#closed = false;
	constructor(host, dependencies) {
		this.host = host;
		this.#adapter = new DeepSeekAdapter({
			...dependencies,
			dispatchControl: {
				checkAdmission: (options) => {
					this.#bound(options);
				},
				checkDispatch: (options, input) => {
					this.#dispatch(options, input);
				}
			}
		});
		host.registerDriver(this);
	}
	/** Consume journaled pending steps; unknown outcomes never redispatch.
	* @param caller Actual calling scope checked by the test launcher policy.
	* @param operationId Admitted journal-local identity.
	* @returns The durable outcome after this local consumer returns.
	*/
	async drive(caller, operationId) {
		if (this.#closed) reject("NATIVE_DRIVER_CLOSED");
		const operation = this.host.inspect(caller, operationId);
		this.host.authorize(caller, "invoke", operation.targetId);
		const active = this.#active.get(operationId);
		if (active !== void 0) return active.done;
		if (operation.state !== "admitted") return operation;
		this.host.claimDriver(caller, operationId, this);
		const abort = new AbortController();
		const done = this.#consume(caller, operation, abort.signal);
		this.#active.set(operationId, {
			operation,
			abort,
			done
		});
		try {
			return await done;
		} finally {
			this.#active.delete(operationId);
			this.host.releaseDriver(operationId, this);
		}
	}
	/** Commit an exact-generation fence before aborting and draining all matching owners.
	* @param caller Actual calling scope with current control authority.
	* @param controlId Idempotent journal-local control receipt identity.
	* @param operationId Operation identifying the generation to stop.
	* @returns The durable outcome, retaining unknown remote effects.
	*/
	async stop(caller, controlId, operationId) {
		this.host.stop(caller, controlId, operationId);
		await this.host.drainStoppedGeneration(caller, operationId);
		return this.host.inspect(caller, operationId);
	}
	/** Drain only the exact generation after the host has committed its fence.
	* @param targetId Journal-local target identity.
	* @param generation Exact generation to abort.
	* @returns Whether every matching local lifecycle returned before the deadline.
	*/
	async drainGeneration(targetId, generation) {
		const owned = [...this.#active.values()].filter((run) => run.operation.targetId === targetId && run.operation.binding.runGeneration === generation);
		for (const run of owned) run.abort.abort(/* @__PURE__ */ new Error("GENERATION_STOPPED"));
		return this.#drain(owned);
	}
	/** Abort requests after the native writer commits an authority change.
	* @param targetId Target whose current authority was changed.
	*/
	abortTarget(targetId) {
		for (const run of this.#active.values()) if (run.operation.targetId === targetId) run.abort.abort(/* @__PURE__ */ new Error("AUTHORITY_REVOKED"));
	}
	/** Persist fences and drain owned local requests before disposal. */
	async close() {
		this.#closed = true;
		const owned = [...this.#active.values()];
		for (const run of owned) this.host.stopOwned(this, run.operation.id);
		for (const run of owned) run.abort.abort(/* @__PURE__ */ new Error("NATIVE_DRIVER_CLOSED"));
		if (!await this.#drain(owned)) {
			for (const run of owned) this.host.noteUnsettled(this, run.operation.id);
			reject("LOCAL_SETTLEMENT_UNKNOWN");
		}
	}
	async #consume(caller, initial, signal) {
		try {
			for (let step = initial.nextStep; step < initial.steps.length; step++) {
				signal.throwIfAborted();
				const op = this.host.checkRequest(caller, initial.id, step);
				const prepared = await this.#adapter.prepareCall(op.binding.provider, op.binding.model, signal);
				const current = this.host.checkRequest(caller, initial.id, step);
				const messages = [];
				for (let previous = 0; previous < step; previous++) {
					messages.push(createUserMessage({
						source: { kind: "user" },
						content: [{
							type: "text",
							text: current.steps[previous]
						}]
					}));
					messages.push(createAssistantMessage({
						source: {
							provider: op.binding.provider,
							model: op.binding.model
						},
						content: [{
							type: "text",
							text: current.answers[previous]
						}]
					}));
				}
				messages.push(createUserMessage({
					source: { kind: "user" },
					content: [{
						type: "text",
						text: current.steps[step]
					}]
				}));
				const frozen = deepFreeze({
					provider: current.binding.provider,
					model: current.binding.model,
					maxTokens: current.binding.maxTokens,
					reasoningEffort: ReasoningEffortId("off"),
					messages
				});
				const options = Object.freeze({
					...frozen,
					signal
				});
				this.#bindings.set(options, {
					caller,
					operationId: current.id,
					step,
					inputDigest: digest(frozen)
				});
				let observed;
				const assembler = new BlockAssembler();
				for await (const chunk of prepared.stream(options)) {
					assembler.push(chunk);
					if (chunk.type === "usage") observed = chunk.usage;
				}
				if (!["stop", "max-tokens"].includes(assembler.finish.kind)) {
					const finish = assembler.finish;
					if (finish.kind === "error" || finish.kind === "aborted") reject(finish.failure.status === 429 ? "RATE_LIMIT" : finish.failure.code);
					reject("UNSUPPORTED_RESPONSE");
				}
				const blocks = assembler.blocks();
				if (blocks.some((block) => block.type !== "text") || observed === void 0 || !usage(observed)) reject("SETTLEMENT_UNKNOWN");
				const answer = blocks.map((block) => block.type === "text" ? block.text : "").join("");
				this.host.completeStep(this, current.id, step, answer, observed);
			}
		} catch (error) {
			const code = error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : signal.aborted ? "ABORTED" : "TRANSPORT";
			this.host.failStep(this, initial.id, code);
		}
		return this.host.inspect(caller, initial.id);
	}
	#bound(options) {
		const bound = this.#bindings.get(options);
		if (bound === void 0) reject("CONTROLLED_PERMIT_REQUIRED");
		const { signal: _liveSignal, ...input } = options;
		if (!Object.isFrozen(options) || digest(input) !== bound.inputDigest || options.tools !== void 0 || options.messages.some((message) => message.content.some((block) => block.type !== "text"))) reject("FINAL_INPUT_CONFLICT");
		this.host.checkRequest(bound.caller, bound.operationId, bound.step);
		return bound;
	}
	#dispatch(options, wire) {
		const bound = this.#bound(options);
		this.host.beginAttempt(bound.caller, this, bound.operationId, bound.step, options, wire);
	}
	async #drain(owned) {
		if (owned.length === 0) return true;
		let timer;
		try {
			return await Promise.race([Promise.allSettled(owned.map((run) => run.done)).then(() => true), new Promise((resolve) => {
				timer = setTimeout(() => resolve(false), this.host.settlementDeadlineMs);
			})]);
		} finally {
			if (timer !== void 0) clearTimeout(timer);
		}
	}
};
//#endregion
//#region lib/types/session-driver.js
var __addDisposableResource = function(env, value, async) {
	if (value !== null && value !== void 0) {
		if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
		var dispose, inner;
		if (async) {
			if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
			dispose = value[Symbol.asyncDispose];
		}
		if (dispose === void 0) {
			if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
			dispose = value[Symbol.dispose];
			if (async) inner = dispose;
		}
		if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
		if (inner) dispose = function() {
			try {
				inner.call(this);
			} catch (e) {
				return Promise.reject(e);
			}
		};
		env.stack.push({
			value,
			dispose,
			async
		});
	} else if (async) env.stack.push({ async: true });
	return value;
};
var __disposeResources = (function(SuppressedError) {
	return function(env) {
		function fail(e) {
			env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
			env.hasError = true;
		}
		var r, s = 0;
		function next() {
			while (r = env.stack.pop()) try {
				if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
				if (r.dispose) {
					var result = r.dispose.call(r.value);
					if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) {
						fail(e);
						return next();
					});
				} else s |= 1;
			} catch (e) {
				fail(e);
			}
			if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
			if (env.hasError) throw env.error;
		}
		return next();
	};
})(typeof SuppressedError === "function" ? SuppressedError : function(error, suppressed, message) {
	var e = new Error(message);
	return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
const withoutEmptySystem = (messages) => messages.filter((message) => !(message.role === "system" && message.content.every((block) => block.type === "text" && block.text.length === 0)));
/** Private runtime-owner consumer; it does not establish public human authorization. */
var NativeSessionDriver = class NativeSessionDriver {
	ctx;
	host;
	binding;
	#handle;
	#active;
	#closed = false;
	#closing = false;
	#history = [];
	#historyDigest = "";
	#requests = /* @__PURE__ */ new WeakMap();
	#receipts = /* @__PURE__ */ new WeakMap();
	constructor(ctx, host, binding) {
		this.ctx = ctx;
		this.host = host;
		this.binding = binding;
	}
	/** Create a native owned Session with its exact preset and protection before publication.
	* @param ctx Actual trusted runtime owner context, not a JSON principal.
	* @param host Open exclusive native journal owner.
	* @param targetId Current Session-bound target.
	* @param provider Actual provider-owned opaque factory.
	* @returns Registered native consumer owning its lifecycle handle.
	*/
	static createOwned(ctx, host, targetId, provider) {
		return this.#openOwned(ctx, host, targetId, provider, false);
	}
	/** Resume with protection already attached before any reconstructed inbox wake.
	* Unknown journal work remains unexecutable; this method never drives it.
	* @param ctx Actual trusted runtime owner context.
	* @param host Already reopened authoritative journal; missing state cannot be synthesized.
	* @param targetId Exact current Session-bound target.
	* @param provider Actual provider-owned opaque factory.
	* @returns Registered consumer after native persistence reconstruction.
	*/
	static resumeOwned(ctx, host, targetId, provider) {
		return this.#openOwned(ctx, host, targetId, provider, true);
	}
	static async #openOwned(ctx, host, targetId, provider, resume) {
		if (!isDeepSeekProviderFactory(provider, ctx.get("llm"))) reject("NATIVE_PROVIDER_FACTORY_REQUIRED");
		const binding = host.target(ctx.fiber, targetId);
		const session = binding.sessionBinding ?? reject("SESSION_BINDING_REQUIRED");
		if (ctx.get("sessionPersistence") === void 0) reject("NATIVE_PERSISTENCE_REQUIRED");
		const driver = new NativeSessionDriver(ctx, host, binding);
		const calls = provider.protectSession(SessionId(session.sessionId), {
			checkAdmission: (options) => {
				driver.#bound(options);
			},
			checkDispatch: (options, wire) => {
				driver.#dispatch(options, wire);
			},
			beforeStream: async (options) => {
				driver.#validateRequest(options);
				if (!await ctx.sessions.flush(driver.#agent().session)) reject("NATIVE_PERSISTENCE_REQUIRED");
				driver.#validateRequest(options);
				const active = driver.#active ?? reject("CONTROLLED_PERMIT_REQUIRED");
				driver.#requests.set(options, {
					operationId: active.operation.id,
					step: active.step,
					inputDigest: driver.#inputDigest(options),
					prefixDigest: digest(driver.#agent().session.snapshotEvents())
				});
			}
		});
		const setup = async (agentCtx) => {
			await ctx.agentPresets.mount(agentCtx, session.agentPreset);
		};
		const options = {
			agentOptions: {
				provider: binding.provider,
				model: binding.model,
				maxTokens: binding.maxTokens,
				reasoningEffort: ReasoningEffortId("off")
			},
			protectedModelCalls: calls,
			setup
		};
		const handle = resume ? await ctx.agents.resume({
			...options,
			resumeSessionId: SessionId(session.sessionId)
		}) : await ctx.agents.create({
			...options,
			sessionId: SessionId(session.sessionId),
			meta: {
				cwd: session.cwd,
				agentPreset: session.agentPreset
			}
		});
		driver.#handle = handle;
		try {
			driver.validateSessionBinding(binding);
			driver.#history = withoutEmptySystem(handle.agent.session.deriveMessages());
			if (!resume && driver.#history.length !== 0) reject("NATIVE_HISTORY_CONFLICT");
			if (resume) await driver.#restoreHistory();
			driver.#historyDigest = digest(handle.agent.session.snapshotEvents());
			host.registerDriver(driver);
		} catch (error) {
			await handle.dispose();
			throw error;
		}
		return driver;
	}
	/** Prove concrete owned native handle provenance, never structural JSON.
	* @returns Whether the exact native factory-returned handle is retained.
	*/
	hasNativeOwner() {
		return this.#handle !== void 0 && isNativeAgentHandle(this.#handle);
	}
	/** Revalidate the actual Session/preset/tool relationship at each host-owned boundary.
	* @param current Complete operation binding, including native/control versions.
	*/
	validateSessionBinding(current) {
		const session = current.sessionBinding ?? reject("SESSION_BINDING_REQUIRED");
		const agent = this.#agent();
		if (canonical(session) !== canonical(this.binding.sessionBinding) || current.id !== this.binding.id || agent.id !== session.sessionId || agent.session.id !== session.sessionId || agent.session.header.cwd !== session.cwd || agent.session.header.agentPreset !== session.agentPreset || this.ctx.agents.get(agent.id) !== agent || this.ctx.sessions.get(agent.id) !== agent.session || this.ctx.sessionProjections.stateOf(agent.session, "agentPreset") !== session.agentPreset) reject("NATIVE_SESSION_BINDING_CONFLICT");
		const scope = scopeOf(agent.ctx) ?? reject("NATIVE_SCOPE_REQUIRED");
		if (this.ctx.tools.schemas().length !== 0 || this.ctx.tools.schemas(scope).length !== 0) reject("NATIVE_MODEL_TOOLS_PRESENT");
	}
	/** Claim journal input, then drive actual native turns; unknown state never wakes the Agent.
	* @param caller Exact trusted owner fiber capability accepted by the journal policy.
	* @param operationId Admitted journal-local identity.
	* @returns Durable native journal outcome after owned local activity returns.
	*/
	async drive(caller, operationId) {
		this.host.authorize(caller, "invoke");
		if (caller !== this.ctx.fiber) reject("CALLER_UNAUTHORIZED");
		if (this.#closed || this.#closing) reject("NATIVE_DRIVER_CLOSED");
		const op = this.host.inspect(caller, operationId);
		if (this.#active?.operation.id === operationId) return this.#active.done;
		if (op.state !== "admitted") return op;
		this.#assertKnownSession();
		if (this.#active !== void 0 || this.#agent().status !== "idle") reject("NATIVE_SESSION_BUSY");
		this.#assertEmptyInbox();
		if (digest(this.#agent().session.snapshotEvents()) !== this.#historyDigest) reject("NATIVE_HISTORY_CONFLICT");
		this.validateSessionBinding(op.binding);
		this.host.claimDriver(caller, operationId, this);
		const done = Promise.withResolvers();
		const active = {
			operation: op,
			step: op.nextStep,
			startSeq: 0,
			inputId: "",
			done: done.promise
		};
		this.#active = active;
		this.#consume(caller, active).then(done.resolve, done.reject);
		try {
			return await done.promise;
		} finally {
			if (this.#active === active) this.#active = void 0;
			this.host.releaseDriver(operationId, this);
		}
	}
	async #consume(caller, active) {
		try {
			for (; active.step < active.operation.steps.length; active.step++) {
				const env_1 = {
					stack: [],
					error: void 0,
					hasError: false
				};
				try {
					const current = this.host.checkRequest(caller, active.operation.id, active.step);
					this.validateSessionBinding(current.binding);
					this.#assertEmptyInbox();
					const agent = this.#agent();
					const input = createUserMessage({
						source: { kind: "user" },
						content: [{
							type: "text",
							text: current.steps[active.step] ?? reject("NATIVE_HISTORY_CONFLICT")
						}]
					});
					active.inputId = input.id;
					active.startSeq = agent.session.snapshotEvents().length;
					agent.followup(input);
					await agent.whenIdle();
					if (!await this.ctx.sessions.flush(agent.session)) reject("NATIVE_PERSISTENCE_REQUIRED");
					const read = await __addDisposableResource(env_1, await (this.ctx.get("sessionPersistence") ?? reject("NATIVE_PERSISTENCE_REQUIRED")).open(agent.id, "read"), true).read();
					const live = agent.session.snapshotEvents();
					if (canonical(read.events) !== canonical(live)) reject("NATIVE_RECEIPT_NOT_DURABLE");
					const interval = read.events.slice(active.startSeq);
					const starts = interval.filter((event) => event.type === "turn/start");
					const ends = interval.filter((event) => event.type === "turn/end");
					const messages = interval.filter((event) => event.type === "assistant/message");
					const users = interval.filter((event) => event.type === "user/message");
					const message = messages[0], end = ends[0];
					if (starts.length !== 1 || ends.length !== 1 || messages.length !== 1 || users.length !== 1 || interval.some((event) => event.type === "assistant/attempt") || users[0]?.data.id !== active.inputId || message === void 0 || end === void 0 || message.data.interrupted === true || !["completed", "max-tokens"].includes(end.data.reason.kind) || end.data.turn !== message.data.turn || starts[0]?.data.turn !== end.data.turn || message.data.step !== 1 || message.data.usage === void 0 || !usage(message.data.usage) || message.data.message.content.some((block) => block.type !== "text")) reject("NATIVE_SETTLEMENT_UNKNOWN");
					const assembled = assembleAssistantStream(message.data.stream);
					if (!["stop", "max-tokens"].includes(assembled.finish.kind)) reject("NATIVE_SETTLEMENT_UNKNOWN");
					const answer = message.data.message.content.map((block) => block.type === "text" ? block.text : "").join("");
					const receipt = Object.freeze({
						sessionId: agent.id,
						turn: message.data.turn,
						step: message.data.step,
						startSeq: active.startSeq,
						assistantSeq: message.seq,
						endSeq: end.seq,
						assistantDigest: digest(message),
						endDigest: digest(end)
					});
					this.#receipts.set(receipt, {
						operationId: current.id,
						step: active.step,
						answer,
						usageDigest: digest(message.data.usage)
					});
					this.host.completeStep(this, current.id, active.step, answer, message.data.usage, receipt);
					this.#history = withoutEmptySystem(agent.session.deriveMessages());
					this.#historyDigest = digest(agent.session.snapshotEvents());
				} catch (e_1) {
					env_1.error = e_1;
					env_1.hasError = true;
				} finally {
					const result_1 = __disposeResources(env_1);
					if (result_1) await result_1;
				}
			}
		} catch (error) {
			const code = error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "NATIVE_CONSUMER_FAILURE";
			this.host.failStep(this, active.operation.id, code);
		}
		return this.host.inspect(caller, active.operation.id);
	}
	#assertKnownSession() {
		if (this.host.sessionOperations(this.ctx.fiber, this.#agent().id).some((op) => op.state === "unknown" || op.attempts.some((attempt) => attempt.state === "intent" || attempt.state === "unknown"))) reject("SESSION_OUTCOME_UNKNOWN");
	}
	async #restoreHistory() {
		const env_2 = {
			stack: [],
			error: void 0,
			hasError: false
		};
		try {
			const agent = this.#agent();
			const operations = this.host.sessionOperations(this.ctx.fiber, agent.id);
			if (operations.some((op) => op.state === "unknown" || op.attempts.some((attempt) => attempt.state !== "observed"))) return;
			this.#assertEmptyInbox();
			if (!await this.ctx.sessions.flush(agent.session)) reject("NATIVE_PERSISTENCE_REQUIRED");
			const events = (await __addDisposableResource(env_2, await (this.ctx.get("sessionPersistence") ?? reject("NATIVE_PERSISTENCE_REQUIRED")).open(agent.id, "read"), true).read()).events;
			if (canonical(events) !== canonical(agent.session.snapshotEvents())) reject("NATIVE_RECEIPT_NOT_DURABLE");
			const receipts = operations.flatMap((op) => op.attempts.map((attempt) => ({
				op,
				attempt,
				receipt: attempt.sessionReceipt ?? reject("NATIVE_RECEIPT_REQUIRED")
			}))).sort((a, b) => a.receipt.startSeq - b.receipt.startSeq);
			const expected = [];
			let previousEnd = -1;
			for (const { op, attempt, receipt } of receipts) {
				if (canonical(op.binding.sessionBinding) !== canonical(this.binding.sessionBinding) || receipt.startSeq <= previousEnd) reject("NATIVE_HISTORY_CONFLICT");
				const interval = events.slice(receipt.startSeq, receipt.endSeq + 1);
				const users = interval.filter((event) => event.type === "user/message");
				const user = users[0];
				const assistants = interval.filter((event) => event.type === "assistant/message");
				const message = events[receipt.assistantSeq], end = events[receipt.endSeq];
				if (user === void 0 || users.length !== 1 || assistants.length !== 1 || message?.type !== "assistant/message" || end?.type !== "turn/end" || digest(message) !== receipt.assistantDigest || digest(end) !== receipt.endDigest || message.data.turn !== receipt.turn || message.data.step !== receipt.step || end.data.turn !== receipt.turn || canonical(user.data.content) !== canonical([{
					type: "text",
					text: op.steps[attempt.step] ?? reject("NATIVE_HISTORY_CONFLICT")
				}]) || canonical(message.data.usage) !== canonical(attempt.usage) || message.data.message.content.map((block) => block.type === "text" ? block.text : "").join("") !== op.answers[attempt.step]) reject("NATIVE_HISTORY_CONFLICT");
				expected.push(user.data);
				const projected = deriveEventMessage(message);
				if (projected !== null) expected.push(projected);
				previousEnd = receipt.endSeq;
			}
			textWire(this.#history);
			if (canonical(this.#history) !== canonical(expected)) reject("NATIVE_HISTORY_CONFLICT");
		} catch (e_2) {
			env_2.error = e_2;
			env_2.hasError = true;
		} finally {
			const result_2 = __disposeResources(env_2);
			if (result_2) await result_2;
		}
	}
	#inputDigest(options) {
		const { signal: _signal, ...input } = options;
		return digest(input);
	}
	#validateRequest(options) {
		const active = this.#active ?? reject("CONTROLLED_PERMIT_REQUIRED");
		const current = this.host.checkRequest(this.ctx.fiber, active.operation.id, active.step);
		this.validateSessionBinding(current.binding);
		const agent = this.#agent();
		if (!isProtectedNativeRequest(options, agent)) reject("NATIVE_REQUEST_PROVENANCE_REQUIRED");
		if (!Object.isFrozen(options) || options.sessionId !== agent.id || options.provider !== current.binding.provider || options.model !== current.binding.model || options.maxTokens !== current.binding.maxTokens || options.reasoningEffort !== "off" || options.tools !== void 0 || (options.toolHistory?.tools.length ?? 0) !== 0 || (options.toolHistory?.updates.length ?? 0) !== 0) reject("FINAL_INPUT_CONFLICT");
		textWire(options.messages);
		if (canonical(options.messages) !== canonical(agent.session.deriveMessages())) reject("NATIVE_REQUEST_LOG_CONFLICT");
		const conversation = withoutEmptySystem(options.messages);
		const last = conversation.at(-1);
		if (conversation.length !== this.#history.length + 1 || canonical(conversation.slice(0, -1)) !== canonical(this.#history) || last?.role !== "user" || last.id !== active.inputId || canonical(last.content) !== canonical([{
			type: "text",
			text: current.steps[active.step] ?? reject("NATIVE_HISTORY_CONFLICT")
		}])) reject("NATIVE_HISTORY_CONFLICT");
		this.#assertEmptyInbox();
	}
	#bound(options) {
		this.#validateRequest(options);
		const bound = this.#requests.get(options) ?? reject("CONTROLLED_PERMIT_REQUIRED");
		const active = this.#active ?? reject("CONTROLLED_PERMIT_REQUIRED");
		if (bound.operationId !== active.operation.id || bound.step !== active.step || bound.inputDigest !== this.#inputDigest(options) || bound.prefixDigest !== digest(this.#agent().session.snapshotEvents())) reject("FINAL_INPUT_CONFLICT");
		return bound;
	}
	#dispatch(options, wire) {
		const bound = this.#bound(options);
		this.host.beginAttempt(this.ctx.fiber, this, bound.operationId, bound.step, options, wire);
	}
	/** Host-only final native provenance check; no caller-supplied authorization callback.
	* @param options Actual request instance.
	* @param op Exact journal operation.
	* @param step Pending journal step.
	*/
	validateIntent(options, op, step) {
		const bound = this.#bound(options);
		if (bound.operationId !== op.id || bound.step !== step) reject("CONTROLLED_PERMIT_REQUIRED");
	}
	/** Host verifies an exact private attestation created only after native durable readback.
	* @param receipt Candidate Session receipt identity.
	* @param op Exact journal operation.
	* @param step Consumed journal step.
	* @param answer Actual native terminal text.
	* @param observed Actual native terminal usage.
	*/
	validateReceipt(receipt, op, step, answer, observed) {
		const proof = receipt === void 0 ? void 0 : this.#receipts.get(receipt);
		if (proof === void 0 || proof.operationId !== op.id || proof.step !== step || proof.answer !== answer || proof.usageDigest !== digest(observed)) reject("NATIVE_RECEIPT_REQUIRED");
	}
	#agent() {
		if (this.#handle === void 0 || !isNativeAgentHandle(this.#handle)) reject("NATIVE_OWNED_HANDLE_REQUIRED");
		return this.#handle.agent;
	}
	#assertEmptyInbox() {
		const inbox = this.#agent().inbox;
		if (inbox.nextTurn.length !== 0 || inbox.nextStep.length !== 0) reject("NATIVE_INBOX_CONFLICT");
	}
	/** Fence the exact generation before native cancellation and bounded local drain.
	* @param caller Exact owner fiber capability.
	* @param controlId Idempotent stop receipt.
	* @param operationId Operation specifying the generation.
	* @returns Durable outcome retaining remote uncertainty.
	*/
	async stop(caller, controlId, operationId) {
		this.host.stop(caller, controlId, operationId);
		await this.host.drainStoppedGeneration(caller, operationId);
		return this.host.inspect(caller, operationId);
	}
	/** Abort/drain only locally active work with the exact fenced generation.
	* @param targetId Target to stop.
	* @param generation Exact generation, excluding restarted work.
	* @returns Whether owned activity returned within the settlement bound.
	*/
	async drainGeneration(targetId, generation) {
		const active = this.#active;
		if (active === void 0 || active.operation.targetId !== targetId || active.operation.binding.runGeneration !== generation) return true;
		this.#agent().cancel({
			kind: "hook",
			reason: "GENERATION_STOPPED"
		});
		return this.#drain(active);
	}
	/** Cancel active work only after its target mutation has committed.
	* @param targetId Revoked/changed target.
	*/
	abortTarget(targetId) {
		if (this.#active?.operation.targetId === targetId) this.#agent().cancel({
			kind: "hook",
			reason: "AUTHORITY_REVOKED"
		});
	}
	/** Fence owned work and release the actual native handle only after bounded quiescence. */
	async close() {
		if (this.#closed) return;
		this.#closing = true;
		const active = this.#active;
		if (active !== void 0) {
			this.host.stopOwned(this, active.operation.id);
			this.#agent().cancel({ kind: "disposed" });
			if (!await this.#drain(active)) {
				this.host.noteUnsettled(this, active.operation.id);
				reject("LOCAL_SETTLEMENT_UNKNOWN");
			}
		}
		await this.#handle?.dispose();
		this.#closed = true;
	}
	async #drain(active) {
		let timer;
		try {
			return await Promise.race([active.done.then(() => true, () => true), new Promise((resolve) => {
				timer = setTimeout(() => resolve(false), this.host.settlementDeadlineMs);
			})]);
		} finally {
			if (timer !== void 0) clearTimeout(timer);
		}
	}
};
//#endregion
//#region lib/types/journal.js
/** Exclusive native writer: authority, queued inputs, reservations and provider intents share one SQLite journal. */
const SCHEMA_VERSION = 3;
/** Native journal owner for one host; its launcher caller policy is process-local and test-only. */
var NativeRunHost = class NativeRunHost {
	#db;
	#lock;
	#path;
	#lockPath;
	#identity;
	#config;
	#drivers = /* @__PURE__ */ new Set();
	#operationOwners = /* @__PURE__ */ new Map();
	#closed = false;
	#closing = false;
	#closePromise;
	constructor(config, db, lock, identity) {
		this.#config = {
			...config,
			capacity: deepFreeze(structuredClone(config.capacity))
		};
		this.#db = db;
		this.#lock = lock;
		this.#path = join(config.directory, "journal.sqlite");
		this.#lockPath = join(config.directory, "writer.lock");
		this.#identity = identity;
	}
	/** Acquire the native lock and open a fresh or strictly validated existing journal.
	* @param config Explicit test launcher, target and capacity configuration.
	* @returns The exclusive native journal owner.
	*/
	static async open(config) {
		if (typeof config.authorize !== "function" || !config.hostId || !config.directory) reject("INVALID_HOST_CONFIG");
		for (const value of Object.values(config.capacity)) if (!integer(value) || value < 1) reject("INVALID_HOST_CONFIG");
		for (const spec of config.targets) target(spec);
		await mkdir(config.directory, {
			recursive: true,
			mode: 448
		});
		const lockPath = join(config.directory, "writer.lock");
		const lock = await open(lockPath, "a+", 384);
		let db;
		try {
			try {
				await tryLockExclusive(lock.fd);
			} catch (error) {
				if (["EAGAIN", "EWOULDBLOCK"].includes(String(error.code))) reject("NATIVE_WRITER_CONFLICT");
				throw error;
			}
			const held = await lock.stat();
			const current = await stat(lockPath);
			if (held.dev !== current.dev || held.ino !== current.ino) reject("NATIVE_WRITER_CONFLICT");
			const path = join(config.directory, "journal.sqlite");
			if (config.create && existsSync(path)) reject("JOURNAL_ALREADY_EXISTS");
			if (!config.create && (!existsSync(path) || statSync(path).size === 0)) reject("JOURNAL_MISSING");
			if (config.create) await (await open(path, "wx", 384)).close();
			db = new DatabaseSync(path);
			try {
				db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
				if (config.create) {
					db.exec("BEGIN IMMEDIATE; CREATE TABLE meta(id INTEGER PRIMARY KEY CHECK(id=1), format INTEGER NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL, stateDigest TEXT NOT NULL) STRICT; CREATE TABLE targets(id TEXT PRIMARY KEY, data TEXT NOT NULL) STRICT; CREATE TABLE operations(id TEXT PRIMARY KEY, data TEXT NOT NULL) STRICT; CREATE TABLE stops(id TEXT PRIMARY KEY, target TEXT NOT NULL, generation INTEGER NOT NULL, operation TEXT NOT NULL) STRICT;");
					db.prepare("INSERT INTO meta VALUES(1,?,?,0,?)").run(SCHEMA_VERSION, canonical({
						hostId: config.hostId,
						capacity: config.capacity
					}), "");
					for (const spec of config.targets) db.prepare("INSERT INTO targets VALUES(?,?)").run(spec.id, canonical(spec));
					db.prepare("UPDATE meta SET stateDigest=? WHERE id=1").run(digest({
						targets: db.prepare("SELECT id,data FROM targets ORDER BY id").all(),
						operations: [],
						stops: []
					}));
					db.exec("COMMIT");
				}
				const meta = db.prepare("SELECT format,data FROM meta WHERE id=1").get();
				if (meta?.format !== SCHEMA_VERSION || meta.data !== canonical({
					hostId: config.hostId,
					capacity: config.capacity
				})) reject("JOURNAL_CORRUPT");
			} catch (_invalidJournal) {
				reject("JOURNAL_CORRUPT");
			}
			const journalStat = statSync(path);
			const host = new NativeRunHost(config, db, lock, {
				dev: journalStat.dev,
				ino: journalStat.ino,
				lockDev: held.dev,
				lockIno: held.ino
			});
			host.#validate();
			host.#transaction(() => {
				for (const op of host.#all()) {
					if (!op.attempts.some((a) => a.state === "intent")) continue;
					host.#write({
						...op,
						state: "unknown",
						remoteExecution: "unknown",
						usage: null,
						reservationHeld: true,
						localTransport: "unknown",
						failureCode: "INTENT_OUTCOME_UNKNOWN",
						attempts: op.attempts.map((a) => a.state === "intent" ? {
							...a,
							state: "unknown"
						} : a)
					});
				}
			});
			return host;
		} catch (error) {
			db?.close();
			await lock.close();
			throw error;
		}
	}
	/** Check current calling scope, including same-ID inspection.
	* @param caller Actual calling scope object.
	* @param action Requested invocation, inspection or control.
	* @param targetId Target-specific scope when the operation identifies a target.
	*/
	authorize(caller, action, targetId) {
		if (this.#closed) reject("NATIVE_HOST_CLOSED");
		if (action === "invoke" && this.#closing) reject("NATIVE_HOST_CLOSING");
		if (this.#config.authorize(caller, action, targetId) !== true) reject("CALLER_UNAUTHORIZED");
	}
	/** Read a detached current target without waking a driver.
	* @param caller Actual calling scope with inspection authority.
	* @param targetId Journal-local target identity.
	* @returns The frozen current target binding.
	*/
	target(caller, targetId) {
		this.authorize(caller, "inspect", targetId);
		this.#validate();
		return deepFreeze(structuredClone(this.#target(targetId)));
	}
	/** Read a detached durable operation without a model request.
	* @param caller Actual calling scope with current inspection authority.
	* @param operationId Journal-local operation identity.
	* @returns The frozen durable operation.
	*/
	inspect(caller, operationId) {
		this.authorize(caller, "inspect");
		this.#validate();
		const op = this.#read(operationId);
		this.authorize(caller, "inspect", op.targetId);
		return deepFreeze(structuredClone(op));
	}
	/** Read journal authority for one Session without deriving operations from JSONL.
	* @param caller Actual owner with inspection authority for every matching target.
	* @param sessionId Exact persisted Session identity.
	* @returns Detached operations belonging to that Session across generations.
	*/
	sessionOperations(caller, sessionId) {
		this.authorize(caller, "inspect");
		this.#validate();
		const operations = this.#all().filter((op) => op.binding.sessionBinding?.sessionId === sessionId);
		for (const op of operations) this.authorize(caller, "inspect", op.targetId);
		return deepFreeze(structuredClone(operations));
	}
	/** Commit input, complete binding, deduplication receipt and reservation atomically.
	* @param caller Actual calling scope with invocation authority.
	* @param requested Complete target binding and bounded pending text steps.
	* @returns The committed operation or identical existing receipt.
	*/
	async admit(caller, requested) {
		this.authorize(caller, "invoke", requested.targetId);
		const input = deepFreeze(structuredClone(admission(requested, this.#config.capacity.maxSteps)));
		this.#validate();
		const existing = this.#maybe(input.id);
		if (existing !== void 0) {
			if (existing.inputDigest !== admissionDigest(input)) reject("OPERATION_CONFLICT");
			return this.inspect(caller, input.id);
		}
		if (this.#config.capacityReady !== void 0) {
			const signal = AbortSignal.timeout(this.#config.capacity.admissionDeadlineMs);
			await Promise.race([this.#config.capacityReady(signal), new Promise((_resolve, fail) => signal.addEventListener("abort", () => fail(signal.reason), { once: true }))]);
		}
		this.authorize(caller, "invoke", input.targetId);
		this.#transaction(() => {
			const duplicate = this.#maybe(input.id);
			if (duplicate !== void 0) {
				if (duplicate.inputDigest !== admissionDigest(input)) reject("OPERATION_CONFLICT");
				return;
			}
			this.#binding(input.binding);
			const available = this.#capacity();
			const slots = input.kind === "contact" ? available.contactSlotsAvailable : available.executionSlotsAvailable;
			const tokens = input.kind === "contact" ? available.contactTokensAvailable : available.executionTokensAvailable;
			const reservedTokens = input.steps.length * this.#config.capacity.tokenReservationPerStep;
			if (slots < 1 || tokens < reservedTokens || input.binding.maxTokens > this.#config.capacity.tokenReservationPerStep) reject("HOST_CAPACITY_BLOCKED");
			const op = {
				...input,
				inputDigest: admissionDigest(input),
				state: "admitted",
				nextStep: 0,
				answers: [],
				attempts: [],
				reservedSlots: 1,
				reservedTokens,
				reservationHeld: true,
				localTransport: "not_started",
				remoteExecution: "not_started",
				usage: null,
				failureCode: null
			};
			this.#db.prepare("INSERT INTO operations VALUES(?,?)").run(op.id, canonical(op));
		});
		return this.inspect(caller, input.id);
	}
	/** Commit an authority change before cancellation or success receipt.
	* @param caller Actual calling scope with current control authority.
	* @param targetId Target whose authority changes.
	* @param change Explicit revoke, archive, restart or model mutation.
	* @returns The committed current target binding.
	*/
	changeTarget(caller, targetId, change) {
		this.authorize(caller, "control", targetId);
		this.#transaction(() => {
			const previous = this.#target(targetId);
			const next = {
				...previous,
				authorityEpoch: previous.authorityEpoch + 1,
				...change.kind === "revoke" ? { state: "revoked" } : {},
				...change.kind === "archive" ? {
					state: "archived",
					botEpoch: previous.botEpoch + 1
				} : {},
				...change.kind === "restart" ? {
					state: "active",
					runGeneration: previous.runGeneration + 1,
					...change.sessionBinding === void 0 ? {} : { sessionBinding: change.sessionBinding }
				} : {},
				...change.kind === "model" ? {
					model: change.model,
					configVersion: previous.configVersion + 1
				} : {}
			};
			target(next);
			this.#db.prepare("UPDATE targets SET data=? WHERE id=?").run(canonical(next), targetId);
			for (const op of this.#all()) if (op.targetId === targetId && ![
				"settled",
				"fenced",
				"unknown"
			].includes(op.state)) this.#fence(op, "AUTHORITY_REVOKED");
		});
		for (const driver of this.#drivers) driver.abortTarget(targetId);
		return this.target(caller, targetId);
	}
	/** Construct a controlled consumer; arbitrary adapters cannot be substituted.
	* @param dependencies Existing provider dependencies without a dispatch guard override.
	* @returns A consumer registered with this native owner.
	*/
	driver(dependencies) {
		if (this.#closed || this.#closing) reject("NATIVE_HOST_CLOSING");
		return new NativeRunDriver(this, dependencies);
	}
	/** Track consumers so direct construction cannot evade host disposal.
	* @param driver Concrete consumer registered by its constructor.
	*/
	registerDriver(driver) {
		if (this.#closed || this.#closing) reject("NATIVE_HOST_CLOSING");
		if (!(driver instanceof NativeRunDriver) && !(driver instanceof NativeSessionDriver && driver.hasNativeOwner())) reject("CONTROLLED_PERMIT_REQUIRED");
		this.#drivers.add(driver);
	}
	/** Claim one consumer before asynchronous preparation begins.
	* @param caller Actual calling scope with invocation authority.
	* @param operationId Admitted operation to consume.
	* @param driver Registered concrete consumer claiming local ownership.
	*/
	claimDriver(caller, operationId, driver) {
		this.authorize(caller, "invoke");
		this.#validate();
		const op = this.#read(operationId);
		this.authorize(caller, "invoke", op.targetId);
		if (!this.#drivers.has(driver)) reject("CONTROLLED_PERMIT_REQUIRED");
		this.#consumerBinding(driver, op);
		if (this.#operationOwners.has(operationId)) reject("OPERATION_DRIVER_CONFLICT");
		this.#operationOwners.set(operationId, driver);
	}
	/** Release only the consumer whose complete local lifecycle returned.
	* @param operationId Operation whose local lifecycle returned.
	* @param driver Exact current consumer owner.
	*/
	releaseDriver(operationId, driver) {
		this.#owner(operationId, driver);
		this.#operationOwners.delete(operationId);
	}
	/** Abort and drain every consumer after the generation fence is durable.
	* @param caller Actual calling scope with current control authority.
	* @param operationId Operation identifying the already-fenced generation.
	*/
	async drainStoppedGeneration(caller, operationId) {
		const op = this.inspect(caller, operationId);
		this.authorize(caller, "control", op.targetId);
		if (this.#db.prepare("SELECT id FROM stops WHERE target=? AND generation=? LIMIT 1").get(op.targetId, op.binding.runGeneration) === void 0) reject("STOP_FENCE_REQUIRED");
		if ((await Promise.all([...this.#drivers].map((driver) => driver.drainGeneration(op.targetId, op.binding.runGeneration)))).every(Boolean)) return;
		this.#transaction(() => {
			for (const owned of this.#all()) if (owned.targetId === op.targetId && owned.binding.runGeneration === op.binding.runGeneration && owned.localTransport === "open") this.#write({
				...owned,
				localTransport: "unknown"
			});
		});
	}
	/** Deployment bound for local drain; expiry never claims remote settlement. */
	get settlementDeadlineMs() {
		return this.#config.capacity.settlementDeadlineMs;
	}
	/** Read remaining local allocations while unknown work retains its reserves.
	* @param caller Actual calling scope with inspection authority.
	* @returns Remaining host-local slots and token allocations.
	*/
	capacity(caller) {
		this.authorize(caller, "inspect");
		this.#validate();
		return this.#capacity();
	}
	/** Verify a bound request against the authoritative pending step.
	* @param caller Actual calling scope with current invocation authority.
	* @param operationId Admitted operation identity.
	* @param step Exact pending step index.
	* @returns The frozen journaled operation for this step.
	*/
	checkRequest(caller, operationId, step) {
		this.authorize(caller, "invoke");
		this.#validate();
		const op = this.#read(operationId);
		this.authorize(caller, "invoke", op.targetId);
		this.#binding(op.binding);
		if (op.state !== "admitted" || op.nextStep !== step) reject(op.state === "unknown" ? "OUTCOME_UNKNOWN_BLOCKED" : "OPERATION_FENCED");
		return op;
	}
	/** Persist an attempt after final synchronous validation; no await is allowed here.
	* @param caller Actual calling scope checked at final dispatch.
	* @param driver Exact consumer owning the operation.
	* @param operationId Journal-local operation identity.
	* @param step Exact pending step index.
	* @param options Frozen request input bound by the controlled consumer.
	* @param wire Frozen endpoint and serialized payload immediately preceding fetch.
	*/
	beginAttempt(caller, driver, operationId, step, options, wire) {
		this.#transaction(() => {
			this.#owner(operationId, driver);
			const op = this.checkRequest(caller, operationId, step);
			this.#consumerBinding(driver, op);
			if (driver instanceof NativeSessionDriver) driver.validateIntent(options, op, step);
			const body = JSON.parse(wire.payload);
			if (!record(body) || wire.endpoint !== op.binding.endpoint || body.model !== op.binding.model || body.max_tokens !== op.binding.maxTokens || body.stream !== true || Object.keys(body).some((k) => ![
				"model",
				"max_tokens",
				"stream",
				"messages",
				"thinking"
			].includes(k)) || canonical(body.thinking) !== canonical({ type: "disabled" }) || canonical(body.messages) !== canonical(textWire(options.messages))) reject("FINAL_INPUT_CONFLICT");
			this.#write({
				...op,
				state: "consumed",
				localTransport: "open",
				remoteExecution: "unknown",
				usage: null,
				attempts: [...op.attempts, {
					step,
					wireDigest: digest(wire),
					state: "intent",
					usage: null
				}]
			});
		});
	}
	/** Record a terminal response; release complete-operation capacity only with known usage.
	* @param driver Exact consumer owning the operation.
	* @param operationId Journal-local operation identity.
	* @param step Exact consumed step index.
	* @param answer Observed terminal text answer.
	* @param observed Independently observed provider token counts.
	* @param receipt Required private native persistence attestation for Session consumers.
	*/
	completeStep(driver, operationId, step, answer, observed, receipt) {
		this.#transaction(() => {
			this.#owner(operationId, driver);
			const op = this.#read(operationId);
			this.#consumerBinding(driver, op);
			if (driver instanceof NativeSessionDriver) driver.validateReceipt(receipt, op, step, answer, observed);
			else if (receipt !== void 0) reject("UNEXPECTED_SESSION_RECEIPT");
			if (op.state !== "consumed" || op.nextStep !== step || !usage(observed)) reject("SETTLEMENT_CONFLICT");
			this.#binding(op.binding);
			const attempts = op.attempts.map((a, i) => i === op.attempts.length - 1 ? {
				...a,
				state: "observed",
				usage: observed,
				...receipt === void 0 ? {} : { sessionReceipt: receipt }
			} : a);
			const nextStep = step + 1;
			const next = {
				...op,
				attempts,
				nextStep,
				answers: [...op.answers, answer],
				localTransport: "closed",
				remoteExecution: "response_observed",
				state: nextStep === op.steps.length ? "settled" : "admitted",
				reservationHeld: nextStep !== op.steps.length,
				failureCode: null,
				usage: null
			};
			this.#write({
				...next,
				usage: knownUsage(next)
			});
		});
	}
	/** Preserve unknown effects and allocations after failure or cancellation.
	* @param driver Exact consumer whose local lifecycle returned.
	* @param operationId Journal-local operation identity.
	* @param failureCode Non-secret machine-readable failure category.
	*/
	failStep(driver, operationId, failureCode) {
		this.#transaction(() => {
			this.#owner(operationId, driver);
			const op = this.#read(operationId);
			if (op.state === "settled" || op.state === "fenced") return;
			if (op.attempts.some((a) => a.state === "intent" || a.state === "unknown")) this.#write({
				...op,
				state: "unknown",
				usage: null,
				reservationHeld: true,
				remoteExecution: "unknown",
				localTransport: "closed",
				failureCode,
				attempts: op.attempts.map((a) => a.state === "intent" ? {
					...a,
					state: "unknown"
				} : a)
			});
			else this.#write({
				...op,
				failureCode
			});
		});
	}
	/** Persist an exact-generation no-dispatch fence before local abort.
	* @param caller Actual calling scope with current control authority.
	* @param controlId Idempotent journal-local control receipt identity.
	* @param operationId Operation identifying the generation to stop.
	* @returns The durable operation after the stop fence commits.
	*/
	stop(caller, controlId, operationId) {
		this.authorize(caller, "control");
		if (!id(controlId)) reject("INVALID_CONTROL");
		this.#transaction(() => {
			const op = this.#read(operationId);
			this.authorize(caller, "control", op.targetId);
			this.#stop(controlId, op);
		});
		return this.inspect(caller, operationId);
	}
	/** Fence only an exact native-owned operation, independently of caller revocation.
	* @param driver Exact consumer owning this operation.
	* @param operationId Owned operation to fence before disposal abort.
	*/
	stopOwned(driver, operationId) {
		this.#transaction(() => {
			this.#owner(operationId, driver);
			const op = this.#read(operationId);
			if (![
				"settled",
				"fenced",
				"unknown"
			].includes(op.state)) this.#fence(op, "OWNER_DISPOSED");
		});
	}
	/** Retain uncertainty when local transport misses its drain deadline.
	* @param driver Exact consumer still owning the operation.
	* @param operationId Owned operation whose closure is unproven.
	*/
	noteUnsettled(driver, operationId) {
		this.#transaction(() => {
			this.#owner(operationId, driver);
			const op = this.#read(operationId);
			if (op.localTransport === "open") this.#write({
				...op,
				localTransport: "unknown"
			});
		});
	}
	/** Drain local consumers before releasing the kernel-owned writer descriptor. */
	close() {
		if (this.#closed) return Promise.resolve();
		if (this.#closePromise !== void 0) return this.#closePromise;
		this.#closing = true;
		const pending = Promise.resolve().then(() => this.#dispose());
		this.#closePromise = pending;
		const clear = () => {
			if (this.#closePromise === pending) this.#closePromise = void 0;
		};
		pending.then(clear, clear);
		return pending;
	}
	async #dispose() {
		const failed = (await Promise.allSettled([...this.#drivers].map((driver) => driver.close()))).find((outcome) => outcome.status === "rejected");
		if (failed?.status === "rejected") throw failed.reason;
		this.#db.close();
		await this.#lock.close();
		this.#closed = true;
	}
	#stop(controlId, op) {
		const receipt = this.#db.prepare("SELECT target,generation,operation FROM stops WHERE id=?").get(controlId);
		if (receipt !== void 0 && (receipt.target !== op.targetId || receipt.generation !== op.binding.runGeneration || receipt.operation !== op.id)) reject("CONTROL_CONFLICT");
		if (receipt === void 0) this.#db.prepare("INSERT INTO stops VALUES(?,?,?,?)").run(controlId, op.targetId, op.binding.runGeneration, op.id);
		for (const owned of this.#all()) if (owned.targetId === op.targetId && owned.binding.runGeneration === op.binding.runGeneration && ![
			"settled",
			"fenced",
			"unknown"
		].includes(owned.state)) this.#fence(owned, "GENERATION_STOPPED");
	}
	#fence(op, failureCode) {
		const uncertain = op.attempts.some((a) => a.state === "intent" || a.state === "unknown");
		this.#write({
			...op,
			state: uncertain ? "unknown" : "fenced",
			reservationHeld: uncertain,
			remoteExecution: uncertain ? "unknown" : op.remoteExecution,
			usage: uncertain ? null : op.attempts.length ? knownUsage(op) : null,
			failureCode
		});
	}
	#consumerBinding(driver, op) {
		if (op.binding.sessionBinding === void 0) {
			if (driver instanceof NativeSessionDriver) reject("SESSION_BINDING_REQUIRED");
		} else if (!(driver instanceof NativeSessionDriver)) reject("SESSION_CONSUMER_REQUIRED");
		else driver.validateSessionBinding(op.binding);
	}
	#owner(operationId, driver) {
		if (this.#operationOwners.get(operationId) !== driver) reject("CONTROLLED_PERMIT_REQUIRED");
	}
	#binding(binding) {
		const current = this.#target(binding.id);
		if (current.state !== "active" || canonical(current) !== canonical(binding)) reject("AUTHORITY_REVOKED");
		if (this.#db.prepare("SELECT id FROM stops WHERE target=? AND generation=? LIMIT 1").get(binding.id, binding.runGeneration) !== void 0) reject("GENERATION_STOPPED");
	}
	#target(targetId) {
		const row = this.#db.prepare("SELECT data FROM targets WHERE id=?").get(targetId);
		if (typeof row?.data !== "string") reject("TARGET_MISSING");
		return target(JSON.parse(row.data));
	}
	#maybe(operationId) {
		const row = this.#db.prepare("SELECT data FROM operations WHERE id=?").get(operationId);
		if (row === void 0) return void 0;
		if (typeof row.data !== "string") reject("JOURNAL_CORRUPT");
		return operation(JSON.parse(row.data), this.#config.capacity.maxSteps);
	}
	#read(operationId) {
		return this.#maybe(operationId) ?? reject("OPERATION_MISSING");
	}
	#all() {
		return this.#db.prepare("SELECT data FROM operations ORDER BY rowid").all().map((row) => {
			if (typeof row.data !== "string") return reject("JOURNAL_CORRUPT");
			return operation(JSON.parse(row.data), this.#config.capacity.maxSteps);
		});
	}
	#write(op) {
		operation(op, this.#config.capacity.maxSteps);
		this.#db.prepare("UPDATE operations SET data=? WHERE id=?").run(canonical(op), op.id);
	}
	#capacity() {
		const c = this.#config.capacity;
		let executionSlotsAvailable = c.executionSlots;
		let contactSlotsAvailable = c.contactSlots;
		let executionTokensAvailable = c.executionTokens;
		let contactTokensAvailable = c.contactTokens;
		for (const op of this.#all()) {
			const tokens = (knownUsage(op).totalTokens ?? 0) + (op.reservationHeld ? (op.steps.length - op.nextStep) * c.tokenReservationPerStep : 0);
			if (op.kind === "contact") {
				contactSlotsAvailable -= op.reservationHeld ? 1 : 0;
				contactTokensAvailable -= tokens;
			} else {
				executionSlotsAvailable -= op.reservationHeld ? 1 : 0;
				executionTokensAvailable -= tokens;
			}
		}
		return {
			executionSlotsAvailable,
			contactSlotsAvailable,
			executionTokensAvailable,
			contactTokensAvailable
		};
	}
	#validate() {
		if (this.#closed) reject("NATIVE_HOST_CLOSED");
		try {
			const s = statSync(this.#path);
			const l = statSync(this.#lockPath);
			if (s.dev !== this.#identity.dev || s.ino !== this.#identity.ino || l.dev !== this.#identity.lockDev || l.ino !== this.#identity.lockIno) reject("JOURNAL_CORRUPT");
			if (this.#db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") reject("JOURNAL_CORRUPT");
			const meta = this.#db.prepare("SELECT format,data,revision,stateDigest FROM meta WHERE id=1").get();
			if (meta?.format !== SCHEMA_VERSION || meta.data !== canonical({
				hostId: this.#config.hostId,
				capacity: this.#config.capacity
			}) || !integer(meta.revision) || meta.stateDigest !== this.#stateDigest()) reject("JOURNAL_CORRUPT");
			const targets = this.#db.prepare("SELECT id,data FROM targets").all();
			if (targets.length !== this.#config.targets.length) reject("JOURNAL_CORRUPT");
			for (const row of targets) if (typeof row.data !== "string" || target(JSON.parse(row.data)).id !== row.id) reject("JOURNAL_CORRUPT");
			for (const row of this.#db.prepare("SELECT id,target,generation,operation FROM stops").all()) if (!id(row.id) || !id(row.target) || !id(row.operation) || !integer(row.generation) || row.generation < 1) reject("JOURNAL_CORRUPT");
			this.#all();
		} catch (_invalidDurableState) {
			reject("JOURNAL_CORRUPT");
		}
	}
	#transaction(effect) {
		this.#validate();
		this.#db.exec("BEGIN IMMEDIATE");
		try {
			const result = effect();
			this.#db.prepare("UPDATE meta SET revision=revision+1,stateDigest=? WHERE id=1").run(this.#stateDigest());
			this.#db.exec("COMMIT");
			return result;
		} catch (error) {
			this.#db.exec("ROLLBACK");
			throw error;
		}
	}
	#stateDigest() {
		return digest({
			targets: this.#db.prepare("SELECT id,data FROM targets ORDER BY id").all(),
			operations: this.#db.prepare("SELECT id,data FROM operations ORDER BY id").all(),
			stops: this.#db.prepare("SELECT id,target,generation,operation FROM stops ORDER BY id").all()
		});
	}
};
//#endregion
export { NativeControlId, NativeOperationId, NativeRunDriver, NativeRunHost, NativeSessionDriver, NativeTargetId };
