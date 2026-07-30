// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHelpCard } from '../../src/ui/helpCard'

describe('createHelpCard', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.replaceChildren()
  })

  it('starts collapsed; toggle opens and closes the card', () => {
    const help = createHelpCard({ onShowStartHere: () => {} })
    document.body.appendChild(help.el)
    const card = help.el.querySelector<HTMLElement>('.help-card')!
    const toggle = help.el.querySelector<HTMLButtonElement>('.help-fab')!
    expect(card.style.display).toBe('none')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    toggle.click()
    expect(card.style.display).toBe('')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    toggle.click()
    expect(card.style.display).toBe('none')
  })

  it('close() collapses when open (Esc path from main)', () => {
    const help = createHelpCard({ onShowStartHere: () => {} })
    document.body.appendChild(help.el)
    help.el.querySelector<HTMLButtonElement>('.help-fab')!.click()
    help.close()
    expect(help.el.querySelector<HTMLElement>('.help-card')!.style.display).toBe('none')
  })

  it('field mode (default): analyze/optimize steps + field-only controls', () => {
    const help = createHelpCard({ onShowStartHere: () => {} })
    const text = help.el.querySelector('.help-card')!.innerHTML
    expect(text).toContain('Analyze coverage')
    expect(text).toContain('Optimize')
    expect(text).toContain('Report')
    expect(text).toContain('rotate the robot')
    expect(text).toMatch(/<b>V<\/b>/)
    expect(text).toMatch(/<b>F<\/b>/)
    // No build-tab instructions in field mode.
    expect(text).not.toContain('Add body shape')
  })

  it('robot mode: build instructions only — field-only shortcuts (V, robot rotate) absent', () => {
    const help = createHelpCard({ onShowStartHere: () => {} })
    help.setMode('robot')
    const text = help.el.querySelector('.help-card')!.innerHTML
    expect(text).toContain('Add body shape')
    expect(text).toContain('Add camera')
    expect(text).toContain('Pitch/Yaw sliders')
    expect(text).toMatch(/<b>F<\/b>/)
    expect(text).not.toMatch(/<b>V<\/b>/)
    expect(text).not.toContain('rotate the robot')
    expect(text).not.toContain('Double-click')
  })

  it('setMode swaps content both ways without duplicating sections', () => {
    const help = createHelpCard({ onShowStartHere: () => {} })
    help.setMode('robot')
    help.setMode('field')
    const card = help.el.querySelector('.help-card')!
    expect(card.innerHTML).toContain('Analyze coverage')
    expect(card.innerHTML).not.toContain('Add body shape')
    expect(card.querySelectorAll('.help-card-title').length).toBe(2)
    // Replay button survives mode swaps.
    expect(card.querySelectorAll('.help-replay').length).toBe(1)
  })

  it('"Show the Start-here intro" collapses the card and fires the callback', () => {
    const onShowStartHere = vi.fn()
    const help = createHelpCard({ onShowStartHere })
    document.body.appendChild(help.el)
    help.el.querySelector<HTMLButtonElement>('.help-fab')!.click()
    help.el.querySelector<HTMLButtonElement>('.help-replay')!.click()
    expect(onShowStartHere).toHaveBeenCalledOnce()
    expect(help.el.querySelector<HTMLElement>('.help-card')!.style.display).toBe('none')
  })
})
