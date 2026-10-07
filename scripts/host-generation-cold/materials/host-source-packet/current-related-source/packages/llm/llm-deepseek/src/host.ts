/** Shared Host wiring for the DeepSeek protocol adapter. */
import type { Context } from '@deepseek-ai/cordis'
import { symbols } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-fs'
import { resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, ProtectedModelCalls } from '@deepseek-ai/dsh-llm'
import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { DeepSeekAdapter } from './adapter.ts'
import type { DeepSeekAdapterOptions, DeepSeekConnectionOptions, DeepSeekDispatchControl } from './types.ts'
import type {} from './protected-providers.ts'

const providerFactories = new WeakMap<object, object>()
function actualRuntime(runtime: Context['llm']): object {
  const original: unknown = Reflect.get(runtime, symbols.original)
  return original !== null && typeof original === 'object' ? original : runtime
}

/** Recognize a provider-created capability owned by this actual LLM runtime.
 * @param value Candidate factory identity, never serialized data.
 * @param runtime Exact owner runtime where the native Session will run.
 * @returns Whether the provider privately created this factory in that runtime.
 */
export function isDeepSeekProviderFactory(value: unknown, runtime: Context['llm'] | undefined): value is DeepSeekProviderFactory {
  return runtime !== undefined && value !== null && typeof value === 'object'
    && providerFactories.get(value) === actualRuntime(runtime)
}

/** Owned control and persistence checkpoint; credentials never cross this interface. */
export interface DeepSeekSessionControl extends DeepSeekDispatchControl {
  /** Flush the exact owned native Session before entering guarded transport.
   * @param options Actual native request to checkpoint and revalidate.
   */
  beforeStream(options: GenerateOptions): Promise<void>
}
/** Provider-owned opaque factory available only to trusted same-process consumers. */
export interface DeepSeekProviderFactory {
  /** Permanently seal ordinary calls and mint a private guarded adapter factory.
   * @param sessionId Exact native Session identity.
   * @param control Mandatory admission, final dispatch and checkpoint controls.
   * @returns An opaque native call capability without credential callbacks.
   */
  protectSession(sessionId: NonNullable<GenerateOptions['sessionId']>, control: DeepSeekSessionControl): ProtectedModelCalls
}

/**
 * Register one provider with request-local transport services and live retry policy.
 * @param ctx - provider plugin lifetime with the LLM registry injected.
 * @param provider - exact route owned by this plugin.
 * @param dependencies - provider-owned discovery, credential, and configuration callbacks.
 * @returns Provider-owned protected Session call factory.
 */
export function registerDeepSeekProvider<C extends DeepSeekConnectionOptions>(
  ctx: Context, provider: string, dependencies: Pick<DeepSeekAdapterOptions<C>,
  'options' | 'resolveAuth' | 'providerName' | 'discoverModels'>): DeepSeekProviderFactory {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  let userId: AnonymousUserId | undefined
  const ownedDependencies = Object.freeze<DeepSeekAdapterOptions<C>>({
    ...dependencies,
    resolveUserId: () => userId ??= getOrCreateAnonymousUserId(),
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(`llm-deepseek: unusable Messages replay state on assistant history for route "${provider}/${model}"; sending provider-neutral content (${reason})`)
    },
    onExtensionsOmitted: ({ provider, model, fields, error }) => {
      ctx.logger.warn(`llm-deepseek: sending route "${provider}/${model}" without request extension fields ${fields.join(', ')} because they failed to serialize: %o`, error)
    },
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments, hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref,
    ),
    prepareExtensions: request => ctx.get('deepseekLlmApiExtensions')?.prepare(request)
      ?? Promise.resolve({ fields: {}, accept: () => Promise.resolve() }),
  })
  const adapter = new DeepSeekAdapter(ownedDependencies)
  const registration = ctx.llm.registerAdapter([provider], adapter)
  let registeredPolicy = dependencies.options().retryPolicy
  ctx.on('loader/volatile-update', () => {
    let policy: typeof registeredPolicy
    try { policy = dependencies.options().retryPolicy }
    catch (error) { ctx.logger.warn(error); return }
    if (deepEqualJson(policy, registeredPolicy)) return
    registration.replace([provider])
    registeredPolicy = policy
  })
  const factory = Object.freeze<DeepSeekProviderFactory>({ protectSession: (sessionId, control) => {
    ctx.fiber.assertActive()
    if (typeof control?.beforeStream !== 'function' || typeof control.checkAdmission !== 'function'
      || typeof control.checkDispatch !== 'function') throw new Error('INVALID_SESSION_CONTROL')
    const checkpoint = control.beforeStream.bind(control)
    const admission = control.checkAdmission.bind(control)
    const dispatch = control.checkDispatch.bind(control)
    const controlled = new DeepSeekAdapter({ ...ownedDependencies, dispatchControl: {
      checkAdmission: (options) => { ctx.fiber.assertActive(); admission(options) },
      checkDispatch: (options, input) => { ctx.fiber.assertActive(); dispatch(options, input) },
    } })
    return ctx.llm.createProtectedCalls(sessionId, provider, controlled, async (options) => {
      ctx.fiber.assertActive()
      await checkpoint(options)
      ctx.fiber.assertActive()
    })
  } })
  providerFactories.set(factory, actualRuntime(ctx.llm))
  // The directory is an explicit host opt-in. Actual API-key providers publish
  // the factory made above through this path; auth callbacks remain closed over.
  ctx.inject(['deepseekProtectedProviders'], (child) => {
    child.deepseekProtectedProviders.register(provider, factory)
  })
  return factory
}
