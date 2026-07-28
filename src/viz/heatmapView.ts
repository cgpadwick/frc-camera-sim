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

// Color stops per visible-tag count (0-255 channels). Boundaries match
// core/evaluate.ts countBand: 0 dead, 1 poor, 2 ok, 3+ strong.
const RED: RGB = { r: 0xd3, g: 0x2f, b: 0x2f } // #d32f2f - 0 tags (blind)
const ORANGE: RGB = { r: 0xff, g: 0x98, b: 0x00 } // #ff9800 - 1 tag (ambiguous)
const YELLOW: RGB = { r: 0xff, g: 0xeb, b: 0x3b } // #ffeb3b - 2 tags
const YELLOW_GREEN: RGB = { r: 0xcd, g: 0xdc, b: 0x39 } // #cddc39 - 3 tags
const GREEN: RGB = { r: 0x4c, g: 0xaf, b: 0x50 } // #4caf50 - 4+ tags

function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }
}

/**
 * Pure: visible-tag count -> heatmap cell color. Integer counts land on
 * exact stops (0 red, 1 orange, 2 yellow, 3 yellow-green, 4+ green);
 * fractional values (the avg-over-headings mode) lerp between adjacent
 * stops so e.g. 1.5 reads halfway orange->yellow.
 */
export function countToColor(count: number): RGB {
  if (count <= 0) return RED
  if (count < 1) return lerpRgb(RED, ORANGE, count)
  if (count < 2) return lerpRgb(ORANGE, YELLOW, count - 1)
  if (count < 3) return lerpRgb(YELLOW, YELLOW_GREEN, count - 2)
  return lerpRgb(YELLOW_GREEN, GREEN, Math.min(1, count - 3))
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
  const scores = mode === 'min' ? result.minCount : mode === 'avg' ? result.avgCount : result.idealCount
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
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
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
