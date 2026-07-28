import { describe, it, expect } from 'vitest'
import { inferStep } from '../../src/ui/tabs'

describe('stepper inference (QA round 6c)', () => {
  const base = { cameraCount: 3, hasSweep: true, optimizeActive: false }
  it('robot view is always step 1', () => {
    expect(inferStep('robot', base)).toBe(1)
    expect(inferStep('robot', { ...base, optimizeActive: true })).toBe(1) // robot view wins even mid-optimize
  })
  it('field view without optimizer activity is step 2', () => {
    expect(inferStep('field', base)).toBe(2)
  })
  it('optimizer RUNNING lights step 3 (the round-6c regression)', () => {
    expect(inferStep('field', { ...base, optimizeActive: true })).toBe(3)
  })
  it('proposal open lights step 3; apply/discard returns to 2', () => {
    expect(inferStep('field', { ...base, optimizeActive: true })).toBe(3)
    expect(inferStep('field', { ...base, optimizeActive: false })).toBe(2)
  })
})
