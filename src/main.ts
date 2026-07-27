import * as THREE from 'three'
import './ui/styles.css'
import { createScene } from './viz/scene'
import { buildFieldView } from './viz/fieldView'
import { loadLayout, loadOccluders } from './field/layoutLoader'
import { buildRobot } from './robot/robotBuilder'
import { createDriveController } from './sim/driveController'
import { DEFAULT_CONFIG } from './core/defaults'
import { evaluatePose } from './core/evaluate'
import { createFrustumView } from './viz/frustumView'
import { createTagHighlights } from './viz/tagHighlights'
import { createHud } from './ui/hud'
import { createConfigPanel } from './ui/configPanel'
import { loadConfig, saveConfig, occluderUrlForYear } from './ui/configStore'
import { showToast } from './ui/toast'
import { createHeatmapView } from './viz/heatmapView'
import { createSweepControls, buildCellDetail } from './ui/sweepControls'
import { sweepInWorker } from './workers/sweepClient'
import { DEFAULT_SWEEP } from './core/sweep'
import type { SweepResult } from './core/sweep'
import type { OccluderBox, SimConfig, TagLayout } from './core/types'
import { computeReportStats } from './report/report'
import type { ReportStats } from './report/report'
import { renderReport, openReport } from './report/reportTemplate'

/**
 * Frees GPU/canvas resources (geometries, materials, and any material
 * texture maps) for every mesh/line under `obj` before it's discarded.
 * `buildRobot`/`buildFieldView` allocate these with no disposal path of
 * their own, so rebuild call sites must dispose the old group themselves.
 */
function disposeObject3D(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const withGeometry = child as THREE.Mesh
    withGeometry.geometry?.dispose()
    const material = (child as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
    if (!material) return
    for (const m of Array.isArray(material) ? material : [material]) {
      ;(m as THREE.MeshBasicMaterial).map?.dispose()
      m.dispose()
    }
  })
}

interface LoadedField {
  layout: TagLayout
  occluders: OccluderBox[]
}

async function loadField(year: string): Promise<LoadedField> {
  const layout = await loadLayout(`layouts/${year}.json`)
  const occluders = await loadOccluders(occluderUrlForYear(year))
  return { layout, occluders }
}

