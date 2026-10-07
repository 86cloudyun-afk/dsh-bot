/** Freeze the exact complete delegate object graph; copied metadata never supplies tool authority. */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { reject } from './values.ts'

export function freezeOwnedDelegateDefinition(tool: ToolDefinition): void {
  const seen = new WeakSet<object>(), pending: unknown[] = [tool]
  while (pending.length > 0) {
    const value = pending.pop()
    if (value === null || typeof value !== 'object' && typeof value !== 'function' || seen.has(value)) continue
    seen.add(value)
    const prototype: unknown = Object.getPrototypeOf(value)
    if (typeof value === 'object' && !Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
      reject('GENERATION_TOOL_PLAIN_POLICY_REQUIRED')
    }
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key) ?? reject('GENERATION_TOOL_DESCRIPTOR_REQUIRED')
      if (descriptor.get !== undefined || descriptor.set !== undefined) reject('GENERATION_TOOL_ACCESSOR_POLICY_REJECTED')
      pending.push(descriptor.value)
    }
    Object.freeze(value)
  }
}
