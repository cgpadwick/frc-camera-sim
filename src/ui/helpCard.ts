/**
 * On-demand guide: a "? Guide" button that expands a card with quick-start
 * steps and controls, plus a "replay first-run tips" action. The first-run
 * coach marks and checklist are one-shot — this card is how returning users
 * pull the instructions back up whenever they want.
 */

import { resetFirstRunFlags } from './coachMarks'
import { SETUP_DONE_KEY } from './setupChecklist'

export interface HelpCard {
  el: HTMLElement
  /** Collapse the card if open (Esc handling lives in main). */
  close(): void
}

export interface HelpCardOptions {
  /** Called after the first-run flags are cleared (main reloads the page). */
  onReplayTips(): void
}

const SECTIONS: { title: string; rows: string[] }[] = [
  {
    title: 'Quick start',
    rows: [
      '<b>① Build</b> — block out your robot with body shapes (cameras can’t see through them), ＋ Add camera, then aim each one with the Pitch/Yaw sliders.',
      '<b>② Analyze</b> — press <b>Analyze coverage</b> to sweep the whole field. The map shows tags visible at the worst-case robot heading; double-click any spot to inspect it.',
      '<b>③ Optimize</b> — let the solver refine your placement (or lay out fresh cameras), compare Yours vs Proposed, then Apply or Discard.',
      '<b>Report</b> — save a shareable coverage report with the maps, an interactive 3D robot viewer, and the camera mounting table.',
    ],
  },
  {
    title: 'Controls',
    rows: [
      '<b>V</b> — cycle field / camera views',
      '<b>F</b> — show / hide camera cones',
      '<b>← →</b> — rotate the robot (field view)',
      '<b>Drag the robot</b> to move it around the field',
      '<b>Double-click the field</b> — inspect coverage at that spot',
      '<b>Esc</b> — close popups and hints',
      '🌀 Left-drag orbit · right-drag pan · scroll zoom',
    ],
  },
]

export function createHelpCard(opts: HelpCardOptions): HelpCard {
  const root = document.createElement('div')
  root.className = 'help-card-wrap'

  const toggle = document.createElement('button')
  toggle.className = 'help-fab'
  toggle.textContent = '? Guide'
  toggle.title = 'How to use this tool'
  toggle.setAttribute('aria-expanded', 'false')

  const card = document.createElement('div')
  card.className = 'help-card'
  card.style.display = 'none'
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-label', 'Guide')

  for (const section of SECTIONS) {
    const h = document.createElement('div')
    h.className = 'help-card-title'
    h.textContent = section.title
    card.appendChild(h)
    for (const row of section.rows) {
      const div = document.createElement('div')
      div.className = 'help-card-row'
      div.innerHTML = row
      card.appendChild(div)
    }
  }

  const replay = document.createElement('button')
  replay.className = 'help-replay'
  replay.textContent = '↺ Replay first-run tips'
  replay.title = 'Bring back the setup checklist and hint bubbles (your robot and settings are kept)'
  replay.addEventListener('click', () => {
    resetFirstRunFlags()
    try {
      localStorage.removeItem(SETUP_DONE_KEY)
    } catch {
      /* ignore */
    }
    opts.onReplayTips()
  })
  card.appendChild(replay)

  function setOpen(open: boolean): void {
    card.style.display = open ? '' : 'none'
    toggle.setAttribute('aria-expanded', String(open))
  }
  toggle.addEventListener('click', () => setOpen(card.style.display === 'none'))

  root.append(toggle, card)
  return {
    el: root,
    close: () => setOpen(false),
  }
}
