import type { RobotConfig, TagLayout, OccluderBox } from '../core/types'
import type { SweepResult } from '../core/sweep'
import { cellIndex } from '../core/sweep'
import { countBand } from '../core/evaluate'
import { COUNT_STOPS } from '../viz/heatmapView'

export type SweepViewMode = 'min' | 'ideal'
import { evaluatePose } from '../core/evaluate'
import { BAND_COLORS } from './hud'

export interface CellDetailHeadingRow {
  headingDeg: number
  score: number
  band: ReturnType<typeof countBand>
}

export interface CellDetailCamera {
  cameraName: string
  tagIds: number[]
}

export interface CellDetail {
  c: number
  r: number
  xM: number
  yM: number
  rows: CellDetailHeadingRow[]
  worstHeadingDeg: number
  worstHeadingCameras: CellDetailCamera[]
}

/**
 * Pure: builds the full inspection payload for one cell of a completed sweep —
 * field coordinates, one row per heading (degrees/score/band, read straight
 * from `result.perHeading`), and — via a single cheap `evaluatePose` recompute
 * at the worst (min-score) heading — which cameras saw which tags there.
 * DOM rendering (sweepControls' detail box) is a thin consumer of this data.
 */
export function buildCellDetail(
  result: SweepResult,
  c: number,
  r: number,
  robot: RobotConfig,
  layout: TagLayout,
  fieldOccluders: OccluderBox[],
  rangeCapM = Infinity,
): CellDetail {
  const i = cellIndex(c, r, result.cols)
  const rows: CellDetailHeadingRow[] = []
  let worstHeading = 0
  let worstScore = Infinity
  for (let h = 0; h < result.headingCount; h++) {
    const score = result.perHeading[i * result.headingCount + h]
    rows.push({ headingDeg: (360 * h) / result.headingCount, score, band: countBand(score) })
    if (score < worstScore) {
      worstScore = score
      worstHeading = h
    }
  }
  const worstHeadingDeg = (360 * worstHeading) / result.headingCount
  const worstPose = {
    x: (c + 0.5) * result.cellSizeM,
    y: (r + 0.5) * result.cellSizeM,
    headingRad: (2 * Math.PI * worstHeading) / result.headingCount,
  }
  const ev = evaluatePose(worstPose, robot, layout, fieldOccluders, rangeCapM)
  const worstHeadingCameras: CellDetailCamera[] = robot.cameras.map((cam, idx) => ({
    cameraName: cam.name,
    tagIds: (ev.perCamera[idx]?.detections ?? []).map((d) => d.tagId),
  }))
  return {
    c,
    r,
    xM: (c + 0.5) * result.cellSizeM,
    yM: (r + 0.5) * result.cellSizeM,
    rows,
    worstHeadingDeg,
    worstHeadingCameras,
  }
}

export interface SweepControlsOptions {
  /** Boot-time trusted range from the saved config: null = uncapped (camera limit), number = capped. */
  initialTrustedRangeM: number | null
  onRun(): void
  onModeChange(mode: SweepViewMode): void
  /** Ideal-view range edited; takes effect on the next Run. */
  onIdealRangeChange(rangeM: number): void
  onClear(): void
  onReport(): void
  onSetBaseline(): void
  onOptimize(): void
  onCancelOptimize(): void
  onProposalSelect(which: 'yours' | 'proposed'): void
  onProposalApply(): void
  onProposalDiscard(): void
}

export interface SweepControlsHandle {
  /** The bottom-bar container element; caller appends it into the page. */
  el: HTMLElement
  /** Toggles the Run button's disabled state and shows/hides the progress bar. */
  setRunning(running: boolean): void
  /** Updates the progress bar (0..1). */
  setProgress(frac: number): void
  /** Renders the cell-detail box from a pure CellDetail payload. */
  showDetail(detail: CellDetail): void
  /** Clears the cell-detail box back to its empty placeholder text. */
  clearDetail(): void
  /** Shows/hides a "results may be stale" note (config or field changed since the last sweep). */
  setStale(stale: boolean): void
  /** Show/hide the heatmap color legend (visible only while a sweep is displayed). */
  setLegendVisible(visible: boolean): void
  /** Coverage-vs-ideal score line (null clears/hides it). */
  setScore(score: { worstPct: number; idealRangeM: number } | null): void
  /** Enables/disables the Report and Set as baseline buttons (both require a completed sweep). */
  setReportEnabled(enabled: boolean): void
  /** Enables/disables the Optimize button (requires a completed sweep). */
  setOptimizeEnabled(enabled: boolean): void
  /** Non-null text puts the bar into optimizing state (progress text + Cancel); null restores it. */
  setOptimizing(text: string | null): void
  /** Shows the yours-vs-proposed A/B pill with Apply/Discard. */
  showProposal(p: { yoursPct: number; proposedPct: number }): void
  setProposalSelected(which: 'yours' | 'proposed'): void
  hideProposal(): void
}

