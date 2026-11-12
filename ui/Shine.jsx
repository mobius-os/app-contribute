// Words for something under way ("Merging…", "Loading changes…") carry a light that passes over them: the sweep the
// Send button has always had, for every line of that kind. The moving copy is drawn by CSS from `data-text`, so the
// words exist once in the page for anything that reads it; with reduced motion, or where text masks are missing, they
// simply stand still (theme.js). Only words that really are under way belong here: "Set aside…" opens a form.
export function Shine({ children }) {
  return <span className="co-shine" data-text={children}>{children}</span>
}

// The words of a result line, with `**#12**` bold and `` `main` `` as a chip: the number and the branch are what
// the owner looks for first.
export function Words({ text }) {
  return String(text || '').split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, index) => {
    if (part.startsWith('**')) return <b key={index}>{part.slice(2, -2)}</b>
    if (part.startsWith('`')) return <code key={index} className="co-chip-code">{part.slice(1, -1)}</code>
    return part
  })
}
