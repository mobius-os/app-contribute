// Small keyed commit renderer for component lifecycle contracts, not a browser.
// It mounts the real function tree, honors React keys, retains hook state and
// runs dependency-sensitive cleanup. Missing DOM refs are intentional here.
let current
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
export const Fragment = Symbol('fragment')
export const jsx = (type, props, key) => ({ type, props: props || {}, key })
export const jsxs = jsx
export const createElement = (type, props, ...children) => jsx(type, { ...props, ...(children.length ? { children } : {}) }, props?.key)
export const createContext = value => ({ value })
export const useContext = context => context.value
export function useRef(value) {
  const i = current.index++
  return current.slots[i] ||= { current: value }
}
export function useState(initial) {
  const instance = current, i = instance.index++
  const slot = instance.slots[i] ||= { value: typeof initial === 'function' ? initial() : initial }
  return [slot.value, next => {
    if (!instance.mounted) return
    const value = typeof next === 'function' ? next(slot.value) : next
    if (!Object.is(value, slot.value)) { slot.value = value; instance.root.dirty = true }
  }]
}
export function useMemo(factory, deps) {
  const i = current.index++, old = current.slots[i]
  if (!old || !same(old.deps, deps)) current.slots[i] = { value: factory(), deps }
  return current.slots[i].value
}
export const useCallback = (fn, deps) => useMemo(() => fn, deps)
export const useId = () => useMemo(() => current.path, [])
export function useEffect(fn, deps) {
  const i = current.index++, old = current.slots[i]
  if (!old || !same(old.deps, deps)) {
    const slot = { deps, cleanup: old?.cleanup }
    current.slots[i] = slot
    current.root.effects.push(() => { slot.cleanup?.(); slot.cleanup = fn() })
  }
}
export const useLayoutEffect = useEffect
export default { createElement, Fragment }

export function mount(Component, props) {
  const root = { instances: new Map(), effects: [], dirty: true, tree: null }
  function retire(instance) { instance.mounted = false; for (const slot of instance.slots) slot?.cleanup?.() }
  function render(node, path, seen) {
    if (Array.isArray(node)) return node.map((child, i) => render(child, path + '/' + (child?.key ?? i), seen))
    if (!node || typeof node !== 'object') return node
    if (node.type === Fragment) return render(node.props.children, path + '/fragment', seen)
    if (typeof node.type === 'function') {
      let instance = root.instances.get(path)
      if (instance?.type !== node.type) {
        if (instance) retire(instance)
        instance = { root, path, type: node.type, slots: [], mounted: true }
        root.instances.set(path, instance)
      }
      seen.add(path); instance.index = 0; current = instance
      return render(node.type(node.props), path + '/output', seen)
    }
    return { ...node, props: { ...node.props, children: render(node.props.children, path + '/children', seen) } }
  }
  root.flush = () => {
    for (let n = 0; root.dirty; n++) {
      if (n > 30) throw new Error('mounted hook tree did not settle')
      root.dirty = false
      const seen = new Set()
      root.tree = render(jsx(Component, props), 'root', seen)
      for (const [path, instance] of root.instances) if (!seen.has(path)) { retire(instance); root.instances.delete(path) }
      for (const effect of root.effects.splice(0)) effect()
    }
  }
  root.update = next => { props = next; root.dirty = true; root.flush() }
  root.unmount = () => { for (const instance of root.instances.values()) retire(instance); root.instances.clear() }
  root.flush()
  return root
}
export function nodes(tree, match) {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, match))
  if (!tree || typeof tree !== 'object') return []
  return [...(match(tree) ? [tree] : []), ...nodes(tree.props?.children, match)]
}
export function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('')
  if (tree == null || typeof tree === 'boolean') return ''
  return typeof tree === 'object' ? text(tree.props.children) : String(tree)
}
