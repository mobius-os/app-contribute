import { useEffect, useMemo, useRef, useState } from 'react'
import { SYNC_POLICY } from '../refresh.js'
import { loadCycleState } from '../storage.js'
import { projectCycleIdentity } from '../source-map.js'
import { readProjectRuns, projectRunsLive, runProjects } from '../project-runs.js'
import { projectCyclePhase } from './useProjectCycle.js'

// The project runs the Desk lists (project-runs.js), read by the sync hub like the review runs: a platform read, never GitHub, every 10 s while a
// run is being sent or at work and every 30 s otherwise, and once more when the frame is shown again. The projects' own page keeps its closer watch
// while it is open. A read that fails leaves what is shown as it was.
export function useProjectRuns({ hub, enabled, projects }) {
  const [runs, setRuns] = useState([])
  const shown = useRef([])
  const followed = useMemo(() => runProjects(projects, projectCycleIdentity), [projects])
  const latest = useRef(followed)
  latest.current = followed
  const followedKey = followed.map(project => project.key).sort().join('|')
  useEffect(() => {
    if (!enabled || !hub) return undefined
    return hub.fact('projectRuns', {
      read: () => readProjectRuns(latest.current, { loadState: loadCycleState, chatStatus: chatId => window.mobius.chat.status(chatId), phaseOf: projectCyclePhase, previous: shown.current }),
      apply: list => { shown.current = list; setRuns(list) },
      failed: () => {},
      every: { live: SYNC_POLICY.runsLiveMs, idle: SYNC_POLICY.runsIdleMs },
      live: projectRunsLive,
    })
  }, [hub, enabled])
  // The first read, and the next one when a project joins the list.
  useEffect(() => {
    if (enabled && hub && followedKey) void hub.refresh('projectRuns')
  }, [hub, enabled, followedKey])
  return runs
}
