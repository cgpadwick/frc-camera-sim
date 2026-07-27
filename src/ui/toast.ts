const DEFAULT_DURATION_MS = 5000

/**
 * Fire-and-forget transient error/status banner: appends a `div.toast` to
 * `document.body` and removes it after `durationMs`. DOM-only (browser),
 * reused by later tasks (13/15) for their own error surfaces — keep it
 * generic, not config-panel-specific.
 */
export function showToast(message: string, durationMs = DEFAULT_DURATION_MS): void {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => el.remove(), durationMs)
}
