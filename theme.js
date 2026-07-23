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
}
.co-root *, .co-root *::before, .co-root *::after { box-sizing: inherit; }
/* /mobius-ui:Root */

/* mobius-ui:Scrollskin v2 — keep in sync; hidden by default, content stays scrollable. */
.co-page,
.co-file-panel {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.co-page::-webkit-scrollbar,
.co-file-panel::-webkit-scrollbar {
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
  width: min(100%, 680px); margin-inline: auto;
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
  min-height: 36px; display: inline-flex; align-items: center; gap: 7px;
  padding: 6px 10px; border-radius: 999px;
  color: var(--muted); font-size: 11.5px; font-weight: 600; white-space: nowrap;
  background: var(--surface2, var(--surface)); border: 1px solid var(--border);
}
.ma-spinner.is-compact { width: 15px; height: 15px; border-width: 2px; }
.co-offline-note {
  grid-column: 1 / -1; display: block; margin: -2px 0 0 46px;
  font-size: 12px; color: var(--muted);
}

/* Sources / Contributions top-level split. The page shell is always wide;
   Projects alone fills it while Contributions stays at a 680px reading measure. */
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

/* Contributions is the inbox; project source detail lives in its own tab. */
.co-overview {
  display: grid; grid-template-columns: 9px minmax(0, 1fr) 18px;
  align-items: center; gap: 10px; width: 100%; min-height: 56px;
  margin: 1px 0 14px; padding: 8px 11px;
  border: 1px solid var(--border); border-radius: 11px;
  background: var(--surface); color: var(--text); font: inherit;
  text-align: left; cursor: pointer;
}
.co-overview.is-loading { cursor: default; }
.co-overview.is-loading .ma-spinner { margin-left: -3px; }
.co-overview-space { width: 18px; height: 1px; }
.co-overview-mark { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.co-overview-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.co-overview-copy strong { font-size: 12.5px; line-height: 1.35; }
.co-overview-copy small {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--muted); font-size: 11px; line-height: 1.35;
}
.co-overview > .co-icon { color: var(--muted); }
@media (hover: hover) {
  .co-overview:hover { border-color: color-mix(in srgb, var(--accent) 34%, var(--border)); }
}

/* Repository map — one glance from origin to this Möbius, then outward
   to GitHub forks and PR branches. Detail is visual first; file lists sit below. */
.co-sources { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding-bottom: 0; }
.co-sources-head {
  flex: 0 0 auto; display: flex; align-items: flex-start; justify-content: space-between; gap: 18px;
  margin: 0 0 12px;
}
.co-sources-head h2 { margin: 0; font-size: 18px; line-height: 1.3; letter-spacing: -0.015em; }
.co-sources-head p { margin: 4px 0 0; color: var(--muted); font-size: 12.5px; line-height: 1.5; }
.co-sources-head p strong { color: var(--text); font-variant-numeric: tabular-nums; }
.co-sources-intro { color: color-mix(in srgb, var(--muted) 88%, var(--text)); }
.co-sources-fresh {
  flex: 0 0 auto; display: flex; align-items: center; gap: 9px;
  color: var(--muted); font-size: 11.5px; white-space: nowrap;
}
.co-source-refresh { width: 40px; height: 40px; flex-basis: 40px; }
.co-source-note,
.co-source-warning,
.co-source-error,
.co-source-unavailable {
  border: 1px solid var(--border); border-radius: 11px;
  background: var(--surface); color: var(--muted); font-size: 12px; line-height: 1.5;
}
.co-source-note { flex: 0 0 auto; margin-bottom: 10px; padding: 9px 12px; }
.co-source-warning {
  flex: 0 0 auto;
  margin-bottom: 10px; padding: 9px 12px;
  border-color: color-mix(in srgb, var(--accent) 38%, var(--border));
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
}
.co-source-error {
  display: flex; flex-direction: column; align-items: flex-start; gap: 7px;
  max-width: 520px; margin: 60px auto; padding: 18px;
}
.co-source-error strong { color: var(--text); font-size: 15px; }
.co-source-error p { margin: 0; }
.co-source-unavailable { margin: 12px 0 0; padding: 12px; }

.co-source-toolbar {
  flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 10px;
  margin: 0 0 12px;
}
.co-source-filters {
  display: flex; gap: 2px; padding: 3px; overflow-x: auto;
  border: 1px solid var(--border); border-radius: 10px;
  background: var(--surface2, var(--surface));
  scrollbar-width: none; overscroll-behavior-inline: contain;
}
.co-source-filters::-webkit-scrollbar { display: none; }
.co-source-filter {
  flex: 0 0 auto; min-height: 44px; padding: 8px 11px;
  border: 0; border-radius: 7px;
  background: transparent; color: var(--muted); font: inherit;
  font-size: 12px; font-weight: 600; cursor: pointer;
}
.co-source-filter.is-active {
  background: var(--surface); color: var(--text);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--text) 9%, transparent);
}
@media (hover: hover) {
  .co-source-filter:hover { color: var(--text); }
}
.co-adapted-note { flex: 0 0 auto; color: var(--muted); font-size: 10.5px; }
.co-source-no-results { padding: 36px 16px; text-align: center; color: var(--muted); font-size: 13px; }

