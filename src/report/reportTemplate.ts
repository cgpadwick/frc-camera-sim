import type { SimConfig } from '../core/types'
import type { Band, ReportStats } from './report'
import { BAND_COLORS } from '../ui/hud'
import { CAMERA_COLORS } from '../viz/frustumView'
import { COUNT_STOPS } from '../viz/heatmapView'
import { showToast } from '../ui/toast'

const BANDS: Band[] = ['dead', 'poor', 'ok', 'strong']
const BAND_LABEL: Record<Band, string> = { dead: 'Dead', poor: 'Poor', ok: 'Ok', strong: 'Strong' }

/** Bands where an increase in coverage % is an improvement (green when delta > 0). */
const HIGHER_IS_BETTER: Record<Band, boolean> = { dead: false, poor: false, ok: true, strong: true }

const IMPROVE_COLOR = '#2e7d32' // green
const REGRESS_COLOR = '#c62828' // red

function hexColor(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`
}

/**
 * Escapes text for safe embedding as HTML *text content* (not attribute
 * values — nothing in this template interpolates user text into an
 * attribute). Quotes/apostrophes are left as-is since they're inert outside
 * of an attribute value; only &/</> need escaping to prevent stray markup.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`
}

function delta(n: number): string {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}`
}

export interface RenderReportOptions {
  /** True if the field's occluder box list was empty at sweep time — no field-element occlusion was modeled. */
  fieldOccludersEmpty?: boolean
  /** Data-URL PNGs embedded in the report (self-contained blob, no external refs). */
  images?: {
    /** Realistic (worst-case heading) coverage map. */
    realisticMap?: string
    /** Theoretical-best coverage map. */
    idealMap?: string
    /** Robot render with camera gizmos and aim cones. */
    robot?: string
  }
}

/** Shared count-color legend strip under the embedded maps. */
function legendStrip(): string {
  const labels = ['0 (blind)', '1 tag', '2 tags', '3 tags', '4+ tags']
  const stops = COUNT_STOPS.map(
    (hex, i) =>
      `<span class="legend-item"><span class="legend-swatch" style="background:${hex}"></span>${labels[i]}</span>`,
  ).join('')
  return `<div class="legend">${stops}</div>`
}

/**
 * Self-contained printable HTML report string for one sweep's ReportStats.
 * Inline CSS only, no external references — safe to hand to `openReport`
 * (window.open + document.write) or save to disk and open directly.
 */
export function renderReport(
  stats: ReportStats,
  config: SimConfig,
  compare?: { label: string; stats: ReportStats },
  opts?: RenderReportOptions,
): string {
  const generatedAt = new Date().toISOString()
  const title = `Coverage Report — Team ${escapeHtml(config.robot.teamNumber)} — ${escapeHtml(config.fieldYear)}`

  const coverageTable = renderCoverageTable(stats, compare)
  const cameraSection = renderCameraShare(stats)
  const tagSection = renderTagLists(stats)
  const occluderNote = opts?.fieldOccludersEmpty
    ? `<p class="note">Field-element occlusion not modeled for this field — coverage is optimistic near field structures.</p>`
    : ''
  const configJson = escapeHtml(JSON.stringify(config, null, 2))

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1a1a; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.1rem; }
  .subtitle { color: #555; margin-top: 0; margin-bottom: 1.5rem; }
  h2 { font-size: 1.1rem; border-bottom: 1px solid #ccc; padding-bottom: 0.25rem; margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; margin: 0.5rem 0 1rem; }
  th, td { border: 1px solid #ccc; padding: 0.35rem 0.6rem; text-align: right; }
  th:first-child, td:first-child { text-align: left; }
  .note { background: #fff3cd; border: 1px solid #ffe69c; padding: 0.6rem 0.8rem; border-radius: 4px; }
  .bar-row { display: flex; align-items: center; gap: 0.5rem; margin: 0.25rem 0; }
  .bar-label { width: 9rem; flex-shrink: 0; }
  .bar-track { flex: 1; background: #eee; border-radius: 3px; height: 1rem; overflow: hidden; }
  .bar-fill { height: 100%; }
  .bar-pct { width: 4rem; text-align: right; flex-shrink: 0; }
  ul.tag-list { margin: 0.25rem 0; padding-left: 1.4rem; }
  ul.deadzone-list { columns: 3; padding-left: 1.4rem; font-variant-numeric: tabular-nums; }
  pre { background: #f5f5f5; border: 1px solid #ddd; padding: 0.75rem; overflow-x: auto; font-size: 0.8rem; }
  .overflow-note { color: #555; font-style: italic; }
  .maps { display: flex; gap: 1rem; flex-wrap: wrap; }
  .maps figure { margin: 0; flex: 1 1 320px; }
  .maps figcaption { font-size: 0.85rem; color: #555; margin-top: 0.25rem; }
  .report-img { width: 100%; height: auto; border: 1px solid #ccc; image-rendering: pixelated; }
  .robot-img { max-width: 480px; image-rendering: auto; }
  .legend { display: flex; gap: 1rem; margin: 0.5rem 0 0.25rem; font-size: 0.85rem; }
  .legend-item { display: inline-flex; align-items: center; gap: 0.3rem; }
  .legend-swatch { width: 0.9rem; height: 0.9rem; border-radius: 2px; border: 1px solid #999; display: inline-block; }
  .note-sub { color: #555; font-size: 0.85rem; }
  @media print {
    body { margin: 0.5rem; }
    .note { break-inside: avoid; }
  }
</style>
</head>
<body>
<h1>${title}</h1>
<p class="subtitle">Generated ${generatedAt}</p>
${occluderNote}
${stats.scoreVsIdeal ? `<p class="score-line"><b>Coverage score vs ideal: ${stats.scoreVsIdeal.worstPct.toFixed(0)} / 100 (worst-case heading)</b> — field-wide tags seen as a percentage of what an omnidirectional ideal setup would see (ideal = 100).</p>` : ''}
${
  opts?.images?.robot
    ? `<h2>Robot &amp; camera placement</h2>
