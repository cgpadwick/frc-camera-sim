// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHelpCard } from '../../src/ui/helpCard'
import { SETUP_DONE_KEY } from '../../src/ui/setupChecklist'

describe('createHelpCard', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.replaceChildren()
  })

  it('starts collapsed; toggle opens and closes the card', () => {
    const help = createHelpCard({ onReplayTips: () => {} })
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
    const help = createHelpCard({ onReplayTips: () => {} })
    document.body.appendChild(help.el)
    help.el.querySelector<HTMLButtonElement>('.help-fab')!.click()
    help.close()
    expect(help.el.querySelector<HTMLElement>('.help-card')!.style.display).toBe('none')
  })

  it('field mode (default): analyze/optimize steps + field-only controls', () => {
    const help = createHelpCard({ onReplayTips: () => {} })
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
    const help = createHelpCard({ onReplayTips: () => {} })
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
    const help = createHelpCard({ onReplayTips: () => {} })
    help.setMode('robot')
    help.setMode('field')
    const card = help.el.querySelector('.help-card')!
    expect(card.innerHTML).toContain('Analyze coverage')
    expect(card.innerHTML).not.toContain('Add body shape')
    expect(card.querySelectorAll('.help-card-title').length).toBe(2)
    // Replay button survives mode swaps.
    expect(card.querySelectorAll('.help-replay').length).toBe(1)
  })

  it('replay button clears all first-run flags and fires the callback', () => {
    localStorage.setItem('frc-camera-sim.onboarded', '1')
    localStorage.setItem('frc-camera-sim.inspect-hinted', '1')
    localStorage.setItem(SETUP_DONE_KEY, '1')
    const onReplayTips = vi.fn()
    const help = createHelpCard({ onReplayTips })
    document.body.appendChild(help.el)
    help.el.querySelector<HTMLButtonElement>('.help-replay')!.click()
    expect(localStorage.getItem('frc-camera-sim.onboarded')).toBeNull()
    expect(localStorage.getItem('frc-camera-sim.inspect-hinted')).toBeNull()
    expect(localStorage.getItem(SETUP_DONE_KEY)).toBeNull()
    expect(onReplayTips).toHaveBeenCalledOnce()
  })

  it('replay does NOT touch the saved robot config', () => {
    localStorage.setItem('frc-camera-sim.config', '{"robot":"mine"}')
    const help = createHelpCard({ onReplayTips: () => {} })
    document.body.appendChild(help.el)
    help.el.querySelector<HTMLButtonElement>('.help-replay')!.click()
    expect(localStorage.getItem('frc-camera-sim.config')).toBe('{"robot":"mine"}')
  })
})