.co-source-layout {
  flex: 1 1 auto; min-height: 0;
  display: grid; grid-template-columns: minmax(270px, 330px) minmax(0, 1fr);
  gap: 12px; align-items: stretch;
}
.co-source-list {
  min-width: 0; min-height: 0; height: 100%; overflow-y: auto;
  display: flex; flex-direction: column; gap: 0;
  border: 1px solid var(--border); border-radius: 13px; background: var(--surface);
  scrollbar-width: thin; scrollbar-color: var(--border) transparent;
  overscroll-behavior: contain;
}
.co-source-group { flex: 0 0 auto; min-width: 0; }
.co-source-group + .co-source-group { border-top: 1px solid var(--border); }
.co-source-group-label {
  padding: 9px 11px 6px; background: var(--surface2, var(--surface));
  color: var(--muted); font-size: 10.5px; line-height: 1.35; font-weight: 650;
}
.co-source-row-wrap {
  flex: 0 0 auto; min-width: 0; overflow: hidden;
}
.co-source-row-wrap + .co-source-row-wrap { border-top: 1px solid var(--border); }
.co-source-row-wrap.is-selected {
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  box-shadow: inset 3px 0 0 var(--accent);
}
.co-source-row {
  display: grid; grid-template-columns: 30px minmax(0, 1fr) auto;
  grid-template-rows: auto auto; align-items: center; gap: 2px 9px;
  width: 100%; min-height: 58px;
  padding: 10px 11px; border: 0; background: transparent; color: var(--text);
  font: inherit; text-align: left; cursor: pointer;
}
@media (hover:hover) { .co-source-row:hover { background: color-mix(in srgb, var(--accent) 5%, transparent); } }
.co-source-glyph {
  grid-column: 1; grid-row: 1 / 3;
  width: 30px; height: 30px; flex: 0 0 auto; border-radius: 9px;
  display: inline-flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  color: var(--accent); font-size: 12px; font-weight: 750;
}
.co-source-glyph.is-platform { background: color-mix(in srgb, var(--accent) 17%, var(--surface)); }
.co-source-glyph svg { width: 18px; height: 18px; }
.co-source-row-id { grid-column: 2; grid-row: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.co-source-row-id strong,
.co-source-row-id small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.co-source-row-id strong { font-size: 13px; }
.co-source-row-id small { color: var(--muted); font-family: var(--mono, var(--font)); font-size: 10px; }
.co-source-row-facts {
  grid-column: 2; grid-row: 2; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  color: var(--muted); font-size: 10px; text-align: left; white-space: nowrap;
}
.co-source-dot { grid-column: 3; grid-row: 1 / 3; width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.co-source-dot.tone-accent { background: var(--accent); }
.co-source-dot.tone-ok { background: var(--green); }
.co-source-dot.tone-warn { background: color-mix(in srgb, var(--accent) 70%, var(--text)); }
.co-source-dot.tone-danger { background: var(--danger); }

.co-source-status {
  flex: 0 0 auto; max-width: 128px; padding: 5px 8px; border-radius: 999px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  background: var(--surface2, var(--bg)); color: var(--muted);
  font-size: 10px; line-height: 1; font-weight: 680;
}
.co-source-status.tone-accent { background: color-mix(in srgb, var(--accent) 13%, transparent); color: var(--accent); }
.co-source-status.tone-ok { background: color-mix(in srgb, var(--green) 12%, transparent); color: var(--green); }
.co-source-status.tone-warn { background: color-mix(in srgb, var(--accent) 11%, transparent); color: var(--text); }
.co-source-status.tone-danger { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); }

.co-source-desktop-detail {
  position: static; min-width: 0; min-height: 0; height: 100%; overflow-y: auto;
  padding-right: 3px; scrollbar-width: thin; scrollbar-color: var(--border) transparent;
  overscroll-behavior: contain;
}
.co-map-back { display: none; }
.co-source-detail {
  min-width: 0; padding: 16px; border: 1px solid var(--border);
  border-radius: 13px; background: var(--surface);
}
.co-source-detail-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding-bottom: 12px; border-bottom: 1px solid var(--border);
}
.co-source-detail-title { display: flex; align-items: center; gap: 9px; min-width: 0; }
.co-source-detail-title > div { min-width: 0; }
.co-source-detail-title h3 { margin: 0; font-size: 16px; line-height: 1.3; overflow-wrap: anywhere; }
.co-source-overview-copy { margin: 12px 0 0; color: var(--muted); font-size: 13px; line-height: 1.55; }
.co-observe-map {
  display: grid; grid-template-columns: minmax(0, 1fr) 42px minmax(0, 1fr);
  grid-template-areas: 'source edge local' '. . branch' '. . reviews';
  align-items: center; gap: 5px 8px; margin-top: 14px;
}
.co-observe-node {
  min-width: 0; min-height: 72px; display: flex; align-items: flex-start; gap: 9px;
  padding: 11px; border: 1px solid var(--border); border-radius: 11px;
  background: var(--surface2, var(--bg));
}
.co-observe-node.is-source { grid-area: source; }
.co-observe-node.is-local { grid-area: local; border-color: color-mix(in srgb, var(--accent) 38%, var(--border)); }
.co-observe-node.is-local.tone-danger { border-color: color-mix(in srgb, var(--danger) 48%, var(--border)); }
.co-observe-node.is-local.tone-ok { border-color: color-mix(in srgb, var(--green) 38%, var(--border)); }
.co-observe-node.is-reviews { grid-area: reviews; border-style: dashed; }
.co-observe-node.is-reviews.has-reviews {
  border-color: color-mix(in srgb, var(--accent) 38%, var(--border));
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));
}
.co-observe-node.is-reviews.has-attention { border-color: color-mix(in srgb, var(--danger) 48%, var(--border)); }
.co-observe-node > div { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.co-observe-node > div > span {
  color: var(--muted); font-size: 8.5px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .06em;
}
.co-observe-node strong { overflow-wrap: anywhere; color: var(--text); font-size: 11.5px; line-height: 1.3; }
.co-observe-node small { color: var(--muted); font-size: 9.5px; line-height: 1.35; }
.co-observe-icon { flex: 0 0 auto; color: var(--accent); font-size: 13px; line-height: 1.1; }
.co-observe-edge { grid-area: edge; position: relative; height: 24px; }
.co-observe-edge span { position: absolute; left: 0; right: 7px; top: 11px; border-top: 1.5px solid var(--border); }
.co-observe-edge i { position: absolute; right: 0; top: 2px; color: var(--muted); font-size: 14px; font-style: normal; }
.co-observe-branch { grid-area: branch; position: relative; height: 36px; color: var(--muted); }
.co-observe-branch span { position: absolute; left: 13px; top: 0; bottom: 8px; border-left: 1.5px solid var(--border); }
.co-observe-branch i { position: absolute; left: 8px; bottom: -2px; font-size: 13px; font-style: normal; }
.co-observe-branch small { position: absolute; left: 27px; top: 7px; font-size: 8.5px; white-space: nowrap; }
.co-pr-map { margin-top: 13px; border-top: 1px solid var(--border); }
.co-pr-map > summary {
  display: grid; grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center; gap: 8px; min-height: 48px; padding: 4px 2px;
  list-style: none; cursor: pointer; color: var(--muted); font-size: 12.5px; font-weight: 650;
}
.co-pr-map > summary::-webkit-details-marker { display: none; }
.co-pr-map > summary strong {
  min-width: 20px; height: 20px; padding: 0 6px; display: inline-flex;
  align-items: center; justify-content: center; border-radius: 999px;
  background: var(--surface2, var(--bg)); color: var(--muted); font-size: 10px;
}
.co-pr-map > summary .co-icon { transition: transform .16s ease; }
.co-pr-map[open] > summary .co-icon { transform: rotate(180deg); }
.co-pr-map-body { padding: 0 0 13px; }
.co-pr-units { display: flex; flex-direction: column; gap: 7px; }
.co-pr-node {
  position: relative; display: grid; grid-template-columns: 18px minmax(0, 1fr);
  padding: 9px 10px 9px 7px; border: 1px solid var(--border); border-radius: 9px;
  background: var(--surface2, var(--bg));
}
.co-pr-node-dot {
  width: 9px; height: 9px; margin: 5px 0 0 1px; border: 2px solid var(--accent);
  border-radius: 50%; background: var(--surface);
}
.co-pr-node-main { min-width: 0; }
.co-pr-node-top { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.co-pr-status { padding: 3px 6px; border-radius: 999px; color: var(--accent); background: color-mix(in srgb, var(--accent) 11%, transparent); font-size: 8.5px; font-weight: 700; }
.co-pr-status.is-danger { color: var(--danger); background: color-mix(in srgb, var(--danger) 11%, transparent); }
.co-pr-layer,
.co-pr-number { color: var(--muted); font-family: var(--mono, var(--font)); font-size: 8.5px; }
.co-pr-node-main > a,
.co-pr-node-main > strong { display: block; color: var(--text); font-size: 12px; font-weight: 650; line-height: 1.4; text-decoration: none; overflow-wrap: anywhere; }
.co-pr-node-main > a { min-height: 44px; margin: -10px -5px -8px; padding: 10px 5px 8px; }
.co-pr-node-main > a:hover { text-decoration: underline; }
.co-pr-route { display: flex; align-items: center; gap: 5px; min-width: 0; margin-top: 5px; color: var(--accent); }
.co-pr-route code { min-width: 0; max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono, var(--font)); font-size: 9.5px; }
.co-pr-node-main > small { display: block; margin-top: 4px; color: var(--muted); font-size: 10px; }
.co-pr-origin { color: var(--muted); }
.co-pr-technical { margin-top: 4px; }
.co-pr-technical > summary {
  display: inline-flex; align-items: center; min-height: 38px; padding: 5px 2px;
  list-style: none; color: var(--muted); font-size: 10px; cursor: pointer;
}
.co-pr-technical > summary::-webkit-details-marker { display: none; }
.co-pr-technical small { display: block; margin-top: 4px; color: var(--muted); font-size: 10px; }
.co-pr-node-main > em { display: block; margin-top: 3px; color: var(--danger); font-size: 10px; font-style: normal; }
.co-pr-stack-map { border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border)); border-radius: 10px; overflow: hidden; }
.co-pr-stack-map > header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: color-mix(in srgb, var(--accent) 7%, transparent); }
.co-chain-mark { color: var(--accent); font-size: 13px; }
.co-pr-stack-map > header div { display: flex; flex-direction: column; gap: 1px; }
.co-pr-stack-map > header strong { font-size: 10.5px; }
.co-pr-stack-map > header small { color: var(--muted); font-size: 8.5px; }
.co-pr-chain { padding: 7px; }
.co-pr-chain .co-pr-node { border-radius: 7px; }
.co-pr-chain .co-pr-node + .co-pr-node { margin-top: 5px; }
.co-pr-chain .co-pr-node.is-chained::before {
  content: ''; position: absolute; left: 12px; top: -7px; height: 11px;
  border-left: 2px solid color-mix(in srgb, var(--accent) 42%, var(--border));
}
.co-pr-chain .co-pr-node:first-child::before { display: none; }

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
.co-source-action {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px;
  padding: 12px 2px 2px; border-top: 1px solid var(--border);
}
.co-source-action > div { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.co-source-action > div strong { font-size: 12.5px; }
.co-source-action > div span { color: var(--muted); font-size: 10.5px; line-height: 1.4; }
.co-source-action > button { flex: 0 0 auto; }
.co-source-action > p {
  flex-basis: 100%; margin: 0; color: var(--muted); font-size: 11px; line-height: 1.4;
}
.co-local-position + .co-source-action { border-top: 0; }


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
.co-conn-dot.is-warn { background: var(--danger); }
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
  min-height: 40px; max-width: 210px; display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 9px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--surface); color: var(--muted); font: inherit; cursor: pointer;
  transition: color .14s ease, border-color .14s ease, background .14s ease;
}
.co-github-menu > span {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text); font-size: 12px; font-weight: 650;
}
.co-github-menu > .co-icon:last-child { color: var(--muted); }
@media (hover: hover) {
  .co-github-menu:hover { border-color: color-mix(in srgb, var(--accent) 36%, var(--border)); }
}
.co-conn-settings {
  position: absolute; z-index: 50; top: calc(100% + 7px); right: 0;
  width: min(360px, calc(100vw - 32px));
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px; border: 1px solid var(--border); border-radius: 13px;
  background: var(--surface); box-shadow: 0 14px 36px color-mix(in srgb, #000 28%, transparent);
}

/* Connect flow (device + PAT), shown inline when disconnected. The card
   switches to a column layout so the controls stack; every control uses the
   shared theme tokens and a 44px min touch target. */
.co-conn.is-column { flex-direction: column; align-items: stretch; gap: 13px; }
.co-conn-row { display: flex; align-items: flex-start; gap: 10px; }
.co-conn-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.co-conn-body .co-conn-actions { margin-top: 10px; }
.co-conn-device { display: flex; flex-direction: column; gap: 10px; }
.co-conn-pat { display: flex; flex-direction: column; gap: 8px; margin: 0; }
.co-conn-form { display: flex; flex-direction: column; gap: 8px; }

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
.co-btn-quiet { border-color: transparent; background: transparent; color: var(--accent); }
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
  .co-btn-quiet:not(:disabled):hover {
    border-color: transparent;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
}
/* /mobius-ui:Button */

/* mobius-ui:Input v1 — app-owned copy; library candidate. */
.co-conn-input {
  display: block; width: 100%; box-sizing: border-box; min-height: 44px;
  padding: 11px 12px; background: var(--bg); color: var(--text);
  border: 1px solid var(--border); border-radius: 10px; outline: none;
  font-family: var(--mono, var(--font)); font-size: 16px;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.co-conn-input:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-dim);
}
/* /mobius-ui:Input */

