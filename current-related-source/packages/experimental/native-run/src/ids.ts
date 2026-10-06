/** Journal-local identifiers carry no caller authority. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { NativeOperationId as OperationId, NativeTargetId as TargetId, NativeControlId as ControlId } from './types.ts'

/** Type namespace paired with the operation label constructor. */
export type NativeOperationId = OperationId
/** Type namespace paired with the target label constructor. */
export type NativeTargetId = TargetId
/** Type namespace paired with the control receipt constructor. */
export type NativeControlId = ControlId

/** Brand a journal-local operation label without granting authority.
 * @param value Journal-local operation label.
 * @returns The branded label, subject to admission validation.
 */
export const NativeOperationId = (value: string): OperationId => brandString<OperationId>(value)
/** Brand a journal-local target label without granting authority.
 * @param value Journal-local target label.
 * @returns The branded target label.
 */
export const NativeTargetId = (value: string): TargetId => brandString<TargetId>(value)
/** Brand a journal-local control receipt label without granting authority.
 * @param value Journal-local control receipt label.
 * @returns The branded receipt label.
 */
export const NativeControlId = (value: string): ControlId => brandString<ControlId>(value)
