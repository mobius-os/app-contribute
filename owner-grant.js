// The owner's own tap, proven by the shell. An app token alone is not the owner's hand: an installed app, or an app token an agent
// minted for itself, passes the platform's old check. So on a Möbius that advertises `owner_confirm`, a sensitive tap first asks the
// shell (window.mobius.ownerGrant.request) to confirm exactly this request on a sheet of its own, outside this frame, in words the
// platform builds from the identifiers sent here. The owner's tap records a one-time grant for that request; the app then repeats
// its normal request. A Möbius that does not advertise it has no such sheet: nothing here runs and the app's own sheets stay.
export const OWNER_CONFIRM_CAPABILITY = 'owner_confirm'

// Advertised by the host (review-presets `capabilities`) and the request function present on this page. That function is compiled into
// this app's own bundle, not supplied by the shell, so this check cannot tell a tab whose shell code is older: there the platform's ack
// and short timeout make the request fail fast with the platform's own sentence until the tab reloads, and askOwner shows that like a refusal.
export const ownerConfirmOffered = capabilities => capabilities?.[OWNER_CONFIRM_CAPABILITY] === true
  && typeof globalThis.window?.mobius?.ownerGrant?.request === 'function'

// Ask the owner to confirm `action` on exactly this `scope` and `body` (the route's path parameters and its request body).
// null: confirmed, so send the request. Otherwise the outcome to show instead, in the shape the action sheets already read:
// { cancelled } (the owner closed the sheet, or this frame was not showing) or { error } (the platform's own sentence: a refusal, or
// the request timing out). Nothing has been sent in either case.
export async function askOwner(action, scope, body) {
  try {
    return (await window.mobius.ownerGrant.request(action, scope, body)) ? null : { cancelled: true }
  } catch (error) {
    return { error: error?.message || 'Möbius did not confirm this. Nothing changed.' }
  }
}
