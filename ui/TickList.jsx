// Things to tick, each a word with a smaller line under it: what Respond to feedback will address, who an Ask will ask.
export function TickList({ items, onToggle, disabled, label }) {
  return <ul className="co-rw-checks" aria-label={label}>
    {items.map(item => <li key={item.key}>
      <label className="co-rw-check">
        <input type="checkbox" checked={item.checked} disabled={disabled} onChange={event => onToggle(item.key, event.target.checked)} />
        <span><strong>{item.label}</strong>{item.detail ? <small>{item.detail}</small> : null}</span>
      </label>
    </li>)}
  </ul>
}
