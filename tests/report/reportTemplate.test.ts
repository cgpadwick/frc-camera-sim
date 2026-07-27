import { describe, it, expect } from 'vitest'
import { renderReport } from '../../src/report/reportTemplate'
import type { ReportStats } from '../../src/report/report'
import { DEFAULT_CONFIG } from '../../src/core/defaults'

function makeStats(overrides: Partial<ReportStats> = {}): ReportStats {
  return {
    bandPctMin: { dead: 25, poor: 25, ok: 25, strong: 25 },
    bandPctAvg: { dead: 10, poor: 20, ok: 30, strong: 40 },
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

  it('includes a dead-zone coordinate list', () => {
    expect(html).toContain('0.50')
    expect(html).toContain('1.50')
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

  it('shows the overflow count when deadZoneOverflow > 0', () => {
    const stats = makeStats({ deadZoneOverflow: 7 })
    const html = renderReport(stats, DEFAULT_CONFIG)
    expect(html).toMatch(/\+7 more/)
  })
})