/* The one-time device code: large, monospaced, selectable as a whole. */
.co-conn-code {
  font-family: var(--mono, var(--font)); font-size: 30px; font-weight: 700;
  letter-spacing: 0; text-align: center; padding: 14px 12px;
  border-radius: 10px; background: var(--surface2, var(--bg));
  border: 1px dashed var(--border); color: var(--text); user-select: all;
}
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
.co-conn-divider {
  display: flex; align-items: center; gap: 10px;
  font-size: 11px; color: var(--muted); letter-spacing: 0;
}
.co-conn-divider::before, .co-conn-divider::after {
  content: ''; flex: 1; height: 1px; background: var(--border);
}
/* The classic-PAT form, collapsed behind a quiet disclosure when the one-tap
   device flow is the recommended path. */
.co-conn-advanced { display: flex; flex-direction: column; gap: 12px; }
.co-conn-advanced-toggle {
  align-self: center; min-height: 44px; padding: 6px 10px;
  border: 0; background: transparent; cursor: pointer;
  font-family: var(--font); font-size: 12.5px; color: var(--muted);
}
@media (hover: hover) {
  .co-conn-advanced-toggle:hover { color: var(--text); }
}

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
.co-section.is-attention .co-section-headline > span {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
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
.co-history > summary::after { content: '›'; color: var(--muted); font-size: 19px; line-height: 1; transform: rotate(90deg); transition: transform .15s ease; }
.co-history[open] > summary { border-bottom: 1px solid var(--border); }
.co-history[open] > summary::after { transform: rotate(-90deg); }
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
.co-card.is-blocked { border-color: color-mix(in srgb, var(--danger) 25%, var(--border)); }
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
.co-stack-chip {
  flex: 0 0 auto; padding: 5px 8px; border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent); font-size: 10px; font-weight: 700;
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
  border: 1px solid color-mix(in srgb, var(--danger) 34%, var(--border));
  border-radius: 10px; background: color-mix(in srgb, var(--danger) 7%, var(--surface));
  color: var(--muted); font-size: 12px; line-height: 1.45;
}
.co-stack-warning strong { color: var(--danger); font-size: 12.5px; }
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
.co-chip.is-merged {
  background: color-mix(in srgb, var(--green) 14%, transparent);
  color: var(--green);
}
.co-chip.is-needs-refresh {
  background: color-mix(in srgb, var(--danger) 13%, transparent);
  color: var(--danger);
}
/* The one plain-language line under the chip: what this state means for the
   owner, in a calm muted voice below the title. */