function bandLabel(band: ReturnType<typeof countBand>): string {
  return { dead: 'dead', poor: 'poor', ok: 'ok', strong: 'strong' }[band]
}

/**
 * Bottom-bar DOM: Run button, worst-case/average mode radios, a progress bar,
 * a Clear button, and a cell-detail box. Plain DOM, no framework — matches
 * configPanel.ts/hud.ts's style. All sweep execution/state lives in main.ts;
 * this module only renders what it's told and forwards user intent via `opts`.
 */
export function createSweepControls(opts: SweepControlsOptions): SweepControlsHandle {
  const el = document.createElement('div')
  el.className = 'sweep-controls'

  const bar = document.createElement('div')
  bar.className = 'sweep-controls-bar'
  el.appendChild(bar)

  const runBtn = document.createElement('button')
  runBtn.textContent = 'Run coverage sweep'
  runBtn.addEventListener('click', () => opts.onRun())
  bar.appendChild(runBtn)

  function radio(value: SweepViewMode, labelText: string, checked: boolean): HTMLLabelElement {
    const label = document.createElement('label')
    label.className = 'sweep-mode-radio'
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'sweep-mode'
    input.value = value
    input.checked = checked
    input.addEventListener('change', () => {
      if (input.checked) opts.onModeChange(value)
    })
    label.append(input, document.createTextNode(labelText))
    return label
  }
  bar.appendChild(radio('min', 'Actual — worst heading', true))
  bar.appendChild(radio('ideal', 'Ideal — any camera setup', false))

  const idealLabel = document.createElement('label')
  idealLabel.className = 'sweep-mode-radio'
  const idealRangeSelect = document.createElement('select')
  for (const [value, text] of [
    ['auto', 'Camera limit (uncapped)'],
    ['custom', 'Capped…'],
  ]) {
    const o = document.createElement('option')
    o.value = value
    o.textContent = text
    idealRangeSelect.appendChild(o)
  }
  const idealRangeInput = document.createElement('input')
  idealRangeInput.type = 'number'
  idealRangeInput.min = '0.5'
  idealRangeInput.step = '0.5'
  idealRangeInput.value = String(opts.initialTrustedRangeM ?? 5)
  idealRangeInput.style.width = '3.5em'
  idealRangeInput.style.display = opts.initialTrustedRangeM === null ? 'none' : ''
  idealRangeInput.title = 'Tags farther than this are ignored everywhere (bad pose accuracy). Applies live; re-run the sweep for maps.'
  idealRangeSelect.value = opts.initialTrustedRangeM === null ? 'auto' : 'custom'
  const emitIdealRange = (): void => {
    if (idealRangeSelect.value === 'auto') {
      opts.onIdealRangeChange(0) // 0 = auto (longest camera reach)
    } else {
      const v = Number(idealRangeInput.value)
      if (Number.isFinite(v) && v > 0) opts.onIdealRangeChange(v)
    }
  }
  idealRangeSelect.title = 'Trusted tag range: tags beyond it are filtered from detection AND the ideal layer. "Camera limit" = no cap beyond what the cameras resolve.'
  idealRangeSelect.addEventListener('change', () => {
    idealRangeInput.style.display = idealRangeSelect.value === 'custom' ? '' : 'none'
    emitIdealRange()
  })
  idealRangeInput.addEventListener('change', emitIdealRange)
  idealLabel.append(document.createTextNode('Tag range'), idealRangeSelect, idealRangeInput)
  bar.appendChild(idealLabel)

  const legend = document.createElement('div')
  legend.className = 'sweep-legend'
  legend.style.display = 'none'
  const LEGEND_LABELS = ['0 (blind)', '1 tag', '2 tags', '3 tags', '4+ tags']
  COUNT_STOPS.forEach((hex, i) => {
    const item = document.createElement('span')
    item.className = 'sweep-legend-item'
    const swatch = document.createElement('span')
    swatch.className = 'sweep-legend-swatch'
    swatch.style.background = hex
    item.append(swatch, document.createTextNode(LEGEND_LABELS[i]))
    legend.appendChild(item)
  })
  bar.appendChild(legend)

  const scoreEl = document.createElement('span')
  scoreEl.className = 'sweep-score'
  scoreEl.title = 'Field-wide tags seen vs the ideal layer (ideal = 100)'
  scoreEl.style.display = 'none'
  bar.appendChild(scoreEl)

  const progress = document.createElement('progress')
  progress.max = 1
  progress.value = 0
  progress.style.display = 'none'
  bar.appendChild(progress)

  const clearBtn = document.createElement('button')
  clearBtn.textContent = 'Clear'
  clearBtn.addEventListener('click', () => opts.onClear())
  bar.appendChild(clearBtn)

  const reportBtn = document.createElement('button')
  reportBtn.textContent = 'Report'
  reportBtn.disabled = true
  reportBtn.addEventListener('click', () => opts.onReport())
  bar.appendChild(reportBtn)

  const baselineBtn = document.createElement('button')
  baselineBtn.textContent = 'Set as baseline'
  baselineBtn.disabled = true
  baselineBtn.addEventListener('click', () => opts.onSetBaseline())
  bar.appendChild(baselineBtn)

  const optimizeBtn = document.createElement('button')
  optimizeBtn.textContent = '✨ Optimize'
  optimizeBtn.title = 'Search your robot surfaces for better mounts for the SAME cameras (count and optics fixed). Requires a completed sweep.'
  optimizeBtn.disabled = true
  optimizeBtn.addEventListener('click', () => opts.onOptimize())
  bar.appendChild(optimizeBtn)

  const optimizeStatus = document.createElement('span')
  optimizeStatus.className = 'optimize-status'
  optimizeStatus.style.display = 'none'
  bar.appendChild(optimizeStatus)

  const cancelOptimizeBtn = document.createElement('button')
  cancelOptimizeBtn.textContent = 'Cancel'
  cancelOptimizeBtn.style.display = 'none'
  cancelOptimizeBtn.addEventListener('click', () => opts.onCancelOptimize())
  bar.appendChild(cancelOptimizeBtn)

  // Yours-vs-proposed A/B pill.
  const proposalWrap = document.createElement('span')
  proposalWrap.className = 'proposal-pill'
  proposalWrap.style.display = 'none'
  const yoursBtn = document.createElement('button')
  const proposedBtn = document.createElement('button')
  yoursBtn.addEventListener('click', () => opts.onProposalSelect('yours'))
  proposedBtn.addEventListener('click', () => opts.onProposalSelect('proposed'))
  const applyBtn = document.createElement('button')
  applyBtn.textContent = '✔ Apply'
  applyBtn.className = 'proposal-apply'
  applyBtn.addEventListener('click', () => opts.onProposalApply())
  const discardBtn = document.createElement('button')
  discardBtn.textContent = '✕ Discard'
  discardBtn.addEventListener('click', () => opts.onProposalDiscard())
  proposalWrap.append(yoursBtn, proposedBtn, applyBtn, discardBtn)
  bar.appendChild(proposalWrap)

  const staleNote = document.createElement('span')
  staleNote.className = 'sweep-stale-note'
  staleNote.textContent = 'Config changed since last sweep — results may be stale.'
  staleNote.style.display = 'none'
  bar.appendChild(staleNote)

  const detailBox = document.createElement('div')
  detailBox.className = 'cell-detail'
  el.appendChild(detailBox)

  const EMPTY_DETAIL_TEXT = 'Run a sweep, then double-click a cell on the field to inspect it.'
  detailBox.textContent = EMPTY_DETAIL_TEXT

  return {
    el,
    setRunning(running) {
      runBtn.disabled = running
      progress.style.display = running ? '' : 'none'
      if (!running) progress.value = 0
    },
    setProgress(frac) {
      progress.value = Math.max(0, Math.min(1, frac))
    },
    showDetail(detail) {
      detailBox.replaceChildren()

      const header = document.createElement('div')
      header.className = 'cell-detail-header'
      const title = document.createElement('span')
      title.textContent = `🔍 Cell inspector — field (${detail.xM.toFixed(2)} m, ${detail.yM.toFixed(2)} m): tags visible at each robot heading. Worst: ${detail.worstHeadingDeg.toFixed(0)}°`
      const closeBtn = document.createElement('button')
      closeBtn.className = 'cell-detail-close'
      closeBtn.textContent = '✕ close'
      closeBtn.addEventListener('click', () => {
        detailBox.replaceChildren()
        detailBox.textContent = EMPTY_DETAIL_TEXT
      })
      header.append(title, closeBtn)
      detailBox.appendChild(header)

      const table = document.createElement('table')
      table.className = 'cell-detail-table'
      const thead = document.createElement('tr')
      for (const h of ['Heading°', 'Tags', 'Band']) {
        const th = document.createElement('th')
        th.textContent = h
        thead.appendChild(th)
      }
      table.appendChild(thead)
      for (const row of detail.rows) {
        const tr = document.createElement('tr')
        if (row.headingDeg === detail.worstHeadingDeg) tr.className = 'worst-heading'
        const cells = [row.headingDeg.toFixed(0), String(Math.round(row.score)), bandLabel(row.band)]
        cells.forEach((text, i) => {
          const td = document.createElement('td')
          td.textContent = text
          if (i === 2) td.style.color = BAND_COLORS[row.band]
          tr.appendChild(td)
        })
        table.appendChild(tr)
      }
      detailBox.appendChild(table)

      const camerasHeader = document.createElement('div')
      camerasHeader.className = 'cell-detail-cameras-header'
      camerasHeader.textContent = 'Cameras at worst heading:'
      detailBox.appendChild(camerasHeader)

      const camerasList = document.createElement('ul')
      camerasList.className = 'cell-detail-cameras'
      for (const cam of detail.worstHeadingCameras) {
        const li = document.createElement('li')
        li.textContent = cam.tagIds.length > 0 ? `${cam.cameraName}: tags ${cam.tagIds.join(', ')}` : `${cam.cameraName}: none`
        camerasList.appendChild(li)
      }
      detailBox.appendChild(camerasList)
    },
    clearDetail() {
      detailBox.replaceChildren()
      detailBox.textContent = EMPTY_DETAIL_TEXT
    },
    setStale(stale) {
      staleNote.style.display = stale ? '' : 'none'
    },
    setLegendVisible(visible) {
      legend.style.display = visible ? '' : 'none'
    },
    setScore(score) {
      if (!score) {
        scoreEl.style.display = 'none'
        scoreEl.textContent = ''
        return
      }
      scoreEl.style.display = ''
      scoreEl.textContent = `Score vs ideal@${score.idealRangeM.toFixed(1)}m: ${score.worstPct.toFixed(0)} / 100`
    },
    setOptimizeEnabled(enabled) {
      optimizeBtn.disabled = !enabled
    },
    setOptimizing(text) {
      optimizeStatus.style.display = text ? '' : 'none'
      optimizeStatus.textContent = text ?? ''
      cancelOptimizeBtn.style.display = text ? '' : 'none'
      optimizeBtn.disabled = text !== null
      runBtn.disabled = text !== null
    },
    showProposal(p) {
      proposalWrap.style.display = ''
      yoursBtn.textContent = `Yours ${p.yoursPct.toFixed(0)}`
      proposedBtn.textContent = `Proposed ${p.proposedPct.toFixed(0)}`
    },
    setProposalSelected(which) {
      yoursBtn.classList.toggle('active', which === 'yours')
      proposedBtn.classList.toggle('active', which === 'proposed')
    },
    hideProposal() {
      proposalWrap.style.display = 'none'
    },
    setReportEnabled(enabled) {
      reportBtn.disabled = !enabled
      baselineBtn.disabled = !enabled
    },
  }
}
