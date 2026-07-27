const DEFAULT_DURATION_MS = 5000

/**
 * Fire-and-forget transient error/status banner: appends a `div.toast` to
 * `document.body` and removes it after `durationMs`. DOM-only (browser),
 * reused by later tasks (13/15) for their own error surfaces — keep it
 * generic, not config-panel-specific.
 *
 * Passing `durationMs = Infinity` is the "persistent variant" (task 15's
 * field-model-unavailable banner): the toast never auto-dismisses and gains
 * a close button so it's still dismissible by the user.
 */
export function showToast(message: string, durationMs = DEFAULT_DURATION_MS): void {
  const el = document.createElement('div')
  el.className = 'toast'
  const text = document.createElement('span')
  text.textContent = message
  el.appendChild(text)
  document.body.appendChild(el)
  if (Number.isFinite(durationMs)) {
    setTimeout(() => el.remove(), durationMs)
    return
  }
  el.classList.add('toast-persistent')
  const closeBtn = document.createElement('button')
  closeBtn.className = 'toast-close'
  closeBtn.textContent = '×'
  closeBtn.setAttribute('aria-label', 'Dismiss')
  closeBtn.onclick = () => el.remove()
  el.appendChild(closeBtn)
}
