// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createStartHere, START_HERE_KEY } from '../../src/ui/startHere'

describe('createStartHere', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.replaceChildren()
  })

  it('starts hidden; show() opens it', () => {
    const card = createStartHere({ onGoToRobotSetup: () => {} })
    document.body.appendChild(card.el)
    expect(card.el.style.display).toBe('none')
    card.show()
    expect(card.el.style.display).toBe('')
  })

  it('seen() is false on first visit, true after dismiss', () => {
    const card = createStartHere({ onGoToRobotSetup: () => {} })
    document.body.appendChild(card.el)
    expect(card.seen()).toBe(false)
    card.show()
    card.el.querySelector<HTMLButtonElement>('.start-here-title button')!.click()
    expect(card.el.style.display).toBe('none')
    expect(card.seen()).toBe(true)
    expect(localStorage.getItem(START_HERE_KEY)).toBe('1')
  })

  it('"Go to ① Robot Setup" dismisses, flags, and fires the callback', () => {
    const onGoToRobotSetup = vi.fn()
    const card = createStartHere({ onGoToRobotSetup })
    document.body.appendChild(card.el)
    card.show()
    card.el.querySelector<HTMLButtonElement>('.start-here-go')!.click()
    expect(onGoToRobotSetup).toHaveBeenCalledOnce()
    expect(card.el.style.display).toBe('none')
    expect(card.seen()).toBe(true)
  })

  it('re-openable after dismissal (Guide path — no incognito needed)', () => {
    localStorage.setItem(START_HERE_KEY, '1')
    const card = createStartHere({ onGoToRobotSetup: () => {} })
    document.body.appendChild(card.el)
    expect(card.seen()).toBe(true)
    card.show()
    expect(card.el.style.display).toBe('')
  })

  it('names all three workflow steps', () => {
    const card = createStartHere({ onGoToRobotSetup: () => {} })
    const html = card.el.innerHTML
    expect(html).toContain('① Robot Setup')
    expect(html).toContain('② Analyze')
    expect(html).toContain('③ Optimize')
    expect(html).toContain('camera placement')
  })
})
