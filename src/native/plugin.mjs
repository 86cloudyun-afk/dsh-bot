/** Official DSH bundle entry. Its initial mount is an integration probe. */
export const name = 'dsh-bot';
export const inject = ['connection'];
export function apply(ctx) {
  let closed = false;
  const service = Object.freeze({snapshot: () => ({status: closed ? 'disabled' : 'implementation_pending', releaseReady: false})});
  ctx.effect(() => {
    const unprovide = ctx.provide('dshBot', service);
    const unrpc = ctx.connection.rpc.handle('/dsh-bot', async (endpoint, _payload, signal, peer) => {
      if (closed || signal.aborted) return {ok: false, error: {code: 'disabled', message: '插件已关闭', details: {}}};
      if (peer !== ctx.connection.operator) return {ok: false, error: {code: 'access_denied', message: '连接身份无效', details: {}}};
      if (endpoint !== 'snapshot') return {ok: false, error: {code: 'implementation_pending', message: '原生插件正在实现，尚未交付', details: {}}};
      return {ok: true, value: service.snapshot()};
    });
    return async () => {closed = true; await unrpc(); await unprovide();};
  });
  return service;
}
