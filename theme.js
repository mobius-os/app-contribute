// One module-level stylesheet rendered once at the app root as
// <style>{CSS}</style>. Semantic co-* classNames; state rides is-*
// modifier classes; every color is a theme token so the app follows the
// owner's light/dark theme. Shared chrome blocks carry mobius-ui fences
// so a future library harvest can find them.
export const CSS = `
/* mobius-ui:Root v1 — app-owned copy; library candidate. */
.co-root {
  box-sizing: border-box; position: relative; min-height: 0; height: 100%;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--bg); color: var(--text); font-family: var(--font);
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
  /* Caution amber for advisory/attention states that are NOT errors, so real
     failures keep --danger to themselves and nothing benign shouts in red. */
  --co-warn: #cf9526;
}
.co-root *, .co-root *::before, .co-root *::after { box-sizing: inherit; }
.co-visually-hidden {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
/* /mobius-ui:Root */

/* mobius-ui:Scrollskin v2 — keep in sync; hidden by default, content stays scrollable. */
.co-page {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.co-page::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
/* /mobius-ui:Scrollskin */

/* mobius-ui:Focus v1 — one keyboard-focus ring for every interactive
   control, so nothing ships without a visible focus indicator. */
:where(button, a, input, textarea, select, summary, [role="button"],
       [tabindex]:not([tabindex="-1"])):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
/* /mobius-ui:Focus */

/* mobius-ui:ReducedMotion v1 — collapse motion to ~instant for
   motion-sensitive users. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
/* /mobius-ui:ReducedMotion */

.co-page {
  flex: 1; min-height: 0; width: min(100%, 1120px); margin: 0 auto;
  padding: 0 20px max(56px, calc(28px + env(safe-area-inset-bottom)));
  overflow-y: auto; overflow-x: hidden;
  overscroll-behavior: contain;
}

/* The shared header and tabs keep the contribution feed's reading measure even
   when Projects uses the wider canvas. Their viewport position therefore stays
   fixed when the owner switches views. */
.co-header,
.co-tabs,
.co-contributions-view {
  width: min(100%, 760px); margin-inline: auto;
}

.co-header {
  position: relative; display: grid;
  grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px 16px;
  padding: max(18px, env(safe-area-inset-top)) 2px 8px;
}
.co-header-main { min-width: 0; display: flex; align-items: center; gap: 12px; }
.co-brand-copy { min-width: 0; }
.co-brand-icon {
  width: 34px; height: 34px; border-radius: 8px;
  object-fit: cover; flex-shrink: 0; display: block;
}
.co-brand-fallback {
  width: 34px; height: 34px; border-radius: 8px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 700;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}
.co-title { margin: 0; font-size: 19px; font-weight: 720; letter-spacing: -0.02em; }
.co-subtitle { display: block; margin-top: 2px; font-size: 12px; color: var(--muted); }

.co-toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 7px; }
.co-toolbar-check {
  width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
  color: var(--muted);
}
.ma-spinner.is-compact { width: 15px; height: 15px; border-width: 2px; }
.co-offline-note {
  grid-column: 1 / -1; display: block; margin: -2px 0 0 46px;
  font-size: 12px; color: var(--muted); text-wrap: pretty;
}

/* Projects / Pull requests / Issues top-level split. The page shell is always
   wide; Projects alone fills it while the review feeds stay at 680px. */
.co-page.is-sources {
  padding-bottom: 12px;
  display: flex; flex-direction: column; overflow: hidden;
}
.co-tabs {
  display: flex; align-items: stretch; gap: 24px;
  margin: 4px auto 20px; padding: 0;
  border-bottom: 1px solid var(--border);
}
.co-tabs button {
  position: relative; min-height: 44px; padding: 9px 1px; border: 0;
  background: transparent; color: var(--muted); font: inherit;
  font-size: 13px; font-weight: 650; cursor: pointer;
}
.co-tabs button.is-active {
  color: var(--text);
}
.co-tabs button.is-active::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: -1px;
  height: 2px; border-radius: 2px 2px 0 0; background: var(--accent);
}
@media (hover: hover) {
  .co-tabs button:hover { color: var(--text); }
}
.co-tabs button span {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 19px; height: 19px; margin-left: 5px; padding: 0 5px;
  border-radius: 999px; background: var(--surface2, var(--surface));
  color: var(--muted); font-size: 10.5px; font-variant-numeric: tabular-nums;
}

/* Opening workspace: the same project / agent work / owner-decision hierarchy
   as the Möbius · You concept, expanded for real contribution state. */
.co-workspace { width: min(100%, 680px); margin-inline: auto; padding: 4px 0 20px; }
.co-workspace-intro { margin: 2px 0 24px; }
.co-workspace-intro h2 {
  margin: 0; max-width: 25ch; font-size: 22px; line-height: 1.25;
  letter-spacing: -0.025em;
}
.co-workspace-intro p {
  max-width: 58ch; margin: 6px 0 0; color: var(--muted);
  font-size: 13px; line-height: 1.55;
}
.co-workspace-section + .co-workspace-section { margin-top: 22px; }
.co-workspace-maintenance {
  display: flex; align-items: center; gap: 6px; margin: 18px 2px 0;
  color: var(--muted); font-size: 10.5px; line-height: 1.4;
}
.co-workspace-maintenance .co-icon { flex: 0 0 auto; }
.co-cycle-card {
  display: grid; grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center; gap: 12px; min-height: 78px; margin: 0 0 24px;
  padding: 13px 14px; border: 1px solid var(--border); border-radius: 14px;
  background: var(--surface);
}
.co-cycle-card.is-idle,
.co-cycle-card.is-running,
.co-cycle-card.is-starting {
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  background: color-mix(in srgb, var(--accent) 4%, var(--surface));
}
.co-cycle-mark {
  display: inline-flex; align-items: center; justify-content: center;
  width: 38px; height: 38px; border-radius: 11px;
  background: color-mix(in srgb, var(--accent) 11%, var(--surface2, var(--bg)));
  color: var(--accent);
}
.co-cycle-card.is-complete .co-cycle-mark { color: var(--green); background: color-mix(in srgb, var(--green) 10%, var(--surface)); }
.co-cycle-copy { min-width: 0; }
.co-cycle-copy h2 { margin: 0; font-size: 13.5px; line-height: 1.35; text-wrap: balance; }
.co-cycle-copy p { margin: 3px 0 0; color: var(--muted); font-size: 11px; line-height: 1.45; text-wrap: pretty; }
.co-cycle-actions { display: flex; align-items: center; justify-content: flex-end; gap: 5px; }
.co-cycle-actions .co-btn { gap: 6px; min-height: 44px; padding: 8px 12px; white-space: nowrap; }
.co-cycle-stop { color: var(--danger); }
.co-cycle-link {
  min-height: 44px; padding: 8px 7px; border: 0; border-radius: 8px;
  background: transparent; color: var(--muted); font: inherit;
  font-size: 10.5px; font-weight: 650; cursor: pointer; white-space: nowrap;
}
.co-cycle-progress { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.co-cycle-progress > span {
  width: min(170px, 45vw); height: 4px; overflow: hidden; border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 13%, var(--surface2, var(--bg)));
}
.co-cycle-progress i {
  display: block; width: 100%; height: 100%; border-radius: inherit;
  transform: scaleX(0); transform-origin: left center; background: var(--accent);
  transition: transform .35s cubic-bezier(.16, 1, .3, 1);
}
.co-cycle-progress small { color: var(--muted); font-size: 9.5px; white-space: nowrap; }
.co-cycle-error { display: block; margin-top: 5px; color: var(--danger); font-size: 10px; line-height: 1.4; }
.co-workspace-section-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  min-height: 44px; margin-bottom: 4px;
}
.co-workspace-section-head h2 { margin: 0; font-size: 12.5px; font-weight: 690; }
.co-workspace-section-head button {
  display: inline-flex; align-items: center; gap: 3px; min-height: 44px; padding: 7px 0;
  border: 0; background: transparent; color: var(--muted); font: inherit;
  font-size: 11.5px; font-weight: 620; cursor: pointer;
}
.co-workspace-card,
.co-workspace-task {
  border: 1px solid var(--border); border-radius: 13px; background: var(--surface);
}
.co-workspace-projects { overflow: hidden; }
.co-workspace-project {
  display: grid; grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center; gap: 10px; width: 100%; min-height: 62px; padding: 10px 12px;
  border: 0; background: transparent; color: var(--text); font: inherit;
  text-align: left; cursor: pointer;
}
.co-workspace-project + .co-workspace-project { border-top: 1px solid var(--border); }
.co-workspace-project-mark {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 9px;
  background: color-mix(in srgb, var(--accent) 11%, var(--surface2, var(--bg)));
  color: var(--accent); font-size: 13px; font-weight: 750;
}
.co-project-icon { overflow: hidden; }
.co-project-icon.has-image {
  background: var(--surface2, var(--surface)); color: transparent;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border) 76%, transparent);
}
.co-project-icon img { display: block; width: 100%; height: 100%; object-fit: cover; }
.co-workspace-project > span:nth-child(2) { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.co-workspace-project strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.co-workspace-project small {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--muted); font-size: 10.5px;
}
.co-workspace-project em,
.co-workspace-task-top em {
  flex: 0 0 auto; padding: 5px 7px; border-radius: 999px;
  background: var(--surface2, var(--bg)); color: var(--muted);
  font-size: 9.5px; line-height: 1; font-style: normal; font-weight: 680;
  white-space: nowrap;
}
.co-workspace-project em.tone-accent,
.co-workspace-task.is-call .co-workspace-task-top em {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: color-mix(in srgb, var(--accent) 80%, var(--text));
}
.co-workspace-project em.tone-ok { background: color-mix(in srgb, var(--green) 11%, transparent); color: var(--green); }
.co-workspace-project em.tone-danger { background: color-mix(in srgb, var(--danger) 11%, transparent); color: color-mix(in srgb, var(--danger) 80%, var(--text)); }
.co-workspace-project em.tone-warn { color: var(--co-warn); }
.co-workspace-card-list { display: flex; flex-direction: column; gap: 8px; }
.co-workspace-task {
  display: flex; flex-direction: column; align-items: flex-start; gap: 9px;
  width: 100%; padding: 13px 14px; color: var(--text); font: inherit; text-align: left;
}
button.co-workspace-task { cursor: pointer; }
.co-workspace-task.is-call {
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  background: color-mix(in srgb, var(--accent) 5%, var(--surface));
}
.co-workspace-task-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; }
.co-workspace-task-top strong { min-width: 0; font-size: 13px; line-height: 1.4; }
.co-workspace-task-top em.is-progress { color: var(--accent); }
.co-workspace-task-copy {
  display: block; margin: 0; color: var(--muted); font-size: 11.5px; line-height: 1.5;
}
.co-workspace-empty-row {
  display: flex; flex-direction: column; gap: 3px; min-height: 62px;
  justify-content: center; padding: 12px 14px;
}
.co-workspace-empty-row strong { font-size: 12.5px; }
.co-workspace-empty-row small { color: var(--muted); font-size: 11px; line-height: 1.45; }
.co-workspace-empty-row.is-clear strong { color: var(--green); }
.co-workspace-loading {
  display: flex; align-items: center; gap: 11px; min-height: 62px; padding: 11px 14px;
}
.co-workspace-loading > span:last-child { display: flex; flex-direction: column; gap: 2px; }
.co-workspace-loading strong { font-size: 12.5px; }
.co-workspace-loading small { color: var(--muted); font-size: 10.5px; }
.co-review-pipeline {
  width: 100%; display: grid; grid-template-columns: repeat(4, 1fr); padding: 0;
  color: inherit; cursor: pointer; overflow: hidden; text-align: left;
}
.co-review-step { min-width: 0; padding: 13px 11px; display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 2px 7px; }
.co-review-step + .co-review-step { border-left: 1px solid var(--border); }
.co-review-step .co-icon { grid-row: 1 / 3; color: var(--muted); }
.co-review-step strong { font-size: 15px; line-height: 1; }
.co-review-step small { color: var(--muted); font-size: 10px; white-space: nowrap; }
.co-review-step.is-progress .co-icon { color: var(--accent); }
.co-review-step.is-warn .co-icon { color: var(--co-warn); }
.co-review-step.is-clear .co-icon, .co-review-step.is-clear strong { color: var(--green); }
.co-incoming-list { overflow: hidden; }
.co-incoming-review { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px 12px; padding: 11px 12px; }
.co-incoming-review + .co-incoming-review { border-top: 1px solid var(--border); }
.co-incoming-review > span { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.co-incoming-review strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.co-incoming-review small { color: var(--muted); font-size: 10.5px; }
.co-incoming-review .co-btn { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.co-incoming-error { grid-column: 1 / -1; color: var(--danger) !important; }
.co-quality-pill { display: inline-flex; align-items: center; gap: 4px; width: max-content; color: var(--muted); font-size: 10.5px; font-weight: 650; }
.co-quality-pill.is-all_clear { color: var(--green); }
.co-quality-pill.is-changes_needed { color: var(--co-warn); }
.co-quality-pill.is-reviewing, .co-quality-pill.is-queued { color: var(--accent); }
@media (hover: hover) {
  .co-workspace-project:hover,
  button.co-workspace-task:hover,
  button.co-review-pipeline:hover { background: color-mix(in srgb, var(--accent) 5%, transparent); }
  .co-workspace-section-head button:hover { color: var(--text); }
}
@media (max-width: 520px) {
  .co-review-pipeline { grid-template-columns: repeat(2, 1fr); }
  .co-review-step:nth-child(3) { border-left: 0; border-top: 1px solid var(--border); }
  .co-review-step:nth-child(4) { border-top: 1px solid var(--border); }
}

/* Projects is a local-work index: a quiet lens rail, one contextual action,
   and a single coherent list rather than a dashboard or split pane. */
.co-projects-view,
.co-review-workspace,
.co-requests-workspace {
  width: min(100%, 760px); margin-inline: auto; padding: 4px 0 32px;
}
.co-view-heading {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 20px; margin: 0 0 25px;
}
.co-view-heading > div { min-width: 0; }
.co-view-heading h2 {
  margin: 0; font-size: clamp(22px, 3vw, 26px); line-height: 1.2;
  letter-spacing: -.03em; text-wrap: balance;
}
.co-view-heading p {
  max-width: 58ch; margin: 7px 0 0; color: var(--muted);
  font-size: 12.5px; line-height: 1.55; text-wrap: pretty;
}
.co-quiet-action,
.co-focus-back {
  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px;
  min-height: 44px; padding: 8px 2px; border: 0; background: transparent;
  color: var(--muted); font: inherit; font-size: 11.5px; font-weight: 650;
  cursor: pointer;
}
.co-view-note,
.co-view-warning {
  margin: -12px 0 18px; padding: 9px 11px; border-left: 2px solid var(--border);
  color: var(--muted); font-size: 11.5px; line-height: 1.5;
}
.co-view-warning { border-left-color: var(--co-warn); color: var(--text); }
.co-lens-nav,
.co-stage-nav {
  display: flex; align-items: stretch; gap: 22px; min-height: 44px;
  margin: 0 0 26px; overflow-x: auto; overflow-y: hidden;
  border-bottom: 1px solid var(--border); scrollbar-width: none;
  overscroll-behavior-inline: contain;
}
.co-lens-nav::-webkit-scrollbar,
.co-stage-nav::-webkit-scrollbar { display: none; }
.co-lens-nav button,
.co-stage-nav button {
  position: relative; flex: 0 0 auto; display: inline-flex; align-items: center;
  gap: 7px; min-height: 44px; padding: 5px 0 10px; border: 0;
  background: transparent; color: var(--muted); font: inherit;
  font-size: 11.5px; font-weight: 650; white-space: nowrap; cursor: pointer;
}
.co-lens-nav button::after,
.co-stage-nav button::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: -1px;
  height: 2px; border-radius: 3px 3px 0 0; background: transparent;
}
.co-lens-nav button.is-active,
.co-stage-nav button.is-active { color: var(--text); }
.co-lens-nav button.is-active::after,
.co-stage-nav button.is-active::after { background: var(--accent); }
.co-lens-nav b,
.co-stage-nav b {
  min-width: 18px; height: 18px; display: inline-flex; align-items: center;
  justify-content: center; padding: 0 5px; border-radius: 999px;
  background: var(--surface2, var(--surface)); color: var(--muted);
  font-size: 9.5px; font-variant-numeric: tabular-nums;
}
.co-stage-intro {
  display: flex; align-items: center; justify-content: space-between; gap: 24px;
  min-height: 76px; margin: 0 0 13px; padding: 3px 1px 17px;
}
.co-stage-intro > div:first-child { min-width: 0; }
.co-stage-intro h3 { margin: 0; font-size: 16px; line-height: 1.3; letter-spacing: -.015em; }
.co-stage-intro p { max-width: 55ch; margin: 4px 0 0; color: var(--muted); font-size: 11.5px; line-height: 1.5; text-wrap: pretty; }
.co-stage-action { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.co-stage-action > span { display: inline-flex; align-items: center; gap: 4px; color: var(--green); font-size: 9.5px; font-weight: 700; }
.co-stage-action.is-public > span { color: var(--co-warn); }
.co-stage-action .co-agent-handoff-error { max-width: 200px; }
.co-stage-note { margin: -7px 0 13px; color: var(--muted); font-size: 11.5px; }
.co-stage-empty {
  min-height: 230px; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 6px; border: 1px solid var(--border);
  border-radius: 15px; background: var(--surface); color: var(--muted);
  text-align: center; padding: 28px;
}
.co-stage-empty .co-icon { margin-bottom: 8px; color: var(--muted); }
.co-stage-empty.is-clear .co-icon { color: var(--green); }
.co-stage-empty strong { color: var(--text); font-size: 13px; }
.co-stage-empty span { max-width: 42ch; font-size: 11px; line-height: 1.5; text-wrap: pretty; }
.co-feed-loading {
  min-height: 42dvh; display: flex; align-items: center; justify-content: center;
  gap: 9px; color: var(--muted); font-size: 12px;
}
.co-project-index,
.co-review-list {
  overflow: hidden; border: 1px solid var(--border); border-radius: 15px;
  background: var(--surface);
}
.co-source-group { min-width: 0; }
.co-source-group + .co-source-group { border-top: 1px solid var(--border); }
.co-source-group-label {
  min-height: 36px; display: flex; align-items: center; padding: 8px 14px;
  background: var(--surface2, var(--surface)); color: var(--muted);
  font-size: 9.5px; font-weight: 720; letter-spacing: .045em;
  text-transform: uppercase;
}
.co-source-row-wrap + .co-source-row-wrap { border-top: 1px solid var(--border); }
.co-source-row {
  display: grid; grid-template-columns: 36px minmax(0, 1fr) auto;
  grid-template-rows: auto auto; align-items: center; gap: 3px 11px;
  width: 100%; min-height: 68px; padding: 11px 14px; border: 0;
  background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer;
}
.co-source-glyph {
  grid-column: 1; grid-row: 1 / 3; width: 36px; height: 36px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 10px; background: color-mix(in srgb, var(--accent) 11%, var(--surface2, var(--surface)));
  color: var(--accent); font-size: 13px; font-weight: 750;
}
.co-source-row-id { grid-column: 2; grid-row: 1; min-width: 0; }
.co-source-row-id strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.co-source-row-facts { grid-column: 2; grid-row: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 10.5px; }
.co-source-dot { grid-column: 3; grid-row: 1 / 3; width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
.co-source-dot.tone-accent { background: var(--accent); }
.co-source-dot.tone-ok { background: var(--green); }
.co-source-dot.tone-warn { background: var(--co-warn); }
.co-source-dot.tone-danger { background: var(--danger); }
.co-focus-view { width: min(100%, 780px); margin-inline: auto; }
.co-focus-back { margin: -8px 0 9px; color: var(--accent); }
.co-source-error,
.co-source-unavailable {
  border: 1px solid var(--border); border-radius: 12px; background: var(--surface);
  color: var(--muted); font-size: 12px; line-height: 1.5;
}
.co-source-error {
  display: flex; flex-direction: column; align-items: flex-start; gap: 7px;
  max-width: 520px; margin: 60px auto; padding: 18px;
}
.co-source-error strong { color: var(--text); font-size: 15px; }
.co-source-error p { margin: 0; }
.co-source-unavailable { margin: 12px 0 0; padding: 12px; }
@media (hover: hover) {
  .co-quiet-action:hover, .co-cycle-link:hover { color: var(--text); background: var(--surface2, var(--surface)); }
  .co-lens-nav button:hover, .co-stage-nav button:hover { color: var(--text); }
  .co-source-row:hover { background: color-mix(in srgb, var(--accent) 5%, transparent); }
}

.co-source-status {
  flex: 0 0 auto; max-width: 128px; padding: 5px 8px; border-radius: 999px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  background: var(--surface2, var(--bg)); color: var(--muted);
  font-size: 10px; line-height: 1; font-weight: 680;
}
.co-source-status.tone-accent { background: color-mix(in srgb, var(--accent) 13%, transparent); color: color-mix(in srgb, var(--accent) 80%, var(--text)); }
.co-source-status.tone-ok { background: color-mix(in srgb, var(--green) 12%, transparent); color: var(--green); }
.co-source-status.tone-warn { background: color-mix(in srgb, var(--accent) 11%, transparent); color: var(--text); }
.co-source-status.tone-danger { background: color-mix(in srgb, var(--danger) 12%, transparent); color: color-mix(in srgb, var(--danger) 80%, var(--text)); }

.co-source-detail {
  min-width: 0; padding: 18px; border: 1px solid var(--border);
  border-radius: 15px; background: var(--surface);
}
.co-source-detail-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding-bottom: 12px; border-bottom: 1px solid var(--border);
}
.co-project-next {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  margin-top: 12px; padding: 12px; border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
}
.co-project-next > span { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.co-project-next strong { font-size: 13px; line-height: 1.4; text-wrap: pretty; }
.co-project-reviews { margin-top: 14px; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.co-project-reviews > header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 10px; background: var(--surface2, var(--bg)); }
.co-project-reviews > header strong { font-size: 11.5px; }
.co-project-reviews > header button { min-height: 44px; display: inline-flex; align-items: center; gap: 3px; padding: 7px 0; border: 0; background: transparent; color: var(--accent); font: inherit; font-size: 10px; cursor: pointer; }
.co-project-reviews > button { width: 100%; min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border: 0; border-top: 1px solid var(--border); background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.co-project-reviews > button span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.co-project-reviews > button small { flex: none; color: var(--muted); font-size: 9px; text-transform: capitalize; }
.co-source-detail-title { display: flex; align-items: center; gap: 9px; min-width: 0; }
.co-source-detail-title > div { min-width: 0; }
.co-source-detail-title h3 { margin: 0; font-size: 16px; line-height: 1.3; overflow-wrap: anywhere; }
.co-source-overview-copy { margin: 12px 0 0; color: var(--muted); font-size: 13px; line-height: 1.55; text-wrap: pretty; }
.co-project-handoff {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  margin-top: 14px; padding: 12px 0;
  border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
}
.co-project-handoff > span {
  max-width: 54ch; color: var(--muted); font-size: 11.5px; line-height: 1.5;
}
.co-project-files { border-top: 1px solid var(--border); }
.co-project-files > header {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  min-height: 48px; padding: 4px 2px; color: var(--muted); font-size: 12.5px; font-weight: 650;
}
.co-project-files > header small { font-size: 9.5px; font-weight: 500; }
.co-project-file-list {
  margin-bottom: 3px; border: 1px solid var(--border); border-radius: 9px;
  overflow: hidden; background: var(--surface2, var(--bg));
}
.co-project-file {
  display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 7px 9px;
}
.co-project-file + .co-project-file { border-top: 1px solid var(--border); }
.co-project-file code {
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text); font-family: var(--mono, var(--font)); font-size: 10px;
}
.co-project-file-meta { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 7px; }
.co-project-file-meta > i {
  padding: 3px 5px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent); font-size: 8.5px; font-style: normal;
}
.co-project-file-meta > i.is-conflict { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }
.co-project-file-meta > i.is-incoming { color: var(--green); background: color-mix(in srgb, var(--green) 10%, transparent); }
.co-project-file-meta > i.is-compatible { color: var(--text); background: var(--surface); }
.co-project-file-meta > span { display: inline-flex; gap: 5px; color: var(--muted); font-size: 9px; }
.co-project-file-meta b { color: var(--green); font-weight: 600; }
.co-project-file-meta em { color: var(--danger); font-style: normal; }
.co-project-file-list > p {
  margin: 0; padding: 9px; border-top: 1px solid var(--border);
  color: var(--muted); font-size: 9.5px; text-align: center;
}
.co-project-files-toggle {
  display: flex; align-items: center; justify-content: center; gap: 7px;
  width: 100%; min-height: 44px; margin-top: 3px; padding: 7px;
  border: 0; background: transparent; color: var(--accent);
  font: inherit; font-size: 10.5px; cursor: pointer;
}
.co-project-files-toggle .co-icon { transition: transform .16s ease; }
.co-project-files-toggle[aria-expanded="true"] .co-icon { transform: rotate(180deg); }

.co-local-position {
  display: flex; flex-direction: column; gap: 3px; margin-top: 14px;
  padding: 13px 2px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
}
.co-local-position strong { font-size: 12.5px; }
.co-local-position span { color: var(--muted); font-size: 11px; line-height: 1.5; }

.co-position-details { border-top: 1px solid var(--border); }
.co-position-details > summary {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  min-height: 46px; padding: 4px 2px; list-style: none; cursor: pointer;
  color: var(--muted); font-size: 11.5px; font-weight: 650;
}
.co-position-details > summary::-webkit-details-marker { display: none; }
.co-position-details > summary .co-icon { transition: transform .16s ease; }
.co-position-details[open] > summary .co-icon { transform: rotate(180deg); }
.co-position-details dl { margin: 0 0 12px; }
.co-position-details dl > div {
  display: grid; grid-template-columns: minmax(92px, .45fr) minmax(0, 1fr);
  gap: 12px; padding: 7px 2px;
}
.co-position-details dl > div + div { border-top: 1px solid var(--border); }
.co-position-details dt { color: var(--muted); font-size: 10.5px; }
.co-position-details dd { min-width: 0; margin: 0; text-align: right; }
.co-position-details code {
  display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text); font-family: var(--mono, var(--font)); font-size: 10px;
}
.co-source-loading { display: flex; align-items: center; justify-content: center; gap: 12px; min-height: 48dvh; color: var(--muted); }
.co-source-loading > div { display: flex; flex-direction: column; gap: 3px; }
.co-source-loading strong { color: var(--text); font-size: 14px; }
.co-source-loading span:last-child { font-size: 12px; }
@keyframes co-spin { to { transform: rotate(360deg); } }
.ma-spinner { width: 24px; height: 24px; flex: 0 0 auto; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--accent) 18%, transparent); border-top-color: var(--accent); animation: co-spin .8s linear infinite; }
@media (prefers-reduced-motion: reduce) { .ma-spinner { animation: none; } }

/* Connection card. The dot is decorative — the text always carries the
   state, so color is never the only signal. */
.co-conn {
  display: flex; align-items: flex-start; gap: 10px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 13px; padding: 13px 14px;
}
.co-conn-dot {
  flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%;
  margin-top: 6px; background: var(--muted);
}
.co-conn-dot.is-ok { background: var(--green); }
.co-conn-dot.is-warn { background: var(--co-warn); }
.co-conn-dot.is-accent { background: var(--accent); }
.co-conn-body { min-width: 0; flex: 1; }
.co-conn-title { font-size: 14px; font-weight: 650; margin: 0 0 2px; }
.co-conn-text { margin: 0; font-size: 13px; line-height: 1.55; color: var(--muted); }
.co-conn-text strong { color: var(--text); font-weight: 650; }
.co-conn-text a, .co-conn-hint a { color: var(--accent); }
.co-conn.is-connected {
  display: block; padding: 0; border: 0; border-radius: 0; background: transparent;
}
.co-conn.is-toolbar { position: relative; }
.co-github-menu {
  min-height: 44px; max-width: 210px; display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 10px; border: 1px solid var(--border); border-radius: 12px;
  background: transparent; color: var(--muted); font: inherit; cursor: pointer;
  transition: color .14s ease, border-color .14s ease, background .14s ease;
}
.co-github-menu > .co-icon:first-child { flex: 0 0 auto; color: var(--text); }
.co-github-menu > span {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text); font-size: 12px; font-weight: 650;
}
.co-github-menu > .co-icon:last-child {
  flex: 0 0 auto; color: var(--muted); transition: transform .18s cubic-bezier(.16, 1, .3, 1);
}
.co-conn.is-open .co-github-menu {
  border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
  background: var(--surface);
}
.co-conn.is-open .co-github-menu > .co-icon:last-child { transform: rotate(180deg); }
@media (hover: hover) {
  .co-github-menu:hover {
    border-color: color-mix(in srgb, var(--accent) 36%, var(--border));
    background: var(--surface);
  }
}
.co-conn-settings {
  position: absolute; z-index: 50; top: calc(100% + 7px); right: 0;
  width: min(320px, calc(100vw - 24px));
  display: flex; flex-direction: column; gap: 0;
  padding: 7px; border: 1px solid var(--border); border-radius: 13px;
  background: var(--surface); box-shadow: 0 14px 36px color-mix(in srgb, #000 28%, transparent);
}
.co-autopilot-setting {
  display: flex; align-items: flex-start; gap: 9px;
  padding: 0 0 10px; border-bottom: 1px solid var(--border);
  color: var(--muted); cursor: pointer;
}
.co-autopilot-setting input { margin-top: 3px; cursor: pointer; }
.co-autopilot-setting > span {
  display: flex; flex-direction: column; gap: 2px; min-width: 0;
}
.co-autopilot-setting strong {
  color: var(--text); font-size: 13px; font-weight: 650;
}
.co-autopilot-setting small {
  font-size: 12px; line-height: 1.45; color: var(--muted);
}
.co-conn-settings .co-autopilot-setting {
  align-items: center; justify-content: space-between; gap: 12px;
  min-height: 44px; margin: 0; padding: 7px 8px; cursor: pointer;
}
.co-conn-settings .co-autopilot-setting > strong { color: var(--text); font-size: 12px; font-weight: 650; }
.co-setting-switch { position: relative; flex: 0 0 auto; width: 34px; height: 20px; display: block !important; }
.co-setting-switch input { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; margin: 0 !important; opacity: 0; cursor: pointer; }
.co-setting-switch i {
  position: absolute; inset: 0; border-radius: 999px; background: var(--border);
  transition: background .14s ease;
}
.co-setting-switch i::after {
  content: ''; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px;
  border-radius: 50%; background: var(--surface); box-shadow: 0 1px 3px color-mix(in srgb, #000 30%, transparent);
  transition: transform .18s cubic-bezier(.16, 1, .3, 1);
}
.co-setting-switch input:checked + i { background: var(--accent); }
.co-setting-switch input:checked + i::after { transform: translateX(14px); }
.co-setting-switch input:focus-visible + i { outline: 2px solid var(--accent); outline-offset: 2px; }
.co-method-setting {
  display: flex; flex-direction: column; gap: 7px; padding: 10px 8px;
  border-bottom: 1px solid var(--border);
}
.co-method-setting > strong { font-size: 11px; font-weight: 650; color: var(--muted); }
.co-method-options {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px; padding: 3px;
  border: 0; border-radius: 10px;
  background: var(--surface2, var(--bg));
}
.co-method-options > button {
  min-width: 0; min-height: 44px; padding: 8px; overflow: hidden;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  text-overflow: ellipsis; white-space: nowrap; border: 0; border-radius: 7px;
  background: transparent; color: var(--muted); font: inherit;
  font-size: 11px; font-weight: 650; cursor: pointer;
}
.co-method-options > button > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.co-method-options > button > .co-icon { flex: 0 0 auto; }
.co-method-options > button.is-active {
  background: var(--surface); color: var(--text);
  box-shadow: 0 1px 4px color-mix(in srgb, #000 20%, transparent);
}
.co-private-setting {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: 8px; padding: 9px 8px; border-bottom: 1px solid var(--border);
}
.co-private-setting > strong { color: var(--text); font-size: 11px; font-weight: 650; }
.co-private-setting .co-btn { min-height: 44px; padding: 8px 10px; font-size: 10.5px; }
.co-conn-settings > .co-conn-actions { padding: 7px 8px 2px; }
.co-conn-settings > .co-conn-actions .co-btn { min-height: 44px; padding: 8px 10px; font-size: 10.5px; }
.co-disconnect-confirm { width: 100%; display: flex; flex-direction: column; gap: 8px; }
.co-disconnect-confirm > p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.45; text-wrap: pretty; }

/* GitHub device flow, shown inline when disconnected. The card switches to a
   column layout so the controls stack; every control uses the shared theme
   tokens and a 44px min touch target. */
.co-conn.is-column { flex-direction: column; align-items: stretch; gap: 13px; }
.co-conn-row { display: flex; align-items: flex-start; gap: 10px; }
.co-conn-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.co-conn-body .co-conn-actions { margin-top: 10px; }
.co-mobius-route {
  display: flex; flex-direction: column; gap: 7px; padding: 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 26%, var(--border));
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));
}
.co-mobius-route .co-conn-note { margin: 0; font-size: 12px; }
.co-conn-divider {
  display: flex; align-items: center; gap: 10px; color: var(--muted);
  font-size: 11px; font-weight: 650; text-transform: uppercase;
  letter-spacing: .06em;
}
.co-conn-divider::before, .co-conn-divider::after {
  content: ''; flex: 1; height: 1px; background: var(--border);
}
.co-conn-device { display: flex; flex-direction: column; gap: 10px; }
.co-conn-steps {
  display: flex; flex-direction: column; gap: 10px;
  margin: 0; padding: 0; list-style: none;
}
.co-conn-step {
  display: flex; flex-direction: column; gap: 10px; padding: 12px;
  border: 1px solid var(--border); border-radius: 12px;
  background: color-mix(in srgb, var(--surface2, var(--surface)) 66%, transparent);
}
.co-conn-step-head { display: flex; align-items: flex-start; gap: 9px; }
.co-conn-step-head > div {
  display: flex; flex-direction: column; gap: 2px; min-width: 0;
}
.co-conn-step-head strong { font-size: 13px; line-height: 1.35; color: var(--text); }
.co-conn-step-head small { font-size: 11.5px; line-height: 1.4; color: var(--muted); }
.co-conn-step-number {
  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: 23px; height: 23px; border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent); font-size: 11px; font-weight: 750;
}
.co-conn-code-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: stretch;
  gap: 8px;
}

/* mobius-ui:Button v1 — app-owned copy; library candidate. */
.co-btn {
  display: inline-flex; align-items: center; justify-content: center;
  min-height: 44px; padding: 10px 16px; border-radius: 10px;
  border: 1px solid var(--border); background: var(--surface); color: var(--text);
  font-family: var(--font); font-size: 14px; font-weight: 500; cursor: pointer;
  transition: background .14s ease, border-color .14s ease, transform .1s ease;
}
.co-btn:active { transform: scale(0.97); }
.co-btn:disabled { opacity: 0.5; cursor: default; }
.co-btn-primary { background: var(--accent-hover, var(--accent)); border-color: var(--accent-hover, var(--accent)); color: var(--accent-fg); }
.co-btn-danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); }
.co-btn-sm { min-height: 44px; padding: 9px 12px; font-size: 13px; }
.co-btn-block { width: 100%; }
@media (hover: hover) {
  .co-btn:not(:disabled):hover {
    border-color: color-mix(in srgb, var(--accent) 34%, var(--border));
    background: var(--surface2, var(--surface));
  }
  .co-btn-primary:not(:disabled):hover {
    border-color: color-mix(in srgb, var(--accent-hover, var(--accent)) 90%, var(--text));
    background: color-mix(in srgb, var(--accent-hover, var(--accent)) 90%, var(--text));
  }
  .co-btn-danger:not(:disabled):hover {
    border-color: color-mix(in srgb, var(--danger) 62%, var(--border));
    background: color-mix(in srgb, var(--danger) 8%, var(--surface));
  }
}
/* /mobius-ui:Button */

.co-agent-handoff { flex: 0 0 auto; display: flex; flex-direction: column; align-items: stretch; gap: 5px; }
.co-agent-handoff-error {
  max-width: 230px; margin: 0; color: var(--danger); font-size: 10.5px;
  line-height: 1.35; text-align: right;
}
.co-agent-started {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  width: 100%; padding-top: 2px;
}
.co-agent-started > span { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.co-agent-started strong { color: var(--green); font-size: 11.5px; line-height: 1.35; }
.co-agent-started small { max-width: 48ch; color: var(--muted); font-size: 10.5px; line-height: 1.4; }
.co-agent-chat-link {
  flex: 0 0 auto; min-height: 40px; padding: 7px 3px; border: 0;
  background: transparent; color: var(--accent); font: inherit;
  font-size: 10.5px; font-weight: 680; cursor: pointer;
}

/* The one-time device code stays genuinely selectable as a fallback when a
   sandboxed browser does not grant clipboard access. */
.co-conn-code {
  display: flex; align-items: center; justify-content: center; min-width: 0;
  font-family: var(--mono, var(--font)); font-size: clamp(21px, 7vw, 28px); font-weight: 700;
  letter-spacing: 0; text-align: center; padding: 10px 8px;
  border-radius: 10px; background: var(--surface2, var(--bg));
  border: 1px dashed var(--border); color: var(--text);
  user-select: text; -webkit-user-select: text; cursor: text;
}
.co-conn-copy { white-space: nowrap; }
.co-conn-copy-status { min-height: 18px; margin: -4px 0 0; font-size: 12px; color: var(--muted); }
.co-conn-wait { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.co-conn-waiting { margin: 0; font-size: 13px; color: var(--muted); }
.co-conn-hint { margin: 0; font-size: 12.5px; color: var(--muted); line-height: 1.5; }
.co-conn-hint code {
  font-family: var(--mono, var(--font)); font-size: 12px;
  padding: 1px 5px; border-radius: 5px;
  background: color-mix(in srgb, var(--text) 8%, transparent);
}
.co-conn-error { margin: 2px 0 0; font-size: 13px; color: var(--danger); line-height: 1.45; }
.co-conn-note { margin: 2px 0 0; font-size: 13px; color: var(--muted); line-height: 1.45; }
.co-section { margin-top: 24px; }
.co-section-headline { display: flex; align-items: center; gap: 8px; }
.co-section-headline > span {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px;
  background: var(--surface2, var(--surface)); color: var(--muted);
  font-size: 10.5px; font-variant-numeric: tabular-nums;
}
.co-section-title { margin: 0; font-size: 14px; font-weight: 680; color: var(--text); letter-spacing: -0.01em; }
.co-section-hint { margin: 3px 0 0; font-size: 12px; color: var(--muted); }
.co-section.is-follow-up .co-section-headline > span {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}
.co-history {
  border: 1px solid var(--border); border-radius: 13px; overflow: hidden;
  background: var(--surface);
}
.co-history > summary {
  min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 11px 14px; list-style: none; cursor: pointer;
}
.co-history > summary::-webkit-details-marker { display: none; }
.co-history > summary > span { font-size: 14px; font-weight: 680; }
.co-history > summary > small { color: var(--muted); font-size: 11.5px; }
.co-history-chevron { color: var(--muted); width: 19px; height: 19px; transform: rotate(90deg); transition: transform .15s ease; }
.co-history[open] > summary { border-bottom: 1px solid var(--border); }
.co-history[open] .co-history-chevron { transform: rotate(-90deg); }
.co-history-feed { display: flex; flex-direction: column; }
.co-history-feed .co-card {
  margin: 0; border: 0; border-radius: 0; padding: 13px 14px;
}
.co-history-feed .co-card + .co-card { border-top: 1px solid var(--border); }

/* mobius-ui:Card v1 — app-owned copy; library candidate. */
.co-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 13px; padding: 14px 15px; margin-top: 9px;
}
.co-card.is-blocked { border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); }
/* /mobius-ui:Card */

/* A stack is one approval surface containing individually reviewable layers.
   The top rail makes the Git base topology legible before any public action. */
.co-stack-card {
  margin-top: 9px; padding: 14px; border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--accent) 36%, var(--border));
  background: linear-gradient(
    155deg,
    color-mix(in srgb, var(--accent) 7%, var(--surface)),
    var(--surface) 42%
  );
}
.co-stack-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
}
.co-stack-head h3 { margin: 2px 0 0; font-size: 16px; line-height: 1.3; }
.co-stack-head p { margin: 4px 0 0; color: var(--muted); font-size: 11.5px; }
.co-stack-kicker {
  color: var(--accent); font-size: 10px; font-weight: 750;
  text-transform: uppercase; letter-spacing: .055em;
}
.co-stack-rail {
  display: flex; flex-direction: column; gap: 0; margin: 13px 0 2px;
  padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border));
  border-radius: 10px; background: color-mix(in srgb, var(--bg) 74%, transparent);
}
.co-stack-node {
  position: relative; display: grid;
  grid-template-columns: 13px 40px minmax(0, .72fr) auto minmax(0, 1fr);
  align-items: center; gap: 7px; min-height: 28px;
  color: var(--muted); font-size: 9.5px;
}
.co-stack-node:not(:last-child)::before {
  content: ''; position: absolute; left: 5px; top: 17px; bottom: -11px;
  border-left: 2px solid color-mix(in srgb, var(--accent) 35%, var(--border));
}
.co-stack-node-dot {
  position: relative; z-index: 1; width: 11px; height: 11px; border-radius: 50%;
  border: 2px solid var(--accent); background: var(--surface);
}
.co-stack-node-layer { color: var(--accent); font-weight: 700; }
.co-stack-node code {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--muted); font-family: var(--mono, var(--font)); font-size: 9.5px;
}
.co-stack-node code:last-child { color: var(--text); }
.co-stack-details { margin-top: 8px; }
.co-stack-details > summary {
  display: inline-flex; align-items: center; gap: 5px; min-height: 44px;
  margin: -5px 0; padding: 5px 3px; border-radius: 8px;
  list-style: none; color: var(--muted); font-size: 12.5px;
  font-weight: 650; cursor: pointer;
}
.co-stack-details > summary::-webkit-details-marker { display: none; }
.co-stack-details > summary .co-icon { transition: transform .16s ease; }
.co-stack-details[open] > summary .co-icon { transform: rotate(180deg); }
.co-stack-details-body { padding-top: 1px; }
.co-stack-layers { margin: 4px 0 0 14px; padding-left: 13px; border-left: 2px solid var(--border); }
.co-stack-layers .co-card { border-radius: 10px; background: var(--surface); }
.co-card.is-stack-layer { box-shadow: none; }
.co-stack-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
.co-stack-warning {
  display: flex; flex-direction: column; gap: 3px; margin-top: 12px; padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px; background: color-mix(in srgb, var(--text) 4%, var(--surface));
  color: var(--muted); font-size: 12px; line-height: 1.45;
}
.co-stack-warning strong { color: var(--text); font-size: 12.5px; }
/* Calm, in-progress waiting (checks running, landing underway) — never alarm. */
.co-stack-warning.is-progress { border-color: color-mix(in srgb, var(--accent) 26%, var(--border)); }
.co-stack-warning.is-progress strong { color: var(--accent); }
/* Advisory attention (a check to look at) — caution amber, not error red. */
.co-stack-warning.is-attention {
  border-color: color-mix(in srgb, var(--co-warn) 34%, var(--border));
  background: color-mix(in srgb, var(--co-warn) 8%, var(--surface));
}
.co-stack-warning.is-attention strong { color: var(--co-warn); }
/* Genuine failure or a broken chain — the only stack banner that earns red. */
.co-stack-warning.is-error {
  border-color: color-mix(in srgb, var(--danger) 34%, var(--border));
  background: color-mix(in srgb, var(--danger) 7%, var(--surface));
}
.co-stack-warning.is-error strong { color: var(--danger); }
/* Row of GitHub merge links for a stack that lands through GitHub's merge/queue. */
.co-stack-merge-links { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
.co-stack-confirm {
  margin-top: 12px; padding: 12px; border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--border));
  background: var(--surface);
}
.co-stack-confirm > strong { font-size: 14px; }
.co-stack-confirm > p { margin: 5px 0 10px; color: var(--muted); font-size: 12px; line-height: 1.5; }
.co-stack-confirm-details { margin-bottom: 10px; }
.co-stack-confirm-details > summary {
  min-height: 40px; display: flex; align-items: center; cursor: pointer;
  color: var(--muted); font-size: 12px;
}
.co-stack-confirm ol { margin: 0; padding: 0; list-style: none; }
.co-stack-confirm li { display: flex; flex-direction: column; gap: 3px; padding: 8px 0; }
.co-stack-confirm li + li { border-top: 1px solid var(--border); }
.co-stack-confirm li span { font-size: 12px; font-weight: 650; }
.co-stack-confirm li code {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--muted); font-family: var(--mono, var(--font)); font-size: 9.5px;
}

.co-card-top {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 10px;
}
.co-card-heading { min-width: 0; margin: 0; font: inherit; }
.co-card-title {
  font-size: 15px; font-weight: 650; line-height: 1.35; color: var(--text);
  text-decoration: none; min-width: 0; overflow-wrap: anywhere;
  /* generous tap area for the text link without shifting layout */
  padding: 4px 0; margin: -4px 0;
}
@media (hover: hover) {
  a.co-card-title:hover { text-decoration: underline; }
}
.co-chip {
  flex: 0 0 auto; font-size: 11px; font-weight: 650; line-height: 1;
  padding: 5px 9px; border-radius: 999px;
  background: var(--surface2, var(--surface)); color: var(--muted);
}
.co-chip.is-prepared,
.co-chip.is-submitting,
.co-chip.is-open {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}
.co-chip.is-merged,
.co-chip.is-superseded {
  background: color-mix(in srgb, var(--green) 14%, transparent);
  color: var(--green);
}
.co-chip.is-needs-refresh {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}
/* The one plain-language line under the chip: what this state means for the
   owner, in a calm muted voice below the title. */
.co-card-status { margin: 5px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--muted); }
.co-card-summary { margin: 6px 0 0; font-size: 13px; line-height: 1.5; text-wrap: pretty; }
.co-card-summary.is-clamped {
  display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical;
  -webkit-line-clamp: 2; color: var(--muted);
}
.co-card-meta {
  display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;
  font-size: 12px; color: var(--muted);
}
/* Collapsed prepared card: one muted meta line + one mono diffline. The pill
   stack and the collapsed co-author tag are gone (co-author now lives in the
   expanded review). */
.co-technical-summary {
  display: flex; flex-direction: column; align-items: stretch; gap: 6px;
  margin-top: 9px;
}
.co-plan-meta {
  display: flex; align-items: baseline; gap: 6px; min-width: 0;
  font-size: 12px; line-height: 1.4; color: var(--muted);
}
.co-plan-meta-repo,
.co-plan-meta-time { flex: 0 0 auto; white-space: nowrap; }
.co-plan-meta-branch {
  flex: 0 1 auto; min-width: 0; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
  font-family: var(--mono, var(--font));
  color: color-mix(in srgb, var(--muted) 85%, var(--text));
}
.co-plan-meta-sep {
  flex: 0 0 auto; color: color-mix(in srgb, var(--muted) 55%, transparent);
}
.co-diffline {
  display: inline-flex; align-items: baseline; gap: 9px;
  font-family: var(--mono, var(--font)); font-size: 12px; line-height: 1.3;
}
.co-diffline-files { color: var(--muted); }
.co-diffline-add { color: color-mix(in srgb, var(--green) 82%, var(--text)); font-weight: 650; }
.co-diffline-del { color: color-mix(in srgb, var(--danger) 80%, var(--text)); font-weight: 650; }

/* Persisted submit error — calm, actionable, with technical detail secondary. */
.co-alert {
  align-self: stretch; margin-top: 10px; padding: 9px 11px;
  display: flex; flex-direction: column; gap: 6px;
  border-radius: 9px;
  border: 1px solid color-mix(in srgb, var(--danger) 20%, var(--border));
  background: color-mix(in srgb, var(--danger) 5%, var(--surface));
}
.co-alert-text {
  margin: 0; font-size: 12.5px; line-height: 1.45; overflow-wrap: anywhere;
  color: color-mix(in srgb, var(--danger) 88%, var(--text));
}
.co-alert > strong { color: var(--text); font-size: 13px; line-height: 1.35; }
.co-alert-reassurance { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
.co-alert .co-btn { align-self: flex-start; }
.co-alert.is-follow-up {
  border-color: color-mix(in srgb, var(--accent) 24%, var(--border));
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));
}
.co-alert.is-follow-up .co-alert-text {
  color: color-mix(in srgb, var(--accent) 72%, var(--text));
}
.co-alert.is-passed {
  border-color: color-mix(in srgb, var(--green) 32%, var(--border));
  background: color-mix(in srgb, var(--green) 7%, var(--surface));
}
.co-alert.is-passed > strong { color: var(--green); }
/* The raw Git message, tucked behind a Details disclosure under the headline. */
.co-alert-details > summary {
  cursor: pointer; font-size: 12px; color: var(--muted); min-height: 38px;
  display: inline-flex; align-items: center; list-style: none;
}
.co-alert-details > summary::-webkit-details-marker { display: none; }
.co-alert-details[open] > summary { margin-bottom: 5px; }
.co-alert-details > .co-alert-text { margin: 0; }

.co-attention {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
  margin-top: 10px; padding: 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));
}
.co-attention-copy {
  min-width: 0; display: flex; flex-direction: column; gap: 4px;
}
.co-attention-title {
  font-size: 13px; font-weight: 700; color: var(--text); line-height: 1.3;
}
.co-attention-text {
  margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--muted);
  overflow-wrap: anywhere;
}

.co-reconciliation-hint {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
  margin-bottom: 10px; padding: 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
}
.co-reconciliation-hint > div {
  min-width: 0; display: flex; flex-direction: column; gap: 4px;
}
.co-reconciliation-hint strong {
  font-size: 13px; line-height: 1.35; color: var(--text);
}
.co-reconciliation-hint p {
  margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--muted);
}
.co-reconciliation-hint a {
  align-self: flex-start; font-size: 12px; color: var(--accent);
  text-underline-offset: 2px;
}
.co-reconciliation-hint .co-btn { flex: 0 0 auto; }

/* Review view: the staged plan a prepared card expands into. Prose stays in
   the app font; the diff is monospace and scrolls INSIDE its own block (both
   axes) so a wide hunk never stretches the card or the page. */
.co-review {
  display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
  margin-top: 10px; padding-top: 12px; border-top: 1px solid var(--border);
}
.co-review-badge {
  font-size: 11px; font-weight: 650; line-height: 1; padding: 5px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}
.co-review-title { font-size: 14px; font-weight: 650; line-height: 1.4; }
.co-review-coauthor {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 28px; padding: 5px 9px; border-radius: 8px;
  background: color-mix(in srgb, var(--green) 12%, transparent);
  color: var(--green); font-size: 12px; line-height: 1.2;
}
.co-review-coauthor strong { color: var(--green); font-weight: 700; }
.co-publication-review {
  align-self: stretch; display: grid; grid-template-columns: auto minmax(0, 1fr);
  gap: 10px; padding: 11px 12px; border: 1px solid var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));
}
.co-publication-review > span {
  align-self: start; padding: 4px 7px; border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 13%, transparent);
  color: var(--accent); font-size: 10px; font-weight: 750;
  line-height: 1.2; letter-spacing: .035em; text-transform: uppercase;
  white-space: nowrap;
}
.co-publication-review > div { min-width: 0; }
.co-publication-review strong {
  display: block; font-size: 13px; line-height: 1.35; color: var(--text);
}
.co-publication-review p {
  margin: 3px 0 0; color: var(--muted); font-size: 12px; line-height: 1.45;
}
.co-prior-work {
  align-self: stretch; display: flex; flex-direction: column; gap: 9px;
  padding: 11px 12px; border: 1px solid var(--border); border-radius: 10px;
  background: color-mix(in srgb, var(--green) 6%, var(--surface));
}
.co-prior-work-head { display: flex; align-items: flex-start; gap: 9px; }
.co-prior-work-check {
  width: 22px; height: 22px; flex: 0 0 22px; display: grid; place-items: center;
  border-radius: 7px; background: color-mix(in srgb, var(--green) 14%, transparent);
  color: var(--green); font-size: 12px; font-weight: 800;
}
.co-prior-work-head > div { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.co-prior-work-head strong { font-size: 13px; line-height: 1.35; }
.co-prior-work-head span { color: var(--muted); font-size: 12px; line-height: 1.4; }
.co-prior-work > p { margin: 0; color: var(--text); font-size: 12.5px; line-height: 1.5; }
.co-prior-work-details { border-top: 1px solid var(--border); }
.co-prior-work-details > summary {
  min-height: 38px; display: flex; align-items: center; cursor: pointer;
  list-style: none; color: var(--muted); font-size: 12px;
}
.co-prior-work-details > summary::-webkit-details-marker { display: none; }
.co-prior-work-chevron {
  margin-left: auto; color: var(--muted); width: 18px; height: 18px;
  transform: rotate(0); transition: transform .14s ease;
}
.co-prior-work-details[open] .co-prior-work-chevron { transform: rotate(90deg); }
.co-prior-work-details > div { display: flex; flex-direction: column; gap: 8px; padding-bottom: 2px; }
.co-prior-work-query {
  display: flex; align-items: baseline; gap: 8px; min-width: 0;
  color: var(--muted); font-size: 11px;
}
.co-prior-work-query code {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text); font-family: var(--mono, var(--font)); font-size: 11.5px;
}
.co-prior-work-links { margin: 0; padding-left: 20px; font-size: 12.5px; }
.co-prior-work-links li + li { margin-top: 6px; }
.co-prior-work-links a { color: var(--accent); overflow-wrap: anywhere; }
.co-prior-work-links span { display: block; margin-top: 1px; color: var(--muted); line-height: 1.4; }
.co-prior-work-more { color: var(--muted); font-size: 11.5px; }
.co-plan-labels {
  display: flex; flex-direction: column; align-items: stretch; gap: 7px; margin: 10px 0 14px;
  color: var(--muted); font-size: 11px;
}
.co-plan-labels-row { display: flex; align-items: center; gap: 10px; }
.co-plan-labels-row > div { display: flex; flex-wrap: wrap; gap: 6px; }
.co-plan-label {
  display: inline-flex; align-items: center; min-height: 24px; padding: 2px 9px;
  max-width: 100%; overflow-wrap: anywhere;
  border: 1px solid color-mix(in srgb, var(--accent) 32%, var(--border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 9%, transparent);
  color: color-mix(in srgb, var(--accent) 72%, var(--text));
  font-weight: 650;
}
.co-plan-label.is-muted {
  border-color: var(--border);
  background: color-mix(in srgb, var(--text) 5%, transparent);
  color: var(--muted);
}
.co-label-outcome {
  align-self: stretch; display: flex; flex-direction: column; gap: 8px;
  margin: 10px 0 14px; padding: 10px 11px; border-radius: 9px;
  background: color-mix(in srgb, var(--green) 7%, var(--surface));
}
.co-label-outcome.needs-attention {
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
}
.co-label-outcome > strong { font-size: 12.5px; line-height: 1.35; }
.co-label-outcome-row {
  display: flex; align-items: flex-start; gap: 10px; color: var(--muted);
  font-size: 11px; line-height: 24px;
}
.co-label-outcome-row > span { flex: 0 0 92px; white-space: nowrap; }
.co-label-outcome-row > div { min-width: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.co-label-outcome-note,
.co-label-outcome-guidance {
  margin: 0; color: var(--muted); font-size: 12px; line-height: 1.45;
  overflow-wrap: anywhere;
}
.co-label-outcome-guidance { color: var(--text); }
/* One calm reassurance line above the diff, backed by the source-only
   allowlist. Muted, not a banner — it states what is already guaranteed. */
.co-review-assurance {
  align-self: stretch; margin: 0; font-size: 12.5px; line-height: 1.5;
  color: var(--muted);
}
.co-review-changes-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 2px 0 8px; }
.co-review-changes-head strong { font-size: 13px; }
.co-review-changes-head span {
  max-width: 62%; overflow-wrap: anywhere; text-align: right;
  color: var(--muted); font-size: 9.5px; line-height: 1.35;
}
.co-pr-metadata { margin-top: 12px; border-top: 1px solid var(--border); }
.co-pr-metadata > summary { min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 8px; list-style: none; color: var(--muted); font-size: 11px; font-weight: 650; cursor: pointer; }
.co-pr-metadata > summary::-webkit-details-marker { display: none; }
.co-pr-metadata > summary .co-icon { transition: transform .16s ease; }
.co-pr-metadata[open] > summary .co-icon { transform: rotate(180deg); }
.co-pr-metadata-body { padding-bottom: 4px; }
.co-review-section {
  align-self: stretch; display: flex; flex-direction: column; gap: 8px;
}
.co-review-section-title {
  font-size: 12px; font-weight: 650; color: var(--muted);
}
.co-markdown {
  font-size: 13px; line-height: 1.58; color: var(--text);
  overflow-wrap: anywhere;
}
.co-markdown > * { margin: 0; }
.co-markdown > * + * { margin-top: 9px; }
.co-markdown h1,
.co-markdown h2,
.co-markdown h3 {
  font-size: 14px; line-height: 1.35; font-weight: 700; text-wrap: balance;
}
.co-markdown ul,
.co-markdown ol { padding-left: 20px; }
.co-markdown li + li { margin-top: 4px; }
.co-markdown a { color: var(--accent); }
.co-markdown code {
  font-family: var(--mono, var(--font)); font-size: 12px;
  padding: 1px 5px; border-radius: 5px;
  background: color-mix(in srgb, var(--text) 9%, transparent);
}
.co-markdown pre {
  overflow: auto; padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--surface2, var(--bg));
}
.co-markdown pre code {
  display: block; padding: 0; background: transparent; white-space: pre;
}
.co-markdown blockquote {
  margin: 0; padding: 0 0 0 12px; border-left: 1px solid var(--border);
  color: var(--muted);
}
/* Stored contribution totals frame the canonical diff viewer, whose
   disclosures and line styles are injected by ui/diff. */
.co-files {
  align-self: stretch;
  border: 1px solid var(--border); border-radius: 10px; overflow: hidden;
  background: var(--surface);
}
.co-files-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  min-height: 40px; padding: 9px 12px; border-bottom: 1px solid var(--border);
  background: var(--surface2, var(--bg));
  font-family: var(--mono, var(--font)); font-size: 12px;
}
.co-files-count { color: var(--muted); font-weight: 650; }
.co-file-stat {
  display: inline-flex; align-items: baseline; gap: 6px;
  font-family: var(--mono, var(--font)); font-size: 12px;
}
.co-file-add { color: var(--green); font-weight: 650; }
.co-file-del { color: var(--danger); font-weight: 650; }
.co-files-note {
  margin: 0; padding: 9px 12px; border-top: 1px solid var(--border);
  font-size: 12px; line-height: 1.45; color: var(--muted);
}

.co-review-link {
  display: inline-flex; align-items: center; min-height: 44px;
  margin-block: -7px; padding-block: 7px; font-size: 13px; color: var(--accent);
}
/* Compact card footer: details stay readable while the three familiar actions
   remain real 44px tap targets instead of stretching into unlabeled bars. */
.co-card-footer {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  margin-top: 11px; padding-top: 9px; border-top: 1px solid var(--border);
}
.co-card-footer.is-actions-only { justify-content: flex-end; }
.co-card-footer.is-reconciliation {
  align-items: stretch; flex-direction: column;
}
.co-card-footer.is-reconciliation .co-details-toggle { align-self: flex-start; }
.co-card-footer.is-reconciliation .co-action-block { width: 100%; align-items: stretch; }
.co-action-block {
  min-width: 0; display: flex; flex: 0 1 auto; flex-direction: column;
  align-items: flex-end; gap: 7px;
}
.co-details-toggle {
  display: inline-flex; align-items: center; gap: 5px; min-height: 44px;
  margin: -7px 0; padding: 7px 4px; border: 0; border-radius: 8px;
  background: transparent; color: var(--muted); font: inherit;
  font-size: 12.5px; font-weight: 650; cursor: pointer;
}
.co-details-toggle > span:last-child {
  display: inline-flex; transition: transform .16s ease;
}
.co-details-toggle > span:last-child.is-open { transform: rotate(180deg); }
@media (hover: hover) {
  .co-details-toggle:hover { color: var(--text); }
}
.co-review-actions {
  align-self: auto; display: flex; align-items: center; justify-content: flex-end;
  gap: 6px; margin-left: auto;
}
.co-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 44px; height: 44px; flex: 0 0 44px; padding: 0;
  border: 1px solid var(--border); border-radius: 10px;
  background: var(--surface2, var(--surface)); color: var(--muted);
  font: inherit; cursor: pointer;
  transition: color .14s ease, border-color .14s ease, background .14s ease, transform .1s ease;
}
.co-send-btn {
  width: auto; min-width: 76px; flex: 0 0 auto; padding: 0 12px; gap: 7px;
  font-size: 12.5px; font-weight: 700; white-space: nowrap;
}
.co-refresh-btn {
  width: auto; min-width: 132px; padding: 0 12px; gap: 7px;
  font-size: 12.5px; font-weight: 700;
}
.co-check-btn {
  width: auto; min-width: 68px; padding: 0 11px; gap: 7px;
  color: var(--accent); font-size: 12.5px; font-weight: 700;
}
.co-secondary-action {
  width: auto; padding: 0 11px; gap: 7px;
  font-size: 12.5px; font-weight: 700;
}
.co-icon-btn.is-primary {
  border-color: color-mix(in srgb, var(--accent) 38%, var(--border));
  background: color-mix(in srgb, var(--accent) 11%, var(--surface));
  color: var(--accent);
}
.co-icon-btn.is-danger {
  margin-left: 2px;
  border-color: color-mix(in srgb, var(--danger) 32%, var(--border));
  background: color-mix(in srgb, var(--danger) 8%, var(--surface));
  color: var(--danger);
}
.co-icon-btn:active { transform: scale(.96); }
.co-icon-btn:disabled { opacity: .45; cursor: default; transform: none; }
.co-icon-btn.is-sending:disabled,
.co-btn.is-sending:disabled { opacity: 1; cursor: progress; }
@media (hover: hover) {
  .co-icon-btn:hover {
    border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
    color: var(--text);
  }
  .co-icon-btn.is-primary:hover { color: var(--accent); }
  .co-icon-btn.is-danger:hover {
    border-color: color-mix(in srgb, var(--danger) 30%, var(--border));
    background: color-mix(in srgb, var(--danger) 8%, transparent);
    color: var(--danger);
  }
}
.co-icon { display: block; pointer-events: none; }
.co-action-label { position: relative; display: inline-block; white-space: nowrap; }
.co-action-label-sweep { display: none; }
@media (prefers-reduced-motion: no-preference) {
  @supports ((-webkit-mask-image: linear-gradient(#000, #000)) or (mask-image: linear-gradient(#000, #000))) {
    .is-sending .co-action-label-sweep {
      display: block; position: absolute; inset: 0; overflow: hidden;
      pointer-events: none; white-space: nowrap;
      color: color-mix(in srgb, var(--text) 88%, var(--accent));
      -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 18%, #000 32%, transparent 50%);
      mask-image: linear-gradient(90deg, transparent 0%, #000 18%, #000 32%, transparent 50%);
      -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
      -webkit-mask-size: 300% 100%; mask-size: 300% 100%;
      animation: co-action-sweep 2.4s steps(48, end) infinite;
    }
    .co-btn-primary.is-sending .co-action-label-sweep {
      color: color-mix(in srgb, var(--accent-fg) 86%, white);
    }
  }
}
@keyframes co-action-sweep {
  0% { -webkit-mask-position: 120% 0; mask-position: 120% 0; }
  42% { -webkit-mask-position: -50% 0; mask-position: -50% 0; }
  100% { -webkit-mask-position: -50% 0; mask-position: -50% 0; }
}
@media (forced-colors: active) {
  .co-action-label-sweep { display: none !important; }
}
/* Two-tap confirmation before moving active work to History. The action is
   reversible, so it reads as caution rather than permanent deletion. */
.co-confirm {
  display: flex; flex-direction: column; gap: 10px; padding: 12px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--co-warn) 34%, var(--border));
  background: color-mix(in srgb, var(--co-warn) 7%, var(--surface));
}
.co-confirm-text { margin: 0; font-size: 14px; line-height: 1.45; color: var(--text); }
.co-confirm-actions { display: flex; gap: 8px; }
.co-confirm-actions .co-btn { flex: 1 1 0; min-width: 0; }
.co-btn-caution {
  color: var(--co-warn);
  border-color: color-mix(in srgb, var(--co-warn) 42%, var(--border));
}
.co-confirm.is-safe {
  border-color: color-mix(in srgb, var(--accent) 34%, var(--border));
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
}
/* Restore lives on an archived card in History — a single, content-width button. */
.co-history-actions { display: flex; gap: 8px; margin-top: 2px; }
.co-publication-action {
  display: flex; flex-direction: column; align-items: flex-start; gap: 5px;
  margin: 10px 0 2px; padding: 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
}
.co-publication-action > span {
  color: var(--accent); font-size: 10px; font-weight: 750;
  letter-spacing: .055em; line-height: 1.2; text-transform: uppercase;
}
.co-publication-action > strong {
  color: var(--text); font-size: 13px; line-height: 1.4;
}
.co-publication-action > p:not(.co-review-error) {
  margin: 0; color: var(--muted); font-size: 12px; line-height: 1.48;
}
.co-publication-action > .co-btn { margin-top: 4px; }
.co-publication-action.is-connected {
  border-color: color-mix(in srgb, var(--green) 35%, var(--border));
  background: color-mix(in srgb, var(--green) 7%, var(--surface));
}
.co-publication-action.is-connected > span { color: var(--green); }
.co-publication-action.has-conflicts {
  border-color: color-mix(in srgb, var(--accent) 38%, var(--border));
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
}
.co-publication-action.has-conflicts > span { color: var(--accent); }
.co-review-note {
  margin: 0; font-size: 13px; line-height: 1.5; color: var(--muted);
  user-select: text; -webkit-user-select: text; cursor: text;
}
.co-review-error {
  margin: 0; font-size: 13px; line-height: 1.5; color: var(--danger);
  white-space: pre-wrap; overflow-wrap: anywhere;
  user-select: text; -webkit-user-select: text; cursor: text;
}
.co-autopilot {
  margin: 8px 0; padding: 10px 12px; border-radius: 10px;
  border: 1px solid var(--border); background: var(--surface-2, rgba(60,120,90,0.06));
}
.co-autopilot.is-escalated { border-color: var(--danger); }
.co-autopilot.is-responding { border-color: var(--accent, #3b7); }
.co-autopilot-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.co-autopilot-badge { font-size: 12px; font-weight: 600; }
.co-autopilot-toggle {
  font-size: 12px; padding: 3px 10px; border-radius: 8px;
  border: 1px solid var(--border); background: transparent; color: var(--fg);
  cursor: pointer;
}
.co-autopilot-toggle:disabled { opacity: 0.5; cursor: default; }
.co-autopilot-line { margin: 6px 0 0; font-size: 13px; line-height: 1.5; }
.co-autopilot-error { margin: 6px 0 0; font-size: 12px; color: var(--danger); }
.co-autopilot-rounds { margin: 8px 0 0; padding: 0; list-style: none; }
.co-autopilot-rounds li {
  display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline;
  font-size: 12px; padding: 3px 0; border-top: 1px solid var(--border);
}
.co-autopilot-round-label { font-weight: 600; }
.co-autopilot-round-summary { color: var(--muted); overflow-wrap: anywhere; }
.co-autopilot-round-when { margin-left: auto; color: var(--muted); }

/* Reviews is a stage pipeline. Each project is a contained review room and the
   complete record opens on its own focused page. */
.co-contributions-view { width: min(100%, 760px); }
.co-review-project + .co-review-project { border-top: 1px solid var(--border); }
.co-review-project > header {
  min-height: 40px; display: grid; grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: center; gap: 8px; padding: 8px 13px;
  background: var(--surface2, var(--surface));
}
.co-review-project > header .co-project-icon { width: 22px; height: 22px; border-radius: 7px; }
.co-review-project > header strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10.5px; }
.co-review-project > header span { color: var(--muted); font-size: 9.5px; font-variant-numeric: tabular-nums; }
.co-review-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto 15px; align-items: center;
  gap: 12px; width: 100%; min-height: 67px; padding: 11px 14px;
  border: 0; border-top: 1px solid var(--border); background: transparent;
  color: var(--text); font: inherit; text-align: left; cursor: pointer;
}
.co-review-row-copy { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.co-review-row-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; line-height: 1.35; }
.co-review-row-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 10px; }
.co-review-state {
  padding: 4px 7px; border-radius: 999px; background: var(--surface2, var(--bg));
  color: var(--muted); font-size: 9px; font-weight: 690; white-space: nowrap;
}
.co-review-state.is-action { color: var(--co-warn); }
.co-review-state.is-working { color: var(--accent); }
.co-review-state.is-clear { color: var(--green); }
.co-review-row > .co-icon { color: var(--muted); }
.co-review-workspace.is-focus .co-view-heading,
.co-requests-workspace.is-focus .co-view-heading { margin-bottom: 18px; }
.co-focus-view > .co-card,
.co-focus-view > .co-stack,
.co-focus-view > .co-stack-card { margin-top: 0; }

/* Requests is an owner decision inbox, deliberately warmer and more spacious
   than the review pipeline. The stage rail already names and counts each lens. */
.co-request-list { display: flex; flex-direction: column; gap: 9px; }
.co-request-card {
  display: grid; grid-template-columns: 38px minmax(0, 1fr) auto 15px;
  align-items: center; gap: 12px; width: 100%; min-height: 96px; padding: 14px;
  border: 1px solid var(--border); border-radius: 15px; background: var(--surface);
  color: var(--text); font: inherit; text-align: left; cursor: pointer;
  transition: border-color .14s ease, background .14s ease, transform .12s ease;
}
.co-request-card.is-history { min-height: 76px; padding-block: 10px; }
.co-request-card.is-history .co-request-copy { gap: 3px; }
.co-request-project { width: 38px; height: 38px; border-radius: 11px; }
.co-request-copy { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.co-request-copy small { color: var(--muted); font-size: 9.5px; font-weight: 650; }
.co-request-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; line-height: 1.35; }
.co-request-copy > span {
  display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical;
  -webkit-line-clamp: 2; overflow-wrap: anywhere;
  color: var(--muted); font-size: 10.5px; line-height: 1.4;
}
.co-request-card em { padding: 4px 7px; border-radius: 999px; background: var(--surface2, var(--bg)); color: var(--muted); font-size: 9px; font-style: normal; font-weight: 700; }
.co-request-card em.is-action { color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.co-request-card em.is-open { color: var(--green); }
.co-request-card > .co-icon { color: var(--muted); }
.co-request-focus { width: min(100%, 700px); }
.co-request-history {
  min-height: 44px; padding: 8px 2px; border: 0; background: transparent;
  color: var(--muted); font: inherit; font-size: 10.5px; cursor: pointer;
}
.co-list-continuation {
  display: grid; grid-template-columns: minmax(0, 1fr) auto 16px;
  align-items: center; gap: 8px; width: 100%; min-height: 44px;
  margin-top: 8px; padding: 8px 12px; border: 0; border-radius: 10px;
  background: transparent; color: var(--muted); font: inherit;
  text-align: left; cursor: pointer;
}
.co-list-continuation > span { color: var(--text); font-size: 11.5px; font-weight: 650; }
.co-list-continuation > small { font-size: 10px; font-variant-numeric: tabular-nums; }
.co-list-continuation > .co-icon { transform: rotate(0); }
@media (hover: hover) {
  .co-review-row:hover { background: color-mix(in srgb, var(--accent) 4%, transparent); }
  .co-request-card:hover { border-color: color-mix(in srgb, var(--accent) 34%, var(--border)); background: color-mix(in srgb, var(--accent) 3%, var(--surface)); transform: translateY(-1px); }
  .co-request-history:hover { color: var(--text); }
  .co-list-continuation:hover { background: color-mix(in srgb, var(--accent) 4%, transparent); }
}

/* mobius-ui:Empty v1 — app-owned copy; library candidate. */
.co-empty {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; text-align: center; gap: 8px;
  min-height: 46dvh; max-width: 440px; margin: 0 auto; padding: 40px 24px;
  color: var(--muted);
}
.co-empty-mark {
  width: 64px; height: 64px; margin-bottom: 10px; border-radius: 18px;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}
.co-empty-title { margin: 0; font-size: 17px; font-weight: 700; color: var(--text); }
.co-empty-text { margin: 0; font-size: 14px; line-height: 1.6; }
/* /mobius-ui:Empty */

@media (max-width: 760px) {
  .co-page.is-sources { display: block; overflow-y: auto; padding-bottom: 32px; }
  .co-projects-view, .co-review-workspace, .co-requests-workspace { padding-top: 2px; }
  .co-lens-nav, .co-stage-nav { margin-inline: -2px; }
  .co-source-detail { padding: 15px; }
}

@media (max-width: 520px) {
  .co-page { padding-inline: 12px; }
  .co-header { padding-inline: 1px; gap: 7px; }
  .co-header-main { gap: 9px; }
  .co-brand-icon, .co-brand-fallback { width: 32px; height: 32px; }
  .co-title { font-size: 17px; }
  .co-toolbar { gap: 3px; }
  .co-toolbar-check { width: 32px; padding: 0; justify-content: center; }
  .co-github-menu { max-width: 132px; min-height: 44px; padding-inline: 9px; }
  .co-github-menu > span { font-size: 11px; }
  .co-offline-note { margin-left: 41px; }
  .co-tabs { gap: 13px; margin-top: 2px; margin-bottom: 18px; overflow-x: auto; scrollbar-width: none; }
  .co-tabs::-webkit-scrollbar { display: none; }
  .co-tabs button { flex: 0 0 auto; padding-inline: 1px; font-size: 11.5px; }
  .co-tabs button span { min-width: 17px; height: 17px; margin-left: 3px; font-size: 9px; }
  .co-view-heading { gap: 14px; margin-bottom: 20px; }
  .co-view-heading h2 { font-size: 22px; }
  .co-view-heading p { margin-top: 5px; font-size: 11.5px; }
  .co-quiet-action { width: 34px; padding-inline: 0; justify-content: center; font-size: 0; }
  .co-lens-nav, .co-stage-nav { gap: 8px; margin-bottom: 20px; }
  .co-lens-nav button, .co-stage-nav button { gap: 5px; min-height: 41px; padding-bottom: 9px; font-size: 11px; }
  .co-stage-intro { align-items: flex-start; min-height: 0; margin-bottom: 11px; padding-bottom: 13px; }
  .co-stage-intro h3 { font-size: 15px; }
  .co-stage-intro p { font-size: 10.5px; }
  .co-stage-action { max-width: 44%; }
  .co-stage-action .co-btn { min-height: 38px; padding: 7px 9px; font-size: 11px; white-space: nowrap; }
  .co-stage-action > span { font-size: 9px; }
  .co-project-index, .co-review-list { border-radius: 13px; }
  .co-source-group-label { padding-inline: 11px; }
  .co-source-row { min-height: 62px; padding: 9px 11px; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 2px 9px; }
  .co-source-glyph { width: 34px; height: 34px; }
  .co-source-detail { padding: 13px 11px 14px; border-radius: 13px; }
  .co-project-next, .co-project-handoff { align-items: stretch; flex-direction: column; }
  .co-project-next .co-agent-handoff .co-btn,
  .co-project-handoff .co-agent-handoff .co-btn { width: 100%; }
  .co-project-handoff .co-agent-handoff-error { max-width: none; text-align: left; }
  .co-review-row { min-height: 72px; padding: 10px 11px; grid-template-columns: minmax(0, 1fr) auto 14px; gap: 8px; }
  .co-review-row-copy strong {
    display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical;
    -webkit-line-clamp: 2; white-space: normal; overflow-wrap: anywhere;
  }
  .co-review-state { padding-inline: 5px; font-size: 8px; }
  .co-cycle-card { grid-template-columns: 36px minmax(0, 1fr); align-items: start; padding: 12px 11px; }
  .co-cycle-mark { width: 36px; height: 36px; }
  .co-cycle-actions { grid-column: 1 / -1; justify-content: flex-start; flex-wrap: wrap; padding-left: 48px; }
  .co-cycle-progress { align-items: flex-start; flex-direction: column; gap: 5px; }
  .co-cycle-progress > span { width: min(100%, 210px); }
  .co-request-card { min-height: 96px; padding: 12px 11px; grid-template-columns: 36px minmax(0, 1fr) 14px; gap: 10px; }
  .co-request-project { width: 36px; height: 36px; }
  .co-request-copy strong {
    display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical;
    -webkit-line-clamp: 2; white-space: normal; overflow-wrap: anywhere;
  }
  .co-request-card em { display: none; }
  .co-card { padding: 13px; }
  .co-plan-meta { gap: 4px; font-size: 10.5px; }
  .co-plan-meta.has-branch .co-plan-meta-repo {
    max-width: 36%; overflow: hidden; text-overflow: ellipsis;
  }
  .co-card.is-blocked .co-card-footer { align-items: stretch; flex-direction: column; }
  .co-card.is-blocked .co-details-toggle { align-self: flex-start; }
  .co-card.is-blocked .co-action-block,
  .co-card.is-blocked .co-review-actions { width: 100%; }
  .co-card.is-blocked .co-refresh-btn { flex: 1 1 auto; }
  .co-focus-view .co-card-footer { align-items: stretch; flex-direction: column; }
  .co-focus-view .co-details-toggle { align-self: flex-start; }
  .co-focus-view .co-action-block,
  .co-focus-view .co-review-actions { width: 100%; }
  .co-focus-view .co-review-actions { justify-content: flex-start; }
  .co-card-footer:has(.co-confirm) { align-items: stretch; flex-direction: column; }
  .co-card-footer:has(.co-confirm) .co-details-toggle { align-self: flex-start; }
  .co-action-block:has(.co-confirm) { width: 100%; align-items: stretch; }
  .co-action-block .co-review-note,
  .co-action-block .co-review-error { width: 100%; }
  .co-agent-started { align-items: flex-start; flex-direction: column; }
  .co-agent-chat-link { min-height: 36px; padding-inline: 0; }
  .co-history > summary > small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .co-attention { flex-direction: column; align-items: stretch; }
}

`
