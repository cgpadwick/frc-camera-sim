import { describe, it, expect } from 'vitest'
import { renderReport } from '../../src/report/reportTemplate'
import { robotWireframeModel } from '../../src/report/robotWireframe'
import type { ReportStats } from '../../src/report/report'
import { DEFAULT_CONFIG } from '../../src/core/defaults'

function makeStats(overrides: Partial<ReportStats> = {}): ReportStats {
  return {
    bandPctMin: { dead: 25, poor: 25, ok: 25, strong: 25 },
    bandPctAvg: { dead: 10, poor: 20, ok: 30, strong: 40 },
    avgTags: { typical: 2.4, worstCase: 1.2, ideal: 3.6 },
    deadZones: [{ xM: 0.5, yM: 0.5 }, { xM: 1.5, yM: 0.5 }],
    deadZoneOverflow: 0,
    cameraShare: [{ name: 'front', pct: 60 }, { name: 'rear-left', pct: 40 }],
    tagsNeverSeen: [5, 9],
    tagsRarelySeen: [{ id: 3, seenPct: 1.2 }],
    ...overrides,
  }
}

// Cheap "valid enough HTML" check: every opening tag in TAGS has a matching
// closing tag count. Not a full parser — just catches gross unclosed-tag bugs.
function assertBalancedTags(html: string, tag: string): void {
  const opens = (html.match(new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi')) ?? []).length
  const closes = (html.match(new RegExp(`</${tag}>`, 'gi')) ?? []).length
  expect(opens, `${tag}: ${opens} open vs ${closes} close`).toBe(closes)
}

describe('renderReport', () => {
  const html = renderReport(makeStats(), DEFAULT_CONFIG)

  it('includes a title and a date', () => {
    expect(html).toMatch(/<title>[^<]*<\/title>/i)
    // Some ISO-ish or human date string is present somewhere in the body.
    expect(html).toMatch(/\d{4}/)
  })

  it('is a self-contained document: doctype/html/head/body, inline style only, no external refs', () => {
    expect(html).toMatch(/<!doctype html>/i)
    expect(html).toMatch(/<html/i)
    expect(html).toMatch(/<\/html>/i)
    expect(html).toMatch(/<style>/)
    expect(html).not.toMatch(/<link/i)
    expect(html).not.toMatch(/<script\s+src/i)
    expect(html).not.toMatch(/https?:\/\//) // no CDN/external asset references
  })

  it('includes a coverage table with band x min/avg', () => {
    assertBalancedTags(html, 'table')
    assertBalancedTags(html, 'tr')
    assertBalancedTags(html, 'td')
    assertBalancedTags(html, 'th')
    expect(html).toMatch(/dead/i)
    expect(html).toMatch(/poor/i)
    expect(html).toMatch(/\bok\b/i)
    expect(html).toMatch(/strong/i)
    expect(html).toContain('25.0%') // bandPctMin values, formatted to 1 decimal
  })

  it('has NO dead-zone table (removed by user request) and embeds images when provided', () => {
    const html = renderReport(makeStats(), DEFAULT_CONFIG, undefined, {
      images: { realisticMap: 'data:image/png;base64,AAA', idealMap: 'data:image/png;base64,BBB', robotViews: { persp: 'data:image/png;base64,CCC' } },
    })
    expect(html).not.toContain('Dead zones')
    expect(html).toContain('Coverage maps')
    expect(html).toContain('data:image/png;base64,AAA')
    expect(html).toContain('data:image/png;base64,BBB')
    expect(html).toContain('Robot &amp; camera placement')
    expect(html).toContain('data:image/png;base64,CCC')
    expect(html).toContain('0 (blind)') // legend strip present with the maps
  })
  it('omits image sections when no images are passed', () => {
    const html = renderReport(makeStats(), DEFAULT_CONFIG)
    expect(html).not.toContain('Coverage maps')
    expect(html).not.toContain('Robot &amp; camera placement')
    expect(html).not.toContain('<canvas id="robot3d">')
  })

  it('embeds the interactive 3D viewer + camera mount table when robotModel is provided', () => {
    const config = {
      ...DEFAULT_CONFIG,
      robot: {
        ...DEFAULT_CONFIG.robot,
        cameras: [
          { name: 'front-cam', hfovDeg: 75, vfovDeg: 47, resWidth: 1280, resHeight: 800, maxRangeM: null,
            mount: { x: 0.312, y: -0.05, z: 0.41, rollDeg: 0, pitchDeg: -12.5, yawDeg: 30 } },
        ],
      },
    }
    const model = robotWireframeModel(config.robot)
    const html = renderReport(makeStats(), config, undefined, { robotModel: model })
    // Viewer canvas + inline script (no src — still self-contained).
    expect(html).toContain('<canvas id="robot3d">')
    expect(html).toContain('drag rotate')
    expect(html).not.toMatch(/<script\s+src/i)
    expect(html).not.toMatch(/https?:\/\//)
    // Serialized model rides inside the script.
    expect(html).toContain(JSON.stringify(model))
    // The inline script must not accidentally terminate its own element early:
    // exactly one opener and one closer.
    expect((html.match(/<script>/g) ?? []).length).toBe(1)
    expect((html.match(/<\/script>/g) ?? []).length).toBe(1)
    // Mount table: one row per camera with position + RPY columns.
    expect(html).toContain('Camera mounts')
    expect(html).toContain('Roll (°)')
    expect(html).toContain('Pitch (°)')
    expect(html).toContain('Yaw (°)')
    for (const cam of config.robot.cameras) {
      expect(html).toContain(cam.name)
      expect(html).toContain(cam.mount.x.toFixed(3))
      expect(html).toContain(cam.mount.pitchDeg.toFixed(1))
    }
    assertBalancedTags(html, 'table')
    assertBalancedTags(html, 'tr')
  })

  it('includes per-camera contribution bars', () => {
    expect(html).toContain('front')
    expect(html).toContain('rear-left')
    expect(html).toContain('60.0%')
    expect(html).toContain('40.0%')
  })

  it('includes never-seen and rarely-seen tag lists', () => {
    expect(html).toMatch(/never/i)
    expect(html).toContain('5')
    expect(html).toContain('9')
    expect(html).toMatch(/rarely/i)
    expect(html).toContain('3')
    expect(html).toContain('1.2%')
  })

  it('embeds the config snapshot as JSON in a <pre>', () => {
    assertBalancedTags(html, 'pre')
    expect(html).toMatch(/<pre[^>]*>[\s\S]*"fieldYear"[\s\S]*<\/pre>/)
    expect(html).toContain(JSON.stringify(DEFAULT_CONFIG, null, 2).replace(/</g, '&lt;'))
  })

  it('includes the average-tags line with typical / worst-case / ideal means', () => {
    expect(html).toContain('Average tags visible')
    expect(html).toContain('2.4 typical')
    expect(html).toContain('1.2 worst-case')
    expect(html).toContain('3.6 ideal')
  })

  it('has no delta column and no optimism note when compare/flag are omitted', () => {
    expect(html).not.toMatch(/delta/i)
    expect(html).not.toMatch(/optimistic/i)
  })
})

describe('renderReport with compare', () => {
  const baseline = makeStats({ bandPctMin: { dead: 40, poor: 30, ok: 20, strong: 10 } })
  const current = makeStats({ bandPctMin: { dead: 25, poor: 25, ok: 25, strong: 25 } })
  const html = renderReport(current, DEFAULT_CONFIG, { label: 'Baseline', stats: baseline })

  it('shows a delta column with +/- percentage points per band', () => {
    expect(html).toMatch(/delta/i)
    expect(html).toContain('Baseline')
    // dead: 25 - 40 = -15.0 ; strong: 25 - 10 = +15.0
    expect(html).toContain('-15.0')
    expect(html).toContain('+15.0')
  })

  it('colors improvements and regressions distinctly (green/red present)', () => {
    expect(html).toMatch(/green|#[0-9a-f]{3,6}/i)
    expect(html.toLowerCase()).toMatch(/color:\s*#?[0-9a-z]+/i)
  })

  it('is still balanced HTML with the extra column', () => {
    assertBalancedTags(html, 'table')
    assertBalancedTags(html, 'tr')
    assertBalancedTags(html, 'td')
    assertBalancedTags(html, 'th')
  })

  it('average-tags line carries signed deltas vs the baseline', () => {
    const base = makeStats({ avgTags: { typical: 2.0, worstCase: 1.5, ideal: 3.6 } })
    const h = renderReport(makeStats(), DEFAULT_CONFIG, { label: 'Baseline', stats: base })
    expect(h).toContain('2.4 typical')
    expect(h).toContain('(+0.4)') // typical 2.4 vs 2.0 — improvement
    expect(h).toContain('(-0.3)') // worst-case 1.2 vs 1.5 — regression
    expect(h).toContain('(+0.0)') // ideal unchanged
    expect(h).toContain('deltas vs Baseline')
  })
})

describe('renderReport occluder-optimism note', () => {
  it('is present when fieldOccludersEmpty flag is passed true', () => {
    const html = renderReport(makeStats(), DEFAULT_CONFIG, undefined, { fieldOccludersEmpty: true })
    expect(html).toMatch(/field-element occlusion not modeled/i)
    expect(html).toMatch(/optimistic/i)
  })

  it('is absent when the flag is false', () => {
    const html = renderReport(makeStats(), DEFAULT_CONFIG, undefined, { fieldOccludersEmpty: false })
    expect(html).not.toMatch(/field-element occlusion not modeled/i)
  })
})

describe('renderReport: empty dead zones and empty tag lists render without crashing', () => {
  it('handles all-empty-list stats', () => {
    const stats = makeStats({ deadZones: [], deadZoneOverflow: 0, tagsNeverSeen: [], tagsRarelySeen: [] })
    const html = renderReport(stats, DEFAULT_CONFIG)
    expect(html.length).toBeGreaterThan(0)
    assertBalancedTags(html, 'table')
  })

})
