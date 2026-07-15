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
  flex: 1; min-height: 0; width: min(100%, 680px); margin: 0 auto;
  padding: 0 16px 48px; overflow-y: auto; overflow-x: hidden;
  overscroll-behavior: contain;
}

.co-header {
  display: flex; align-items: center; gap: 11px;
  padding: max(16px, env(safe-area-inset-top)) 0 4px;
}
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
.co-title { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: 0; }
.co-subtitle { display: block; margin-top: 2px; font-size: 12px; color: var(--muted); }

.co-offline-note { display: block; margin: 8px 0 0; font-size: 12px; color: var(--muted); }

/* Sources / Contributions top-level split. Sources gets a wider desktop
   canvas; Contributions keeps the original 680px reading measure. */
.co-page.is-sources {
  width: min(100%, 1040px); padding-bottom: 12px;
  display: flex; flex-direction: column; overflow: hidden;
}
.co-tabs {
  display: grid; grid-template-columns: 1fr 1fr; gap: 3px;
  margin: 13px 0 16px; padding: 3px;
  border: 1px solid var(--border); border-radius: 12px;
  background: var(--surface2, var(--surface));
}
.co-tabs button {
  min-height: 40px; padding: 8px 12px; border: 0; border-radius: 9px;
  background: transparent; color: var(--muted); font: inherit;
  font-size: 13px; font-weight: 650; cursor: pointer;
}
.co-tabs button.is-active {
  background: var(--surface); color: var(--text);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--text) 8%, transparent);
}
.co-tabs button span {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; margin-left: 5px; padding: 0 6px;
  border-radius: 999px; background: color-mix(in srgb, var(--accent) 13%, transparent);
  color: var(--accent); font-size: 11px; font-variant-numeric: tabular-nums;
}

/* Repository map — one glance from origin to this Möbius, then outward
   to GitHub forks and PR branches. Detail is visual first; file lists sit below. */
.co-sources { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding-bottom: 0; }
.co-sources-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 18px;
  margin: 2px 0 12px;
}
.co-sources-head h2 { margin: 0; font-size: 17px; line-height: 1.3; }
.co-sources-head p { margin: 4px 0 0; color: var(--muted); font-size: 12.5px; line-height: 1.5; }
.co-sources-head p strong { color: var(--text); font-variant-numeric: tabular-nums; }
.co-sources-fresh {
  flex: 0 0 auto; display: flex; align-items: center; gap: 9px;
  color: var(--muted); font-size: 11.5px; white-space: nowrap;
}
.co-source-note,
.co-source-error,
.co-source-unavailable {
  border: 1px solid var(--border); border-radius: 11px;
  background: var(--surface); color: var(--muted); font-size: 12px; line-height: 1.5;
}
.co-source-note { margin-bottom: 10px; padding: 9px 12px; }
.co-source-error {
  display: flex; flex-direction: column; align-items: flex-start; gap: 7px;
  max-width: 520px; margin: 60px auto; padding: 18px;
}
.co-source-error strong { color: var(--text); font-size: 15px; }
.co-source-error p { margin: 0; }
.co-source-unavailable { margin: 12px 0 0; padding: 12px; }

