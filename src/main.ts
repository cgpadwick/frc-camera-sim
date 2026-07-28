import * as THREE from 'three'
import './ui/styles.css'
import { createScene } from './viz/scene'
import { buildFieldView } from './viz/fieldView'
import { loadLayout, loadOccluders } from './field/layoutLoader'
import { tryLoadFieldModel } from './field/fieldModelLoader'
import { buildRobot } from './robot/robotBuilder'
import { createDriveController } from './sim/driveController'
import { DEFAULT_CONFIG } from './core/defaults'
import { evaluatePose, idealTagIds, autoIdealRangeM } from './core/evaluate'
import { createFrustumView } from './viz/frustumView'
import { createTagHighlights } from './viz/tagHighlights'
import { createHud } from './ui/hud'
import { createConfigPanel } from './ui/configPanel'
import { loadConfig, saveConfig, occluderUrlForYear } from './ui/configStore'
import { showToast, dismissToast } from './ui/toast'
import { createHeatmapView } from './viz/heatmapView'
import { createViewManager } from './viz/viewModes'
import { createViewSelect } from './ui/viewSelect'
import { createTabBar } from './ui/tabs'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { createRobotEditor } from './editor/robotEditor'
import { disposeObject3D } from './viz/dispose'
import { createSweepControls, buildCellDetail } from './ui/sweepControls'
import type { SweepViewMode } from './ui/sweepControls'
import { sweepInWorker } from './workers/sweepClient'
import { DEFAULT_SWEEP, coverageScoreVsIdeal } from './core/sweep'
import type { SweepResult } from './core/sweep'
import type { OccluderBox, SimConfig, TagLayout } from './core/types'
import { computeReportStats } from './report/report'
import type { ReportStats } from './report/report'
import { renderReport, openReport } from './report/reportTemplate'

// Stable key for the "field model unavailable" banner, so switching between
// model-less field years (or repeatedly reloading the same one) replaces the
// existing banner instead of stacking a new one on top each time — see
// showToast's `key` param. Also used to dismiss a stale banner once a later
// field switch's model DOES load.
const FIELD_MODEL_TOAST_KEY = 'field-model-unavailable'

interface LoadedField {
  layout: TagLayout
  occluders: OccluderBox[]
  /** null when no glb exists for this year, or it failed to load/parse — never throws, see tryLoadFieldModel. */
  model: THREE.Group | null
}

async function loadField(year: string): Promise<LoadedField> {
  const layout = await loadLayout(`layouts/${year}.json`)
  const occluders = await loadOccluders(occluderUrlForYear(year))
  const model = await tryLoadFieldModel(`models/${year}.glb`)
  return { layout, occluders, model }
}

