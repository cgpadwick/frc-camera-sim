import * as THREE from 'three'
import type { SweepResult } from '../core/sweep'
import type { SweepViewMode } from '../ui/sweepControls'
import { cellIndex } from '../core/sweep'

/** World-space Z of the heatmap plane: just above the field (0) so it doesn't z-fight. */
export const HEATMAP_Z = 0.02

export interface RGB {
  r: number
  g: number
  b: number
}

// Color stops per visible-tag count. Red = status flag for "blind";
// counts 1..4+ ride a single-hue blue ramp, light -> dark (sequential =
// magnitude). Steps validated CVD-safe (adjacent dE >= 15, dataviz
// validator) and explained by the on-screen legend.
export const COUNT_STOPS = ['#c62828', '#a8d9f2', '#54a8da', '#1a6fae', '#062f52'] as const
const hexToRgb = (hex: string): RGB => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
})
const STOPS: RGB[] = COUNT_STOPS.map(hexToRgb)

function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }
}

/**
 * Pure: visible-tag count -> heatmap cell color. Integer counts land on
 * exact stops (0 red-blind, then light->dark blue for 1/2/3/4+);
 * fractional values (avg mode) lerp between adjacent stops.
 */
export function countToColor(count: number): RGB {
  if (count <= 0) return STOPS[0]
  const i = Math.min(3, Math.floor(count))
  const upper = Math.min(4, i + 1)
  return lerpRgb(STOPS[i], STOPS[upper], Math.min(1, count - i))
}

/**
 * Pure: a world-space (x, y) hit point on the heatmap plane -> its grid cell,
 * or null if outside the grid. The plane spans x in [0, cols*cellSizeM],
 * y in [0, rows*cellSizeM] (cell (0,0)'s center at (0.5*cellSizeM, 0.5*cellSizeM)),
 * matching sweep.ts's pose convention (c,r)+0.5)*cellSizeM.
 */
export function hitPointToCell(
  x: number,
  y: number,
  cols: number,
  rows: number,
  cellSizeM: number,
): { c: number; r: number } | null {
  const c = Math.floor(x / cellSizeM)
  const r = Math.floor(y / cellSizeM)
  if (c < 0 || c >= cols || r < 0 || r >= rows) return null
  return { c, r }
}

/** Builds the RGBA texel buffer for a SweepResult's selected score array (NearestFilter keeps cells crisp, no blending). */
function buildTextureData(result: SweepResult, mode: SweepViewMode): Uint8Array {
  const { cols, rows } = result
  const scores = mode === 'min' ? result.minCount : result.idealCount
  const data = new Uint8Array(cols * rows * 4)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = cellIndex(c, r, cols)
      const color = countToColor(scores[i])
      const o = i * 4
      data[o] = Math.round(color.r)
      data[o + 1] = Math.round(color.g)
      data[o + 2] = Math.round(color.b)
      data[o + 3] = 255
    }
  }
  return data
}

export interface HeatmapView {
  /** (Re)builds and shows the heatmap plane for `result`, colored by `mode`. Disposes any previous plane first. */
  show(result: SweepResult, mode: SweepViewMode): void
  /** Disposes the current plane (geometry/material/texture) and removes it from the scene, if present. */
  hide(): void
  /** Raycasts the heatmap plane and converts the hit point to a cell, or null if there's no plane / the ray misses / the hit is outside the grid. */
  pickCell(ndc: { x: number; y: number }, camera: THREE.Camera): { c: number; r: number } | null
}

/** Live coverage heatmap overlay: one textured THREE.Mesh plane, rebuilt on each `show`. */
export function createHeatmapView(scene: THREE.Scene): HeatmapView {
  let mesh: THREE.Mesh | null = null
  let currentResult: SweepResult | null = null
  const raycaster = new THREE.Raycaster()

  function dispose(): void {
    if (!mesh) return
    scene.remove(mesh)
    mesh.geometry.dispose()
    const material = mesh.material as THREE.MeshBasicMaterial
    material.map?.dispose()
    material.dispose()
    mesh = null
    currentResult = null
  }

  return {
    show(result, mode) {
      dispose()
      currentResult = result
      const width = result.cols * result.cellSizeM
      const height = result.rows * result.cellSizeM
      const texture = new THREE.DataTexture(buildTextureData(result, mode), result.cols, result.rows, THREE.RGBAFormat)
      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.NearestFilter
      texture.needsUpdate = true
      const geometry = new THREE.PlaneGeometry(width, height)
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.92, side: THREE.DoubleSide })
      mesh = new THREE.Mesh(geometry, material)
      mesh.name = 'heatmap'
      mesh.position.set(width / 2, height / 2, HEATMAP_Z)
      scene.add(mesh)
    },
    hide() {
      dispose()
    },
    pickCell(ndc, camera) {
      if (!mesh || !currentResult) return null
      raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera)
      const hits = raycaster.intersectObject(mesh)
      if (hits.length === 0) return null
      const { x, y } = hits[0].point
      return hitPointToCell(x, y, currentResult.cols, currentResult.rows, currentResult.cellSizeM)
    },
  }
}
