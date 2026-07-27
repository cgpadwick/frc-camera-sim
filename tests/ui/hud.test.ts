import { describe, it, expect } from 'vitest'
import { colorForScore, BAND_COLORS } from '../../src/ui/hud'

describe('colorForScore (band -> color mapping)', () => {
  it('dead (<=0) -> red', () => {
    expect(colorForScore(0)).toBe(BAND_COLORS.dead)
    expect(colorForScore(0)).toBe('#f44336')
  })
  it('poor (0,40) -> orange', () => {
    expect(colorForScore(20)).toBe(BAND_COLORS.poor)
    expect(colorForScore(20)).toBe('#ff9800')
  })
  it('ok [40,70) -> yellow', () => {
    expect(colorForScore(50)).toBe(BAND_COLORS.ok)
    expect(colorForScore(50)).toBe('#ffeb3b')
  })
  it('strong (>=70) -> green', () => {
    expect(colorForScore(85)).toBe(BAND_COLORS.strong)
    expect(colorForScore(85)).toBe('#4caf50')
  })
})
