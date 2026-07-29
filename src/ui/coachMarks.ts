/**
 * Minimal first-run coach marks: at most 3 sequential bubbles, each anchored
 * to a live element, each dismissible, whole sequence skippable. Shown once
 * per browser (localStorage flag). No modal walls of text — one short line
 * per mark (QA round 5, P1 item 8).
 */

const ONBOARD_KEY = 'frc-camera-sim.onboarded'
const INSPECT_KEY = 'frc-camera-sim.inspect-hinted'

function flagged(key: string): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1'
  } catch {
    return true // storage unavailable: never nag
  }
}

function setFlag(key: string): void {
  try {
    localStorage.setItem(key, '1')
  } catch {
    /* ignore */
  }
}

function bubble(anchor: HTMLElement, text: string, isLast: boolean, onNext: () => void, onSkip: () => void): HTMLElement {
  const el = document.createElement('div')
  el.className = 'coach-mark'
  el.setAttribute('role', 'status')
  const rect = anchor.getBoundingClientRect()
  el.style.left = `${Math.max(8, rect.left)}px`
  el.style.top = `${rect.bottom + 10}px`
  const label = document.createElement('span')
  label.textContent = text
  const next = document.createElement('button')
  next.textContent = isLast ? 'Got it' : 'Next'
  next.className = 'coach-next'
  next.addEventListener('click', onNext)
  el.append(label, next)
  if (!isLast) {
    const skip = document.createElement('button')
    skip.textContent = 'Skip'
    skip.addEventListener('click', onSkip)
    el.appendChild(skip)
  }
  document.body.appendChild(el)
  return el
}

/** Marks 1+2 on first-ever load: Robot tab, then Analyze coverage. */
export function showFirstRunMarks(anchors: { robotTab: HTMLElement; analyzeBtn: HTMLElement }): void {
  if (flagged(ONBOARD_KEY)) return
  const done = (): void => setFlag(ONBOARD_KEY)
  const mark1 = bubble(
    anchors.robotTab,
    'Set up your robot & cameras here',
    false,
    () => {
      mark1.remove()
      const mark2 = bubble(
        anchors.analyzeBtn,
        'Then see what your cameras cover',
        true,
        () => {
          mark2.remove()
          done()
        },
        () => {
          mark2.remove()
          done()
        },
      )
      // Anchor is at the bottom of the screen — flip the bubble above it.
      mark2.style.top = `${anchors.analyzeBtn.getBoundingClientRect().top - mark2.offsetHeight - 10}px`
    },
    () => {
      mark1.remove()
      done()
    },
  )
}

/** Mark 3, after the first sweep ever completes: inspect discoverability. */
export function showInspectMark(anchor: HTMLElement): void {
  if (flagged(INSPECT_KEY)) return
  setFlag(INSPECT_KEY)
  const mark = bubble(anchor, 'Double-click any spot on the field to inspect it', true, () => mark.remove(), () => mark.remove())
  mark.classList.add('coach-mark-inspect') // field-only: main hides it in Build
  mark.style.top = `${anchor.getBoundingClientRect().top - mark.offsetHeight - 10}px`
  setTimeout(() => mark.remove(), 15000)
}

/** True until the user has ever completed a sweep (drives the purpose chip). */
export function firstSweepPending(): boolean {
  return !flagged(INSPECT_KEY)
}

/** Forget the one-shot coach marks so they replay on next load (help card's "replay tips"). */
export function resetFirstRunFlags(): void {
  try {
    localStorage.removeItem(ONBOARD_KEY)
    localStorage.removeItem(INSPECT_KEY)
  } catch {
    /* ignore */
  }
}
