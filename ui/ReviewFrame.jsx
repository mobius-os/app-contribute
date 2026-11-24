import { useLayoutEffect, useRef, useState } from 'react'
import { cometLayers, cometSeconds, rippleWave, roundedRectPerimeter } from '../review-frame.js'

// A frame around whatever is being reviewed. While an agent works, one comet
// with a soft tail travels along a faint base frame; when the review waits on
// the owner the frame holds still and amber. `state` is 'reviewing', 'verdict'
// or 'idle' (no frame). The outline is measured, so the comet follows any size
// of card around its rounded corners. Motion is CSS only.
// `look` is how work shows: 'ring' (the comet frame) or 'wave' for a list row. A ring drawn inside a flat,
// hairline-separated row read as a box inside the list's box (the owner's choice, 24 Nov), so a row at work
// gets a soft wave of light that spreads from its status icon over the whole row instead. A review waiting
// on the owner keeps the still amber frame in both looks. It is one component either way, so a row never
// remounts (and loses its focus and open panes) when its review starts or ends.
export function ReviewFrame({ state = 'idle', inset = 0, radius = 12, look = 'ring', className = '', children }) {
  const box = useRef(null)
  const [size, setSize] = useState(null)
  const [wave, setWave] = useState(null)
  const rippling = look === 'wave' && state === 'reviewing'
  useLayoutEffect(() => {
    const node = box.current
    if (!node || state === 'idle') return undefined
    const measure = () => {
      setSize(old => old && old.width === node.clientWidth && old.height === node.clientHeight
        ? old : { width: node.clientWidth, height: node.clientHeight })
      if (rippling) setWave(old => sameWave(old, rippleWave(node.getBoundingClientRect(), node.querySelector(STATUS_ICON)?.getBoundingClientRect())))
    }
    measure()
    if (!window.ResizeObserver) return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [state, rippling])
  const ring = state !== 'idle' && !rippling && size && size.width > 2 * inset && size.height > 2 * inset
  return <div ref={box} className={'co-frame ' + (rippling ? 'co-frame-row ' : '') + className} data-frame={state} style={{ '--frame-radius': radius + 'px' }}>
    {ring ? <FrameRing state={state} width={size.width - 2 * inset} height={size.height - 2 * inset} inset={inset} radius={radius} /> : null}
    {rippling && wave ? <Ripple wave={wave} /> : null}
    {children}
  </div>
}

// The wave starts at the row's status icon (a PR's state icon, or a Desk row's attention icon).
const STATUS_ICON = '.co-gh-state, .co-desk-attention-icon'
const sameWave = (old, next) => old && old.x === next.x && old.y === next.y && old.diameter === next.diameter ? old : next

// The layer clips the wave, so the row itself never clips its Actions menu.
function Ripple({ wave }) {
  return <span className="co-ripple" aria-hidden="true" style={{ '--ripple-x': wave.x + 'px', '--ripple-y': wave.y + 'px', '--ripple-d': wave.diameter + 'px' }} />
}

function FrameRing({ state, width, height, inset, radius }) {
  const stroke = state === 'reviewing' ? 3 : 2
  const r = Math.max(0, radius - inset - stroke / 2)
  const w = width - stroke, h = height - stroke
  const outline = { x: inset + stroke / 2, y: inset + stroke / 2, width: w, height: h, rx: r, strokeWidth: stroke }
  const perimeter = roundedRectPerimeter(w, h, r)
  return <svg className="co-frame-svg" viewBox={`0 0 ${width + 2 * inset} ${height + 2 * inset}`} aria-hidden="true" focusable="false">
    <rect className="co-frame-track" {...outline} />
    {state === 'reviewing' ? cometLayers(perimeter).map((layer, index) => <rect key={index} className="co-frame-comet" {...outline}
      strokeOpacity={layer.opacity} strokeDasharray={`${layer.length} ${layer.gap}`}
      style={{ '--L': layer.length + 'px', '--lap': perimeter + 'px', animationDuration: cometSeconds(perimeter) + 's' }} />) : null}
  </svg>
}