async function boot() {
  const app = document.getElementById('app')!
  const ctx = createScene(app)

  let config: SimConfig = loadConfig() ?? structuredClone(DEFAULT_CONFIG)

  // Guard the initial load: a corrupted/unknown fieldYear that slipped into
  // localStorage (e.g. via a hand-edited import) must not brick every
  // future boot. Fall back to DEFAULT_CONFIG's field and persist the
  // correction; if even the default field fails to load, that's a real
  // asset problem and the boot-failed screen is the right outcome.
  let bootYear = config.fieldYear
  let bootField: LoadedField
  try {
    bootField = await loadField(bootYear)
  } catch (e) {
    if (bootYear === DEFAULT_CONFIG.fieldYear) throw e
    showToast(`Failed to load field "${bootYear}": ${e instanceof Error ? e.message : String(e)} — falling back to default field.`)
    bootYear = DEFAULT_CONFIG.fieldYear
    bootField = await loadField(bootYear)
  }
  if (bootYear !== config.fieldYear) {
    config.fieldYear = bootYear
    saveConfig(config)
  }

  let layout: TagLayout = bootField.layout
  let fieldOccluders: OccluderBox[] = bootField.occluders
  let fieldGroup = buildFieldView(ctx.scene, layout)
  let tagSize = layout.tags[0]?.size ?? 0.1651

  let robotGroup = buildRobot(config.robot)
  ctx.scene.add(robotGroup)
  const drive = createDriveController(layout.field.length, layout.field.width)

  const frustumView = createFrustumView(ctx.scene)
  let tagHighlights = createTagHighlights(fieldGroup)
  const hud = createHud(app)
  const heatmap = createHeatmapView(ctx.scene)

  // Coverage sweep state. `lastSweep` is the source of truth for both the
  // shown heatmap and cell inspection; it's cleared whenever it would no
  // longer be valid (field change) and flagged stale (not cleared — cheap
  // version per the task brief) when the robot config changes underneath it.
  let lastSweep: {
    result: SweepResult
    config: SimConfig
    /** True when `fieldOccluders` was empty at sweep time — threads into the report's optimism note. */
    fieldOccludersEmpty: boolean
    /** Layout tag ids at sweep time — computeReportStats needs the full layout id set (not just the ones detected) to report never-seen tags. */
    allTagIds: number[]
  } | null = null
  let sweepMode: 'min' | 'avg' = 'min'
  let sweepRunning = false
  // Report baseline: a snapshot of ReportStats from a past sweep, captured via
  // the "Set as baseline" button, compared against in the report when set.
  let baseline: { label: string; stats: ReportStats } | null = null
  // Bumped by clearSweep() (Clear button or a field change); a sweep whose
  // generation no longer matches when its worker promise resolves was
  // superseded mid-flight and its result is discarded rather than applied.
  let sweepGeneration = 0

  function rebuildRobot(): void {
    ctx.scene.remove(robotGroup)
    disposeObject3D(robotGroup)
    robotGroup = buildRobot(config.robot)
    ctx.scene.add(robotGroup)
  }

  function clearSweep(clearBaselineToo = false): void {
    sweepGeneration++
    heatmap.hide()
    lastSweep = null
    sweepControls.clearDetail()
    sweepControls.setStale(false)
    sweepControls.setReportEnabled(false)
    // A baseline's ReportStats are tied to the field it was swept on (cell
    // coordinates, dead-zone counts, etc. are meaningless across different
    // field dimensions), so a field change invalidates it too — but a plain
    // Clear-button click (same field, e.g. re-running with new config) should
    // leave a set baseline in place for the next report's comparison.
    if (clearBaselineToo) baseline = null
  }

  function markSweepStaleIfNeeded(): void {
    if (!lastSweep) return
    sweepControls.setStale(JSON.stringify(config) !== JSON.stringify(lastSweep.config))
  }

  async function rebuildField(year: string): Promise<void> {
    let loaded: LoadedField
    try {
      loaded = await loadField(year)
    } catch (e) {
      showToast(`Failed to load field "${year}": ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    // Only mutate/persist fieldYear and swap live state once the load has
    // fully succeeded — an in-flight failure must leave the old field (and
    // the previously-saved, known-good fieldYear) untouched.
    ctx.scene.remove(fieldGroup)
    disposeObject3D(fieldGroup)
    layout = loaded.layout
    fieldOccluders = loaded.occluders
    tagSize = layout.tags[0]?.size ?? 0.1651
    fieldGroup = buildFieldView(ctx.scene, layout)
    tagHighlights = createTagHighlights(fieldGroup)
    drive.setFieldBounds(layout.field.length, layout.field.width)
    config.fieldYear = year
    saveConfig(config)
    // A field change means a different grid (size/dims/occluders) — any
    // existing sweep result no longer describes this field at all, so it's
    // disposed outright rather than merely marked stale. Any set baseline is
    // tied to the old field's geometry too, so it's cleared as well.
    clearSweep(true)
  }

  ctx.onFrame((dt) => {
    drive.update(dt)
    robotGroup.position.set(drive.pose.x, drive.pose.y, 0)
    robotGroup.rotation.z = drive.pose.headingRad

    const ev = evaluatePose(drive.pose, config.robot, layout, fieldOccluders)
    frustumView.update(drive.pose, config.robot, tagSize)
    tagHighlights.update(ev, config.robot)
    hud.update(ev, config.robot)
  })

  const sweepControls = createSweepControls({
    onRun() {
      if (sweepRunning) return
      sweepRunning = true
      const myGeneration = ++sweepGeneration
      sweepControls.setRunning(true)
      sweepControls.setProgress(0)
      sweepControls.clearDetail()
      sweepInWorker(layout, config.robot, fieldOccluders, DEFAULT_SWEEP, (frac) => {
        if (sweepGeneration === myGeneration) sweepControls.setProgress(frac)
      })
        .then((result) => {
          // A Clear click or a field change while this sweep was in flight
          // bumped the generation counter; that result no longer describes
          // the current field/state, so it's silently dropped.
          if (sweepGeneration !== myGeneration) return
          heatmap.show(result, sweepMode)
          lastSweep = {
            result,
            config: structuredClone(config),
            fieldOccludersEmpty: fieldOccluders.length === 0,
            allTagIds: layout.tags.map((t) => t.id),
          }
          ;(window as any).__sim.lastSweep = lastSweep
          sweepControls.setStale(false)
          sweepControls.setReportEnabled(true)
        })
        .catch((e: unknown) => {
          showToast(`Coverage sweep failed: ${e instanceof Error ? e.message : String(e)}`)
        })
        .finally(() => {
          sweepRunning = false
          sweepControls.setRunning(false)
        })
    },
    onModeChange(mode) {
      sweepMode = mode
      // Re-color only from the stored result — no re-sweep.
      if (lastSweep) heatmap.show(lastSweep.result, sweepMode)
    },
    onClear() {
      clearSweep()
    },
    onReport() {
      if (!lastSweep) return
      const stats = computeReportStats(lastSweep.result, lastSweep.config.robot, lastSweep.allTagIds)
      const html = renderReport(stats, lastSweep.config, baseline ?? undefined, { fieldOccludersEmpty: lastSweep.fieldOccludersEmpty })
      openReport(html)
    },
    onSetBaseline() {
      if (!lastSweep) return
      const stats = computeReportStats(lastSweep.result, lastSweep.config.robot, lastSweep.allTagIds)
      baseline = { label: 'Baseline', stats }
      showToast('Baseline set from the current sweep.')
    },
  })
  app.appendChild(sweepControls.el)

  // Cell inspection: a plain click (not an OrbitControls drag) on the canvas
  // while a heatmap is shown picks the cell under the cursor and renders its
  // detail. Distinguished from a drag by pointerdown->pointerup travel
  // distance, since OrbitControls also listens on the same canvas.
  const CLICK_DRAG_THRESHOLD_PX = 4
  let pointerDownX = 0
  let pointerDownY = 0
  ctx.renderer.domElement.addEventListener('pointerdown', (e) => {
    pointerDownX = e.clientX
    pointerDownY = e.clientY
  })
  ctx.renderer.domElement.addEventListener('pointerup', (e) => {
    if (Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY) > CLICK_DRAG_THRESHOLD_PX) return
    if (!lastSweep) return
    const rect = ctx.renderer.domElement.getBoundingClientRect()
    const ndc = {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    }
    const cell = heatmap.pickCell(ndc, ctx.camera)
    if (!cell) return
    // Use the robot config *snapshotted at sweep time*, not the live one: the
    // per-heading score table came from that snapshot's sweep, so the worst-
    // heading cameras/tags recompute must use the same robot or the two
    // halves of the detail box would describe different robots after an
    // edit (see markSweepStaleIfNeeded — this is exactly the drift that
    // makes a completed sweep "stale"). layout/fieldOccluders are safe to
    // read live: a field change always clears lastSweep via clearSweep().
    sweepControls.showDetail(buildCellDetail(lastSweep.result, cell.c, cell.r, lastSweep.config.robot, layout, fieldOccluders))
  })

  const panel = createConfigPanel({
    config,
    onChange(newConfig) {
      // fieldYear is main.ts's own responsibility (see rebuildField): it's
      // only ever mutated after a field load actually succeeds. The panel's
      // `newConfig.fieldYear` may be stale/unconfirmed (e.g. it optimistically
      // updates on select before the async load resolves, including on a
      // load that ultimately fails), so it is intentionally *not* trusted
      // here — only the robot config is taken from panel edits.
      config = { ...newConfig, fieldYear: config.fieldYear }
      saveConfig(config)
      rebuildRobot()
      markSweepStaleIfNeeded()
    },
    onFieldChange(year) {
      // config.fieldYear is only mutated + persisted inside rebuildField,
      // after the new layout/occluders have actually loaded successfully.
      void rebuildField(year)
    },
  })
  app.appendChild(panel)

  ;(window as any).__sim = {
    ctx,
    layout,
    fieldOccluders,
    config,
    robotGroup,
    drive,
    frustumView,
    tagHighlights,
    hud,
    panel,
    heatmap,
    sweepControls,
    lastSweep,
  } // grows in later tasks
}
boot().catch((e) => { document.body.innerHTML = `<pre>boot failed: ${e.message}</pre>` })
