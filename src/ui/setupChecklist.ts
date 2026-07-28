/**
 * First-run setup checklist for the Build view (QA round 7A): four ordered
 * steps that tick live with app state. Soft guidance only — nothing gates.
 * Never returns once completed or dismissed (localStorage flag).
 */

export const SETUP_DONE_KEY = 'frc-camera-sim.setup-done'

export interface SetupState {
  /** User touched/resized/added/removed a body shape this profile (default box untouched = false). */
  bodyShapeTouched: boolean
  cameraCount: number
  /** Any camera aim/mount/parameter edit (drag, slider, or field). */
  cameraAimed: boolean
  hasSweep: boolean
}

export interface ChecklistRow {
  label: string
  hint: string
  done: boolean
  /** The single row the user should do next. */
  active: boolean
}

/** Pure: state -> ordered rows + completion. Active = first not-done row. */
export function computeChecklist(s: SetupState): { rows: ChecklistRow[]; allDone: boolean } {
  const done = [s.bodyShapeTouched, s.cameraCount > 0, s.cameraAimed && s.cameraCount > 0, s.hasSweep]
  const firstOpen = done.indexOf(false)
  const defs: [string, string][] = [
    ['Add your robot’s superstructure', 'Use ▦ Add body shape to block out elevators and intakes — cameras can’t see through them.'],
    ['Add your cameras', '＋ Add camera, then click a spot on the robot.'],
    ['Aim them', 'Use the Pitch/Yaw sliders on each camera card.'],
    ['Analyze your coverage', 'Click ② Analyze, then press the Analyze coverage button.'],
  ]
  return {
    rows: defs.map(([label, hint], i) => ({ label, hint, done: done[i], active: i === firstOpen })),
    allDone: firstOpen === -1,
  }
}

function flagged(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(SETUP_DONE_KEY) === '1'
  } catch {
    return true
  }
}

function setFlag(): void {
  try {
    localStorage.setItem(SETUP_DONE_KEY, '1')
  } catch {
    /* ignore */
  }
}

export interface SetupChecklist {
  el: HTMLElement
  /** Re-render from state; auto-completes (and flags) when all rows tick. */
  update(state: SetupState): void
  /** True once dismissed or completed — callers can skip update() work. */
  finished(): boolean
  /** Fires once when rows 1–3 are done but 4 isn't — main pulses step ② Analyze. */
  onReadyToAnalyze(cb: () => void): void
}

export function createSetupChecklist(): SetupChecklist {
  const el = document.createElement('div')
  el.className = 'setup-checklist'
  el.setAttribute('role', 'status')
  let finished = flagged()
  let readyFired = false
  let readyCb: (() => void) | null = null
  if (finished) el.style.display = 'none'

  const title = document.createElement('div')
  title.className = 'setup-checklist-title'
  const titleText = document.createElement('span')
  titleText.textContent = 'Set up your robot'
  const closeBtn = document.createElement('button')
  closeBtn.textContent = '✕'
  closeBtn.title = 'Dismiss this guide'
  closeBtn.setAttribute('aria-label', 'Dismiss setup guide')
  closeBtn.addEventListener('click', () => {
    finished = true
    setFlag()
    el.style.display = 'none'
  })
  title.append(titleText, closeBtn)
  el.appendChild(title)

  const list = document.createElement('ol')
  list.className = 'setup-checklist-list'
  el.appendChild(list)

  return {
    el,
    finished: () => finished,
    onReadyToAnalyze(cb) {
      readyCb = cb
    },
    update(state) {
      if (finished) return
      const { rows, allDone } = computeChecklist(state)
      list.replaceChildren(
        ...rows.map((row) => {
          const li = document.createElement('li')
          li.className = row.done ? 'done' : row.active ? 'active' : ''
          const mark = document.createElement('span')
          mark.className = 'setup-mark'
          mark.textContent = row.done ? '✓' : '☐'
          const body = document.createElement('span')
          const label = document.createElement('span')
          label.className = 'setup-label'
          label.textContent = row.label
          body.appendChild(label)
          if (row.active) {
            const hint = document.createElement('span')
            hint.className = 'setup-hint'
            hint.textContent = row.hint
            body.appendChild(hint)
          }
          li.append(mark, body)
          return li
        }),
      )
      if (!readyFired && rows[3].active) {
        readyFired = true
        readyCb?.()
      }
      if (allDone) {
        finished = true
        setFlag()
        titleText.textContent = 'Setup complete 🎉'
        closeBtn.focus()
        setTimeout(() => {
          el.style.display = 'none'
        }, 4000)
      }
    },
  }
}

/**
 * Pure: which parts of the robot changed between two configs — drives the
 * checklist's touch flags (QA round 7b fix 1: panel edits must count the
 * same as 3D gizmo edits).
 */
export function diffRobotEdits(
  prev: { superstructure: unknown[]; cameras: unknown[] },
  next: { superstructure: unknown[]; cameras: unknown[] },
): { boxesChanged: boolean; camerasChanged: boolean } {
  return {
    boxesChanged: JSON.stringify(prev.superstructure) !== JSON.stringify(next.superstructure),
    camerasChanged: JSON.stringify(prev.cameras) !== JSON.stringify(next.cameras),
  }
}