.co-source-toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  margin: 8px 0 12px;
}
.co-source-filters {
  display: flex; gap: 6px; padding: 1px 0; overflow-x: auto;
  scrollbar-width: none; overscroll-behavior-inline: contain;
}
.co-source-filters::-webkit-scrollbar { display: none; }
.co-source-filter {
  flex: 0 0 auto; min-height: 34px; padding: 6px 11px;
  border: 1px solid var(--border); border-radius: 999px;
  background: transparent; color: var(--muted); font: inherit;
  font-size: 12px; font-weight: 600; cursor: pointer;
}
.co-source-filter.is-active {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent);
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
  display: flex; flex-direction: column; gap: 5px; padding-right: 3px;
  scrollbar-width: thin; scrollbar-color: var(--border) transparent;
  overscroll-behavior: contain;
}
.co-source-row-wrap {
  flex: 0 0 auto; min-width: 0; border: 1px solid var(--border); border-radius: 11px;
  background: var(--surface); overflow: hidden;
}
.co-source-row-wrap.is-selected { border-color: color-mix(in srgb, var(--accent) 48%, var(--border)); }
.co-source-row {
  display: grid; grid-template-columns: 30px minmax(0, 1fr) auto;
  grid-template-rows: auto auto; align-items: center; gap: 2px 9px;
  width: 100%; min-height: 58px;
  padding: 9px 10px; border: 0; background: transparent; color: var(--text);
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
.co-source-row-id strong { font-size: 12.5px; }
.co-source-row-id small { color: var(--muted); font-family: var(--mono, var(--font)); font-size: 9.5px; }
.co-source-row-facts {
  grid-column: 2; grid-row: 2; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  color: var(--muted); font-size: 9px; text-align: left; white-space: nowrap;
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
  min-width: 0; padding: 14px; border: 1px solid var(--border);
  border-radius: 12px; background: var(--surface);
}
.co-source-detail-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding-bottom: 12px; border-bottom: 1px solid var(--border);
}
.co-source-detail-title { display: flex; align-items: center; gap: 9px; min-width: 0; }
.co-source-detail-title > div { min-width: 0; }
.co-source-detail-title h3 { margin: 0; font-size: 15px; line-height: 1.3; overflow-wrap: anywhere; }
.co-source-detail-title p {
  margin: 2px 0 0; color: var(--muted); font-family: var(--mono, var(--font));
  font-size: 10px; overflow-wrap: anywhere;
}