.co-card-status { margin: 5px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--muted); }
.co-card-summary { margin: 6px 0 0; font-size: 13px; line-height: 1.5; }
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
.co-plan-summary,
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
.co-diffline-add { color: var(--green); font-weight: 650; }
.co-diffline-del { color: var(--danger); font-weight: 650; }

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
  border: 1px solid color-mix(in srgb, var(--danger) 26%, var(--border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--danger) 8%, var(--surface));
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

/* Review view: the staged plan a prepared card expands into. Prose stays in
   the app font; the diff is monospace and scrolls INSIDE its own block (both
   axes) so a wide hunk never stretches the card or the page. */
.co-review-toggle { margin-top: 10px; }
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
.co-prior-work-details > summary::after {
  content: '›'; margin-left: auto; color: var(--muted); font-size: 18px;
  transform: rotate(0); transition: transform .14s ease;
}
.co-prior-work-details[open] > summary::after { transform: rotate(90deg); }
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
/* Changed-file list (expanded review): a compact header, one row per file with
   a left-truncating path + right-aligned +adds −dels, each row expanding its
   own diff inline. */
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

.co-file + .co-file,
.co-files-more,
.co-files-note { border-top: 1px solid var(--border); }

.co-file-row {
  display: flex; align-items: center; gap: 9px;
  width: 100%; min-height: 44px; padding: 8px 12px;
  border: 0; background: transparent; color: var(--text);
  font: inherit; text-align: left; cursor: pointer;
}
.co-file-row.is-static { cursor: default; }
@media (hover: hover) {
  .co-file-row:not(.is-static):hover {
    background: color-mix(in srgb, var(--accent) 7%, transparent);
  }
}
.co-file-caret {
  flex: 0 0 auto; width: 6px; height: 6px;
  border-right: 1.5px solid var(--muted);
  border-bottom: 1.5px solid var(--muted);
  transform: rotate(-45deg); transition: transform .14s ease;
}
.co-file-row[aria-expanded="true"] .co-file-caret { transform: rotate(45deg); }

