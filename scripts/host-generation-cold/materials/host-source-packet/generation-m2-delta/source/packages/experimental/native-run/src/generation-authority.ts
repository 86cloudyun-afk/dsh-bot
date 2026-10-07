/** Pinned synchronous owner grants, independent of permission to dispatch a new input. */
import { reject } from './values.ts'

export interface OwnedGenerationControlAuthority {
  readonly isAuthorized: () => boolean
  readonly isDispatchFenced: () => boolean
}
export interface PinnedGenerationControlAuthority {
  authorize(): void
  assertFenced(): void
}
export function pinGenerationControlAuthority(input: OwnedGenerationControlAuthority): PinnedGenerationControlAuthority {
  const authorization = Object.getOwnPropertyDescriptor(input, 'isAuthorized')
  const fence = Object.getOwnPropertyDescriptor(input, 'isDispatchFenced')
  const authorized: unknown = authorization?.value, fenced: unknown = fence?.value
  const callable = (value: unknown): value is () => unknown => typeof value === 'function'
  if (authorization?.get !== undefined || fence?.get !== undefined || !callable(authorized)
    || !callable(fenced)) reject('GENERATION_CONTROL_AUTHORITY_REQUIRED')
  Object.freeze(authorized); Object.freeze(fenced)
  const check = (callback: () => unknown, code: string): void => {
    let result: unknown
    try { result = callback() } catch (_error: unknown) { reject(code) }
    if (result !== true) {
      if (result !== null && typeof result === 'object' && 'then' in result) void Promise.resolve(result).catch((_error: unknown) => {})
      reject(code)
    }
  }
  return Object.freeze({ authorize: (): void => { check(() => authorized(), 'GENERATION_CONTROL_AUTHORITY_REVOKED') },
    assertFenced: (): void => { check(() => fenced(), 'GENERATION_CONTROL_PRODUCT_FENCE_REQUIRED') } })
}

/** Original operation and nonce are mandatory for historical control, never invented from coordinates. */
export function assertOwnedControlBinding(binding: object): void {
  for (const key of ['operationId', 'nonce']) {
    const value: unknown = Reflect.get(binding, key)
    if (typeof value !== 'string' || value.length === 0 || value.length > 200 || value.includes('\0')) {
      reject('GENERATION_CONTROL_ORIGINAL_OPERATION_REQUIRED')
    }
  }
}