/* Origin → live main is the stable top rail. */
.co-map-graph { padding: 14px 0; }
.co-map-primary {
  display: grid; grid-template-columns: minmax(0, 1fr) 54px minmax(0, 1fr);
  align-items: center; gap: 8px;
}
.co-map-node {
  position: relative; min-width: 0; display: flex; align-items: flex-start; gap: 8px;
  padding: 10px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--surface2, var(--bg));
}
.co-map-node.is-local { border-color: color-mix(in srgb, var(--accent) 42%, var(--border)); }
.co-map-node.is-fork { border-style: dashed; }
.co-map-node-icon {
  width: 22px; height: 22px; flex: 0 0 auto; display: grid; place-items: center;
  border-radius: 7px; background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent); font-size: 12px; line-height: 1;
}
.co-map-node-copy { min-width: 0; display: flex; flex: 1 1 auto; flex-direction: column; gap: 2px; }
.co-map-node-eyebrow { color: var(--muted); font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; }
.co-map-node-copy strong,
.co-map-node-copy code { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.co-map-node-copy strong { font-size: 12px; }
.co-map-node-copy code { color: var(--muted); font-family: var(--mono, var(--font)); font-size: 9.5px; }
.co-map-node-copy small { margin-top: 2px; color: var(--muted); font-size: 10px; line-height: 1.35; }
.co-map-node-badges { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.co-map-node-badges span {
  padding: 3px 5px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent); font-size: 8.5px; white-space: nowrap;
}
.co-map-edge { position: relative; height: 22px; color: var(--muted); }
.co-map-edge span { position: absolute; left: 0; right: 7px; top: 10px; border-top: 2px solid var(--border); }
.co-map-edge i { position: absolute; right: 0; top: 1px; font-size: 16px; font-style: normal; }
.co-map-edge.state-customized span,
.co-map-edge.state-working span,
.co-map-edge.state-diverged span { border-color: var(--accent); }
.co-map-edge.state-conflict span { border-color: var(--danger); border-top-style: dashed; }
.co-map-stats {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 7px;
}
.co-map-stats span {
  padding: 6px 7px; border-radius: 8px; background: var(--surface2, var(--bg));
  color: var(--muted); font-size: 9px; text-align: center;
}
.co-map-stats b { color: var(--text); font-variant-numeric: tabular-nums; }

/* Forks hang from the live-main side; PR branches below route back to origin. */
.co-map-fork-zone { position: relative; margin: 10px 0 0 calc(50% + 27px); padding: 0 0 0 17px; }
.co-map-fork-zone::before {
  content: ''; position: absolute; left: 0; top: -10px; bottom: 12px;
  border-left: 1px dashed color-mix(in srgb, var(--accent) 42%, var(--border));
}
.co-map-fork-label { margin: 0 0 5px; color: var(--muted); font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; }
.co-map-fork-row { position: relative; display: grid; gap: 5px; margin-bottom: 8px; }
.co-map-fork-connector {
  position: absolute; left: -17px; top: 19px; width: 17px;
  border-top: 1px dashed color-mix(in srgb, var(--accent) 42%, var(--border));
}
.co-map-fork-state { padding-left: 3px; color: var(--muted); font-size: 9px; }
.co-map-fork-state .is-danger { color: var(--danger); }

.co-map-section-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  margin-bottom: 9px;
}
.co-map-section-head > div { display: flex; align-items: baseline; gap: 7px; }
.co-map-section-head span { color: var(--muted); font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
.co-map-section-head strong { font-size: 10.5px; }
.co-link-btn { padding: 3px 0; border: 0; background: transparent; color: var(--accent); font: inherit; font-size: 10.5px; cursor: pointer; }

.co-pr-map,
.co-difference-map { padding-top: 13px; border-top: 1px solid var(--border); }
.co-pr-map + .co-difference-map { margin-top: 13px; }
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
.co-pr-node-main > strong { display: block; color: var(--text); font-size: 11px; font-weight: 650; line-height: 1.35; text-decoration: none; overflow-wrap: anywhere; }
.co-pr-node-main > a:hover { text-decoration: underline; }
.co-pr-route { display: flex; align-items: center; gap: 5px; min-width: 0; margin-top: 5px; color: var(--accent); }
.co-pr-route code { min-width: 0; max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono, var(--font)); font-size: 8.5px; }
.co-pr-node-main > small { display: block; margin-top: 4px; color: var(--muted); font-size: 9px; }
.co-pr-node-main > em { display: block; margin-top: 3px; color: var(--danger); font-size: 9px; font-style: normal; }
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

.co-difference-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.co-difference-group { min-width: 0; padding: 9px; border: 1px solid var(--border); border-radius: 9px; }
.co-difference-group h4 { display: flex; align-items: center; gap: 6px; margin: 0 0 7px; font-size: 10px; }
.co-difference-group h4 b { margin-left: auto; color: var(--muted); font-size: 9px; }
.co-difference-group p { margin: 0; color: var(--muted); font-size: 9.5px; line-height: 1.4; }
.co-diff-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.co-diff-dot.is-working { border: 1px dashed var(--danger); background: transparent; }
.co-map-files { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.co-map-file { min-width: 0; display: flex; align-items: center; gap: 6px; }
.co-map-file code { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-family: var(--mono, var(--font)); font-size: 8.5px; }
.co-map-file > span:last-child { flex: 0 0 auto; display: flex; gap: 4px; color: var(--muted); font-size: 8.5px; }
.co-map-file b { color: var(--green); font-weight: 500; }
.co-map-file em { color: var(--danger); font-style: normal; }
.co-map-files > small { color: var(--muted); font-size: 8.5px; }
.co-map-work { flex: 0 0 auto; padding: 2px 4px; border-radius: 4px; background: var(--surface2, var(--bg)); color: var(--muted); font-size: 7.5px; }
.co-map-work.is-conflict { color: var(--danger); }
.co-map-work.is-untracked { color: var(--accent); }
.co-managed-differences { margin-top: 8px; border: 1px dashed var(--border); border-radius: 9px; overflow: hidden; }
.co-managed-differences summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 9px; color: var(--muted); cursor: pointer; list-style: none; }
.co-managed-differences summary::-webkit-details-marker { display: none; }
.co-managed-differences summary span { font-size: 9.5px; }
.co-managed-differences summary i { margin-right: 6px; color: var(--accent); font-style: normal; }
.co-managed-differences summary small { font-size: 8.5px; text-align: right; }
.co-managed-differences[open] .co-map-files { padding: 0 9px 9px; }

