export function createRefreshCoordinator(refresh) {
  let active = null
  let rerun = false

  return function requestRefresh() {
    if (active) {
      rerun = true
      return active
    }
    active = (async () => {
      do {
        rerun = false
        await refresh()
      } while (rerun)
    })().finally(() => { active = null })
    return active
  }
}

export function isVisibleFrameMessage(event, parentWindow) {
  return event?.source === parentWindow
    && event?.data?.type === 'moebius:frame-visibility'
    && event.data.visible === true
}
