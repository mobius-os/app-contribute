// Project, inventory and contextual action: one adaptive workspace.
export const WORKSPACE_CSS = `
.co-header { width:100%; padding:18px 26px; border-bottom:1px solid var(--border); }
.co-page.is-sources { width:100%; max-width:none; padding:0; }
.co-projects-view:not(.is-focus) { max-width:1120px; margin:auto; padding:28px; }
.co-projects-view.is-focus { height:100%; padding:0; }
.co-project-layout { display:grid; grid-template-columns:196px minmax(0,1fr); height:100%; }
.co-project-rail { padding:18px 12px; background:var(--surface); border-right:1px solid var(--border); overflow:auto; }
.co-rail-search input { width:100%; min-height:44px; font-size:16px; padding:8px 10px; margin:12px 0; color:var(--text); background:var(--bg); border:1px solid var(--border); border-radius:8px; }
.co-rail-project { display:flex; align-items:center; gap:10px; width:100%; border:0; border-radius:9px; padding:14px 10px; background:none; color:var(--text); text-align:left; cursor:pointer; min-height:64px; }
.co-rail-project .co-source-glyph { width:30px; height:30px; flex-shrink:0; }
.co-rail-project span { min-width:0; }
.co-rail-project strong { display:block; font-size:15px; line-height:1.3; overflow-wrap:anywhere; }
.co-rail-project small { display:block; color:var(--muted); font-size:14px; line-height:1.35; margin-top:4px; }
.co-rail-project:hover { background:var(--bg); }
.co-rail-project.is-selected { background:var(--accent-dim); color:var(--accent); }
.co-workspace { min-width:0; display:flex; flex-direction:column; height:100%; background:var(--bg); }
.co-workspace-head { display:flex; flex-wrap:wrap; align-items:center; gap:20px; padding:24px 30px 16px; border-bottom:1px solid var(--border); }
.co-workspace-title { display:flex; align-items:center; gap:14px; flex:1; min-width:0; }
.co-workspace-title .co-source-glyph { display:none; }
.co-workspace-title h2 { font-size:30px; font-weight:680; line-height:1.2; letter-spacing:-.025em; margin:0; overflow-wrap:anywhere; }
.co-workspace-title p { font-size:14px; color:var(--muted); margin:8px 0 0; overflow-wrap:anywhere; }
.co-workspace-position { width:100%; display:flex; justify-content:space-between; align-items:center; gap:14px; font-size:14px; color:var(--muted); }
.co-workspace-body { display:grid; grid-template-columns:minmax(0,1fr) 350px; flex:1; min-height:0; }
.co-workspace-inventory { padding:28px; overflow:auto; min-width:0; }
.co-task-pane { background:var(--surface); border-left:1px solid var(--border); padding:26px; min-width:0; overflow:auto; padding-bottom:max(28px,env(safe-area-inset-bottom)); }
.co-task-content { outline-offset:4px; overflow-wrap:anywhere; }
.co-task-content > .co-icon { color:var(--accent); margin-bottom:12px; }
.co-task-content h3 { font-size:24px; font-weight:650; line-height:1.25; letter-spacing:-.02em; margin:0 0 16px; }
.co-task-content p { font-size:15px; color:var(--muted); line-height:1.6; margin:10px 0 20px; }
.co-task-back { margin:-10px 0 20px; }
.co-task-scope { padding:6px 0 24px; border-bottom:1px solid var(--border); margin-bottom:24px; }
.co-task-scope strong { font-size:15px; }
.co-task-scope p { font-size:14px; margin:4px 0 0; }
.co-task-primary { width:100%; margin-top:24px; white-space:normal; }
.co-task-content .co-workflow-option { align-items:flex-start; gap:12px; padding:0; border:0; background:none; font-size:15px; margin:0; }
.co-workflow-option small { display:block; margin-top:4px; font-size:14px; color:var(--muted); line-height:1.55; }
.co-task-content .co-task-footnote { font-size:14px; margin:10px 0 26px; }
.co-task-details { border-top:1px solid var(--border); padding-top:14px; }
.co-task-details summary { min-height:44px; display:flex; align-items:center; font-size:14px; cursor:pointer; color:var(--muted); }
.co-task-details summary::before { content:'+'; margin-right:10px; }
.co-task-details[open] summary::before { content:'−'; }
.co-task-progress { padding:16px 0; }
.co-task-progress .co-btn { width:100%; }
.co-task-steps { padding-left:20px; color:var(--muted); font-size:15px; }
.co-task-steps li { padding:7px 0; }
.co-local-work > header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }
.co-local-work > header h3 { font-size:18px; margin:0; }
.co-local-summary { display:flex; align-items:center; gap:14px; width:100%; padding:18px; text-align:left; min-height:88px; background:transparent; color:var(--text); border:1px solid var(--border); border-radius:12px; cursor:pointer; }
.co-local-summary > span { flex:1; min-width:0; }
.co-local-summary strong { font-size:15px; display:block; font-weight:600; }
.co-local-summary small { display:block; color:var(--muted); font-size:14px; margin-top:6px; }
.co-local-summary:hover { background:var(--surface); }
.co-work-progress-row { display:flex; width:100%; align-items:center; gap:10px; padding:14px 0; background:none; color:var(--accent); border:0; font-size:15px; cursor:pointer; }
.co-workspace-files { border-top:1px solid var(--border); width:100%; justify-content:space-between; margin-top:24px; padding-block:16px; }
.co-workspace .co-run { margin-top:28px; }
.co-workspace .co-run-primary { border:0; border-radius:0; border-bottom:1px solid var(--border); background:none; padding:16px 0; }
.co-workspace .co-run-focus-layout { display:block; }
.co-workspace .co-run-focus-summary { padding:0; background:none; border:0; }
.co-workspace .co-run-focus-summary > small { display:none; }
.co-workspace .co-run-focus-summary h3 { font-size:22px; }
.co-workspace .co-run-focus-detail { min-width:0; }
.co-workspace .co-run-focus-detail .co-card { border:0; background:none; }
.co-workspace .co-run-fold { border-radius:0; border:0; border-bottom:1px solid var(--border); }
.co-workspace .co-pr-workspace { border:0; border-radius:0; padding:0; margin-top:30px; background:none; }
.co-workspace .co-pr-workspace > summary { padding:0; font-size:18px; }
.co-workspace .co-pr-row { border-radius:0; border:0; border-bottom:1px solid var(--border); padding:18px 0; background:none; }
.co-workspace .co-pr-title { font-size:15px; line-height:1.45; font-weight:600; }
.co-workspace .co-pr-meta { font-size:14px; margin-top:5px; }
.co-workspace .co-pr-filters { flex-wrap:wrap; gap:4px; }
.co-workspace .co-pr-filters button { font-size:14px; min-height:44px; padding:8px 10px; }
.co-workspace .co-pr-filters button[aria-pressed=true] { color:var(--text); background:var(--surface); border-radius:8px; }
.co-workspace .co-pr-confirm, .co-workspace .co-pr-assignment { padding:0; background:none; border:0; border-radius:0; }
.co-workspace .co-pr-confirm ul { padding:0; list-style:none; }
.co-workspace .co-pr-confirm li { padding:14px 0; border-bottom:1px solid var(--border); }
.co-workspace .co-pr-confirm li span { font-size:14px; overflow-wrap:anywhere; }
.co-workspace .co-pr-confirm .co-board-actions { flex-direction:column; align-items:stretch; margin-top:24px; }
.co-workspace .co-pr-confirm .co-board-actions .co-btn { width:100%; white-space:normal; }
.co-workspace .co-pr-selection { background:none; border:0; padding:0; }
.co-workspace input:not([type=checkbox]), .co-workspace select { font-size:16px; }
.co-workspace input[type=checkbox] { width:18px; height:18px; accent-color:var(--accent); flex-shrink:0; }
.co-workspace .co-quiet-action, .co-workspace summary, .co-project-rail .co-quiet-action { min-height:44px; }
.co-workspace .co-pr-select { min-width:44px; min-height:44px; }
.co-workspace :is(button,a,summary) { text-underline-offset:3px; }
.co-workspace ::selection { color:var(--text); background:var(--accent-dim); }
.co-workspace :is(input,textarea) { caret-color:var(--accent); }
.co-workspace-inventory,.co-task-pane,.co-project-rail { scrollbar-width:thin; scrollbar-color:var(--border) transparent; }
@media(min-width:681px) {
 .co-page:has(.co-projects-view.is-focus) { overflow:hidden; }
}
@media(max-width:1150px) {
 .co-project-layout { grid-template-columns:170px minmax(0,1fr); }
 .co-workspace-body { grid-template-columns:minmax(0,1fr) 310px; }
 .co-workspace-inventory,.co-task-pane { padding:22px; }
}
@media(max-width:950px) {
 .co-project-layout { display:flex; flex-direction:column; }
 .co-project-rail { flex-shrink:0; padding:4px 22px; border-right:0; border-bottom:1px solid var(--border); }
 .co-project-rail > label,.co-project-rail > div { display:none; }
 .co-workspace { flex:1; min-height:0; }
}
@media(max-width:680px) {
 .co-header { padding:12px 18px; }
 .co-title { font-size:21px; }
 .co-projects-view:not(.is-focus) { padding:20px 18px; }
 .co-projects-view.is-focus,.co-project-layout,.co-workspace { height:auto; }
 .co-workspace-head { padding:22px 20px 14px; gap:12px; }
 .co-workspace-title h2 { font-size:27px; }
 .co-workspace-position { align-items:flex-start; flex-direction:column; gap:2px; }
 .co-workspace-body { display:block; }
 .co-workspace-inventory { padding:20px; }
 .co-task-pane { display:none; border:0; padding:22px; }
 .co-workspace.has-task .co-task-pane { display:block; min-height:65vh; }
 .co-workspace.has-task .co-workspace-head,.co-workspace.has-task .co-workspace-inventory { display:none; }
 .co-project-layout:has(.has-task) .co-project-rail { display:none; }
 .co-root:has(.co-workspace.has-task) .co-header-shell { display:none; }
 .co-workspace .co-pr-title { font-size:16px; }
 .co-task-content h3 { font-size:25px; }
}

.co-public-work { margin-top:32px; }
.co-public-work > header { display:flex; align-items:center; gap:10px; margin-bottom:16px; }
.co-public-work > header h3 { font-size:18px; margin:0; }
.co-public-work > header > span { color:var(--muted); font-size:14px; flex:1; }
.co-pr-open { background:none; border:0; text-align:left; color:var(--text); padding:0; cursor:pointer; width:100%; min-height:44px; }
.co-pr-open > span,.co-pr-open > strong { display:block; }
.co-pr-open:hover .co-pr-title { color:var(--accent); }
.co-work-state { display:inline-block !important; width:fit-content; border-radius:5px; background:var(--surface); padding:2px 7px; font-size:14px; color:var(--muted); margin-top:10px; }
.co-pr-row.is-selected .co-pr-title { color:var(--accent); }
.co-task-pulls > div { padding:14px 0; border-bottom:1px solid var(--border); }
.co-task-pulls strong { font-size:15px; display:block; }
.co-task-pulls a { display:inline-flex; align-items:center; font-size:14px; color:var(--accent); min-height:44px; }
.co-task-pulls p { margin:6px 0; }
.co-task-secondary { width:100%; margin-top:12px; }
.co-review-run-row { display:flex; gap:10px; flex-wrap:wrap; width:100%; padding:14px 0; background:none; color:var(--text); border:0; border-bottom:1px solid var(--border); text-align:left; cursor:pointer; }
.co-review-run-row span:first-child { flex:1; }
.co-work-empty { padding:24px 0; }
.co-work-empty strong { font-size:16px; }
.co-work-empty p { font-size:15px; color:var(--muted); }
.co-task-pane .co-run-approval { border:0; padding:0; background:none; }
.co-task-pane .co-run-approval-actions { display:flex; flex-direction:column-reverse; }
.co-task-pane .co-run-approval-actions .co-btn { white-space:normal; width:100%; }

.co-scope-row { display:grid; grid-template-columns:1fr auto; gap:6px 12px; width:100%; padding:16px 0; border:0; border-bottom:1px solid var(--border); background:none; color:var(--text); text-align:left; cursor:pointer; min-height:64px; }
.co-scope-row strong { font-size:15px; }
.co-scope-row span { font-size:14px; color:var(--muted); grid-column:1; }
.co-scope-row .co-icon { grid-column:2; grid-row:1 / 3; align-self:center; }
.co-scope-row:hover strong { color:var(--accent); }
.co-section-count { color:var(--muted); font-weight:400; font-size:14px; margin-left:6px; }
.co-task-content h4 { margin:28px 0 0; font-size:17px; }
.co-workspace .co-run-list { border:0; border-radius:0; }
.co-workspace .co-run-row { background:none; border-bottom:1px solid var(--border); }
`