.co-source-loading { display: flex; align-items: center; justify-content: center; gap: 12px; min-height: 48dvh; color: var(--muted); }
.co-source-loading > div { display: flex; flex-direction: column; gap: 3px; }
.co-source-loading strong { color: var(--text); font-size: 14px; }
.co-source-loading span:last-child { font-size: 12px; }
@keyframes co-spin { to { transform: rotate(360deg); } }
.ma-spinner { width: 24px; height: 24px; flex: 0 0 auto; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--accent) 18%, transparent); border-top-color: var(--accent); animation: co-spin .8s linear infinite; }
@media (prefers-reduced-motion: reduce) { .ma-spinner { animation: none; } }

/* Stat tiles: label + value wear text tokens, never status colors — the
   counts are magnitudes, and the group labels below carry the identity. */
.co-tiles {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
  margin: 14px 0 10px;
}
.co-tile {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 12px 14px;
}
.co-tile-value { font-size: 24px; font-weight: 650; line-height: 1.2; letter-spacing: 0; }
.co-tile-label { margin-top: 2px; font-size: 12px; color: var(--muted); }

/* Connection card. The dot is decorative — the text always carries the
   state, so color is never the only signal. */
.co-conn {
  display: flex; align-items: flex-start; gap: 10px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 13px 14px;
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
.co-btn-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.co-btn-danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); }
.co-btn-sm { min-height: 36px; padding: 7px 12px; font-size: 13px; }
.co-btn-block { width: 100%; }
/* /mobius-ui:Button */

/* mobius-ui:Input v1 — app-owned copy; library candidate. */
.co-conn-input {
  display: block; width: 100%; box-sizing: border-box; min-height: 44px;
  padding: 11px 12px; background: var(--bg); color: var(--text);
  border: 1px solid var(--border); border-radius: 10px; outline: none;
  font-family: var(--mono, var(--font)); font-size: 16px;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.co-conn-input:focus,
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
.co-conn-divider {
  display: flex; align-items: center; gap: 10px;
  font-size: 11px; color: var(--muted); letter-spacing: 0;
}
.co-conn-divider::before, .co-conn-divider::after {
  content: ''; flex: 1; height: 1px; background: var(--border);
}

.co-section { margin-top: 22px; }
.co-section-title { margin: 0; font-size: 13px; font-weight: 650; color: var(--muted); }
.co-section-hint { margin: 3px 0 0; font-size: 12px; color: var(--muted); }

/* mobius-ui:Card v1 — app-owned copy; library candidate. */
.co-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 13px 14px; margin-top: 8px;
}
.co-card.is-clickable { cursor: pointer; }
@media (hover: hover) {
  .co-card.is-clickable:hover {
    border-color: color-mix(in srgb, var(--accent) 34%, var(--border));
  }
}
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
.co-stack-layers { margin: 4px 0 0 14px; padding-left: 13px; border-left: 2px solid var(--border); }
.co-stack-layers .co-card { border-radius: 10px; background: var(--surface); }
.co-card.is-stack-layer { box-shadow: none; }
.co-stack-actions { display: flex; gap: 8px; margin-top: 12px; }
.co-stack-actions .co-btn-primary { flex: 1 1 auto; }
.co-stack-confirm {
  margin-top: 12px; padding: 12px; border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--border));
  background: var(--surface);
}
.co-stack-confirm > strong { font-size: 14px; }
.co-stack-confirm > p { margin: 5px 0 10px; color: var(--muted); font-size: 12px; line-height: 1.5; }
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
.co-card-summary { margin: 6px 0 0; font-size: 13px; line-height: 1.5; }
.co-card-meta {
  display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;
  font-size: 12px; color: var(--muted);
}
/* Collapsed prepared card: one muted meta line + one mono diffline. The pill
   stack and the collapsed co-author tag are gone (co-author now lives in the
   expanded review). */