/* Left-truncation: the dir keeps its right edge (…app/) via its own rtl+ellipsis
   single run, and the basename is a separate, never-shrinking item after it, so
   the filename always stays fully visible. */
.co-file-path {
  flex: 1 1 auto; min-width: 0;
  display: flex; align-items: baseline;
  font-family: var(--mono, var(--font)); font-size: 12.5px; line-height: 1.3;
}
.co-file-dir {
  flex: 0 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  /* rtl puts the ellipsis on the LEFT so the deepest dirs survive truncation;
     isolate fences the bidi context so path glyphs can't visually reorder the
     surrounding row (the title attribute always carries the exact path). */
  direction: rtl; unicode-bidi: isolate; text-align: left; color: var(--muted);
}
.co-file-sep { flex: 0 0 auto; color: var(--muted); }
.co-file-base { flex: 0 0 auto; white-space: nowrap; color: var(--text); font-weight: 650; }

.co-file-meta { flex: 0 0 auto; display: inline-flex; align-items: baseline; gap: 8px; }
.co-file-kind { font-size: 11px; color: var(--muted); }
.co-file-stat {
  display: inline-flex; align-items: baseline; gap: 6px;
  font-family: var(--mono, var(--font)); font-size: 12px;
}
.co-file-stat.is-approx { opacity: 0.85; }
.co-file-add { color: var(--green); font-weight: 650; }
.co-file-del { color: var(--danger); font-weight: 650; }

