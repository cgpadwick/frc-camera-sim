import { describe, it, expect } from 'vitest'
import { clampPositive } from '../../src/ui/configPanel'

// configPanel.ts is otherwise DOM-only (no jsdom environment configured for this
// project — see vite.config.ts's `test.environment: 'node'`), so only the pure
// validation helper backing positiveNumberField is unit-tested here. It's the piece
// responsible for finding #4's fix: rejecting/clamping values configStore.ts's
// parseConfig would throw on (lengthM/widthM/chassisHeightM, resWidth/resHeight,
// superstructure box sizes) so an in-panel edit can never write a config that fails
// to round-trip through loadConfig/parseConfig later.
describe('clampPositive', () => {
  it('passes through a positive value unchanged', () => {
    expect(clampPositive(0.8)).toBe(0.8)
  })

  it('rejects zero', () => {
    expect(clampPositive(0)).toBeNull()
  })

  it('rejects a negative value', () => {
    expect(clampPositive(-1)).toBeNull()
  })
})
