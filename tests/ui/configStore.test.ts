import { describe, it, expect } from 'vitest'
import { parseConfig, occluderUrlForYear, saveConfig, loadConfig } from '../../src/ui/configStore'
import { DEFAULT_CONFIG } from '../../src/core/defaults'

describe('parseConfig', () => {
  it('accepts a round-tripped DEFAULT_CONFIG', () => {
    const json = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    expect(parseConfig(json)).toEqual(DEFAULT_CONFIG)
  })

  it('rejects a non-object payload', () => {
    expect(() => parseConfig(null)).toThrow()
    expect(() => parseConfig('nope')).toThrow()
    expect(() => parseConfig(42)).toThrow()
  })

  it('rejects a missing robot', () => {
    expect(() => parseConfig({ fieldYear: '2026-rebuilt-welded' })).toThrow(/robot/i)
  })

  it('rejects a non-numeric hfovDeg with a readable message', () => {
    const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    bad.robot.cameras[0].hfovDeg = 'x'
    expect(() => parseConfig(bad)).toThrow(/hfovDeg/)
  })

  it('rejects negative robot dims', () => {
    const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    bad.robot.lengthM = -1
    expect(() => parseConfig(bad)).toThrow(/lengthM/)
  })

  it('rejects a zero chassis height', () => {
    const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    bad.robot.chassisHeightM = 0
    expect(() => parseConfig(bad)).toThrow(/chassisHeightM/)
  })

  it('rejects missing mount fields', () => {
    const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    delete bad.robot.cameras[0].mount.yawDeg
    expect(() => parseConfig(bad)).toThrow(/mount.*yawDeg|yawDeg/)
  })

  it('accepts a null maxRangeM and rejects a non-numeric one', () => {
    const ok = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    ok.robot.cameras[0].maxRangeM = null
    expect(() => parseConfig(ok)).not.toThrow()

    const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    bad.robot.cameras[0].maxRangeM = 'far'
    expect(() => parseConfig(bad)).toThrow(/maxRangeM/)
  })

  it('does not block on non-positive FOV (soft warning territory, not a hard error)', () => {
    const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    cfg.robot.cameras[0].hfovDeg = -5
    expect(() => parseConfig(cfg)).not.toThrow()
  })
})

describe('occluderUrlForYear', () => {
  it('maps known field years to their occluder file prefixes', () => {
    expect(occluderUrlForYear('2026-rebuilt-welded')).toBe('occluders/2026-rebuilt.json')
    expect(occluderUrlForYear('2025-reefscape-welded')).toBe('occluders/2025-reefscape.json')
  })
})

describe('saveConfig/loadConfig localStorage guard (node has no localStorage)', () => {
  it('loadConfig returns null rather than throwing', () => {
    expect(loadConfig()).toBeNull()
  })
  it('saveConfig does not throw', () => {
    expect(() => saveConfig(DEFAULT_CONFIG)).not.toThrow()
  })
})