.co-file-panel {
  max-height: 340px; overflow: auto; overscroll-behavior: contain;
  border-top: 1px solid var(--border);
  background: var(--surface2, var(--bg));
}

.co-files-more {
  display: flex; align-items: center; justify-content: center;
  width: 100%; min-height: 44px; padding: 8px 12px;
  border-left: 0; border-right: 0; border-bottom: 0;
  background: transparent; color: var(--accent);
  font: inherit; font-size: 12.5px; cursor: pointer;
}
@media (hover: hover) {
  .co-files-more:hover { background: color-mix(in srgb, var(--accent) 7%, transparent); }
}
.co-files-note {
  margin: 0; padding: 9px 12px; font-size: 12px; line-height: 1.45; color: var(--muted);
}

.co-diff-lines { min-width: max-content; padding: 4px 0; }
.co-diff-row {
  display: grid; grid-template-columns: 44px 44px 22px max-content;
  min-width: max-content; font-family: var(--mono, var(--font));
  font-size: 12px; line-height: 1.55;
}
.co-diff-row.is-add {
  background: color-mix(in srgb, var(--green) 10%, transparent);
}
.co-diff-row.is-del {
  background: color-mix(in srgb, var(--danger) 9%, transparent);
}
.co-diff-num {
  padding: 0 8px; color: color-mix(in srgb, var(--muted) 82%, transparent); text-align: right;
  user-select: none;
}
.co-diff-mark {
  padding: 0 4px; color: var(--muted); user-select: none;
}
.co-diff-code { padding-right: 12px; white-space: pre; color: var(--text); }
.co-diff-hunk,
.co-diff-meta {
  min-width: max-content; padding: 4px 10px;
  font-family: var(--mono, var(--font)); font-size: 12px; line-height: 1.45;
  color: var(--muted); white-space: pre;
}
.co-diff-hunk {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
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
  width: auto; min-width: 76px; padding: 0 12px; gap: 7px;
  font-size: 12.5px; font-weight: 700;
}
.co-refresh-btn {
  width: auto; min-width: 132px; padding: 0 12px; gap: 7px;
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
/* Two-tap confirm before a destructive Dismiss — deliberate, in-card, reversible. */
.co-confirm {
  display: flex; flex-direction: column; gap: 10px; padding: 12px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border));
  background: color-mix(in srgb, var(--danger) 8%, var(--surface));
}
.co-confirm-text { margin: 0; font-size: 14px; line-height: 1.45; color: var(--text); }
.co-confirm-actions { display: flex; gap: 8px; }
.co-confirm-actions .co-btn { flex: 1 1 0; min-width: 0; }
/* Undrop lives on a dropped card in History — a single, content-width button. */
.co-history-actions { display: flex; gap: 8px; margin-top: 2px; }
.co-review-note {
  margin: 0; font-size: 13px; line-height: 1.5; color: var(--muted);
  user-select: text; -webkit-user-select: text; cursor: text;
}
.co-review-error {
  margin: 0; font-size: 13px; line-height: 1.5; color: var(--danger);
  white-space: pre-wrap; overflow-wrap: anywhere;
  user-select: text; -webkit-user-select: text; cursor: text;
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
  .co-page.is-sources {
    padding-bottom: 32px;
    display: block; overflow-y: auto;
  }
  .co-sources { display: block; }
  .co-sources.is-detail-open > .co-sources-head,
  .co-sources.is-detail-open > .co-source-note,
  .co-sources.is-detail-open > .co-source-warning,
  .co-sources.is-detail-open > .co-source-toolbar { display: none; }
  .co-sources-head { flex-direction: column; gap: 9px; }
  .co-sources-fresh { width: 100%; justify-content: space-between; }
  .co-source-toolbar { align-items: flex-start; flex-direction: column; }
  .co-source-layout { display: block; }
  .co-source-list { height: auto; overflow: visible; padding-right: 0; }
  .co-source-desktop-detail { display: none; }
  .co-source-layout.is-mobile-open .co-source-list { display: none; }
  .co-source-layout.is-mobile-open .co-source-desktop-detail {
    display: block; height: auto; overflow: visible; padding-right: 0;
  }
  .co-map-back {
    display: inline-flex; align-items: center; gap: 7px; min-height: 44px;
    margin: -4px 0 7px; padding: 6px 3px; border: 0;
    background: transparent; color: var(--accent); font: inherit; font-size: 12px;
    cursor: pointer;
  }
  .co-source-row-wrap.is-selected { box-shadow: none; }
}