<img class="report-img robot-img" src="${opts.images.robot}" alt="Robot with camera positions and aim cones">`
    : ''
}
${
  opts?.images?.realisticMap || opts?.images?.idealMap
    ? `<h2>Coverage maps</h2>
<div class="maps">
${opts?.images?.realisticMap ? `<figure><img class="report-img" src="${opts.images.realisticMap}" alt="Realistic coverage map (worst-case heading)"><figcaption>Realistic — tags visible at the worst-case robot heading</figcaption></figure>` : ''}
${opts?.images?.idealMap ? `<figure><img class="report-img" src="${opts.images.idealMap}" alt="Theoretical best coverage map"><figcaption>Theoretical best — omnidirectional ideal at the same range</figcaption></figure>` : ''}
</div>
${legendStrip()}
<p class="note-sub">Field origin bottom-left; long axis horizontal.</p>`
    : ''
}
<h2>Coverage by band</h2>
${coverageTable}
<h2>Per-camera contribution</h2>
${cameraSection}
<h2>Tag visibility</h2>
${tagSection}
<h2>Configuration snapshot</h2>
<pre>${configJson}</pre>
</body>
</html>
`
}

function renderCoverageTable(stats: ReportStats, compare?: { label: string; stats: ReportStats }): string {
  const headerCells = ['Band', 'Worst-case %']
  if (compare) headerCells.push(`Delta (pp) vs ${escapeHtml(compare.label)}`)
  const header = `<tr>${headerCells.map((h) => `<th>${h}</th>`).join('')}</tr>`

  const rows = BANDS.map((band) => {
    const color = BAND_COLORS[band]
    const cells = [
      `<td style="color:${color}; font-weight:600;">${BAND_LABEL[band]}</td>`,
      `<td>${pct(stats.bandPctMin[band])}</td>`,
    ]
    if (compare) {
      const d = stats.bandPctMin[band] - compare.stats.bandPctMin[band]
      const improved = d === 0 ? null : (d > 0) === HIGHER_IS_BETTER[band]
      const deltaColor = improved === null ? '#555' : improved ? IMPROVE_COLOR : REGRESS_COLOR
      cells.push(`<td style="color:${deltaColor}; font-weight:600;">${delta(d)}</td>`)
    }
    return `<tr>${cells.join('')}</tr>`
  }).join('\n')

  return `<table>${header}\n${rows}</table>`
}


function renderCameraShare(stats: ReportStats): string {
  if (stats.cameraShare.length === 0) return '<p>No cameras configured.</p>'
  const rows = stats.cameraShare.map((c, i) => {
    const color = hexColor(CAMERA_COLORS[i % CAMERA_COLORS.length])
    return `<div class="bar-row">
  <span class="bar-label">${escapeHtml(c.name)}</span>
  <span class="bar-track"><span class="bar-fill" style="width:${Math.max(0, Math.min(100, c.pct))}%; background:${color};"></span></span>
  <span class="bar-pct">${pct(c.pct)}</span>
</div>`
  }).join('\n')
  return rows
}

/**
 * Opens `html` (from `renderReport`) as a standalone printable document in a
 * new tab via a Blob URL — unlike the document.write/about:blank approach,
 * the tab gets a real (refreshable) URL and popup blockers are detectable.
 * The object URL is revoked after a grace period so the document can finish
 * loading; already-open tabs keep their content after revocation.
 */
export function openReport(html: string): void {
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (!win) {
    URL.revokeObjectURL(url)
    showToast('Report popup was blocked — allow popups for this site to view the coverage report.')
    return
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function renderTagLists(stats: ReportStats): string {
  const neverSection = stats.tagsNeverSeen.length > 0
    ? `<p><strong>Never seen:</strong></p><ul class="tag-list">${stats.tagsNeverSeen.map((id) => `<li>Tag ${id}</li>`).join('')}</ul>`
    : '<p><strong>Never seen:</strong> none.</p>'
  const rarelySection = stats.tagsRarelySeen.length > 0
    ? `<p><strong>Rarely seen</strong> (&lt; 2% of samples):</p><ul class="tag-list">${stats.tagsRarelySeen.map((t) => `<li>Tag ${t.id} — ${pct(t.seenPct)}</li>`).join('')}</ul>`
    : '<p><strong>Rarely seen:</strong> none.</p>'
  return `${neverSection}\n${rarelySection}`
}
