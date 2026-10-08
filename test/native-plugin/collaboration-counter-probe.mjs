import { readFile, writeFile } from "node:fs/promises";
import { textChunks } from "./official-fixture.mjs";

export async function readCounters(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}
export function incrementStream() {
  const seen = new Set();
  return async function* (options) {
    if (!seen.has(options.sessionId)) {
      seen.add(options.sessionId);
      yield { type: "block-start", index: 0, blockType: "tool-call" };
      yield {
        type: "block-end",
        index: 0,
        block: {
          type: "tool-call",
          id: `increment-${options.sessionId}`,
          name: "review_increment",
          arguments: "{}",
        },
      };
      yield { type: "finish", reason: { kind: "tool-calls" } };
    } else
      yield* textChunks(
        "Persisted original real model reply after the local side effect",
      );
  };
}
export function installIncrement(
  f,
  path,
  { shouldBlock = () => false, onBlock = () => {} } = {},
) {
  return f.ctx.tools.register({
    name: "review_increment",
    description: "Harmless scratch-file counter for a review reproduction.",
    parameters: { type: "object" },
    output: {
      schema: { type: "object" },
      render: () => [{ type: "text", text: "Scratch counter incremented." }],
    },
    execute: async (_args, exec) => {
      const botId = f.store.read().sessions[exec.agent.id].botId,
        counters = await readCounters(path);
      counters[botId] = (counters[botId] ?? 0) + 1;
      await writeFile(path, JSON.stringify(counters));
      if (shouldBlock(botId)) {
        onBlock();
        await new Promise(() => {});
      }
      return {};
    },
  });
}
