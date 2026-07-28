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
import { showFirstRunMarks, showInspectMark, firstSweepPending } from './ui/coachMarks'
import { createSetupChecklist } from './ui/setupChecklist'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { createRobotEditor } from './editor/robotEditor'
import { disposeObject3D } from './viz/dispose'
import { createSweepControls, buildCellDetail } from './ui/sweepControls'
import type { SweepViewMode } from './ui/sweepControls'
import { sweepInWorker } from './workers/sweepClient'
import { optimizeInWorker } from './workers/optimizeClient'
import type { OptimizeHandle } from './workers/optimizeClient'
import { buildCameraGizmo } from './viz/cameraModel'
import { DEFAULT_SWEEP, coverageScoreVsIdeal } from './core/sweep'
import type { SweepResult } from './core/sweep'
import type { OccluderBox, RobotConfig, SimConfig, TagLayout } from './core/types'
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

  // --- Optimizer proposal state + ghost visuals (white = proposed mounts) ---
  const GHOST_WHITE = 0xffffff
  const ghostFrustums = createFrustumView(ctx.scene, { colorOverride: GHOST_WHITE })
  let ghostGizmos: THREE.Group | null = null
  let proposal: { robot: RobotConfig; result: SweepResult; score: number } | null = null
  let proposalView: 'yours' | 'proposed' = 'proposed'
  let optimizeHandle: OptimizeHandle | null = null

  function buildGhostGizmos(robot: RobotConfig): void {
    if (ghostGizmos) {
      ctx.scene.remove(ghostGizmos)
      disposeObject3D(ghostGizmos)
    }
    ghostGizmos = new THREE.Group()
    ghostGizmos.name = 'ghost-cameras'
    for (const cam of robot.cameras) {
      const g = buildCameraGizmo(GHOST_WHITE, 1.4)
      g.traverse((c) => {
        const mat = (c as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined
        if (mat) {
          mat.transparent = true
          mat.opacity = 0.55
        }
      })
      g.position.set(cam.mount.x, cam.mount.y, cam.mount.z)
      const rollQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (cam.mount.rollDeg * Math.PI) / 180)
      const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (cam.mount.pitchDeg * Math.PI) / 180)
      const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (cam.mount.yawDeg * Math.PI) / 180)
      g.quaternion.multiplyQuaternions(yawQ, pitchQ).multiply(rollQ)
      ghostGizmos.add(g)
    }
    ctx.scene.add(ghostGizmos)
  }

  function clearProposal(): void {
    proposal = null
    if (ghostGizmos) {
      ctx.scene.remove(ghostGizmos)
      disposeObject3D(ghostGizmos)
      ghostGizmos = null
    }
    ghostFrustums.update({ x: 0, y: 0, headingRad: 0 }, { ...config.robot, cameras: [] }, tagSize)
    sweepControls.hideProposal()
    // An outcome line referencing a discarded proposal would be stale.
    sweepControls.setOptimizeOutcome(null)
    refreshWorkflowState()
  }

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
    if (e.key === 'Escape') {
      // A2: Esc backs out of transient UI regardless of focus target.
      sweepControls.clearDetail()
      purposeChip.remove()
      for (const mark of document.querySelectorAll('.coach-mark')) mark.remove()
      detachRobotGizmo()
      return
    }
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
    refreshWorkflowState()
    refreshChecklist()
  }

  const editor = createRobotEditor(ctx, {
    getRobot: () => config.robot,
    getTagSize: () => tagSize,
    onMountUpdate(u) {
      const cam = config.robot.cameras[u.cameraIndex]
      if (!cam) return
      cam.mount = u.mount
      if (u.commit) cameraAimed = true
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
      bodyShapeTouched = true
      applyEditorRobotChange(true)
      editor.rebuildRobot() // normalizes gizmo scale back into box size
    },
    onBoxRemove(index) {
      config.robot.superstructure.splice(index, 1)
      bodyShapeTouched = true
      applyEditorRobotChange(true)
      editor.rebuildRobot()
    },
    onHint(text) {
      hintLine.textContent = text
    },
  })

  // Robot-editor guidance: ONE contextual hint line for the current state,
  // with the full legend collapsed behind a "?" toggle (QA round 5, P1.11).
  const editorHints = document.createElement('div')
  editorHints.className = 'editor-hints'
  const hintLine = document.createElement('div')
  hintLine.className = 'editor-hint-line'
  const helpToggle = document.createElement('button')
  helpToggle.className = 'editor-help-toggle'
  helpToggle.textContent = '?'
  helpToggle.title = 'Show all editor controls'
  const legend = document.createElement('div')
  legend.style.display = 'none'
  legend.innerHTML = [
    '🖱 <b>Drag</b> a camera to slide it across the robot (it aims out of the face it sits on)',
    '➕ <b>Add camera</b>, then click a spot on the robot',
    '▦ <b>Click a body shape</b> to move/rotate/scale it · <b>Delete</b> removes it',
    '🌀 Left-drag orbit · right-drag pan · scroll zoom · <b>F</b> toggles view cones',
  ]
    .map((l) => `<div>${l}</div>`)
    .join('')
  helpToggle.addEventListener('click', () => {
    const open = legend.style.display === 'none'
    legend.style.display = open ? '' : 'none'
    helpToggle.title = open ? 'Hide controls' : 'Show all editor controls'
  })
  const hintRow = document.createElement('div')
  hintRow.className = 'editor-hint-row'
  hintRow.append(hintLine, helpToggle)
  editorHints.append(hintRow, legend)
  editorHints.style.display = 'none'
  app.appendChild(editorHints)

  // Purpose chip: tells a cold-load user what the tool is FOR and what to
  // press first; gone forever once they've ever completed a sweep.
  const purposeChip = document.createElement('div')
  purposeChip.className = 'purpose-chip'
  if (firstSweepPending()) {
    const text = document.createElement('span')
    text.innerHTML = '<b>Find the best camera placement for your robot</b> — set it up in the Robot tab, then press Analyze coverage.'
    const close = document.createElement('button')
    close.textContent = '✕'
    close.title = 'Dismiss'
    close.addEventListener('click', () => purposeChip.remove())
    purposeChip.append(text, close)
    app.appendChild(purposeChip)
  }

  // --- Round 7A: guided first-run setup checklist (Build view only) ---
  const setupChecklist = createSetupChecklist()
  app.appendChild(setupChecklist.el)
  setupChecklist.el.style.display = 'none' // shown only in Build (and only until finished)
  let bodyShapeTouched = false
  let cameraAimed = false
  function refreshChecklist(): void {
    if (setupChecklist.finished()) return
    setupChecklist.update({
      bodyShapeTouched,
      cameraCount: config.robot.cameras.length,
      cameraAimed,
      hasSweep: lastSweep !== null,
    })
  }
  setupChecklist.onReadyToAnalyze(() => {
    // Rows 1–3 done: point at the next move without gating anything.
    tabs.stepButton(2).classList.add('pulse')
    setTimeout(() => tabs.stepButton(2).classList.remove('pulse'), 2100)
  })

  const tabs = createTabBar({
    onChange(mode) {
      appMode = mode
      if (mode === 'robot') {
        detachRobotGizmo()
        viewManager.setMode('orbit')
        savedFieldCam.position.copy(ctx.camera.position)
        savedFieldCam.target.copy(ctx.controls.target)
        ctx.setActiveScene(editor.scene)
        editor.frameRobot()
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
      setupChecklist.el.style.display = mode === 'robot' && !setupChecklist.finished() ? '' : 'none'
      if (mode === 'robot') refreshChecklist()
      // The chip's copy points AT the Robot tab — showing it while already
      // there is nonsense (QA round 5b nit 2).
      purposeChip.style.display = mode === 'robot' ? 'none' : ''
      panel.setMode(mode)
    },
    onAddCamera: () => editor.armAddCamera(),
    onOptimizeSpotlight() {
      sweepControls.pulseOptimize()
    },
    onToggleFrustums: (visible) => setFrustumsVisible(visible),
    onFrustumOpacity(opacity) {
      frustumView.setFillOpacity(opacity)
      editor.setFrustumFillOpacity(opacity)
    },
    onAddBox() {
      bodyShapeTouched = true
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
  /** Trusted-range cap for actual detections (Infinity when uncapped). */
  function rangeCapM(): number {
    return config.trustedRangeM ?? Infinity
  }
  /** Ideal-layer radius: the trusted cap when set, else the longest camera reach. */
  function resolveIdealRangeM(): number {
    return config.trustedRangeM ?? autoIdealRangeM(config.robot, tagSize)
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
    sweepControls.setOptimizeEnabled(false)
    sweepControls.setPrimaryAction('run')
    ctx.renderer.domElement.style.cursor = ''
    clearProposal()
    refreshWorkflowState()
    sweepControls.setStale(false)
    sweepControls.setReportEnabled(false)
    // A baseline's ReportStats are tied to the field it was swept on (cell
    // coordinates, dead-zone counts, etc. are meaningless across different
    // field dimensions), so a field change invalidates it too — but a plain
    // Clear-button click (same field, e.g. re-running with new config) should
    // leave a set baseline in place for the next report's comparison.
    if (clearBaselineToo) baseline = null
  }

  function selectProposalView(which: 'yours' | 'proposed'): void {
    proposalView = which
    const shown = which === 'proposed' && proposal ? proposal.result : lastSweep?.result
    if (!shown) return
    heatmap.show(shown, sweepMode)
    const sc = coverageScoreVsIdeal(shown)
    sweepControls.setScore(sc ? { ...sc, idealRangeM: shown.idealRangeM } : null)
    sweepControls.setProposalSelected(which)
  }

  function markSweepStaleIfNeeded(): void {
    // Any config drift invalidates an open optimizer proposal too — it was
    // computed against the previous config/range and comparing against it
    // would silently mix worlds.
    clearProposal()
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

    const ev = evaluatePose(drive.pose, config.robot, layout, fieldOccluders, rangeCapM())
    const idealIds = idealTagIds(drive.pose.x, drive.pose.y, layout, fieldOccluders, resolveIdealRangeM())
    viewManager.update(drive.pose, config.robot)
    frustumView.update(drive.pose, config.robot, tagSize, viewManager.povCameraIndex(), rangeCapM())
    tagHighlights.update(ev, config.robot, idealIds)
    hud.update(ev, config.robot, idealIds.length)

    if (proposal && ghostGizmos) {
      ghostGizmos.position.copy(robotGroup.position)
      ghostGizmos.rotation.z = robotGroup.rotation.z
      ghostFrustums.update(drive.pose, proposal.robot, tagSize, null, rangeCapM())
    }
  })

  const sweepControls = createSweepControls({
    initialTrustedRangeM: config.trustedRangeM,
    onRun() {
      if (sweepRunning) return
      clearProposal() // a fresh sweep supersedes any open A/B session
      sweepControls.setOptimizeOutcome(null)
      purposeChip.remove()
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
      sweepInWorker(layout, snapshot.robot, fieldOccluders, { ...DEFAULT_SWEEP, idealRangeM: resolveIdealRangeM(), rangeCapM: rangeCapM() }, (frac) => {
        if (sweepGeneration === myGeneration) sweepControls.setProgress(frac)
      })
        .then((result) => {
          // A Clear click or a field change while this sweep was in flight
          // bumped the generation counter; that result no longer describes
          // the current field/state, so it's silently dropped.
          if (sweepGeneration !== myGeneration) return
          heatmap.show(result, sweepMode)
          sweepControls.setLegendVisible(true)
          {
            const sc = coverageScoreVsIdeal(result)
            sweepControls.setScore(sc ? { ...sc, idealRangeM: result.idealRangeM } : null)
          }
          lastSweep = {
            result,
            config: snapshot,
            fieldOccludersEmpty: fieldOccluders.length === 0,
            allTagIds: layout.tags.map((t) => t.id),
          }
          ;(window as any).__sim.lastSweep = lastSweep
          sweepControls.setStale(false)
          sweepControls.setReportEnabled(true)
          sweepControls.setOptimizeEnabled(true)
          sweepControls.setPrimaryAction('optimize')
          ctx.renderer.domElement.style.cursor = 'crosshair'
          refreshWorkflowState()
          refreshChecklist()
          showInspectMark(sweepControls.el)
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
      config.trustedRangeM = rangeM > 0 ? rangeM : null
      saveConfig(config)
      // The shown maps were computed at the old range — flag them.
      if (lastSweep && lastSweep.result.idealRangeM !== resolveIdealRangeM()) sweepControls.setStale(true)
    },
    onModeChange(mode) {
      sweepMode = mode
      // Re-color only from the stored result — no re-sweep.
      const shown = proposalView === 'proposed' && proposal ? proposal.result : lastSweep?.result
      if (shown) heatmap.show(shown, sweepMode)
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
    onOptimize() {
      if (!lastSweep || optimizeHandle || config.robot.cameras.length === 0) return
      clearProposal()
      sweepControls.setOptimizeOutcome(null)
      // 16 headings = the same worst-case standard the final score uses; coarser cells only.
      const coarse = { cellSizeM: 0.5, headingCount: 16, idealRangeM: resolveIdealRangeM(), rangeCapM: rangeCapM() }
      sweepControls.setOptimizing('Optimizing…')
      const myGeneration = sweepGeneration
      optimizeHandle = optimizeInWorker(structuredClone(config.robot), layout, fieldOccluders, coarse, [], (p) => {
        sweepControls.setOptimizing(`Optimizing… ${p.evals.toLocaleString()}/${p.totalEvals.toLocaleString()} mounts (${Math.round((100 * p.evals) / p.totalEvals)}%) · best ≈${p.bestWorstPct.toFixed(0)}`)
      })
      optimizeHandle.promise
        .then(async (res) => {
          const identical =
            JSON.stringify(res.cameras.map((c) => c.mount)) === JSON.stringify(config.robot.cameras.map((c) => c.mount))
          if (identical) {
            sweepControls.setOptimizeOutcome(
              `Optimizer finished: nothing better than your current setup (${res.evals.toLocaleString()} mounts searched — your mounts are the search optimum).`,
            )
            return
          }
          const proposalRobot: RobotConfig = { ...structuredClone(config.robot), cameras: res.cameras }
          sweepControls.setOptimizing('Scoring proposal…')
          const full = await sweepInWorker(
            layout,
            proposalRobot,
            fieldOccluders,
            { ...DEFAULT_SWEEP, idealRangeM: resolveIdealRangeM(), rangeCapM: rangeCapM() },
            () => {},
          )
          // Field changed / cleared mid-optimize: the proposal no longer applies.
          if (sweepGeneration !== myGeneration || !lastSweep) return
          const sc = coverageScoreVsIdeal(full)
          proposal = { robot: proposalRobot, result: full, score: sc?.worstPct ?? 0 }
          buildGhostGizmos(proposalRobot)
          const yours = coverageScoreVsIdeal(lastSweep.result)?.worstPct ?? 0
          sweepControls.showProposal({ yoursPct: yours, proposedPct: proposal.score })
          sweepControls.setOptimizeOutcome(
            `Optimizer finished: proposal scores ${proposal.score.toFixed(0)} vs your ${yours.toFixed(0)} (${res.evals.toLocaleString()} mounts searched) — review the white ghost cameras, then Apply or Discard.`,
          )
          selectProposalView('proposed')
        })
        .catch((e: unknown) => {
          if (e instanceof Error && e.message === 'cancelled') {
            sweepControls.setOptimizeOutcome('Optimizer cancelled — no proposal generated.')
            return
          }
          sweepControls.setOptimizeOutcome(`Optimize failed: ${e instanceof Error ? e.message : String(e)}`)
        })
        .finally(() => {
          optimizeHandle = null
          sweepControls.setOptimizing(null)
          refreshWorkflowState()
        })
      // AFTER the handle exists — refreshing before this line was the
      // round-6c bug: optimizeActive read false and step 3 never lit.
      refreshWorkflowState()
    },
    onCancelOptimize() {
      optimizeHandle?.cancel()
    },
    onProposalSelect(which) {
      selectProposalView(which)
    },
    onProposalApply() {
      if (!proposal || !lastSweep) return
      const prevCameras = structuredClone(config.robot.cameras)
      config.robot.cameras = structuredClone(proposal.robot.cameras)
      saveConfig(config)
      panel.refresh(config)
      rebuildRobot()
      editor.rebuildRobot()
      viewSelect.refresh(config.robot.cameras.map((c) => c.name))
      // The proposal's full-res sweep IS the fresh sweep of the new config.
      lastSweep = {
        result: proposal.result,
        config: structuredClone(config),
        fieldOccludersEmpty: fieldOccluders.length === 0,
        allTagIds: layout.tags.map((t) => t.id),
      }
      heatmap.show(lastSweep.result, sweepMode)
      const sc = coverageScoreVsIdeal(lastSweep.result)
      sweepControls.setScore(sc ? { ...sc, idealRangeM: lastSweep.result.idealRangeM } : null)
      sweepControls.setStale(false)
      clearProposal()
      showToast('Applied optimized camera mounts.', 30000, undefined, {
        label: 'Undo',
        onClick() {
          config.robot.cameras = prevCameras
          saveConfig(config)
          panel.refresh(config)
          rebuildRobot()
          editor.rebuildRobot()
          viewSelect.refresh(config.robot.cameras.map((c) => c.name))
          sweepControls.setStale(true) // shown sweep no longer matches the reverted config
        },
      })
    },
    onProposalDiscard() {
      clearProposal()
      if (lastSweep) heatmap.show(lastSweep.result, sweepMode)
    },
  })
  app.appendChild(sweepControls.el)
  sweepControls.setPrimaryAction('run')

  /** Stepper ✓s + current-step highlight follow app state. */
  function refreshWorkflowState(): void {
    tabs.setWorkflowState({
      cameraCount: config.robot.cameras.length,
      hasSweep: lastSweep !== null,
      optimizeActive: optimizeHandle !== null || proposal !== null,
    })
  }
  refreshWorkflowState()

  showFirstRunMarks({
    robotTab: tabs.stepButton(1),
    analyzeBtn: sweepControls.el.querySelector('button') as HTMLElement,
  })

  // Cell inspection: DOUBLE-click a heatmap cell to inspect it. Single
  // clicks are far too overloaded on this canvas (deselect robot, orbit
  // slop) and made the inspector pop up constantly — dblclick is deliberate.
  // A5: color is not the only encoding — hovering a swept cell reads out
  // its value in the legend row.
  ctx.renderer.domElement.addEventListener('pointermove', (e) => {
    if (!lastSweep || appMode !== 'field') return
    const rect = ctx.renderer.domElement.getBoundingClientRect()
    const ndc = {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    }
    const shown = proposalView === 'proposed' && proposal ? proposal.result : lastSweep.result
    const cell = heatmap.pickCell(ndc, ctx.camera)
    if (!cell) {
      sweepControls.setHoverReadout(null)
      return
    }
    const i = cell.r * shown.cols + cell.c
    const v = sweepMode === 'min' ? shown.minCount[i] : shown.idealCount[i]
    const label = sweepMode === 'min' ? 'tags @ worst heading' : 'tags (theoretical best)'
    const n = Math.round(v * 10) / 10
    sweepControls.setHoverReadout(`hover: ${n} ${label}`)
  })
  ctx.renderer.domElement.addEventListener('pointerleave', () => sweepControls.setHoverReadout(null))

  ctx.renderer.domElement.addEventListener('dblclick', (e) => {
    if (!lastSweep) return
    // Robot clicks belong to the move gizmo, not cell inspection.
    if (robotTc.dragging || robotTc.axis || pointerHitsRobot(e as unknown as PointerEvent)) return
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
    sweepControls.showDetail(buildCellDetail(lastSweep.result, cell.c, cell.r, lastSweep.config.robot, layout, fieldOccluders, lastSweep.config.trustedRangeM ?? Infinity))
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
      const camerasChanged = JSON.stringify(newConfig.robot.cameras) !== JSON.stringify(config.robot.cameras)
      config = { ...newConfig, fieldYear: config.fieldYear }
      if (camerasChanged && config.robot.cameras.length > 0) cameraAimed = true
      saveConfig(config)
      rebuildRobot()
      editor.rebuildRobot()
      viewSelect.refresh(config.robot.cameras.map((c) => c.name))
      markSweepStaleIfNeeded()
      refreshWorkflowState()
      refreshChecklist()
    },
    onFieldChange(year) {
      // config.fieldYear is only mutated + persisted inside rebuildField,
      // after the new layout/occluders have actually loaded successfully.
      void rebuildField(year)
    },
    onCameraPick(index) {
      selectedCameraIndex = index
      editor.selectCamera(index)
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
