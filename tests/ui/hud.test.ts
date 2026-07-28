import { describe, it, expect } from 'vitest'
import { colorForCount, BAND_COLORS } from '../../src/ui/hud'

describe('colorForCount (band -> color mapping)', () => {
  it('dead (<=0) -> red', () => {
    expect(colorForCount(0)).toBe(BAND_COLORS.dead)
    expect(colorForCount(0)).toBe('#f44336')
  })
  it('1 tag -> orange (poor)', () => {
    expect(colorForCount(1)).toBe(BAND_COLORS.poor)
    expect(colorForCount(1)).toBe('#ff9800')
  })
  it('2 tags -> yellow (ok)', () => {
    expect(colorForCount(2)).toBe(BAND_COLORS.ok)
    expect(colorForCount(2)).toBe('#ffeb3b')
  })
  it('3+ tags -> green (strong)', () => {
    expect(colorForCount(3)).toBe(BAND_COLORS.strong)
    expect(colorForCount(7)).toBe('#4caf50')
  })
})
