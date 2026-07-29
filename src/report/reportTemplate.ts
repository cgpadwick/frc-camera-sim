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
    /** Robot render with camera gizmos and aim cones (print/static fallback + hero). */
    robotViews?: { persp: string }
  }
  /** Wireframe model for the embedded interactive 3D viewer. */
  robotModel?: import('./robotWireframe').WireframeModel
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
  .ortho-row { display: flex; gap: 0.75rem; flex-wrap: wrap; }
  .ortho-row figure { margin: 0; flex: 1 1 200px; }
  .ortho-row img { image-rendering: auto; }
  .ortho-row figcaption { font-size: 0.85rem; color: #555; margin-top: 0.25rem; }
  .legend { display: flex; gap: 1rem; margin: 0.5rem 0 0.25rem; font-size: 0.85rem; }
  .legend-item { display: inline-flex; align-items: center; gap: 0.3rem; }
  .legend-swatch { width: 0.9rem; height: 0.9rem; border-radius: 2px; border: 1px solid #999; display: inline-block; }
  .note-sub { color: #555; font-size: 0.85rem; }
  .viewer-wrap { border: 1px solid #ccc; border-radius: 4px; overflow: hidden; }
  #robot3d { width: 100%; height: 380px; display: block; cursor: grab; touch-action: none; }
  .chip { display: inline-block; width: 0.7rem; height: 0.7rem; border-radius: 50%; margin-right: 0.4rem; border: 1px solid #999; vertical-align: baseline; }
  .print-fallback { display: none; }
  @media print {
    .viewer-wrap { display: none; }
    .print-fallback { display: block; }
  }
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
  opts?.images?.robotViews || opts?.robotModel
    ? `<h2>Robot &amp; camera placement</h2>
${opts?.robotModel ? renderRobotViewer(opts.robotModel) : ''}
${opts?.images?.robotViews ? `<img class="report-img robot-img print-fallback" src="${opts.images.robotViews.persp}" alt="Robot with camera positions and aim cones (3/4 view)">` : ''}
${renderMountTable(config)}`
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

/** Camera mount table: position + roll/pitch/yaw per camera, color-chipped. */
function renderMountTable(config: SimConfig): string {
  if (config.robot.cameras.length === 0) return ''
  const rows = config.robot.cameras
    .map((cam, i) => {
      const m = cam.mount
      const chip = `<span class="chip" style="background:${hexColor(CAMERA_COLORS[i % CAMERA_COLORS.length])}"></span>`
      return `<tr><td>${chip}${escapeHtml(cam.name)}</td><td>${m.x.toFixed(3)}</td><td>${m.y.toFixed(3)}</td><td>${m.z.toFixed(3)}</td><td>${m.rollDeg.toFixed(1)}</td><td>${m.pitchDeg.toFixed(1)}</td><td>${m.yawDeg.toFixed(1)}</td><td>${cam.hfovDeg.toFixed(1)}° × ${cam.vfovDeg.toFixed(1)}°</td></tr>`
    })
    .join('')
  return `<h3>Camera mounts (robot frame: +X front, +Y left, meters / degrees; pitch +down)</h3>
<table><tr><th>Camera</th><th>X (m)</th><th>Y (m)</th><th>Z (m)</th><th>Roll (°)</th><th>Pitch (°)</th><th>Yaw (°)</th><th>FOV</th></tr>${rows}</table>`
}

/** Dependency-free interactive 3D wireframe viewer (canvas 2D projection): drag = rotate, wheel = zoom, right-drag = pan. */
function renderRobotViewer(model: import('./robotWireframe').WireframeModel): string {
  const data = JSON.stringify(model)
  // Assembled from plain strings (no nested template literals) and must
  // never contain the byte sequence that would close the script element.
  const src = [
    '(function(){',
    'var M=' + data + ';',
    "var cv=document.getElementById('robot3d');if(!cv)return;var g=cv.getContext('2d');",
    'var yaw=0.8,pitch=0.55,dist=Math.max(2.5,M.fitRadius*2.6);',
    'var tgt=[0,0,M.targetZ];var fl=560;',
    'function draw(){',
    ' var dpr=window.devicePixelRatio||1;var w=cv.clientWidth,h=cv.clientHeight;',
    ' if(cv.width!==w*dpr){cv.width=w*dpr;cv.height=h*dpr;}',
    ' g.setTransform(dpr,0,0,dpr,0,0);g.fillStyle="#14161c";g.fillRect(0,0,w,h);',
    ' var cp=Math.cos(pitch),sp=Math.sin(pitch),cy=Math.cos(yaw),sy=Math.sin(yaw);',
    ' var fwd=[cp*cy,cp*sy,-sp];',
    ' var camp=[tgt[0]-fwd[0]*dist,tgt[1]-fwd[1]*dist,tgt[2]-fwd[2]*dist];',
    ' var right=[fwd[1],-fwd[0],0];var rl=Math.hypot(right[0],right[1])||1;right=[right[0]/rl,right[1]/rl,0];',
    ' var up=[right[1]*fwd[2],-right[0]*fwd[2],right[0]*fwd[1]-right[1]*fwd[0]];',
    ' function pr(p){var d=[p[0]-camp[0],p[1]-camp[1],p[2]-camp[2]];',
    '  var z=d[0]*fwd[0]+d[1]*fwd[1]+d[2]*fwd[2];if(z<0.05)return null;',
    '  var x=d[0]*right[0]+d[1]*right[1];var y=d[0]*up[0]+d[1]*up[1]+d[2]*up[2];',
    '  return [w/2+x*fl/z,h/2-y*fl/z];}',
    ' g.lineWidth=1.4;',
    ' for(var i=0;i<M.lines.length;i++){var L=M.lines[i];g.strokeStyle=L.color;g.beginPath();var pen=false;',
    '  for(var j=0;j<L.pts.length;j++){var q=pr(L.pts[j]);if(!q){pen=false;continue;}',
    '   if(pen)g.lineTo(q[0],q[1]);else{g.moveTo(q[0],q[1]);pen=true;}}',
    '  g.stroke();}',
    ' g.fillStyle="#9aa4b0";g.font="12px system-ui";g.fillText("drag rotate · wheel zoom · right-drag pan",10,h-10);',
    '}',
    'var drag=null;',
    "cv.addEventListener('contextmenu',function(e){e.preventDefault();});",
    "cv.addEventListener('pointerdown',function(e){drag={x:e.clientX,y:e.clientY,b:e.button};cv.setPointerCapture(e.pointerId);});",
    "cv.addEventListener('pointermove',function(e){if(!drag)return;var dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;",
    ' if(drag.b===2||e.shiftKey){var cp=Math.cos(pitch),cy=Math.cos(yaw),sy=Math.sin(yaw);',
    '  var k=dist/fl;tgt[0]+=(-dx*sy - dy* -Math.sin(pitch)*cy)*k;tgt[1]+=(dx*cy - dy* -Math.sin(pitch)*sy)*k;tgt[2]+=dy*cp*k;}',
    ' else{yaw-=dx*0.008;pitch=Math.min(1.5,Math.max(-1.5,pitch+dy*0.008));}',
    ' draw();});',
    "cv.addEventListener('pointerup',function(){drag=null;});",
    "cv.addEventListener('wheel',function(e){e.preventDefault();dist=Math.min(30,Math.max(0.8,dist*(e.deltaY>0?1.12:0.9)));draw();},{passive:false});",
    'draw();window.addEventListener("resize",draw);',
    '})();',
  ].join('\n')
  return `<div class="viewer-wrap"><canvas id="robot3d"></canvas></div>\n<script>${src}<\/script>`
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
