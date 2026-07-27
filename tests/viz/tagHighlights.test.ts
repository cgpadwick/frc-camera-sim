import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { highlightColorFor, createTagHighlights } from '../../src/viz/tagHighlights'
import { CAMERA_COLORS } from '../../src/viz/frustumView'
import { DEFAULT_CONFIG } from '../../src/core/defaults'
import type { PoseEvaluation } from '../../src/core/evaluate'
import type { Detection } from '../../src/core/visibility'

const det = (over: Partial<Detection> = {}): Detection => ({
  tagId: 1, distanceM: 1, skewRad: 0, edgeMargin: 1, bearingRad: 0, ...over,
})

describe('highlightColorFor', () => {
  it('0 detecting cameras -> hidden (null)', () => {
    expect(highlightColorFor([])).toBeNull()
  })
  it('1 detecting camera -> that camera color', () => {
    expect(highlightColorFor([0])).toBe(CAMERA_COLORS[0])
    expect(highlightColorFor([1])).toBe(CAMERA_COLORS[1])
  })
  it('2+ detecting cameras -> white', () => {
    expect(highlightColorFor([0, 1])).toBe(0xffffff)
    expect(highlightColorFor([0, 1, 2])).toBe(0xffffff)
  })
  it('camera index wraps around CAMERA_COLORS length', () => {
    expect(highlightColorFor([CAMERA_COLORS.length])).toBe(CAMERA_COLORS[0])
  })
})

function fieldGroupWithTag(id: number): THREE.Group {
  const group = new THREE.Group()
  group.name = 'field'
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(0.1651, 0.1651))
  quad.name = `tag-${id}`
  quad.position.set(1, 2, 0.5)
  group.add(quad)
  return group
}

describe('createTagHighlights', () => {
  it('creates no ring for a tag that is never detected', () => {
    const fieldGroup = fieldGroupWithTag(1)
    const highlights = createTagHighlights(fieldGroup)
    const ev: PoseEvaluation = { score: 0, perCamera: [{ cameraIndex: 0, detections: [] }] }
    highlights.update(ev, DEFAULT_CONFIG.robot)
    const ring = fieldGroup.getObjectByName('tag-1-ring')
    expect(ring).toBeUndefined()
  })

  it('shows a ring colored by the single detecting camera', () => {
    const fieldGroup = fieldGroupWithTag(1)
    const highlights = createTagHighlights(fieldGroup)
    const ev: PoseEvaluation = { score: 25, perCamera: [{ cameraIndex: 0, detections: [det({ tagId: 1 })] }] }
    highlights.update(ev, DEFAULT_CONFIG.robot)
    const ring = fieldGroup.getObjectByName('tag-1-ring') as THREE.Mesh
    expect(ring).toBeTruthy()
    expect(ring.visible).toBe(true)
    expect((ring.material as THREE.MeshBasicMaterial).color.getHex()).toBe(CAMERA_COLORS[0])
  })

  it('shows white when 2+ cameras detect the same tag', () => {
    const fieldGroup = fieldGroupWithTag(1)
    const highlights = createTagHighlights(fieldGroup)
    const ev: PoseEvaluation = {
      score: 40,
      perCamera: [
        { cameraIndex: 0, detections: [det({ tagId: 1 })] },
        { cameraIndex: 1, detections: [det({ tagId: 1 })] },
      ],
    }
    highlights.update(ev, DEFAULT_CONFIG.robot)
    const ring = fieldGroup.getObjectByName('tag-1-ring') as THREE.Mesh
    expect((ring.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xffffff)
  })

  it('hides the ring again once the tag drops out of view (visibility toggled, not removed)', () => {
    const fieldGroup = fieldGroupWithTag(1)
    const highlights = createTagHighlights(fieldGroup)
    const seen: PoseEvaluation = { score: 25, perCamera: [{ cameraIndex: 0, detections: [det({ tagId: 1 })] }] }
    highlights.update(seen, DEFAULT_CONFIG.robot)
    const ring = fieldGroup.getObjectByName('tag-1-ring') as THREE.Mesh
    expect(ring.visible).toBe(true)

    const gone: PoseEvaluation = { score: 0, perCamera: [{ cameraIndex: 0, detections: [] }] }
    highlights.update(gone, DEFAULT_CONFIG.robot)
    expect(fieldGroup.getObjectByName('tag-1-ring')).toBe(ring) // same instance, not re-created
    expect(ring.visible).toBe(false)
  })

  it('offsets the ring 0.01 along the tag normal (+X of tag frame) relative to the quad', () => {
    const fieldGroup = fieldGroupWithTag(1)
    const highlights = createTagHighlights(fieldGroup)
    const ev: PoseEvaluation = { score: 25, perCamera: [{ cameraIndex: 0, detections: [det({ tagId: 1 })] }] }
    highlights.update(ev, DEFAULT_CONFIG.robot)
    const quad = fieldGroup.getObjectByName('tag-1') as THREE.Mesh
    const ring = fieldGroup.getObjectByName('tag-1-ring') as THREE.Mesh
    const offset = ring.position.distanceTo(quad.position)
    expect(offset).toBeCloseTo(0.01, 6)
  })
})
