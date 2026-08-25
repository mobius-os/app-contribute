import React from 'react'
import {
  ArrowRotateCw,
  ArrowLeft,
  ArrowUp,
  Chat,
  ChevronDown,
  ChevronRight,
  InfoCircle,
  Trash,
} from '@openai/apps-sdk-ui/components/Icon'

const SDK_ICONS = {
  send: ArrowUp,
  feedback: Chat,
  trash: Trash,
  refresh: ArrowRotateCw,
  left: ArrowLeft,
  chevron: ChevronDown,
  right: ChevronRight,
  info: InfoCircle,
}

const PATHS = {
  merge: <><circle cx="7" cy="5" r="2" /><circle cx="17" cy="19" r="2" /><path d="M7 7v5a7 7 0 0 0 7 7h1" /><path d="M17 17V9a4 4 0 0 0-4-4H9" /></>,
  github: <path d="M12 2.8a9.2 9.2 0 0 0-2.9 17.9c.5.1.6-.2.6-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 0 1.6 1.1 1.6 1.1.9 1.6 2.4 1.1 2.9.8.1-.7.4-1.1.7-1.4-2.2-.3-4.6-1.1-4.6-4.9 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.5 9.5 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.8-2.3 4.6-4.6 4.9.4.3.7 1 .7 1.9v2.7c0 .4.2.6.7.5A9.2 9.2 0 0 0 12 2.8Z" />,
  review: <><path d="M3 12s3.4-5 9-5 9 5 9 5-3.4 5-9 5-9-5-9-5Z" /><circle cx="12" cy="12" r="2" /></>,
  check: <path d="m5 12 4 4 10-10" />,
  fix: <><path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-3-3Z" /></>,
  cycle: <><path d="M20 7h-6V1" /><path d="M4 17h6v6" /><path d="M20 7a9 9 0 0 0-15-2" /><path d="M4 17a9 9 0 0 0 15 2" /></>,
}

export function Icon({ name, size = 18, ...props }) {
  const SdkIcon = SDK_ICONS[name]
  if (SdkIcon) {
    return <SdkIcon width={size} height={size} className="co-icon" aria-hidden="true" {...props} />
  }
  // GitHub's mark is a filled silhouette rather than a stroked interface
  // glyph. Keeping that distinction here prevents it from looking like a
  // hand-drawn approximation while the rest of the chrome stays stroke-based.
  if (name === 'github') {
    return (
      <svg
        className="co-icon"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="currentColor"
        aria-hidden="true"
        {...props}
      >
        {PATHS.github}
      </svg>
    )
  }
  return (
    <svg
      className="co-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {PATHS[name] || null}
    </svg>
  )
}
