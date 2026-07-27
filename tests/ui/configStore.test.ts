import { describe, it, expect } from 'vitest'
import { parseConfig, occluderUrlForYear, saveConfig, loadConfig, STORAGE_KEY } from '../../src/ui/configStore'
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

describe('loadConfig corrupt-vs-absent distinction', () => {
  // These simulate the two failure shapes distinctly, using a minimal
  // localStorage stand-in (real localStorage isn't available under the
  // node test environment — see the guard tests above) since loadConfig's
  // three-way result (`{config}` / `{error}` / null) is exactly the
  // fix for finding #4: main.ts must toast on real corruption but stay
  // silent on a first-ever boot with nothing saved yet.
  function withFakeStorage<T>(value: string | undefined, fn: () => T): T {
    const g = globalThis as { localStorage?: unknown }
    const prev = g.localStorage
    g.localStorage = {
      getItem: (k: string) => (k === STORAGE_KEY && value !== undefined ? value : null),
      setItem: () => {},
    }
    try {
      return fn()
    } finally {
      if (prev === undefined) delete g.localStorage
      else g.localStorage = prev
    }
  }

  it('returns null (silent) when nothing is saved', () => {
    withFakeStorage(undefined, () => {
      expect(loadConfig()).toBeNull()
    })
  })

  it('returns {error} (not null, not throwing) when the saved value is malformed JSON', () => {
    withFakeStorage('{not valid json', () => {
      const result = loadConfig()
      expect(result).not.toBeNull()
      expect(result && 'error' in result).toBe(true)
    })
  })

  it('returns {error} when the saved JSON is valid but fails parseConfig (e.g. negative lengthM)', () => {
    const corrupt = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    corrupt.robot.lengthM = -1
    withFakeStorage(JSON.stringify(corrupt), () => {
      const result = loadConfig()
      expect(result && 'error' in result ? result.error : null).toMatch(/lengthM/)
    })
  })

  it('returns {config} for a valid saved config', () => {
    withFakeStorage(JSON.stringify(DEFAULT_CONFIG), () => {
      const result = loadConfig()
      expect(result && 'config' in result ? result.config : null).toEqual(DEFAULT_CONFIG)
    })
  })
})
