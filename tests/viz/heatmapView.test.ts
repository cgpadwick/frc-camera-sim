import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { countToColor, hitPointToCell, createHeatmapView, HEATMAP_Z, type RGB } from '../../src/viz/heatmapView'
import type { SweepResult } from '../../src/core/sweep'

function hue({ r, g, b }: RGB): number {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  if (delta === 0) return 0
  let h: number
  if (max === rn) h = 60 * (((gn - bn) / delta) % 6)
  else if (max === gn) h = 60 * ((bn - rn) / delta + 2)
  else h = 60 * ((rn - gn) / delta + 4)
  return h < 0 ? h + 360 : h
}

describe('countToColor', () => {
  it('0 -> exact #c62828 (blind red)', () => {
    expect(countToColor(0)).toEqual({ r: 198, g: 40, b: 40 })
  })
  it('negative counts clamp to the same exact red as 0', () => {
    expect(countToColor(-5)).toEqual({ r: 198, g: 40, b: 40 })
  })
  it('1 tag -> exact light blue (#a8d9f2)', () => {
    expect(countToColor(1)).toEqual({ r: 168, g: 217, b: 242 })
  })
  it('3 tags -> exact mid-dark blue (#1a6fae)', () => {
    expect(countToColor(3)).toEqual({ r: 26, g: 111, b: 174 })
  })
  it('4+ tags -> exact navy (#062f52)', () => {
    expect(countToColor(4)).toEqual({ r: 6, g: 47, b: 82 })
    expect(countToColor(9)).toEqual({ r: 6, g: 47, b: 82 })
  })
  it('counts far above 4 clamp to the same exact navy as 4', () => {
    expect(countToColor(150)).toEqual({ r: 6, g: 47, b: 82 })
  })
  it('blue ramp darkens monotonically from 1 to 4+ (sequential lightness)', () => {
    // Sequential = one hue, light -> dark: channel sum strictly decreases.
    const luma = (c: { r: number; g: number; b: number }) => c.r + c.g + c.b
    let prev = luma(countToColor(1))
    for (let n = 1.5; n <= 4.5; n += 0.5) {
      const l = luma(countToColor(n))
      expect(l).toBeLessThanOrEqual(prev + 1e-9)
      prev = l
    }
  })
  it('fractional counts lerp between adjacent stops (mid red->light blue)', () => {
    const c = countToColor(0.5)
    expect(c.r).toBeLessThan(198) // red channel falls toward the blue stop
    expect(c.b).toBeGreaterThan(40) // blue channel rises
  })
})

describe('hitPointToCell', () => {
  const cols = 10
  const rows = 5
  const cellSizeM = 0.25

  it('origin -> cell (0,0)', () => {
    expect(hitPointToCell(0, 0, cols, rows, cellSizeM)).toEqual({ c: 0, r: 0 })
  })
  it('interior point maps to the containing cell', () => {
    expect(hitPointToCell(2.49, 1.24, cols, rows, cellSizeM)).toEqual({ c: 9, r: 4 })
  })
  it('negative x -> null (outside grid)', () => {
    expect(hitPointToCell(-0.1, 0.1, cols, rows, cellSizeM)).toBeNull()
  })
  it('negative y -> null (outside grid)', () => {
    expect(hitPointToCell(0.1, -0.1, cols, rows, cellSizeM)).toBeNull()
  })
  it('x at exact right edge (cols*cellSizeM) -> null (out of bounds, half-open interval)', () => {
    expect(hitPointToCell(cols * cellSizeM, 0.1, cols, rows, cellSizeM)).toBeNull()
  })
  it('y at exact top edge (rows*cellSizeM) -> null', () => {
    expect(hitPointToCell(0.1, rows * cellSizeM, cols, rows, cellSizeM)).toBeNull()
  })
  it('just inside the right/top edge -> last cell', () => {
    expect(hitPointToCell(cols * cellSizeM - 0.001, rows * cellSizeM - 0.001, cols, rows, cellSizeM)).toEqual({
      c: cols - 1,
      r: rows - 1,
    })
  })
})

function fakeResult(cols: number, rows: number, cellSizeM: number): SweepResult {
  const n = cols * rows
  return {
    cols,
    rows,
    cellSizeM,
    headingCount: 4,
    minCount: new Float32Array(n).fill(50),
    perHeading: new Float32Array(n * 4),
    idealCount: new Float32Array(n).fill(3),
    idealRangeM: 4,
    tagSeen: {},
    cameraDetections: [],
  }
}

describe('createHeatmapView', () => {
  it('show() adds exactly one mesh named "heatmap" positioned so cell (0,0) center sits at (0.5*cellSize, 0.5*cellSize, HEATMAP_Z)', () => {
    const scene = new THREE.Scene()
    const view = createHeatmapView(scene)
    const result = fakeResult(10, 5, 0.25)
    view.show(result, 'min')
    const mesh = scene.getObjectByName('heatmap') as THREE.Mesh
    expect(mesh).toBeTruthy()
    // Plane spans [0, cols*cellSize] x [0, rows*cellSize]; mesh position is the plane center.
    expect(mesh.position.x).toBeCloseTo((10 * 0.25) / 2)
    expect(mesh.position.y).toBeCloseTo((5 * 0.25) / 2)
    expect(mesh.position.z).toBeCloseTo(HEATMAP_Z)
  })

  it('show() disposes a previously-shown plane before building the new one', () => {
    const scene = new THREE.Scene()
    const view = createHeatmapView(scene)
    view.show(fakeResult(10, 5, 0.25), 'min')
    view.show(fakeResult(4, 4, 0.5), 'ideal')
    const heatmapMeshes: THREE.Mesh[] = []
    scene.traverse((o) => {
      if (o.name === 'heatmap') heatmapMeshes.push(o as THREE.Mesh)
    })
    expect(heatmapMeshes).toHaveLength(1)
  })

  it('hide() removes the plane from the scene', () => {
    const scene = new THREE.Scene()
    const view = createHeatmapView(scene)
    view.show(fakeResult(10, 5, 0.25), 'min')
    view.hide()
    expect(scene.getObjectByName('heatmap')).toBeUndefined()
  })

  it('pickCell returns null when no heatmap is shown', () => {
    const scene = new THREE.Scene()
    const view = createHeatmapView(scene)
    const camera = new THREE.PerspectiveCamera()
    expect(view.pickCell({ x: 0, y: 0 }, camera)).toBeNull()
  })

  it('pickCell raycasts a straight-down camera onto the plane center and resolves the expected cell', () => {
    const scene = new THREE.Scene()
    const view = createHeatmapView(scene)
    const cols = 10
    const rows = 5
    const cellSizeM = 0.25
    view.show(fakeResult(cols, rows, cellSizeM), 'min')
    const centerX = (cols * cellSizeM) / 2
    const centerY = (rows * cellSizeM) / 2
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(centerX, centerY, 5)
    camera.up.set(0, 1, 0)
    camera.lookAt(centerX, centerY, 0)
    camera.updateMatrixWorld()
    const cell = view.pickCell({ x: 0, y: 0 }, camera)
    expect(cell).toEqual({
      c: Math.floor(centerX / cellSizeM),
      r: Math.floor(centerY / cellSizeM),
    })
  })
})
