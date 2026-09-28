// The GitHub account is connected, upgraded, and disconnected in Möbius
// Settings, which owns the instance-wide credential. Contribute only reads
// /api/github/status (fetchGithubStatus in api.js) and sends the owner there.
// Settings navigation belongs to the host; the frame only asks for it.
export function openGithubSettings() {
  window.parent.postMessage({ type: 'moebius:open-settings', section: 'github' }, '*')
}
