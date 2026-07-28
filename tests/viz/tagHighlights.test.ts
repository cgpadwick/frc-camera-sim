import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { highlightColorFor, createTagHighlights } from '../../src/viz/tagHighlights'
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
  it('any detection -> green', () => {
    expect(highlightColorFor([0])).toBe(0x2ecc40)
    expect(highlightColorFor([1])).toBe(0x2ecc40)
    expect(highlightColorFor([0, 1])).toBe(0x2ecc40)
    expect(highlightColorFor([0, 1, 2])).toBe(0x2ecc40)
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

  it('shows a green ring for a detected tag', () => {
    const fieldGroup = fieldGroupWithTag(1)
    const highlights = createTagHighlights(fieldGroup)
    const ev: PoseEvaluation = { score: 25, perCamera: [{ cameraIndex: 0, detections: [det({ tagId: 1 })] }] }
    highlights.update(ev, DEFAULT_CONFIG.robot)
    const ring = fieldGroup.getObjectByName('tag-1-ring') as THREE.Mesh
    expect(ring).toBeTruthy()
    expect(ring.visible).toBe(true)
    expect((ring.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x2ecc40)
  })

  it('stays green when 2+ cameras detect the same tag', () => {
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
    expect((ring.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x2ecc40)
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
