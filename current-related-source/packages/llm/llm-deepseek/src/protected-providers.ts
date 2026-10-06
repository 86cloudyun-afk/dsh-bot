/** Explicit non-RPC host opt-in for opaque factories; absent from shipped profiles. */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { DeepSeekProviderFactory } from './host.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Trusted same-process provider capability directory, without auth callbacks. */
    deepseekProtectedProviders: DeepSeekProtectedProviders
  }
}

/** Provider definition directory; it neither grants human authority nor exposes credentials. */
export class DeepSeekProtectedProviders extends Service {
  private factories = new Map<string, DeepSeekProviderFactory>()
  constructor(ctx: Context) { super(ctx, 'deepseekProtectedProviders') }

  /** Publish a factory under the actual provider fiber lifetime.
   * @param provider Exact provider-owned route.
   * @param factory Opaque factory created by that provider.
   * @returns Fiber-owned idempotent withdrawal capability.
   */
  register(provider: string, factory: DeepSeekProviderFactory): () => Promise<void> {
    return this.ctx.effect(() => {
      if (this.factories.has(provider)) throw new Error('PROTECTED_PROVIDER_CONFLICT')
      this.factories.set(provider, factory)
      return () => { if (this.factories.get(provider) === factory) this.factories.delete(provider) }
    }, 'deepseekProtectedProviders.register()')
  }

  /** Resolve an opaque provider factory without reading credentials or discovering models.
   * @param provider Exact route requested by an owned native consumer.
   * @returns Current provider-owned capability, or absence.
   */
  lookup(provider: string): DeepSeekProviderFactory | undefined { return this.factories.get(provider) }
}
