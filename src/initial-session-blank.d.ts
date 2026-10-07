export type InitialSessionModeSnapshot = Readonly<{
  permissionPreset: 'read-only'|'workspace-write'|'danger-full-access';
  sandboxMode: 'read-only'|'workspace-write'|'danger-full-access';
  approvalPolicy: 'ask'|'never';
}>;
export function freezeInitialSessionMode(value: unknown): InitialSessionModeSnapshot;
export function isBlankInitialSessionEvents(events: unknown, initialization?: InitialSessionModeSnapshot, seq?: number): boolean;
