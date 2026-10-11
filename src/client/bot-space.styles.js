/** Styles for the dedicated Bot panel. Native conversation descendants stay host-owned. */
export const botSpaceStyles = `
.dsh-bot-space {
  --bs-fallback-surface: #ffffff;
  --bs-fallback-subtle: #f5f7f6;
  --bs-fallback-ink: #18302b;
  --bs-fallback-muted: #63756f;
  --bs-fallback-rule: #e4eae7;
  --bs-surface: var(--dsw-alias-bg-layer-1, var(--bs-fallback-surface));
  --bs-subtle: var(--dsw-alias-bg-layer-2, var(--bs-fallback-subtle));
  --bs-ink: var(--dsw-alias-label-primary, var(--bs-fallback-ink));
  --bs-muted: var(--dsw-alias-label-secondary, var(--bs-fallback-muted));
  --bs-rule: var(--dsw-alias-border-l2, var(--bs-fallback-rule));
  --bs-accent: #146c62;
  --bs-accent-ink: color-mix(in srgb, var(--bs-accent) 55%, var(--bs-ink));
  --bs-accent-soft: color-mix(in srgb, var(--bs-accent) 9%, var(--bs-surface));
  --bs-hover: color-mix(in srgb, var(--bs-ink) 5%, var(--bs-surface));
  --bs-danger: var(--dsw-alias-state-error-primary, #be4248);
  position: relative;
  isolation: isolate;
  container: bot-space / inline-size;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  color: var(--bs-ink);
  background: var(--bs-surface);
  font-family: inherit;
  font-size: 15px;
  line-height: 1.75;
  -webkit-font-smoothing: antialiased;
}
.dsh-bot-space .bs-shell {
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr) 296px;
  height: 100%;
  min-height: 0;
}
.dsh-bot-space .bs-rail,
.dsh-bot-space .bs-main,
.dsh-bot-space .bs-context {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.dsh-bot-space .bs-rail {
  padding: 24px 14px 16px;
  border-right: 1px solid var(--bs-rule);
  background: color-mix(in srgb, var(--bs-accent) 2%, var(--bs-subtle));
  overflow: hidden;
}
.dsh-bot-space .bs-rail > .bs-brand,
.dsh-bot-space .bs-rail > .bs-search,
.dsh-bot-space .bs-rail > .bs-rail-actions,
.dsh-bot-space .bs-rail > .bs-rail-footer { flex: 0 0 auto; }
.dsh-bot-space .bs-brand {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 0 8px 23px;
}
.dsh-bot-space .bs-brand-mark {
  display: grid;
  place-items: center;
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  border-radius: 11px;
  background: var(--bs-accent);
  color: #fff;
  font-size: 18px;
  font-weight: 650;
  line-height: 1;
}
.dsh-bot-space .bs-brand-title {
  margin: 0;
  font-size: 20px;
  font-weight: 650;
  letter-spacing: -.45px;
  line-height: 1.3;
}
.dsh-bot-space .bs-search {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 40px;
  padding: 9px 12px;
  border: 1px solid var(--bs-rule);
  border-radius: 9px;
  background: var(--bs-surface);
  color: var(--bs-ink);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
}
.dsh-bot-space .bs-search::placeholder,
.dsh-bot-space .bs-input::placeholder,
.dsh-bot-space .bs-textarea::placeholder { color: var(--bs-muted); opacity: .85; }
.dsh-bot-space .bs-rail-actions,
.dsh-bot-space .bs-actions,
.dsh-bot-space .bs-header-actions,
.dsh-bot-space .bs-task-actions,
.dsh-bot-space .bs-modal-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.dsh-bot-space .bs-rail-actions { margin: 12px 0 20px; }
.dsh-bot-space .bs-rail-actions > .bs-button,
.dsh-bot-space .bs-rail-actions > .bs-primary { flex: 1; }
.dsh-bot-space .bs-list { display: flex; flex: 1 1 auto; flex-direction: column; gap: 3px; min-height: 0; margin-bottom: 0; padding-bottom: 16px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.dsh-bot-space .bs-list > * { flex: 0 0 auto; }
.dsh-bot-space .bs-list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0;
  padding: 8px 9px;
  color: var(--bs-muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .25px;
  line-height: 1.5;
}
.dsh-bot-space .bs-contact,
.dsh-bot-space .bs-nav-item {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 56px;
  padding: 9px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--bs-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.dsh-bot-space .bs-contact:hover,
.dsh-bot-space .bs-nav-item:hover,
.dsh-bot-space .bs-history-item:hover { background: var(--bs-hover); }
.dsh-bot-space .bs-contact[aria-selected="true"],
.dsh-bot-space .bs-contact[aria-pressed="true"],
.dsh-bot-space .bs-nav-item[aria-selected="true"],
.dsh-bot-space .bs-nav-item[aria-pressed="true"],
.dsh-bot-space .bs-nav-item[data-selected="true"] {
  border-color: color-mix(in srgb, var(--bs-accent) 16%, var(--bs-rule));
  background: var(--bs-accent-soft);
}
.dsh-bot-space .bs-avatar {
  box-sizing: border-box;
  display: inline-grid;
  place-items: center;
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
  border: 1px solid hsl(var(--bs-avatar, 168) 30% 78%);
  border-radius: 12px;
  background: hsl(var(--bs-avatar, 168) 35% 89%);
  color: hsl(var(--bs-avatar, 168) 38% 24%);
  font-size: 15px;
  font-weight: 650;
  line-height: 1;
  user-select: none;
}
.dsh-bot-space .bs-contact-copy { display: grid; grid-template-columns: 36px minmax(0, 1fr); align-items: center; column-gap: 10px; flex: 1; min-width: 0; }
.dsh-bot-space .bs-contact-copy > .bs-avatar { grid-column: 1; grid-row: 1 / span 2; }
.dsh-bot-space .bs-contact-name {
  display: block;
  overflow: hidden;
  color: var(--bs-ink);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-bot-space .bs-contact-copy > .bs-contact-name { grid-column: 2; }
.dsh-bot-space .bs-meta,
.dsh-bot-space .bs-muted {
  color: var(--bs-muted);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.dsh-bot-space .bs-contact-copy > .bs-meta {
  grid-column: 2;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-bot-space .bs-history {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 2px 0 8px 25px;
  padding-left: 12px;
  border-left: 1px solid var(--bs-rule);
}
.dsh-bot-space .bs-history-item {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-height: 40px;
  padding: 8px 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--bs-muted);
  font: inherit;
  font-size: 12px;
  line-height: 1.6;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.dsh-bot-space .bs-history-item[aria-selected="true"],
.dsh-bot-space .bs-history-item[aria-pressed="true"] {
  background: var(--bs-accent-soft);
  color: var(--bs-accent-ink);
  font-weight: 600;
}
.dsh-bot-space .bs-rail-footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
  padding: 16px 2px 0;
  border-top: 1px solid var(--bs-rule);
}
.dsh-bot-space .bs-main { overflow: hidden; background: var(--bs-surface); }
.dsh-bot-space .bs-header {
  box-sizing: border-box;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 88px;
  padding: 18px 24px;
  border-bottom: 1px solid var(--bs-rule);
}
.dsh-bot-space .bs-header-identity {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}
.dsh-bot-space .bs-header-identity > :not(.bs-avatar) { min-width: 0; }
.dsh-bot-space .bs-header-identity .bs-avatar { width: 42px; height: 42px; flex-basis: 42px; border-radius: 14px; font-size: 18px; }
.dsh-bot-space .bs-title {
  margin: 0;
  font-size: 18px;
  font-weight: 650;
  letter-spacing: -.25px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.dsh-bot-space .bs-header-actions { flex: 0 0 auto; justify-content: flex-end; }
.dsh-bot-space .bs-button,
.dsh-bot-space .bs-primary,
.dsh-bot-space .bs-icon-button,
.dsh-bot-space .bs-mobile-toggle,
.dsh-bot-space .bs-context-toggle,
.dsh-bot-space .bs-load-more,
.dsh-bot-space .bs-new-messages {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 40px;
  min-height: 40px;
  padding: 9px 12px;
  border: 1px solid var(--bs-rule);
  border-radius: 8px;
  background: var(--bs-surface);
  color: var(--bs-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  text-decoration: none;
  text-align: center;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.dsh-bot-space .bs-button:hover,
.dsh-bot-space .bs-icon-button:hover,
.dsh-bot-space .bs-mobile-toggle:hover,
.dsh-bot-space .bs-context-toggle:hover,
.dsh-bot-space .bs-load-more:hover,
.dsh-bot-space .bs-new-messages:hover { background: var(--bs-hover); border-color: color-mix(in srgb, var(--bs-ink) 18%, var(--bs-rule)); }
.dsh-bot-space .bs-primary { border-color: var(--bs-accent); background: var(--bs-accent); color: #fff; font-weight: 600; }
.dsh-bot-space .bs-primary:hover { background: #105b53; border-color: #105b53; }
.dsh-bot-space .bs-icon-button { padding: 8px; }
.dsh-bot-space .bs-mobile-toggle { display: none; }
.dsh-bot-space .bs-button:disabled,
.dsh-bot-space .bs-primary:disabled,
.dsh-bot-space .bs-icon-button:disabled,
.dsh-bot-space .bs-load-more:disabled { opacity: .5; cursor: not-allowed; }
.dsh-bot-space .bs-status,
.dsh-bot-space .bs-tag {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 3px 7px;
  border: 1px solid var(--bs-rule);
  border-radius: 6px;
  background: var(--bs-subtle);
  color: var(--bs-muted);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.dsh-bot-space .bs-header .bs-status { margin: 3px 0 0; }
.dsh-bot-space .bs-native { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; min-width: 0; width: 100%; overflow: hidden; }
.dsh-bot-space .bs-native.bs-interaction { flex: 0 0 auto; height: min(520px, 60dvh); min-height: 240px; }
.dsh-bot-space .bs-plan-document { margin: 12px 0 16px; padding: 14px 16px; border: 1px solid var(--bs-rule); border-radius: 9px; background: var(--bs-subtle); }
.dsh-bot-space .bs-plan-document > h3 { margin: 0 0 8px; color: var(--bs-ink); font-size: 13px; font-weight: 600; line-height: 1.6; }
.dsh-bot-space .bs-plan-document > pre { max-height: 240px; margin: 0; overflow: auto; color: var(--bs-ink); white-space: pre-wrap; overflow-wrap: anywhere; font: 13px/1.75 ui-monospace, SFMono-Regular, Consolas, monospace; }
.dsh-bot-space .bs-group { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; min-width: 0; overflow: hidden; }
.dsh-bot-space .bs-empty {
  box-sizing: border-box;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 0;
  padding: 40px 28px;
  overflow: auto;
  color: var(--bs-muted);
  text-align: center;
  overflow-wrap: anywhere;
}
.dsh-bot-space .bs-empty > h2,
.dsh-bot-space .bs-empty > h3 { margin: 4px 0 0; color: var(--bs-ink); font-size: 20px; font-weight: 600; line-height: 1.5; letter-spacing: -.3px; }
.dsh-bot-space .bs-empty > p { max-width: 390px; margin: 0; font-size: 14px; line-height: 1.85; }
.dsh-bot-space .bs-empty > .bs-primary,
.dsh-bot-space .bs-empty > .bs-actions { margin-top: 8px; }
.dsh-bot-space .bs-empty-art {
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  margin-bottom: 6px;
  border: 1px solid color-mix(in srgb, var(--bs-accent) 18%, var(--bs-rule));
  border-radius: 23px;
  background: linear-gradient(145deg, var(--bs-accent-soft), var(--bs-surface));
  color: var(--bs-accent-ink);
  font-size: 28px;
  font-weight: 500;
  line-height: 1;
}
.dsh-bot-space .bs-empty-art > .bs-avatar { width: 48px; height: 48px; flex-basis: 48px; border-radius: 16px; font-size: 23px; }
.dsh-bot-space .bs-feedback,
.dsh-bot-space .bs-error,
.dsh-bot-space .bs-pending {
  box-sizing: border-box;
  flex: 0 0 auto;
  margin: 12px 24px 0;
  padding: 10px 12px;
  border: 1px solid var(--bs-rule);
  border-radius: 8px;
  background: var(--bs-subtle);
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dsh-bot-space .bs-feedback { max-height: 160px; overflow-y: auto; }
.dsh-bot-space .bs-error { color: var(--bs-danger); border-color: color-mix(in srgb, var(--bs-danger) 28%, var(--bs-rule)); background: color-mix(in srgb, var(--bs-danger) 5%, var(--bs-surface)); }
.dsh-bot-space .bs-feedback .bs-error,
.dsh-bot-space .bs-feedback .bs-pending { margin: 0; }
.dsh-bot-space .bs-pending + .bs-pending { margin-top: 8px; }
.dsh-bot-space .bs-transcript,
.dsh-bot-space .bs-messages {
  box-sizing: border-box;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 24px max(24px, calc((100% - 760px) / 2)) 18px;
}
.dsh-bot-space .bs-message { max-width: 760px; margin: 0 auto 28px; overflow-wrap: anywhere; }
.dsh-bot-space .bs-transcript > .bs-empty { min-height: 100%; }
.dsh-bot-space .bs-message-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; line-height: 1.6; }
.dsh-bot-space .bs-message-heading .bs-avatar { width: 32px; height: 32px; flex-basis: 32px; border-radius: 10px; font-size: 13px; }
.dsh-bot-space .bs-message-body { margin: 9px 0 0 40px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 15px; line-height: 1.75; }
.dsh-bot-space .bs-message[data-producer="human"] .bs-message-body { width: fit-content; max-width: calc(100% - 40px); padding: 11px 15px; border-radius: 2px 12px 12px 12px; background: var(--bs-accent-soft); }
.dsh-bot-space .bs-rounds { flex: 0 1 auto; max-height: 160px; overflow-y: auto; overscroll-behavior: contain; }
.dsh-bot-space .bs-round { box-sizing: border-box; display: flex; flex: 0 0 auto; flex-wrap: wrap; align-items: center; gap: 8px; width: calc(100% - 48px); max-width: 760px; margin: 0 auto 10px; padding: 10px 12px; border: 1px solid var(--bs-rule); border-radius: 8px; background: var(--bs-subtle); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.dsh-bot-space .bs-load-more { display: flex; margin: 0 auto 24px; color: var(--bs-muted); }
.dsh-bot-space .bs-new-messages { align-self: center; flex: 0 0 auto; margin: 0 16px 8px; border-color: color-mix(in srgb, var(--bs-accent) 25%, var(--bs-rule)); background: var(--bs-accent-soft); color: var(--bs-accent-ink); }
.dsh-bot-space .bs-composer {
  box-sizing: border-box;
  flex: 0 0 auto;
  width: calc(100% - 48px);
  max-width: 760px;
  margin: 8px auto 20px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--bs-ink) 16%, var(--bs-rule));
  border-radius: 12px;
  background: var(--bs-surface);
  box-shadow: 0 3px 12px color-mix(in srgb, var(--bs-ink) 4%, transparent);
}
.dsh-bot-space .bs-composer .bs-textarea { display: block; min-height: 82px; max-height: 180px; padding: 13px 15px 8px; border: 0; border-radius: 12px 12px 0 0; background: transparent; font-size: 15px; line-height: 1.75; resize: vertical; }
.dsh-bot-space .bs-composer-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 10px 10px 15px; }
.dsh-bot-space .bs-composer-footer .bs-primary { flex: 0 0 auto; }
.dsh-bot-space .bs-composer-footer .bs-meta { min-width: 0; }
.dsh-bot-space .bs-context { padding: 22px 20px; border-left: 1px solid var(--bs-rule); background: var(--bs-surface); overflow-y: auto; overscroll-behavior: contain; }
.dsh-bot-space .bs-context-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 18px; }
.dsh-bot-space .bs-context-header > h2,
.dsh-bot-space .bs-context-header > h3 { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.5; }
.dsh-bot-space .bs-section { margin: 0 0 24px; padding: 0 0 20px; border-bottom: 1px solid var(--bs-rule); }
.dsh-bot-space .bs-section:last-child { margin-bottom: 0; padding-bottom: 0; border-bottom: 0; }
.dsh-bot-space .bs-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 12px; color: var(--bs-muted); font-size: 12px; font-weight: 600; line-height: 1.6; }
.dsh-bot-space .bs-section-heading > h2,
.dsh-bot-space .bs-section-heading > h3 { margin: 0; color: inherit; font: inherit; }
.dsh-bot-space .bs-section > h3 { margin: 0 0 12px; color: var(--bs-muted); font-size: 12px; font-weight: 600; line-height: 1.6; }
.dsh-bot-space .bs-section > p { margin: 0 0 12px; font-size: 13px; line-height: 1.8; overflow-wrap: anywhere; }
.dsh-bot-space .bs-context .bs-button[data-pending-session-id] { display: flex; width: 100%; margin: 0 0 8px; padding: 10px 12px; justify-content: flex-start; text-align: left; white-space: normal; overflow-wrap: anywhere; }
.dsh-bot-space .bs-task,
.dsh-bot-space .bs-meeting { margin: 0 0 10px; padding: 12px; border: 1px solid var(--bs-rule); border-radius: 9px; background: var(--bs-subtle); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.dsh-bot-space .bs-task-title { display: block; margin: 0 0 5px; font-size: 13px; font-weight: 600; line-height: 1.7; overflow-wrap: anywhere; }
.dsh-bot-space .bs-task > .bs-meta { margin: 4px 0; }
.dsh-bot-space .bs-meeting > h4 { margin: 0 0 6px; font-size: 13px; font-weight: 600; line-height: 1.7; }
.dsh-bot-space .bs-meeting > p { margin: 8px 0; }
.dsh-bot-space .bs-task-actions { margin-top: 10px; }
.dsh-bot-space .bs-task-actions > .bs-button { flex: 1 1 auto; padding-right: 8px; padding-left: 8px; font-size: 12px; }
.dsh-bot-space .bs-member { display: flex; align-items: center; gap: 10px; min-height: 48px; margin-bottom: 6px; font-size: 13px; overflow-wrap: anywhere; }
.dsh-bot-space .bs-member > :not(.bs-avatar):not(.bs-tag) { flex: 1 1 0; min-width: 0; overflow-wrap: anywhere; }
.dsh-bot-space .bs-member > .bs-tag { flex: 0 0 auto; max-width: none; white-space: nowrap; }
.dsh-bot-space .bs-member .bs-avatar { width: 32px; height: 32px; flex-basis: 32px; border-radius: 10px; font-size: 13px; }
.dsh-bot-space .bs-sealed { margin: 12px 0; padding: 12px; border: 1px dashed color-mix(in srgb, var(--bs-accent) 24%, var(--bs-rule)); border-radius: 8px; background: var(--bs-accent-soft); color: var(--bs-accent-ink); font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
.dsh-bot-space .bs-details { margin: 12px 0; color: var(--bs-muted); font-size: 12px; }
.dsh-bot-space .bs-details > summary { box-sizing: border-box; min-height: 40px; padding: 10px 0; cursor: pointer; }
.dsh-bot-space .bs-details > :not(summary) { margin-top: 8px; }
.dsh-bot-space .bs-form { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.dsh-bot-space .bs-form > fieldset.bs-section { min-width: 0; margin: 0; padding: 10px 12px; border: 1px solid var(--bs-rule); border-radius: 8px; }
.dsh-bot-space .bs-form > fieldset.bs-section > legend { padding: 0 4px; color: var(--bs-muted); font-size: 12px; }
.dsh-bot-space .bs-field { display: flex; flex-direction: column; gap: 7px; min-width: 0; color: var(--bs-ink); font-size: 13px; font-weight: 500; line-height: 1.6; }
.dsh-bot-space .bs-input,
.dsh-bot-space .bs-select,
.dsh-bot-space .bs-textarea { box-sizing: border-box; width: 100%; min-width: 0; min-height: 40px; padding: 9px 11px; border: 1px solid var(--bs-rule); border-radius: 8px; background: var(--bs-surface); color: var(--bs-ink); font: inherit; font-size: 14px; font-weight: 400; line-height: 1.6; }
.dsh-bot-space .bs-textarea { min-height: 92px; resize: vertical; }
.dsh-bot-space .bs-check { box-sizing: border-box; display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 7px 0; font-size: 13px; line-height: 1.6; cursor: pointer; }
.dsh-bot-space .bs-check > input { flex: 0 0 auto; width: 17px; height: 17px; margin: 0; accent-color: var(--bs-accent); }
.dsh-bot-space .bs-modal,
.dsh-bot-space .bs-dialog { box-sizing: border-box; width: min(520px, calc(100vw - 40px)); max-height: min(760px, calc(100dvh - 48px)); margin: auto; padding: 0; border: 1px solid var(--bs-rule); border-radius: 16px; background: var(--bs-surface); color: var(--bs-ink); box-shadow: 0 24px 80px rgb(0 0 0 / 18%); font: inherit; overflow-y: auto; }
.dsh-bot-space .bs-modal::backdrop,
.dsh-bot-space .bs-dialog::backdrop { background: rgb(8 25 22 / 38%); }
.dsh-bot-space .bs-modal-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 24px 16px; border-bottom: 1px solid var(--bs-rule); }
.dsh-bot-space .bs-modal-header > h2,
.dsh-bot-space .bs-modal-header > h3 { margin: 0; font-size: 18px; font-weight: 600; line-height: 1.5; letter-spacing: -.2px; }
.dsh-bot-space .bs-modal-body { padding: 22px 24px; }
.dsh-bot-space .bs-modal-actions { justify-content: flex-end; padding: 16px 24px 20px; border-top: 1px solid var(--bs-rule); }
.dsh-bot-space .bs-modal-body > .bs-modal-header { margin: -22px -24px 22px; }
.dsh-bot-space .bs-modal-body .bs-modal-actions { margin: 4px -24px -22px; }
.dsh-bot-space .bs-backdrop { display: none; position: absolute; inset: 0; z-index: 45; width: 100%; height: 100%; padding: 0; border: 0; border-radius: 0; background: rgb(8 25 22 / 30%); cursor: pointer; }
.dsh-bot-space .bs-button:focus-visible,
.dsh-bot-space .bs-primary:focus-visible,
.dsh-bot-space .bs-icon-button:focus-visible,
.dsh-bot-space .bs-mobile-toggle:focus-visible,
.dsh-bot-space .bs-context-toggle:focus-visible,
.dsh-bot-space .bs-contact:focus-visible,
.dsh-bot-space .bs-nav-item:focus-visible,
.dsh-bot-space .bs-history-item:focus-visible,
.dsh-bot-space .bs-search:focus-visible,
.dsh-bot-space .bs-input:focus-visible,
.dsh-bot-space .bs-select:focus-visible,
.dsh-bot-space .bs-textarea:focus-visible,
.dsh-bot-space .bs-load-more:focus-visible,
.dsh-bot-space .bs-new-messages:focus-visible,
.dsh-bot-space .bs-details > summary:focus-visible,
.dsh-bot-space .bs-check > input:focus-visible { outline: 2px solid var(--bs-accent-ink); outline-offset: 3px; }
.dsh-bot-space .bs-composer:focus-within { border-color: var(--bs-accent-ink); }
.dsh-bot-space[data-context-collapsed="true"] .bs-shell { grid-template-columns: 248px minmax(0, 1fr); }
.dsh-bot-space[data-context-collapsed="true"] .bs-context { display: none; }
@container bot-space (max-width: 1179px) {
  .dsh-bot-space .bs-shell { grid-template-columns: 248px minmax(0, 1fr); }
  .dsh-bot-space .bs-context { display: none; position: absolute; top: 0; right: 0; bottom: 0; z-index: 50; width: min(296px, calc(100% - 40px)); box-shadow: -12px 0 40px rgb(0 0 0 / 12%); }
  .dsh-bot-space[data-context-open="true"] .bs-context { display: flex; }
  .dsh-bot-space[data-context-open="true"] .bs-backdrop[data-for="context"] { display: block; }
}
@container bot-space (max-width: 839px) {
  .dsh-bot-space .bs-shell,
  .dsh-bot-space[data-context-collapsed="true"] .bs-shell { grid-template-columns: minmax(0, 1fr); }
  .dsh-bot-space .bs-rail { display: none; position: absolute; top: 0; left: 0; bottom: 0; z-index: 50; width: min(296px, calc(100% - 40px)); box-shadow: 12px 0 40px rgb(0 0 0 / 12%); }
  .dsh-bot-space[data-rail-open="true"] .bs-rail { display: flex; }
  .dsh-bot-space[data-rail-open="true"] .bs-backdrop[data-for="rail"] { display: block; }
  .dsh-bot-space .bs-mobile-toggle { display: inline-flex; }
  .dsh-bot-space .bs-brand { gap: 9px; padding-right: 0; padding-left: 0; }
  .dsh-bot-space .bs-brand > .bs-mobile-toggle { flex: 0 0 40px; width: 40px; margin-left: auto; padding: 8px; font-size: 0; }
  .dsh-bot-space .bs-brand > .bs-mobile-toggle::before { content: "×"; font-size: 22px; line-height: 1; }
  .dsh-bot-space .bs-header { flex-wrap: wrap; gap: 10px; min-height: 80px; padding: 14px 16px; }
  .dsh-bot-space .bs-header-identity { flex-basis: 180px; }
  .dsh-bot-space .bs-header-actions { gap: 6px; margin-left: auto; }
  .dsh-bot-space .bs-transcript,
  .dsh-bot-space .bs-messages { padding: 20px 16px 12px; }
  .dsh-bot-space .bs-composer { width: calc(100% - 32px); margin-bottom: 16px; }
  .dsh-bot-space .bs-round { width: calc(100% - 32px); }
  .dsh-bot-space .bs-feedback,
  .dsh-bot-space .bs-error,
  .dsh-bot-space .bs-pending { margin-right: 16px; margin-left: 16px; }
  .dsh-bot-space .bs-empty { padding: 28px 20px; }
}
@container bot-space (max-width: 439px) {
  .dsh-bot-space .bs-header-identity { flex-basis: calc(100% - 56px); }
  .dsh-bot-space .bs-header-actions { justify-content: flex-start; width: 100%; margin-left: 0; }
  .dsh-bot-space .bs-composer-footer { flex-wrap: wrap; }
  .dsh-bot-space .bs-composer-footer .bs-primary { margin-left: auto; }
  .dsh-bot-space .bs-message-body { margin-left: 0; }
  .dsh-bot-space .bs-message[data-producer="human"] .bs-message-body { max-width: 100%; }
  .dsh-bot-space .bs-modal,
  .dsh-bot-space .bs-dialog { width: calc(100vw - 24px); max-height: calc(100dvh - 24px); border-radius: 12px; }
  .dsh-bot-space .bs-modal-header { padding: 16px; }
  .dsh-bot-space .bs-modal-body { padding: 18px 16px; }
  .dsh-bot-space .bs-modal-actions { padding: 14px 16px 16px; }
  .dsh-bot-space .bs-modal-body > .bs-modal-header { margin: -18px -16px 18px; }
  .dsh-bot-space .bs-modal-body .bs-modal-actions { margin: 4px -16px -18px; }
}
@media (prefers-color-scheme: dark) {
  .dsh-bot-space { --bs-fallback-surface: #171d1b; --bs-fallback-subtle: #202825; --bs-fallback-ink: #e5eeea; --bs-fallback-muted: #a4b4ad; --bs-fallback-rule: #34413b; }
}
@media (forced-colors: active) {
  .dsh-bot-space .bs-contact[aria-selected="true"],
  .dsh-bot-space .bs-contact[aria-pressed="true"],
  .dsh-bot-space .bs-history-item[aria-selected="true"],
  .dsh-bot-space .bs-history-item[aria-pressed="true"] { border: 1px solid Highlight; }
  .dsh-bot-space .bs-primary { border-color: ButtonText; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-bot-space .bs-contact,
  .dsh-bot-space .bs-nav-item,
  .dsh-bot-space .bs-button,
  .dsh-bot-space .bs-primary,
  .dsh-bot-space .bs-icon-button,
  .dsh-bot-space .bs-mobile-toggle,
  .dsh-bot-space .bs-context-toggle,
  .dsh-bot-space .bs-load-more,
  .dsh-bot-space .bs-new-messages { transition: none; }
}
`;
