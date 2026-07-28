import * as THREE from 'three'
import type { RobotConfig, RobotPose } from '../core/types'
import { cameraFieldPose } from '../core/visibility'
import type { SceneCtx } from './scene'

/**
 * Rotation mapping three.js camera-local axes onto the WPILib optical
 * frame: three cameras look along local -Z with +Y up, our cameras look
 * along +X with +Z up. Applying a camera pose's rotation times this
 * quaternion orients a three camera to match core/visibility.ts's view.
 * Columns: three local +X -> optical -Y (image right), +Y -> optical +Z
 * (up), +Z -> optical -X (backward).
 */
export const OPTICAL_TO_THREE = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(-1, 0, 0),
  ),
)

export interface ViewMode {
  id: string
  label: string
  /** Camera index for POV modes, null for orbit. */
  cameraIndex: number | null
}

/** Pure: the selectable view modes for the current camera list. */
export function viewModeList(cameraNames: string[]): ViewMode[] {
  return [
    { id: 'orbit', label: 'Orbit', cameraIndex: null },
    ...cameraNames.map((name, i) => ({ id: `cam-${i}`, label: `POV: ${name}`, cameraIndex: i })),
  ]
}

/** Pure: id of the mode after `currentId` in cycle order (wraps; unknown id -> first mode). */
export function nextViewMode(currentId: string, modes: ViewMode[]): string {
  const i = modes.findIndex((m) => m.id === currentId)
  return modes[(i + 1) % modes.length].id
}

/** Pure: `currentId` if still valid for this camera count, else 'orbit' (e.g. the POV'd camera was removed). */
export function resolveViewMode(currentId: string, cameraCount: number): string {
  const m = /^cam-(\d+)$/.exec(currentId)
  if (!m) return 'orbit'
  return Number(m[1]) < cameraCount ? currentId : 'orbit'
}

export interface LetterboxRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Pure: render aspect for a camera POV, derived from the FOVs themselves —
 * NOT resWidth/resHeight. Detection (core/visibility.ts) treats hfov and
 * vfov as independent truth; a three.js camera derives its horizontal FOV
 * from vfov × aspect, so only this ratio makes the rendered frame match
 * the detection frustum exactly. With user-entered specs the sensor aspect
 * is usually close but not equal (82°/56° vs 1280/800 differs by ~1° of
 * hfov — enough to hide an edge tag that detection counts).
 */
export function povAspect(hfovDeg: number, vfovDeg: number): number {
  return Math.tan((hfovDeg * Math.PI) / 360) / Math.tan((vfovDeg * Math.PI) / 360)
}

/** Pure: largest rect of the given aspect centered in a canvas (letterbox/pillarbox). */
export function letterboxRect(canvasW: number, canvasH: number, aspect: number): LetterboxRect {
  const canvasAspect = canvasW / canvasH
  if (canvasAspect > aspect) {
    const w = Math.round(canvasH * aspect)
    return { x: Math.round((canvasW - w) / 2), y: 0, w, h: canvasH }
  }
  const h = Math.round(canvasW / aspect)
  return { x: 0, y: Math.round((canvasH - h) / 2), w: canvasW, h }
}

export interface ViewManager {
  current(): string
  setMode(id: string): void
  cycle(): void
  /** Camera index rendered from in POV mode, null in orbit — main.ts hides that camera's frustum wireframe. */
  povCameraIndex(): number | null
  /** Call once per frame before render; re-imposes the active view (and falls back to orbit if the POV'd camera vanished). */
  update(robotPose: RobotPose, robot: RobotConfig): void
  onChange(cb: (id: string) => void): void
}

const ORBIT_FOV_DEG = 50

export function createViewManager(ctx: SceneCtx): ViewManager {
  let mode = 'orbit'
  let povIndex: number | null = null
  // Refreshed every update(); cycle() derives its mode list from it.
  let lastCameraNames: string[] = []
  const changeCbs: ((id: string) => void)[] = []
  const savedOrbit = {
    position: ctx.camera.position.clone(),
    target: ctx.controls.target.clone(),
  }

  function enterOrbit(): void {
    ctx.camera.position.copy(savedOrbit.position)
    ctx.controls.target.copy(savedOrbit.target)
    ctx.camera.fov = ORBIT_FOV_DEG
    ctx.controls.enabled = true
    const canvas = ctx.renderer.domElement
    ctx.camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight)
    ctx.camera.updateProjectionMatrix()
    ctx.renderer.setScissorTest(false)
    ctx.renderer.setViewport(0, 0, canvas.clientWidth, canvas.clientHeight)
  }

  function applyMode(id: string): void {
    if (id === mode) return
    if (mode === 'orbit') {
      savedOrbit.position.copy(ctx.camera.position)
      savedOrbit.target.copy(ctx.controls.target)
    }
    mode = id
    const m = /^cam-(\d+)$/.exec(id)
    povIndex = m ? Number(m[1]) : null
    if (povIndex === null) {
      enterOrbit()
    } else {
      ctx.controls.enabled = false
    }
    for (const cb of changeCbs) cb(mode)
  }

  return {
    current: () => mode,
    povCameraIndex: () => povIndex,
    setMode: applyMode,
    cycle() {
      // Cycle order derives from the live camera count at keypress time.
      const names = lastCameraNames
      applyMode(nextViewMode(mode, viewModeList(names)))
    },
    onChange(cb) {
      changeCbs.push(cb)
    },
    update(robotPose, robot) {
      lastCameraNames = robot.cameras.map((c) => c.name)
      const resolved = resolveViewMode(mode, robot.cameras.length)
      if (resolved !== mode) applyMode(resolved)
      if (povIndex === null) return
      const spec = robot.cameras[povIndex]
      const pose = cameraFieldPose(robotPose, spec)
      ctx.camera.position.set(pose.translation.x, pose.translation.y, pose.translation.z)
      ctx.camera.quaternion
        .set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w)
        .multiply(OPTICAL_TO_THREE)
      ctx.camera.fov = spec.vfovDeg
      ctx.camera.aspect = povAspect(spec.hfovDeg, spec.vfovDeg)
      ctx.camera.updateProjectionMatrix()
      // Letterbox to the sensor's aspect; clear the full canvas first so the
      // bars outside the scissor rect stay black instead of holding stale
      // frames after a resize or mode switch.
      const canvas = ctx.renderer.domElement
      const rect = letterboxRect(canvas.clientWidth, canvas.clientHeight, ctx.camera.aspect)
      ctx.renderer.setScissorTest(false)
      ctx.renderer.setClearColor(0x000000)
      ctx.renderer.clear()
      ctx.renderer.setScissorTest(true)
      ctx.renderer.setScissor(rect.x, rect.y, rect.w, rect.h)
      ctx.renderer.setViewport(rect.x, rect.y, rect.w, rect.h)
    },
  }
}
