import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icons.jsx'

const PROVIDER_ORDER = ['codex', 'claude', 'mobius']
const PROVIDER_LABELS = {
  codex: 'OpenAI Codex',
  claude: 'Claude Code',
  mobius: 'Möbius subscription',
}

function effortLabel(value) {
  if (value === 'xhigh') return 'Extra high'
  return String(value || '').replace(/[-_]+/g, ' ').replace(/^./, letter => letter.toUpperCase())
}

export function effortOptions(model) {
  const values = Array.isArray(model?.effort_levels) ? model.effort_levels : []
  return [...new Set(values.filter(value => typeof value === 'string' && value))]
}

export function preferredEffort(model, current) {
  const efforts = effortOptions(model)
  if (efforts.includes(current)) return current
  if (efforts.includes(model?.default_effort)) return model.default_effort
  if (efforts.includes('medium')) return 'medium'
  return efforts[0] || ''
}

export function filterModelRegistry(registry, query = '') {
  const needle = query.trim().toLowerCase()
  const providers = Object.keys(registry || {})
  const ordered = [...PROVIDER_ORDER.filter(provider => providers.includes(provider)), ...providers.filter(provider => !PROVIDER_ORDER.includes(provider)).sort()]
  return ordered.map(provider => ({
    provider,
    label: PROVIDER_LABELS[provider] || provider.replace(/[-_]+/g, ' ').replace(/^./, letter => letter.toUpperCase()),
    models: (registry?.[provider] || []).filter(model => !needle || `${model.label || ''} ${model.id} ${PROVIDER_LABELS[provider] || provider}`.toLowerCase().includes(needle)),
  })).filter(group => group.models.length)
}

export function AgentModelSettings({ token, choice, onChange }) {
  const [registry, setRegistry] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const [modelsResponse, prefsResponse] = await Promise.all([
          fetch('/api/models', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/owner/model-prefs', { headers: { Authorization: `Bearer ${token}` } }),
        ])
        if (!modelsResponse.ok) throw new Error('models')
        const models = await modelsResponse.json()
        const prefs = prefsResponse.ok ? await prefsResponse.json() : {}
        const hidden = new Set(Array.isArray(prefs?.hidden_ids) ? prefs.hidden_ids : [])
        const next = Object.fromEntries(Object.entries(models?.providers || {}).map(([provider, rows]) => [
          provider,
          (Array.isArray(rows) ? rows : []).filter(row => row?.id && row.available !== false && (!hidden.has(row.id) || row.id === choice?.model)),
        ]))
        if (!cancelled) setRegistry(next)
      } catch {
        if (!cancelled) setError('Could not load the current chat models.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [token])

  const selectedModel = useMemo(() => {
    if (!choice?.model) return null
    return (registry?.[choice.provider] || []).find(row => row.id === choice.model)
      || { id: choice.model, label: choice.model }
  }, [registry, choice?.provider, choice?.model])
  const efforts = choice?.model ? effortOptions(selectedModel) : []
  const selectedEffort = choice?.model ? preferredEffort(selectedModel, choice.effort) : ''
  const visibleProviders = useMemo(() => filterModelRegistry(registry, query), [registry, query])

  useEffect(() => {
    if (!pickerOpen) return
    searchRef.current?.focus()
    const close = event => {
      if (event.key === 'Escape') setPickerOpen(false)
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [pickerOpen])

  async function save(next) {
    setSaving(true)
    setSaveError('')
    const ok = await onChange?.(next)
    if (!ok) setSaveError('Could not save this choice. Try again when you are online.')
    setSaving(false)
    return !!ok
  }

  async function chooseModel(provider, model) {
    const ok = provider && model
      ? await save({ provider, model: model.id, effort: preferredEffort(model, choice?.effort) })
      : await save({ provider: '', model: '', effort: '' })
    if (ok) {
      setPickerOpen(false)
      setQuery('')
    }
  }

  return (
    <section className="co-agent-model-settings" aria-labelledby="co-agent-model-heading">
      <div>
        <strong id="co-agent-model-heading">Agent work</strong>
        <p>Choose the model for new work started from Contribute. Existing conversations keep their current model.</p>
      </div>
      <div className="co-model-field">
        <span>Model</span>
        <button
          type="button"
          className="co-model-trigger"
          aria-expanded={pickerOpen}
          aria-controls="co-agent-model-picker"
          disabled={loading || saving}
          onClick={() => setPickerOpen(open => !open)}
        >
          <span>{choice?.model ? selectedModel?.label || selectedModel?.id : 'Use chat default'}</span>
          <Icon name="chevron" size={16} />
        </button>
      </div>
      {choice?.model && efforts.length ? <div className="co-effort-field">
        <span>Effort</span>
        <div className="co-effort-options" role="group" aria-label="Agent effort">
          {efforts.map(value => <button type="button" key={value} aria-pressed={selectedEffort === value} disabled={saving} onClick={() => void save({ ...choice, effort: value })}>{effortLabel(value)}</button>)}
        </div>
      </div> : null}
      {pickerOpen ? <div className="co-model-picker" id="co-agent-model-picker">
        <label className="co-model-search"><Icon name="search" size={17} /><input ref={searchRef} type="search" aria-label="Find a model" placeholder="Find a model" value={query} onChange={event => setQuery(event.target.value)} /></label>
        {!query.trim() ? <button type="button" className="co-model-option" aria-pressed={!choice?.model} disabled={saving} onClick={() => void chooseModel('', null)}><span><strong>Use chat default</strong><small>Follow your current chat preference</small></span>{!choice?.model ? <Icon name="check" size={17} /> : null}</button> : null}
        {visibleProviders.map(group => <section className="co-model-group" key={group.provider} aria-label={group.label}>
          <h4>{group.label}</h4>
          {group.models.map(model => {
            const selected = choice?.provider === group.provider && choice?.model === model.id
            return <button type="button" className="co-model-option" key={model.id} aria-pressed={selected} disabled={saving} onClick={() => void chooseModel(group.provider, model)}><span><strong>{model.label || model.id}</strong></span>{selected ? <Icon name="check" size={17} /> : null}</button>
          })}
        </section>)}
        {!visibleProviders.length ? <p className="co-model-empty">No matching models.</p> : null}
      </div> : null}
      {loading ? <small role="status">Loading chat models…</small> : null}
      {error ? <small role="status">{error} Your chat default will still be used.</small> : null}
      {saveError ? <small className="is-error" role="status">{saveError}</small> : null}
    </section>
  )
}
