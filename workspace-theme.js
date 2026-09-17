// Approved continuous project workspace. Theme remains owned by the shell.
export const WORKSPACE_CSS = `
.co-header-shell { width:100%; max-width:none; }
.co-header { width:100%; max-width:1108px; padding:8px 44px; border-bottom:0; }
.co-title { font-size:18px; font-weight:600; letter-spacing:-.015em; }
.co-brand-icon { width:26px; height:26px; }
.co-header-back { display:inline-flex; align-items:center; gap:8px; min-height:44px; padding:6px 4px; border:0; background:none; color:var(--text); font:600 16px var(--font); cursor:pointer; }
.co-header-back:hover { color:var(--accent); }
.co-icon-action { display:inline-grid; place-items:center; flex:0 0 44px; width:44px; height:44px; padding:0; border:0; border-radius:10px; background:transparent; color:var(--muted); cursor:pointer; }
.co-icon-action:hover { color:var(--text); background:var(--surface2); }
.co-icon-action:disabled { cursor:default; opacity:.5; }
.co-page.is-sources { width:100%; max-width:none; padding:0; overflow:auto; }
.co-projects-view { width:100%; max-width:1108px; margin:auto; padding:24px 44px 80px; }
.co-projects-view.is-focus { height:auto; }
.co-project-layout { display:block; }
.co-workspace { min-width:0; background:var(--bg); }
.co-workspace-head { display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding:2px 0 12px; }
.co-workspace-title { display:flex; align-items:center; gap:14px; flex:1; min-width:0; }
.co-workspace-title > div { flex:1; min-width:0; }
.co-workspace-name-row { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.co-workspace-title .co-source-glyph { display:none; }
.co-workspace-title h2 { font-size:30px; font-weight:600; line-height:1.25; letter-spacing:-.025em; margin:0; overflow-wrap:anywhere; }
.co-workspace-title p { display:flex; flex-wrap:wrap; align-items:center; gap:0 12px; font-size:14px; color:var(--muted); margin:4px 0 0; overflow-wrap:anywhere; }
.co-workspace-access { display:inline-flex; align-items:center; min-height:32px; color:var(--muted); font-weight:600; }
.co-workspace-body,.co-workspace-inventory { display:block; padding:0; overflow:visible; }
.co-task-content { position:relative; margin:18px 0 24px; padding:24px; background:var(--surface); border:1px solid var(--border); border-radius:12px; overflow-wrap:anywhere; outline-offset:4px; }
.co-inline-close { position:absolute; right:12px; top:10px; width:44px; justify-content:center; }
.co-task-content > h3,.co-task-content > section > h3 { padding-right:32px; }
.co-task-content h3 { font-size:19px; font-weight:600; line-height:1.4; letter-spacing:-.015em; margin:0 0 14px; }
.co-task-content p { font-size:16px; color:var(--muted); line-height:1.6; margin:10px 0 18px; max-width:72ch; }
.co-task-scope { display:flex; flex-wrap:wrap; align-items:center; gap:16px; padding:8px 0; }
.co-task-scope > span { font-size:14px; color:var(--muted); }
.co-task-primary { margin-top:16px; white-space:normal; width:auto; }
.co-task-content .co-workflow-option { align-items:flex-start; gap:12px; padding:0; border:0; background:none; font-size:15px; margin:16px 0; }
.co-workflow-option small { display:block; margin-top:4px; font-size:14px; color:var(--muted); line-height:1.55; }
.co-task-content .co-task-footnote { font-size:14px; margin:10px 0 20px; }
.co-task-details { margin-top:20px; border-top:1px solid var(--border); padding-top:10px; }
.co-task-details summary { min-height:44px; cursor:pointer; color:var(--muted); font-size:14px; align-content:center; }
.co-task-progress { padding:12px 0; }
.co-task-steps { padding-left:20px; color:var(--muted); font-size:15px; }
.co-task-steps li { padding:5px 0; }
.co-local-work > header,.co-public-work > header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }
.co-local-work > header h3,.co-public-work > header h3 { font-size:16px; font-weight:600; margin:0; letter-spacing:-.01em; }
.co-local-overview { display:flex; justify-content:space-between; gap:24px; align-items:center; padding:16px 0 22px; border:0; border-bottom:1px solid var(--border); border-radius:0; }
.co-local-overview strong { display:block; font-size:19px; font-weight:600; letter-spacing:-.015em; }
.co-local-overview p { font-size:14px; line-height:1.6; color:var(--muted); margin:6px 0 0; max-width:65ch; }
.co-local-overview .co-btn { flex-shrink:0; }
.co-local-files { margin-top:4px; }
.co-prepare-scope { display:grid; grid-template-columns:minmax(0,1fr) 18px; align-items:center; gap:12px; width:100%; min-height:64px; padding:10px 0; border:0; border-block:1px solid var(--border); background:none; color:var(--text); text-align:left; cursor:pointer; }
.co-prepare-scope span { min-width:0; }
.co-prepare-scope small,.co-prepare-scope strong { display:block; }
.co-prepare-scope small { color:var(--muted); font-size:14px; margin-bottom:2px; }
.co-prepare-scope strong { font-size:16px; font-weight:600; }
.co-follow-merge { display:flex; align-items:flex-start; gap:12px; margin:18px 0 0; padding:14px; border:1px solid var(--border); border-radius:12px; background:var(--bg); cursor:pointer; }
.co-follow-merge.is-selected { border-color:color-mix(in srgb,var(--accent) 48%,var(--border)); background:var(--accent-dim); }
.co-follow-merge input { margin-top:3px; }
.co-follow-merge strong,.co-follow-merge small { display:block; }
.co-follow-merge strong { font-size:16px; font-weight:650; }
.co-follow-merge small { margin-top:4px; color:var(--muted); font-size:14px; line-height:1.5; }
.co-task-content .co-task-primary { width:100%; justify-content:center; margin-top:18px; }
.co-work-progress-row { display:flex; width:100%; align-items:center; gap:10px; padding:14px 0; background:none; color:var(--accent); border:0; font-size:15px; cursor:pointer; }
.co-workspace .co-run { margin-top:24px; }
.co-run-empty-overview { display:flex; align-items:center; gap:10px; margin:18px 0; padding:14px 0; color:var(--muted); border-bottom:1px solid var(--border); }
.co-run-empty-overview > .co-icon { color:var(--green); flex:0 0 auto; }
.co-run-empty-overview span { display:grid; gap:2px; }
.co-run-empty-overview strong { color:var(--text); font-size:15px; font-weight:650; }
.co-run-empty-overview small { font-size:14px; }
.co-workspace .co-run-primary { border:0; border-radius:0; border-bottom:1px solid var(--border); background:none; padding:16px 0; }
.co-workspace .co-local-summary { display:grid; grid-template-columns:24px minmax(0,1fr) 16px; align-items:center; gap:10px; width:100%; min-height:62px; padding:10px 0; border:0; border-bottom:1px solid var(--border); background:none; color:var(--text); text-align:left; cursor:pointer; }
.co-workspace .co-local-summary > span { min-width:0; }
.co-workspace .co-local-summary strong,.co-workspace .co-local-summary small { display:block; min-width:0; }
.co-workspace .co-local-summary strong { font-size:15px; line-height:1.35; font-weight:650; }
.co-workspace .co-local-summary small { margin-top:2px; overflow:hidden; color:var(--muted); font-size:14px; line-height:1.35; text-overflow:ellipsis; white-space:nowrap; }
.co-workspace .co-local-summary:hover { color:var(--accent); background:color-mix(in srgb,var(--surface) 65%,transparent); }
.co-workspace .co-run-focus-layout { display:block; }
.co-workspace .co-run-focus-summary { padding:0; background:none; border:0; }
.co-workspace .co-run-focus-summary > small { display:none; }
.co-workspace .co-run-focus-detail { min-width:0; }
.co-workspace .co-run-focus-detail .co-card { border:0; background:none; }
.co-workspace .co-run-fold { border-radius:0; border:0; border-bottom:1px solid var(--border); }
.co-public-work { margin-top:22px; }
.co-public-work > header > span { color:var(--muted); font-size:14px; flex:1; }
.co-workspace .co-pr-row { display:flex; align-items:center; gap:8px; border:0; border-bottom:1px solid var(--border); padding:10px 6px; background:none; flex-wrap:wrap; transition:background .14s; border-radius:6px; min-height:78px; }
.co-workspace .co-pr-title { font-size:15px; line-height:1.5; font-weight:500; }
.co-workspace .co-pr-meta { display:flex; flex-wrap:wrap; gap:5px 10px; font-size:14px; margin-top:5px; color:var(--muted); }
.co-pr-open { background:none; border:0; text-align:left; color:var(--text); padding:0; cursor:pointer; width:100%; min-height:44px; }
.co-pr-open > strong { display:block; }
.co-pr-open:hover .co-pr-title { color:var(--accent); }
.co-pr-content { flex:1; min-width:0; }
.co-pr-side { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.co-work-state { display:inline-block; width:fit-content; font-size:14px; color:var(--muted); }
.co-pr-list-controls { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:4px; }
.co-pr-list-controls input { flex:1; min-width:120px; }
.co-pr-list-controls label { display:flex; align-items:center; gap:10px; font-size:14px; color:var(--muted); }
/* Non-modal selection shelf; fixed only within this mini-app iframe. */
.co-page.is-sources { padding-bottom:max(var(--co-selection-height,0px),var(--co-task-height,0px)); scroll-padding-bottom:max(var(--co-selection-height,0px),var(--co-task-height,0px)); }
.co-workspace .co-pr-selection,.co-workspace .co-task-dock { position:fixed; left:50%; right:auto; top:auto; bottom:max(16px,env(safe-area-inset-bottom)); width:calc(100% - 48px); max-width:800px; margin:0; z-index:20; background:var(--surface); border:1px solid color-mix(in srgb,var(--border) 72%,var(--text)); border-radius:16px; box-shadow:0 18px 58px color-mix(in srgb,#000 34%,transparent); transform:translateX(-50%); }
.co-workspace .co-pr-selection { display:block; padding:9px 13px; }
.co-workspace .co-pr-selection[hidden] { display:none; }
.co-selection-heading { display:flex; align-items:center; gap:8px; }
.co-selection-heading > .co-quiet-action { width:44px; justify-content:center; }
.co-selection-toggle { display:flex; align-items:center; gap:10px; min-height:44px; padding:0 4px; border:0; background:none; color:var(--text); cursor:pointer; margin-right:auto; }
.co-selection-toggle strong { font-size:14px; font-weight:500; white-space:nowrap; }
.co-selection-stack { display:grid; place-items:center; position:relative; width:28px; height:28px; border:1px solid var(--border); border-radius:7px; background:var(--accent-dim); color:var(--accent); box-shadow:-3px -3px 0 var(--surface),-4px -4px 0 var(--border); }
.co-selection-toggle > .co-icon { transition:transform .16s; }
.co-pr-selection.is-expanded .co-selection-toggle > .co-icon { transform:rotate(180deg); }
.co-selected-cards { display:flex; gap:8px; overflow:auto; padding:8px 0 2px; scrollbar-width:thin; }
.co-selected-card { display:flex; align-items:center; flex:0 0 248px; min-width:0; background:var(--bg); border:1px solid var(--border); border-radius:12px; }
.co-selected-open { display:flex; align-items:center; gap:8px; flex:1; min-width:0; min-height:48px; padding:8px 0 8px 12px; color:var(--text); border:0; background:none; text-align:left; cursor:pointer; }
.co-selected-open span { font-size:14px; color:var(--muted); }
.co-selected-open strong { font-size:14px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.co-selected-remove { display:grid; place-items:center; width:44px; min-height:44px; flex-shrink:0; border:0; background:none; color:var(--muted); cursor:pointer; }
.co-selected-remove:hover,.co-selection-heading > button:hover { color:var(--text); background:var(--surface2); border-radius:8px; }
.co-pr-selection.is-expanded .co-selected-cards { flex-direction:column; max-height:30dvh; }
.co-pr-selection.is-expanded .co-selected-card { flex:none; }
.co-pr-selection.is-expanded .co-selected-open strong { white-space:normal; overflow-wrap:anywhere; }
.co-selection-actions { display:flex; gap:8px; }
.co-selection-actions .co-btn { font-size:14px; padding-inline:12px; }

.co-workspace .co-task-dock { width:min(720px,calc(100% - 48px)); padding:28px; max-height:78dvh; overflow:auto; overscroll-behavior:contain; }
.co-task-dock .co-inline-close { position:sticky; top:0; float:right; margin:-12px -10px 0 12px; background:var(--surface); z-index:1; }
.co-workspace .co-task-dock > .co-run-approval { margin:0; overflow:visible; border:0; border-radius:0; background:transparent; }
.co-workspace .co-task-dock > .co-run-approval > header { padding:0 36px 16px 0; }
.co-workspace .co-task-dock > .co-run-approval h3 { margin:0; font-size:22px; line-height:1.3; letter-spacing:-.02em; }
.co-workspace .co-task-dock > .co-run-approval header p { margin:8px 0 0; font-size:16px; line-height:1.55; }
.co-workspace .co-task-dock > .co-run-approval .co-run-approval-list { max-height:min(35dvh,320px); border:1px solid var(--border); border-radius:10px; }
.co-workspace .co-task-dock > .co-run-approval .co-run-approval-list li { background:var(--surface2); }
.co-workspace .co-task-dock > .co-run-approval .co-run-approval-list strong { white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
.co-workspace .co-task-dock > .co-run-approval .co-run-approval-actions { padding:16px 0 0; }
.co-workspace .co-btn { border-radius:7px; }
.co-workspace .co-btn:not(.co-btn-primary):hover:not(:disabled) { background:var(--surface2); border-color:color-mix(in srgb,var(--accent) 35%,var(--border)); }

.co-workspace .co-pr-row:hover { background:color-mix(in srgb,var(--surface) 65%,transparent); }
.co-workspace .co-pr-row.is-selected { background:var(--accent-dim); border-radius:12px; box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 28%,transparent); }

.co-detail-tabs { width:fit-content; max-width:100%; background:none; padding:0; gap:16px; border-bottom:1px solid var(--border); }
.co-workspace .co-pr-confirm,.co-workspace .co-pr-assignment { padding:0; background:none; border:0; border-radius:0; }
.co-workspace .co-pr-confirm ul { padding:0; list-style:none; }
.co-workspace .co-pr-confirm li { padding:10px 0; }
.co-pr-confirm li span { display:block; font-size:14px; color:var(--muted); }
.co-pr-confirm .co-board-actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:20px; }
.co-person-search { width:100%; margin:12px 0; }
.co-person-list { display:grid; gap:4px; max-height:320px; overflow:auto; }
.co-person-option { display:flex; align-items:center; gap:12px; width:100%; min-height:52px; padding:8px 10px; background:none; border:0; border-radius:8px; color:var(--text); text-align:left; cursor:pointer; font-size:16px; }
.co-person-option:hover { background:var(--bg); }
.co-person-option span:last-child { color:var(--muted); font-size:14px; margin-left:auto; }
.co-avatar { display:inline-grid; place-items:center; width:32px; height:32px; background:var(--accent-dim); color:var(--accent); border-radius:50%; }
.co-pr-detail { width:100%; padding:0; min-width:0; }
.co-detail-tabs { display:flex; margin-bottom:20px; }
.co-detail-tabs button { background:none; border:0; border-bottom:2px solid transparent; border-radius:0; color:var(--muted); min-height:48px; font-size:14px; cursor:pointer; padding:8px 0; }
.co-detail-tabs button[aria-pressed=true] { color:var(--text); border-bottom-color:var(--text); }
.co-pr-detail .co-markdown { font-size:16px; line-height:1.65; max-width:72ch; }
.co-pr-detail .co-board-actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:20px; }
.co-detail-stats { display:flex; gap:8px 16px; flex-wrap:wrap; color:var(--muted); font-size:14px; margin:12px 0; font-variant-numeric:tabular-nums; }
.co-file-disclosure { padding:8px 0; border-bottom:1px solid var(--border); }
.co-file-disclosure summary { cursor:pointer; overflow-wrap:anywhere; font-size:14px; min-height:44px; align-content:center; }
.co-file-disclosure pre { overflow:auto; max-height:480px; padding:16px; background:var(--surface); font:13px/1.6 var(--mono,monospace); }
.co-activity-item { padding:14px 0; border-bottom:1px solid var(--border); }
.co-activity-item > header { font-size:14px; color:var(--muted); }
.co-group-members { margin-top:20px; }
.co-group-member { border-bottom:1px solid var(--border); padding:10px 0; }
.co-group-member > summary { cursor:pointer; min-height:44px; font-size:16px; align-content:center; }
.co-group-count { color:var(--muted); font-size:14px; margin:6px 0; }
.co-workspace input:not([type=checkbox]) { font-size:16px; min-height:44px; color:var(--text); background:var(--surface); padding:8px 12px; border:1px solid var(--border); border-radius:8px; }
.co-workspace input[type=checkbox] { width:18px; height:18px; accent-color:var(--accent); flex-shrink:0; }
.co-workspace .co-quiet-action,.co-workspace summary { min-height:44px; }
.co-workspace .co-pr-select { min-width:44px; min-height:44px; }
.co-workspace :is(button,a,summary) { text-underline-offset:3px; }
.co-workspace ::selection { color:var(--text); background:var(--accent-dim); }
.co-workspace :is(input,textarea) { caret-color:var(--accent); }
.co-page,.co-person-list { scrollbar-width:thin; scrollbar-color:var(--border) transparent; }
.co-task-pulls > div { padding:14px 0; border-bottom:1px solid var(--border); }
.co-task-pulls strong { font-size:16px; display:block; }
.co-task-pulls a { display:inline-flex; align-items:center; font-size:14px; color:var(--accent); min-height:44px; }
.co-task-secondary { margin:12px 10px 0 0; }
.co-review-run-row { display:flex; gap:10px; flex-wrap:wrap; width:100%; padding:14px 0; background:none; color:var(--text); border:0; border-bottom:1px solid var(--border); text-align:left; cursor:pointer; }
.co-review-run-row span:first-child { flex:1; }
.co-work-empty { padding:24px 0; }
.co-work-empty strong { font-size:16px; }
.co-work-empty p { font-size:15px; color:var(--muted); }
.co-scope-row { display:grid; grid-template-columns:1fr auto; gap:6px 12px; width:100%; padding:16px 0; border:0; border-bottom:1px solid var(--border); background:none; color:var(--text); text-align:left; cursor:pointer; min-height:64px; }
.co-scope-row strong { font-size:16px; }
.co-scope-row span { font-size:14px; color:var(--muted); grid-column:1; }
.co-scope-row .co-icon { grid-column:2; grid-row:1 / 3; align-self:center; }
.co-section-count { color:var(--muted); font-weight:400; font-size:14px; margin-left:6px; }
.co-workspace .co-run-list { border:0; border-radius:0; background:none; }
.co-workspace .co-run-row { background:none; border-bottom:1px solid var(--border); padding:12px 0; }
.co-workspace .co-run-row-main { grid-template-columns:minmax(0,1fr) 14px; }
.co-workspace .co-run-row-icon { display:none; }
.co-workspace .co-run-row-main strong { font-size:15px; font-weight:500; white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.co-workspace .co-run-row-main small { white-space:normal; }
.co-workspace .co-run-row-action { min-height:44px; border-radius:7px; font-weight:500; }
.co-workspace .co-run-fold { background:none; }
.co-directory { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:start; gap:16px; }
.co-directory .co-project-search { margin:0; }
.co-directory > :not(.co-project-search):not(.co-directory-filters) { grid-column:1/-1; }
.co-directory-filters { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.co-directory-filters button { display:inline-flex; align-items:center; gap:7px; min-height:44px; padding:8px 14px; border:1px solid var(--border); border-radius:18px; background:var(--surface); color:var(--muted); font:600 14px var(--font); cursor:pointer; }
.co-directory-filters button[aria-pressed=true],.co-directory-filters button:hover { color:var(--text); border-color:color-mix(in srgb,var(--accent) 34%,var(--border)); background:var(--accent-dim); }
.co-directory-filters button span { min-width:20px; padding:1px 6px; border-radius:10px; background:var(--bg); color:var(--muted); font-variant-numeric:tabular-nums; }
.co-pr-filters { display:flex; flex-wrap:wrap; gap:4px; margin-right:auto; }
.co-pr-filters button { min-height:44px; padding:8px 10px; border:0; border-radius:7px; background:none; color:var(--muted); font:500 14px var(--font); text-decoration:none; cursor:pointer; }
.co-pr-filters button[aria-pressed=true],.co-pr-filters button:hover { background:var(--surface2); color:var(--text); }
.co-pr-list-controls .co-pr-search { display:flex; align-items:center; gap:8px; flex:1 1 100%; margin:4px 0; color:var(--muted); }
.co-workspace .co-pr-search input { border:0; background:none; padding:8px 0; min-width:0; width:100%; }
.co-workspace .co-pr-side > button[aria-label^="Assign PR"] { min-width:44px; justify-content:center; }
.co-task-dock:focus-visible,.co-task-dock [tabindex="-1"]:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
.co-workspace .co-task-dock { animation:co-dock-arrive .18s cubic-bezier(.16,1,.3,1); }
.co-connect-banner { display:flex; align-items:center; justify-content:space-between; gap:20px; margin:0 0 20px; padding:16px 18px; border:1px solid color-mix(in srgb,var(--accent) 30%,var(--border)); border-radius:12px; background:color-mix(in srgb,var(--accent-dim) 42%,var(--surface)); }
.co-connect-banner strong { display:block; font-size:16px; font-weight:650; }
.co-connect-banner p { margin:4px 0 0; max-width:64ch; color:var(--muted); font-size:14px; line-height:1.5; }
.co-accepted-banner { display:flex; align-items:center; justify-content:space-between; gap:20px; margin:0 0 18px; padding:16px 18px; border:1px solid color-mix(in srgb,var(--green) 35%,var(--border)); border-radius:12px; background:color-mix(in srgb,var(--green) 10%,var(--surface)); }
.co-accepted-banner strong { display:block; font-size:16px; font-weight:650; }
.co-accepted-banner p { margin:4px 0 0; max-width:64ch; color:var(--muted); font-size:14px; line-height:1.5; }
@media(max-width:680px) { .co-connect-banner { align-items:stretch; flex-direction:column; gap:12px; margin-bottom:16px; } .co-connect-banner .co-btn { width:100%; justify-content:center; } }
@media(max-width:680px) { .co-accepted-banner { align-items:stretch; flex-direction:column; gap:12px; margin-bottom:16px; } .co-accepted-banner .co-btn { width:100%; justify-content:center; } }
@keyframes co-dock-arrive { from { transform:translate(-50%,12px); } to { transform:translate(-50%,0); } }
@keyframes co-dock-arrive-mobile { from { transform:translateY(12px); } to { transform:translateY(0); } }
@media(prefers-reduced-motion:reduce) { .co-workspace .co-task-dock { animation:none; } }
@media(max-width:680px) {
 .co-header { padding:6px 18px; }
 .co-projects-view { padding:20px 18px 60px; }
 .co-workspace-head { gap:14px; }
 .co-workspace-title h2 { font-size:28px; }
 .co-local-overview { align-items:flex-start; flex-direction:column; gap:18px; padding:0 0 24px; }
 .co-local-overview .co-btn { width:100%; }
 .co-task-content { padding:20px; }
 .co-pr-detail { padding:12px 0; }
 .co-workspace .co-pr-side { padding-left:52px; width:100%; justify-content:space-between; }
 .co-workspace .co-pr-row { min-height:94px; }
 .co-workspace .co-pr-title { font-size:16px; }
 .co-workspace .co-pr-selection,.co-workspace .co-task-dock { left:8px; right:8px; width:auto; bottom:max(8px,env(safe-area-inset-bottom)); border-radius:18px; transform:none; }
 .co-workspace .co-task-dock { padding:20px; max-height:76dvh; animation-name:co-dock-arrive-mobile; }
 .co-selection-stack { display:none; }
 .co-selection-toggle { gap:4px; }
 .co-selection-heading { gap:4px; }
 .co-selection-actions { gap:4px; }
 .co-selection-actions .co-icon { display:none; }
 .co-selection-actions .co-btn { padding:9px 8px; font-size:14px; white-space:normal; }
 .co-selected-card { flex-basis:228px; }
 .co-pr-search { width:100%; }
 .co-pr-filters { width:100%; gap:0; }
 .co-pr-filters button { flex:1; padding-inline:6px; }
 .co-directory { grid-template-columns:1fr; }
 .co-directory-filters { width:100%; }
}
.co-other-repositories { margin-top:28px; border-top:1px solid var(--border); }
.co-other-repositories > summary { display:flex; align-items:center; gap:12px; min-height:56px; font-size:16px; cursor:pointer; }
.co-other-repositories > summary span { color:var(--muted); font-size:14px; }
.co-other-repositories > p { max-width:72ch; margin:0 0 12px; color:var(--muted); font-size:14px; line-height:1.55; text-wrap:pretty; }
.co-agent-model-settings { display:grid; grid-template-columns:1fr; gap:12px; margin-bottom:18px; padding-bottom:18px; border-bottom:1px solid var(--border); }
.co-agent-model-settings > div,.co-agent-model-settings > small { grid-column:1/-1; }
.co-agent-model-settings strong { display:block; font-size:14px; }
.co-agent-model-settings p { margin:4px 0 0; color:var(--muted); font-size:14px; line-height:1.45; }
.co-model-field,.co-effort-field { display:grid; gap:7px; min-width:0; color:var(--muted); font-size:14px; }
.co-model-trigger { display:flex; align-items:center; justify-content:space-between; gap:10px; width:100%; min-height:46px; padding:9px 12px; border:1px solid var(--border); border-radius:10px; background:var(--bg); color:var(--text); font:500 15px var(--font); text-align:left; cursor:pointer; }
.co-model-trigger[aria-expanded=true] { border-color:color-mix(in srgb,var(--accent) 45%,var(--border)); box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 12%,transparent); }
.co-model-trigger[aria-expanded=true] .co-icon { transform:rotate(180deg); }
.co-model-trigger:disabled { opacity:.5; cursor:default; }
.co-model-picker { display:grid; gap:6px; max-height:360px; overflow:auto; overscroll-behavior:contain; padding:8px; border:1px solid var(--border); border-radius:12px; background:var(--bg); }
.co-model-search { display:flex; align-items:center; gap:8px; min-height:44px; padding:0 10px; border:1px solid var(--border); border-radius:10px; color:var(--muted); background:var(--surface); }
.co-model-search input { min-width:0; width:100%; border:0; outline:0; background:transparent; color:var(--text); font:16px var(--font); }
.co-model-group { display:grid; gap:2px; padding-top:5px; }
.co-model-group h4 { margin:0; padding:7px 9px 4px; color:var(--muted); font-size:14px; font-weight:650; }
.co-model-option { display:flex; align-items:center; justify-content:space-between; gap:10px; width:100%; min-height:50px; padding:7px 9px; border:0; border-radius:10px; background:transparent; color:var(--text); text-align:left; cursor:pointer; }
.co-model-option:hover,.co-model-option[aria-pressed=true] { background:var(--surface2); }
.co-model-option > span { display:grid; gap:2px; min-width:0; }
.co-model-option strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:14px; font-weight:600; }
.co-model-option small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--muted); font-size:14px; }
.co-model-option > .co-icon { flex:0 0 auto; color:var(--accent); }
.co-model-empty { margin:12px; color:var(--muted); font-size:14px; text-align:center; }
.co-effort-options { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; }
.co-effort-options button { min-height:38px; padding:6px 5px; border:1px solid var(--border); border-radius:10px; background:transparent; color:var(--muted); font:500 14px var(--font); cursor:pointer; }
.co-effort-options button[aria-pressed=true] { border-color:color-mix(in srgb,var(--accent) 38%,var(--border)); background:var(--accent-dim); color:var(--text); }
.co-effort-options button:disabled { opacity:.5; cursor:default; }
.co-agent-model-settings small { color:var(--muted); font-size:14px; line-height:1.4; }
.co-agent-model-settings small.is-error { color:var(--danger); }
.co-change-total { display:inline-flex; align-items:baseline; gap:7px; font-variant-numeric:tabular-nums; }
.co-change-total b { color:var(--green); font-weight:650; }
.co-change-total em { color:var(--danger); font-style:normal; font-weight:650; }
.co-attention-action { display:inline-flex; align-items:center; gap:5px; min-height:40px; padding:7px 11px; border:1px solid color-mix(in srgb,var(--accent) 32%,var(--border)); border-radius:10px; background:var(--accent-dim); color:var(--text); font:650 14px var(--font); cursor:pointer; }
.co-root { user-select:text; -webkit-user-select:text; }
.co-source-row,.co-pr-open,.co-card-title,.co-run-row-main,.co-run-quiet-row { user-select:text; -webkit-user-select:text; }
.co-source-row { min-height:88px; padding:13px 12px; border-radius:12px; }
.co-source-row .co-source-glyph { grid-row:1; align-self:center; }
.co-btn > .co-icon,.co-quiet-action > .co-icon,.co-icon-btn > .co-icon,.co-source-row-cue > .co-icon { flex:0 0 auto; align-self:center; margin:0; }
.co-icon-btn { line-height:0; }
.co-repository-picker { position:relative; }
.co-repository-trigger { white-space:nowrap; }
.co-repository-picker form { position:absolute; right:0; top:100%; z-index:5; width:min(500px,calc(100vw - 36px)); padding:20px; background:var(--bg); border:1px solid var(--border); border-radius:12px; }
.co-repository-picker form > header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
.co-repository-picker form > header strong { font-size:16px; }
.co-repository-picker form > header .co-quiet-action { padding-inline:4px; }
.co-repository-picker label { display:block; margin-bottom:8px; font-size:15px; }
.co-repository-picker form > div { display:flex; align-items:center; gap:12px; }
.co-repository-picker input { min-width:0; width:100%; min-height:44px; padding:10px 12px; font-size:16px; color:var(--text); background:var(--surface); border:1px solid var(--border); border-radius:8px; }
.co-repository-picker p { color:var(--muted); font-size:14px; line-height:1.5; }
.co-repository-note { position:absolute; right:0; top:100%; z-index:5; width:min(320px,calc(100vw - 36px)); padding:16px; border:1px solid var(--border); border-radius:12px; background:var(--bg); }
@media(max-width:520px) {
 .co-view-heading { display:flex; align-items:center; gap:8px; }
 .co-view-heading h2 { white-space:nowrap; }
 .co-project-view-actions { flex-direction:row; align-items:center; gap:8px; }
 .co-project-view-actions { margin-left:auto; }
 .co-directory-filters { flex-wrap:nowrap; }
 .co-directory-filters button { flex:1; justify-content:center; padding-inline:10px; }
 .co-repository-picker form { position:fixed; left:8px; right:8px; top:auto; bottom:max(8px,env(safe-area-inset-bottom)); z-index:70; width:auto; max-height:calc(100dvh - 16px); overflow:auto; box-sizing:border-box; border-radius:18px; box-shadow:0 18px 58px color-mix(in srgb,#000 34%,transparent); }
 .co-repository-note { position:fixed; left:8px; right:8px; top:auto; bottom:max(8px,env(safe-area-inset-bottom)); width:auto; box-sizing:border-box; border-radius:18px; }
 .co-repository-picker form > div { display:grid; grid-template-columns:minmax(0,1fr) auto; }
}
.co-selection-page { width:100%; max-width:760px; margin:0 auto; padding:28px; }
.co-selection-page > .co-quiet-action { min-height:44px; margin-bottom:20px; }
.co-selection-page h2,.co-selection-page h3 { font-size:26px; line-height:1.25; letter-spacing:-.02em; }
.co-selection-page p { font-size:16px; line-height:1.6; color:var(--muted); }
.co-selection-page .co-pr-confirm { padding:0; border:0; background:none; }
.co-selection-page .co-board-actions { margin-top:24px; }
@media(max-width:680px) { .co-selection-page { padding:20px; } }
`