.co-plan-summary {
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

/* Persisted submit error — a real danger-tinted strip, not stray red text. */
.co-alert {
  align-self: stretch; margin-top: 10px; padding: 9px 11px;
  display: flex; flex-direction: column; gap: 6px;
  border-radius: 9px;
  border: 1px solid color-mix(in srgb, var(--danger) 30%, var(--border));
  background: color-mix(in srgb, var(--danger) 9%, var(--surface));
}
.co-alert-text {
  margin: 0; font-size: 12.5px; line-height: 1.45; overflow-wrap: anywhere;
  color: color-mix(in srgb, var(--danger) 88%, var(--text));
}

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
  width: 100%; min-height: 42px; padding: 8px 12px;
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
.co-review-link { font-size: 13px; color: var(--accent); }
/* Keep all three decisions on one line without giving compact Drop an equal
   third of the row. The two forward actions absorb the flexible width; Drop
   stays content-sized and visually secondary. */
.co-review-actions {
  align-self: stretch; display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) auto; gap: 8px;
}
.co-review-actions.is-secondary-only { grid-template-columns: minmax(0, 1fr) auto; }
.co-review-actions .co-btn { width: 100%; min-width: 0; padding-inline: 10px; }
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
.co-empty-title { font-size: 17px; font-weight: 700; color: var(--text); }
.co-empty-text { margin: 0; font-size: 14px; line-height: 1.6; }
/* /mobius-ui:Empty */

@media (max-width: 760px) {
  .co-page.is-sources {
    width: min(100%, 680px); padding-bottom: 32px;
    display: block; overflow-y: auto;
  }
  .co-sources { display: block; }
  .co-sources.is-detail-open > .co-sources-head,
  .co-sources.is-detail-open > .co-source-note,
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
  .co-tabs { margin-top: 11px; }
  .co-tabs button { padding-inline: 8px; font-size: 12.5px; }
  .co-source-row { min-height: 55px; padding: 8px 9px; }
  .co-source-detail { padding: 12px 9px 14px; }
  .co-map-primary { grid-template-columns: 1fr; gap: 4px; }
  .co-map-edge { height: 24px; }
  .co-map-edge span {
    left: 50%; right: auto; top: 0; width: 0; height: 20px;
    border-top: 0; border-left: 2px solid var(--border);
  }
  .co-map-edge i { left: calc(50% - 6px); right: auto; top: 4px; transform: rotate(90deg); }
  .co-map-edge.state-customized span,
  .co-map-edge.state-working span,
  .co-map-edge.state-diverged span { border-left-color: var(--accent); }
  .co-map-edge.state-conflict span { border-left-color: var(--danger); border-left-style: dashed; }
  .co-map-node { padding: 8px; gap: 6px; }
  .co-map-node-icon { display: none; }
  .co-map-node-copy strong { font-size: 10.5px; }
  .co-map-node-copy small { font-size: 8.5px; }
  .co-map-node-badges { display: none; }
  .co-map-fork-zone { margin-left: 18px; padding-left: 12px; }
  .co-map-fork-connector { left: -12px; width: 12px; }
  .co-difference-columns { grid-template-columns: 1fr; }
  .co-managed-differences summary { align-items: flex-start; flex-direction: column; }
  .co-managed-differences summary small { text-align: left; }
  .co-attention {
    flex-direction: column; align-items: stretch;
  }
}

`