@media (max-width: 520px) {
  .co-page { padding-inline: 12px; }
  .co-header { padding-inline: 1px; gap: 8px; }
  .co-header-main { gap: 9px; }
  .co-subtitle { display: none; }
  .co-toolbar { gap: 5px; }
  .co-toolbar-check { width: 36px; padding: 0; justify-content: center; }
  .co-toolbar-check > span:last-child {
    position: absolute; width: 1px; height: 1px; overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .co-github-menu { max-width: 148px; }
  .co-offline-note { margin-left: 43px; }
  .co-tabs { gap: 18px; margin-top: 2px; }
  .co-tabs button { flex: 1 1 0; padding-inline: 2px; font-size: 12.5px; }
  .co-card { padding: 13px; }
  .co-card.is-blocked .co-card-footer { align-items: stretch; flex-direction: column; }
  .co-card.is-blocked .co-details-toggle { align-self: flex-start; }
  .co-card.is-blocked .co-action-block,
  .co-card.is-blocked .co-review-actions { width: 100%; }
  .co-card.is-blocked .co-refresh-btn { flex: 1 1 auto; }
  .co-action-block .co-review-note,
  .co-action-block .co-review-error { width: 100%; }
  .co-source-toolbar { align-items: stretch; }
  .co-source-filters { width: 100%; }
  .co-source-filter { flex: 1 0 auto; text-align: center; }
  .co-history > summary > small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .co-source-row { min-height: 55px; padding: 8px 9px; }
  .co-source-detail { padding: 12px 9px 14px; }
  .co-source-action { align-items: stretch; flex-direction: column; }
  .co-source-action > button { width: 100%; }
  .co-observe-map {
    grid-template-columns: 1fr;
    grid-template-areas: 'source' 'edge' 'local' 'branch' 'reviews'; gap: 4px;
  }
  .co-observe-node { min-height: 64px; }
  .co-observe-edge { height: 24px; }
  .co-observe-edge span { left: 18px; right: auto; top: 0; bottom: 5px; border-top: 0; border-left: 1.5px solid var(--border); }
  .co-observe-edge i { left: 13px; right: auto; top: 9px; transform: rotate(90deg); }
  .co-observe-branch { height: 32px; }
  .co-attention {
    flex-direction: column; align-items: stretch;
  }
}

`
