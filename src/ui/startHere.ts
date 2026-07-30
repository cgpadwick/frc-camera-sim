/**
 * "Start here" card for first-time visitors: says what the tool is for and
 * the three steps, with a button straight to ① Robot Setup. Shown once
 * (localStorage flag), and re-openable any time from the Guide card — no
 * incognito required to see it again.
 */

export const START_HERE_KEY = 'frc-camera-sim.start-here-done'

export interface StartHere {
  el: HTMLElement
  /** Open the card (used by the Guide's "show intro" action). */
  show(): void
  /** True if the first-visit flag is set (card already seen/dismissed). */
  seen(): boolean
}

export interface StartHereOptions {
  /** Jump to the ① Robot Setup tab (also dismisses the card). */
  onGoToRobotSetup(): void
}

function setFlag(): void {
  try {
    localStorage.setItem(START_HERE_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function createStartHere(opts: StartHereOptions): StartHere {
  const el = document.createElement('div')
  el.className = 'start-here'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-label', 'Start here')
  el.style.display = 'none'

  const title = document.createElement('div')
  title.className = 'start-here-title'
  const titleText = document.createElement('span')
  titleText.textContent = '📍 Start here'
  const close = document.createElement('button')
  close.textContent = '✕'
  close.title = 'Dismiss (reopen any time from ? Guide)'
  close.setAttribute('aria-label', 'Dismiss start-here card')
  close.addEventListener('click', () => {
    setFlag()
    el.style.display = 'none'
  })
  title.append(titleText, close)

  const blurb = document.createElement('div')
  blurb.className = 'start-here-blurb'
  blurb.innerHTML =
    '<b>Find the best camera placement for your robot.</b> Model your robot and cameras, ' +
    'sweep the whole field to see what they cover, then let the solver improve the layout.'

  const steps = document.createElement('ol')
  steps.className = 'start-here-steps'
  for (const s of [
    '<b>① Robot Setup</b> — block out your robot and add your cameras',
    '<b>② Analyze</b> — press <b>Analyze coverage</b> to map what they see',
    '<b>③ Optimize</b> — let the solver propose better mounts, then save a report',
  ]) {
    const li = document.createElement('li')
    li.innerHTML = s
    steps.appendChild(li)
  }

  const go = document.createElement('button')
  go.className = 'start-here-go'
  go.textContent = 'Go to ① Robot Setup'
  go.addEventListener('click', () => {
    setFlag()
    el.style.display = 'none'
    opts.onGoToRobotSetup()
  })

  el.append(title, blurb, steps, go)

  return {
    el,
    show() {
      el.style.display = ''
    },
    seen() {
      try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(START_HERE_KEY) === '1'
      } catch {
        return true
      }
    },
  }
}
