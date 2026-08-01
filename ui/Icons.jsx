import React from 'react'
import {
  ArrowRotateCw,
  ArrowLeft,
  ArrowUp,
  Chat,
  ChevronDown,
  ChevronRight,
  SettingsCog,
  Trash,
} from '@openai/apps-sdk-ui/components/Icon'

const SDK_ICONS = {
  send: ArrowUp,
  feedback: Chat,
  trash: Trash,
  settings: SettingsCog,
  refresh: ArrowRotateCw,
  left: ArrowLeft,
  chevron: ChevronDown,
  right: ChevronRight,
}

const PATHS = {
  merge: <><circle cx="7" cy="5" r="2" /><circle cx="17" cy="19" r="2" /><path d="M7 7v5a7 7 0 0 0 7 7h1" /><path d="M17 17V9a4 4 0 0 0-4-4H9" /></>,
  github: <path d="M12 2.8a9.2 9.2 0 0 0-2.9 17.9c.5.1.6-.2.6-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 0 1.6 1.1 1.6 1.1.9 1.6 2.4 1.1 2.9.8.1-.7.4-1.1.7-1.4-2.2-.3-4.6-1.1-4.6-4.9 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.5 9.5 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.8-2.3 4.6-4.6 4.9.4.3.7 1 .7 1.9v2.7c0 .4.2.6.7.5A9.2 9.2 0 0 0 12 2.8Z" />,
}

export function Icon({ name, size = 18, ...props }) {
  const SdkIcon = SDK_ICONS[name]
  if (SdkIcon) {
    return <SdkIcon width={size} height={size} className="co-icon" aria-hidden="true" {...props} />
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
