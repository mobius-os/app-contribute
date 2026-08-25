import { useEffect, useState } from 'react'
import { projectIconUrl } from '../source-map.js'

export function ProjectIcon({ project, className = '' }) {
  const src = projectIconUrl(project)
  const [failed, setFailed] = useState(false)
  const letter = String(project?.name || '?').trim().charAt(0).toUpperCase() || '?'

  useEffect(() => setFailed(false), [src])

  return (
    <span
      className={`co-project-icon ${className}${src && !failed ? ' has-image' : ''}`}
      aria-hidden="true"
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : letter}
    </span>
  )
}
