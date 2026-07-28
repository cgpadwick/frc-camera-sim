import * as THREE from 'three'
import type { PoseEvaluation } from '../core/evaluate'
import type { RobotConfig } from '../core/types'

const DETECTED_GREEN = 0x2ecc40
const IDEAL_BLUE = 0x4fc3f7
const RING_INNER_M = 0.12
const RING_OUTER_M = 0.16
const RING_OFFSET_M = 0.01
const EMPTY: readonly number[] = []

/**
 * Pure: ring color for one tag. Detected by any camera -> green ("feeding
 * localization"). Not detected but counted by the ideal layer -> blue
 * ("readable from here, your cameras miss it"). Neither -> hidden (the tag
 * is physically unreadable from this pose: wrong side, too far, too skewed,
 * or occluded).
 */
export function highlightColorFor(cameraIndices: readonly number[], idealVisible = false): number | null {
  if (cameraIndices.length > 0) return DETECTED_GREEN
  if (idealVisible) return IDEAL_BLUE
  return null
}

export interface TagHighlights {
  /** `idealIds`: tags the ideal layer counts at the current pose — shown as blue rings when not actually detected. */
  update(ev: PoseEvaluation, robot: RobotConfig, idealIds?: readonly number[]): void
}

/**
 * One emissive ring per AprilTag, parented under the field group so it
 * inherits nothing but stays alongside its tag quad. Rings are created
 * lazily on first detection and thereafter only toggled visible/hidden
 * (never removed) so repeated in/out-of-view transitions don't churn the
 * scene graph.
 */
export function createTagHighlights(fieldGroup: THREE.Group): TagHighlights {
  const rings = new Map<number, THREE.Mesh>()
  // Reused across frames: tagId -> camera indices detecting it this frame.
  // Arrays are cleared (not reallocated) each update so steady-state frames
  // touching already-seen tags allocate nothing here.
  const detectingCamerasByTag = new Map<number, number[]>()

  function ringFor(tagId: number): THREE.Mesh | null {
    const existing = rings.get(tagId)
    if (existing) return existing
    const quad = fieldGroup.getObjectByName(`tag-${tagId}`) as THREE.Mesh | undefined
    if (!quad) return null
    const geometry = new THREE.RingGeometry(RING_INNER_M, RING_OUTER_M)
    const material = new THREE.MeshBasicMaterial({ color: DETECTED_GREEN, side: THREE.DoubleSide, transparent: true })
    const ring = new THREE.Mesh(geometry, material)
    ring.name = `tag-${tagId}-ring`
    ring.visible = false
    ring.quaternion.copy(quad.quaternion)
    // PlaneGeometry's local +Z face normal maps to the tag's world +X
    // (outward) direction via tagQuadQuaternion (see fieldView.ts); offset
    // the ring along that same world normal so it sits just in front of
    // the quad rather than z-fighting with it.
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(quad.quaternion)
    ring.position.copy(quad.position).addScaledVector(normal, RING_OFFSET_M)
    fieldGroup.add(ring)
    rings.set(tagId, ring)
    return ring
  }

  function applyRingState(ring: THREE.Mesh, cameraIndices: readonly number[], idealVisible: boolean): void {
    const color = highlightColorFor(cameraIndices, idealVisible)
    if (color === null) {
      ring.visible = false
      return
    }
    ring.visible = true
    ;(ring.material as THREE.MeshBasicMaterial).color.setHex(color)
  }

  return {
    update(ev, _robot, idealIds = EMPTY) {
      for (const arr of detectingCamerasByTag.values()) arr.length = 0
      for (const cam of ev.perCamera) {
        for (const d of cam.detections) {
          let arr = detectingCamerasByTag.get(d.tagId)
          if (!arr) {
            arr = []
            detectingCamerasByTag.set(d.tagId, arr)
          }
          arr.push(cam.cameraIndex)
        }
      }
      const idealSet = new Set(idealIds)
      for (const [tagId, ring] of rings) {
        applyRingState(ring, detectingCamerasByTag.get(tagId) ?? EMPTY, idealSet.has(tagId))
      }
      for (const tagId of idealSet) {
        if (rings.has(tagId)) continue
        const ring = ringFor(tagId)
        if (ring) applyRingState(ring, detectingCamerasByTag.get(tagId) ?? EMPTY, true)
      }
      for (const [tagId, cams] of detectingCamerasByTag) {
        if (cams.length === 0 || rings.has(tagId)) continue
        const ring = ringFor(tagId)
        if (ring) applyRingState(ring, cams, idealSet.has(tagId))
      }
    },
  }
}