async function boot() {
  const app = document.getElementById('app')!
  const ctx = createScene(app)

  const loaded = loadConfig()
  if (loaded && 'error' in loaded) {
    showToast('Saved config was invalid — using defaults')
  }
  let config: SimConfig = loaded && 'config' in loaded ? loaded.config : structuredClone(DEFAULT_CONFIG)

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
  if (bootField.model) {
    dismissToast(FIELD_MODEL_TOAST_KEY)
  } else {
    showToast('Field model unavailable — showing simplified field.', Infinity, FIELD_MODEL_TOAST_KEY)
  }

  let layout: TagLayout = bootField.layout
  let fieldOccluders: OccluderBox[] = bootField.occluders
  let fieldGroup = buildFieldView(ctx.scene, layout, { model: bootField.model })
  let tagSize = layout.tags[0]?.size ?? 0.1651

  let robotGroup = buildRobot(config.robot)
  ctx.scene.add(robotGroup)
  const drive = createDriveController(layout.field.length, layout.field.width)

  const frustumView = createFrustumView(ctx.scene)
  let tagHighlights = createTagHighlights(fieldGroup)
  const hud = createHud(app)
  const heatmap = createHeatmapView(ctx.scene)

  const viewManager = createViewManager(ctx)
  const viewSelect = createViewSelect(viewManager)
  viewSelect.refresh(config.robot.cameras.map((c) => c.name))
  // HUD + view selector share a left-side column so the selector always
  // sits below the per-camera list no matter how many cameras exist.
  const leftStack = document.createElement('div')
  leftStack.className = 'left-stack'
  leftStack.append(hud.el, viewSelect.el)
  app.appendChild(leftStack)
  // --- Pick-up-and-move the robot in field view (orbit mode) ---
  // Click the robot: an X/Y translate gizmo attaches; dragging slides it
  // across the carpet with live score/frustum feedback (the frame loop reads
  // drive.pose, which objectChange keeps in sync). WASD/rotation keys keep
  // working alongside. Click empty space or leave orbit view to detach.
  const robotTc = new TransformControls(ctx.camera, ctx.renderer.domElement)
  robotTc.setMode('translate')
  robotTc.showZ = false // field-plane moves only
  robotTc.setSize(0.7)
  ctx.scene.add(robotTc.getHelper())
  robotTc.enabled = false

  function detachRobotGizmo(): void {
    robotTc.detach()
    robotTc.enabled = false
  }

  robotTc.addEventListener('dragging-changed', (e) => {
    const dragging = (e as unknown as { value: boolean }).value
    ctx.controls.enabled = !dragging
    // On release, re-clamp the pose into field bounds (reuses the drive
    // controller's own clamp) and snap the group back onto the carpet.
    if (!dragging) {
      drive.setFieldBounds(layout.field.length, layout.field.width)
      robotGroup.position.set(drive.pose.x, drive.pose.y, 0)
    }
  })
  robotTc.addEventListener('objectChange', () => {
    drive.pose.x = robotGroup.position.x
    drive.pose.y = robotGroup.position.y
  })

  function pointerHitsRobot(e: PointerEvent): boolean {
    const rect = ctx.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, ctx.camera)
    return ray.intersectObject(robotGroup, true).length > 0
  }

  ctx.renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || appMode !== 'field') return
    if (viewManager.current() !== 'orbit') return
    if (robotTc.dragging || robotTc.axis) return // gizmo owns this event
    if (pointerHitsRobot(e)) {
      robotTc.attach(robotGroup)
      robotTc.enabled = true
    } else {
      detachRobotGizmo()
    }
  })
  viewManager.onChange((id) => {
    if (id !== 'orbit') detachRobotGizmo()
  })

  // Single frustum-visibility state shared by both modes (F key + 👁 button).
  let frustumsVisible = true
  function setFrustumsVisible(visible: boolean): void {
    frustumsVisible = visible
    frustumView.setVisible(visible)
    editor.setFrustumsVisible(visible)
    tabs.setFrustumsVisible(visible)
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.target !== document.body) return
    if (e.key.toLowerCase() === 'v' && appMode === 'field') viewManager.cycle()
    if (e.key.toLowerCase() === 'f') setFrustumsVisible(!frustumsVisible)
  })

  // --- Robot editor mode ---
  let appMode: 'field' | 'robot' = 'field'
  // Saved field-mode camera so tab switches round-trip the viewpoint.
  const savedFieldCam = { position: new THREE.Vector3(), target: new THREE.Vector3() }

  let selectedCameraIndex: number | null = null

  /** Editor moved/added a camera: mutate config; on commit persist + sync all consumers. */
  function applyEditorRobotChange(commit: boolean): void {
    if (!commit) return
    saveConfig(config)
    panel.refresh(config)
    panel.highlightCamera(selectedCameraIndex) // refresh() rebuilt the DOM
    rebuildRobot()
    viewSelect.refresh(config.robot.cameras.map((c) => c.name))
    markSweepStaleIfNeeded()
  }

  const editor = createRobotEditor(ctx, {
    getRobot: () => config.robot,
    getTagSize: () => tagSize,
    onMountUpdate(u) {
      const cam = config.robot.cameras[u.cameraIndex]
      if (!cam) return
      cam.mount = u.mount
      applyEditorRobotChange(u.commit)
    },
    onAddCamera(mount) {
      const n = config.robot.cameras.length
      config.robot.cameras.push({
        name: `cam-${n}`,
        hfovDeg: 75,
        vfovDeg: 47,
        resWidth: 1280,
        resHeight: 800,
        maxRangeM: null,
        mount,
      })
      applyEditorRobotChange(true)
    },
    onSelectCamera(index) {
      selectedCameraIndex = index
      panel.highlightCamera(index)
    },
    onBoxUpdate(index, box) {
      if (!config.robot.superstructure[index]) return
      config.robot.superstructure[index] = box
      applyEditorRobotChange(true)
      editor.rebuildRobot() // normalizes gizmo scale back into box size
    },
    onBoxRemove(index) {
      config.robot.superstructure.splice(index, 1)
      applyEditorRobotChange(true)
      editor.rebuildRobot()
    },
  })

  // Instructions overlay for the robot editor (visible only in robot mode).
  const editorHints = document.createElement('div')
  editorHints.className = 'editor-hints'
  editorHints.innerHTML = [
    '<b>Robot editor</b>',
    '🖱 <b>Drag</b> a camera to slide it across the robot',
    '📐 It aims out of whatever face it sits on',
    '➕ <b>Add camera</b>, then click a spot on the robot',
    '🎯 <b>Click</b> a camera to edit its numbers in the panel',
    '▦ <b>Click a box</b> to move/rotate/scale it (toolbar appears)',
    '⌫ <b>Delete</b> removes the selected box',
    '🌀 Left-drag orbit · right-drag pan · scroll zoom',
  ]
    .map((l) => `<div>${l}</div>`)
    .join('')
  editorHints.style.display = 'none'
  app.appendChild(editorHints)

  const tabs = createTabBar({
    onChange(mode) {
      appMode = mode
      if (mode === 'robot') {
        detachRobotGizmo()
        viewManager.setMode('orbit')
        savedFieldCam.position.copy(ctx.camera.position)
        savedFieldCam.target.copy(ctx.controls.target)
        ctx.setActiveScene(editor.scene)
        ctx.camera.position.set(1.6, -1.6, 1.2)
        ctx.controls.target.set(0, 0, 0.35)
        editor.setActive(true)
      } else {
        editor.setActive(false)
        ctx.setActiveScene(ctx.scene)
        ctx.camera.position.copy(savedFieldCam.position)
        ctx.controls.target.copy(savedFieldCam.target)
      }
      // Field-only chrome hides in robot mode; editor hints show there.
      for (const el of [viewSelect.el, sweepControls.el, hud.el]) {
        el.style.display = mode === 'robot' ? 'none' : ''
      }
      editorHints.style.display = mode === 'robot' ? '' : 'none'
      panel.setMode(mode)
    },
    onAddCamera: () => editor.armAddCamera(),
    onToggleFrustums: (visible) => setFrustumsVisible(visible),
    onAddBox() {
      config.robot.superstructure.push({
        center: { x: 0, y: 0, z: config.robot.chassisHeightM + 0.15 },
        size: { x: 0.3, y: 0.3, z: 0.3 },
        yawDeg: 0,
      })
      applyEditorRobotChange(true)
      editor.rebuildRobot()
      editor.selectBox(config.robot.superstructure.length - 1)
    },
  })
  app.appendChild(tabs.el)

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
  let sweepMode: SweepViewMode = 'min'
  // 0 = auto: match the longest camera's reach so ideal always >= actual.
  let sweepIdealRangeM = 0
  function resolveIdealRangeM(): number {
    return sweepIdealRangeM > 0 ? sweepIdealRangeM : autoIdealRangeM(config.robot, tagSize)
  }
  let sweepRunning = false
  // Report baseline: a snapshot of ReportStats from a past sweep, captured via
  // the "Set as baseline" button, compared against in the report when set.
  let baseline: { label: string; stats: ReportStats } | null = null
  // Bumped by clearSweep() (Clear button or a field change); a sweep whose
  // generation no longer matches when its worker promise resolves was
  // superseded mid-flight and its result is discarded rather than applied.
  let sweepGeneration = 0

  function rebuildRobot(): void {
    const gizmoWasAttached = robotTc.object === robotGroup
    if (gizmoWasAttached) robotTc.detach()
    ctx.scene.remove(robotGroup)
    disposeObject3D(robotGroup)
    robotGroup = buildRobot(config.robot)
    ctx.scene.add(robotGroup)
    if (gizmoWasAttached) robotTc.attach(robotGroup)
  }

  function clearSweep(clearBaselineToo = false): void {
    sweepGeneration++
    heatmap.hide()
    lastSweep = null
    sweepControls.clearDetail()
    sweepControls.setLegendVisible(false)
    sweepControls.setScore(null)
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
    if (loaded.model) {
      dismissToast(FIELD_MODEL_TOAST_KEY)
    } else {
      showToast('Field model unavailable — showing simplified field.', Infinity, FIELD_MODEL_TOAST_KEY)
    }
    fieldGroup = buildFieldView(ctx.scene, layout, { model: loaded.model })
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
    if (appMode === 'robot') {
      editor.update()
      return
    }
    drive.update(dt)
    // While the move gizmo drags, it owns the group's position; pose is
    // synced back via objectChange (heading stays keyboard-driven).
    if (!robotTc.dragging) robotGroup.position.set(drive.pose.x, drive.pose.y, 0)
    robotGroup.rotation.z = drive.pose.headingRad

    const ev = evaluatePose(drive.pose, config.robot, layout, fieldOccluders)
    const idealIds = idealTagIds(drive.pose.x, drive.pose.y, layout, fieldOccluders, resolveIdealRangeM())
    viewManager.update(drive.pose, config.robot)
    frustumView.update(drive.pose, config.robot, tagSize, viewManager.povCameraIndex())
    tagHighlights.update(ev, config.robot, idealIds)
    hud.update(ev, config.robot, idealIds.length)
  })

  const sweepControls = createSweepControls({
    onRun() {
      if (sweepRunning) return
      sweepRunning = true
      const myGeneration = ++sweepGeneration
      // Snapshot the config BEFORE dispatch, not at resolve time: the worker
      // runs for a while, and a config edit mid-sweep must not retroactively
      // change what this sweep is recorded as having measured (that would
      // both silence markSweepStaleIfNeeded's staleness check and make the
      // report/cell-detail describe the wrong robot). Both the worker call
      // and lastSweep below use this same snapshot.
      const snapshot = structuredClone(config)
      sweepControls.setRunning(true)
      sweepControls.setProgress(0)
      sweepControls.clearDetail()
      sweepInWorker(layout, snapshot.robot, fieldOccluders, { ...DEFAULT_SWEEP, idealRangeM: resolveIdealRangeM() }, (frac) => {
        if (sweepGeneration === myGeneration) sweepControls.setProgress(frac)
      })
        .then((result) => {
          // A Clear click or a field change while this sweep was in flight
          // bumped the generation counter; that result no longer describes
          // the current field/state, so it's silently dropped.
          if (sweepGeneration !== myGeneration) return
          heatmap.show(result, sweepMode)
          sweepControls.setLegendVisible(true)
          sweepControls.setScore(coverageScoreVsIdeal(result))
          lastSweep = {
            result,
            config: snapshot,
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
    onIdealRangeChange(rangeM) {
      sweepIdealRangeM = rangeM
      // The shown ideal layer was computed at the old range — flag it.
      if (lastSweep && lastSweep.result.idealRangeM !== resolveIdealRangeM()) sweepControls.setStale(true)
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
    // Robot clicks belong to the move gizmo, not cell inspection.
    if (robotTc.dragging || robotTc.axis || pointerHitsRobot(e)) return
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
      editor.rebuildRobot()
      viewSelect.refresh(config.robot.cameras.map((c) => c.name))
      markSweepStaleIfNeeded()
    },
    onFieldChange(year) {
      // config.fieldYear is only mutated + persisted inside rebuildField,
      // after the new layout/occluders have actually loaded successfully.
      void rebuildField(year)
    },
  })
  app.appendChild(panel.el)

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
boot().catch((e) => {
  document.body.replaceChildren()
  const pre = document.createElement('pre')
  pre.textContent = `boot failed: ${e instanceof Error ? e.message : String(e)}`
  document.body.appendChild(pre)
})
