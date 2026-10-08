import { useEffect, useState } from 'react'
import { loadWorkflowOptions, previewWorkflow, saveWorkflowOptions, reviewOptions, workflowAgent } from '../review-prompts.js'

const PROMPTS = [['review_prompt','Review'],['fix_prompt','Fix'],['merge_prompt','Merge decision']]
export const PROMPT_CSS = `
.co-prompt-settings { margin:20px 0; padding:20px 0; border-top:1px solid var(--border); }
.co-prompt-choices { display:flex; gap:6px; margin:14px 0 8px; }
.co-prompt-choices button { min-height:44px; min-width:44px; padding:8px 14px; border:0; border-radius:7px; color:var(--muted); background:none; font:inherit; cursor:pointer; }
.co-prompt-choices button[aria-pressed=true] { color:var(--accent); background:var(--accent-dim); }
.co-prompt-settings h3 { margin:0 0 8px; font-size:18px; }
.co-prompt-settings p { font-size:14px; line-height:1.5; color:var(--muted); }
.co-prompt-settings label { display:block; margin:14px 0 6px; font-size:14px; }
.co-prompt-settings textarea { box-sizing:border-box; width:100%; min-height:120px; padding:12px; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--text); font:inherit; font-size:16px; line-height:1.5; resize:vertical; }
.co-prompt-settings summary { min-height:44px; display:flex; align-items:center; cursor:pointer; font-size:14px; }
.co-prompt-settings pre,.co-resolved-prompt { white-space:pre-wrap; overflow-wrap:anywhere; max-height:360px; overflow:auto; font:inherit; font-size:14px; line-height:1.5; background:var(--bg); padding:12px; border-radius:8px; }
.co-prompt-settings textarea:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
`

export function ResolvedPrompt({ snapshot }) {
  const [active, setActive] = useState('review_prompt')
  if (!snapshot) return null
  const value = snapshot.options || snapshot.snapshot || snapshot
  return <section className="co-prompt-settings" aria-label="Instructions used"><style>{PROMPT_CSS}</style>
    <PromptChoices active={active} onChange={setActive} />
    <pre className="co-resolved-prompt">{value[active] || 'No instructions recorded for this step.'}</pre>
  </section>
}

function PromptChoices({ active, onChange }) {
  return <div className="co-prompt-choices" role="group" aria-label="Prompt to inspect">{PROMPTS.map(([key,label]) => <button type="button" key={key} aria-pressed={key === active} onClick={()=>onChange(key)}>{label}</button>)}</div>
}

export function ReviewPromptSettings({ token, appId }) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
  const [retry,setRetry]=useState(0),[active,setActive]=useState('review_prompt')
  useEffect(() => { let alive=true; setData(null);setError('');loadWorkflowOptions(token,appId).then(value=>{if(alive)setData(value)}).catch(error=>{if(alive)setError(error.message)});return()=>{alive=false} },[token,appId,retry])
  function change(key,value) { setData(old=>({...old,options:{...old.options,[key]:value}}));setNotice('') }
  async function save() { setBusy(true);setError('');setNotice('');try { const receipt=await saveWorkflowOptions(data.options,data.version);setData(old=>({...old,version:receipt.version}));setNotice('Saved for new review workflows. Existing runs are unchanged.') } catch(error) { setError(error.status===412 ? 'These settings changed elsewhere. Reload before saving; your edits have not replaced them.' : error.message) } finally {setBusy(false)} }
  return <section className="co-prompt-settings" aria-label="Review workflow settings"><style>{PROMPT_CSS}</style>
    {!data && !error ? <div className="co-settings-skeleton" role="status">Loading settings…</div> : null}
    {data ? <>
      <p>Edit guidance for new runs. Existing runs stay unchanged.</p>
      <PromptChoices active={active} onChange={setActive} />
      <div className="co-prompt-editor-group"><label className="co-visually-hidden" htmlFor={`co-${active}`}>{PROMPTS.find(([key])=>key===active)[1]} prompt</label><textarea id={`co-${active}`} value={data.options[active] || ''} maxLength={16000} onChange={e=>change(active,e.target.value)} /><button type="button" className="co-quiet-action" onClick={()=>change(active,data.defaults[active])}>Restore this prompt</button></div>
      <div className="co-board-actions"><button type="button" className="co-btn co-btn-primary" disabled={busy} onClick={save}>Save defaults</button></div>
    </> : null}
    {error ? <p role="alert">{error} <button className="co-quiet-action" disabled={busy} onClick={()=>setRetry(x=>x+1)}>{data ? 'Reload settings' : 'Retry'}</button></p> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </section>
}

export function ReviewPromptPreview({ token, appId, choice, onResolved }) {
  const [state,setState]=useState({loading:true})
  const [retry,setRetry]=useState(0)
  const optionKey = JSON.stringify(choice?.options || null)
  const agentKey = JSON.stringify(workflowAgent(choice?.agent) || null)
  useEffect(() => {
    if (!choice) return
    let alive=true; setState({loading:true});onResolved?.(null)
    async function resolve() {
      const data=await loadWorkflowOptions(token,appId)
      // Frozen selections keep their exact options; defaults apply only to new work.
      const options=reviewOptions(choice.options,choice.preview_sha256 ? undefined : data.options)
      if(choice.mode === 'review_fix_merge' && !choice.preview_sha256) options.autopilot=true
      if(choice.mode !== 'review') delete options.post_review
      const agent=workflowAgent(choice.agent)
      const preview=await previewWorkflow(token,appId,choice.mode,options,agent)
      if(choice.preview_sha256 && choice.preview_sha256!==preview.preview_sha256) throw new Error('The saved instructions or model changed. Ask the agent to prepare a fresh review link; nothing was started.')
      return {options,agent,preview,capabilities:data.capabilities}
    }
    resolve().then(value=>{if(alive){setState(value);onResolved?.(value)}}).catch(error=>{if(alive)setState({error:error.message})})
    return()=>{alive=false}
  },[token,appId,choice?.request_id,choice?.mode,choice?.preview_sha256,optionKey,agentKey,retry])
  return state.error ? <p role="alert">Could not check this run: {state.error} <button className="co-quiet-action" onClick={()=>setRetry(x=>x+1)}>Retry</button></p> : null
}
