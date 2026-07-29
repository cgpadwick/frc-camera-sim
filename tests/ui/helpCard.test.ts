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

  it('contains the workflow steps and key controls', () => {
    const help = createHelpCard({ onReplayTips: () => {} })
    const text = help.el.querySelector('.help-card')!.innerHTML
    expect(text).toContain('① Build')
    expect(text).toContain('② Analyze')
    expect(text).toContain('③ Optimize')
    expect(text).toContain('Report')
    expect(text).toContain('rotate the robot')
    expect(text).toMatch(/<b>V<\/b>/)
    expect(text).toMatch(/<b>F<\/b>/)
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
