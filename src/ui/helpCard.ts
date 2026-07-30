/**
 * On-demand guide: a "? Guide" button that expands a card with quick-start
 * steps and controls, plus a link back to the Start-here intro. This card is
 * how returning users pull the instructions back up whenever they want.
 *
 * Content is context-specific: the Build tab and the Field tab have
 * different controls, so each mode gets its own sections (a field-only
 * shortcut like V must never be advertised in Build).
 */

export type HelpMode = 'field' | 'robot'

export interface HelpCard {
  el: HTMLElement
  /** Collapse the card if open (Esc handling lives in main). */
  close(): void
  /** Swap the card's content to the active tab's instructions. */
  setMode(mode: HelpMode): void
}

export interface HelpCardOptions {
  /** Re-open the Start-here intro card. */
  onShowStartHere(): void
}

interface Section {
  title: string
  rows: string[]
}

const CONTENT: Record<HelpMode, Section[]> = {
  robot: [
    {
      title: 'Build your robot',
      rows: [
        '▦ <b>Add body shape</b> to block out elevators and intakes — cameras can’t see through them.',
        '➕ <b>Add camera</b>, then click a spot on the robot. It aims out of the face it sits on.',
        '🖱 <b>Drag a camera</b> to slide it across the robot; fine-tune aim with the <b>Pitch/Yaw sliders</b> on its card.',
        '▦ <b>Click a body shape</b> to move/rotate/scale it with the gizmo · <b>Delete</b> removes it.',
        'Done building? Press <b>② Analyze</b> to see what your cameras cover.',
      ],
    },
    {
      title: 'Controls (Robot Setup tab)',
      rows: [
        '<b>F</b> — show / hide camera view cones',
        '<b>Esc</b> — deselect / close popups',
        '🌀 Left-drag orbit · right-drag pan · scroll zoom',
      ],
    },
  ],
  field: [
    {
      title: 'Analyze & optimize',
      rows: [
        '<b>Analyze coverage</b> sweeps the whole field — the map shows tags visible at the <b>worst-case robot heading</b>.',
        '<b>Double-click any spot</b> on the field to inspect exactly which cameras see which tags there.',
        '<b>Optimize</b> — refine your placement or lay out fresh cameras, compare Yours vs Proposed, then Apply or Discard.',
        '<b>Report</b> — save a shareable coverage report with the maps, an interactive 3D robot viewer, and the mounting table.',
      ],
    },
    {
      title: 'Controls (Field tab)',
      rows: [
        '<b>V</b> — cycle field / camera views',
        '<b>F</b> — show / hide camera cones',
        '<b>← →</b> — rotate the robot',
        '<b>Drag the robot</b> to move it around the field',
        '<b>Esc</b> — close popups and hints',
        '🌀 Left-drag orbit · right-drag pan · scroll zoom · <b>⟲ Reset</b> re-centers',
      ],
    },
  ],
}

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

  const content = document.createElement('div')
  card.appendChild(content)

  function render(mode: HelpMode): void {
    content.replaceChildren(
      ...CONTENT[mode].flatMap((section) => {
        const h = document.createElement('div')
        h.className = 'help-card-title'
        h.textContent = section.title
        return [
          h,
          ...section.rows.map((row) => {
            const div = document.createElement('div')
            div.className = 'help-card-row'
            div.innerHTML = row
            return div
          }),
        ]
      }),
    )
  }
  render('field')

  const intro = document.createElement('button')
  intro.className = 'help-replay'
  intro.textContent = '📍 Show the Start-here intro'
  intro.title = 'Re-open the first-visit intro card'
  intro.addEventListener('click', () => {
    setOpen(false)
    opts.onShowStartHere()
  })
  card.appendChild(intro)

  function setOpen(open: boolean): void {
    card.style.display = open ? '' : 'none'
    toggle.setAttribute('aria-expanded', String(open))
  }
  toggle.addEventListener('click', () => setOpen(card.style.display === 'none'))

  root.append(toggle, card)
  return {
    el: root,
    close: () => setOpen(false),
    setMode: render,
  }
}
