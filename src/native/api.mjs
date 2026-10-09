import { clientRequestSchema } from "@deepseek-ai/dsh-client-connection";
import { requireCondition } from "./store.mjs";

// A <=4 MiB UTF-8 import file is carried as a JSON string, which may be escaped.
// Domain limits remain independent; Connection authenticates this carrier.
const MAX_BODY_BYTES = 9 * 1024 * 1024;

async function readEnvelope(request) {
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BODY_BYTES)
    return new Response("request too large", { status: 413 });
  const reader = request.body?.getReader(),
    chunks = [];
  let bytes = 0;
  if (!reader) return new Response("body is not JSON", { status: 400 });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return new Response("request too large", { status: 413 });
      }
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed = clientRequestSchema.safeParse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)),
    );
    return parsed.success
      ? parsed.data
      : new Response("invalid request envelope", { status: 400 });
  } catch {
    return new Response("body is not JSON", { status: 400 });
  } finally {
    reader.releaseLock();
  }
}

/** Connection owns the authenticated /api carrier; this plugin owns exact routes only. */
export async function mountBotRoutes(ctx, { policy, service, isClosed }) {
  const disposers = [];
  const dispose = async () => {
    for (const remove of disposers.splice(0).reverse()) await remove();
  };
  try {
    for (const endpoint of ["catalog", "snapshot", "command", "page"]) {
      const method = `dsh.bot/${endpoint}`;
      disposers.push(
        ctx.connection.fetch.register({
          path: `/api/${method}`,
          methods: ["POST"],
          requestBody: "buffered",
          async fetch(request) {
            if (request.method !== "POST")
              return new Response("not found", { status: 404 });
            if (
              request.headers
                .get("content-type")
                ?.split(";", 1)[0]
                ?.trim()
                .toLowerCase() !== "application/json"
            )
              return new Response("content type must be application/json", {
                status: 415,
              });
            const message = await readEnvelope(request);
            if (message instanceof Response) return message;
            let result;
            try {
              requireCondition(message.method === method, "invalid_endpoint");
              requireCondition(!isClosed(), "disabled");
              request.signal.throwIfAborted();
              // The public Connection fetch contract admits only the actual authenticated operator.
              const actor = policy.fromPeer(ctx.connection.operator),
                payload = message.payload;
              const command =
                endpoint === "command"
                  ? payload
                  : endpoint === "page"
                    ? { action: "session.page", input: payload }
                    : { action: endpoint, input: payload ?? {} };
              result = {
                ok: true,
                value: await service.dispatch(actor, command, request.signal),
              };
            } catch (error) {
              const publicCode=typeof error.code==='string'&&(/^[a-z][a-z0-9_]{0,79}$/.test(error.code)||['agent-preset/locked','agent-preset/not-found','agent-preset/invalid'].includes(error.code))
                ? error.code : request.signal.aborted ? "cancelled" : "internal_error";
              result = {
                ok: false,
                error: {
                  code: publicCode,
                  message: "操作未完成，请根据错误代码检查输入或保留原始操作并查回。",
                  details: error.details?.rejectedBeforeWrite === true ? {rejectedBeforeWrite:true} : {},
                },
              };
            }
            return Response.json({
              type: "server-response",
              rpcId: message.rpcId,
              result,
            });
          },
        }),
      );
    }
    return dispose;
  } catch (error) {
    await dispose();
    throw error;
  }
}
