import type { SweepResult } from '../core/sweep'
import { countToColor } from '../viz/heatmapView'

const CELL_PX = 10

/**
 * Renders a sweep layer to a PNG data URL on a plain 2D canvas (no WebGL
 * needed — the report must embed images that survive as a standalone file).
 * Drawn field-oriented: origin bottom-left, +x right, +y up, matching the
 * in-app view from above.
 */
export function heatmapDataUrl(result: SweepResult, layer: 'min' | 'ideal'): string {
  const values = layer === 'min' ? result.minCount : result.idealCount
  const canvas = document.createElement('canvas')
  canvas.width = result.cols * CELL_PX
  canvas.height = result.rows * CELL_PX
  const g = canvas.getContext('2d')!
  for (let r = 0; r < result.rows; r++) {
    for (let c = 0; c < result.cols; c++) {
      const v = values[r * result.cols + c]
      const col = countToColor(v)
      g.fillStyle = `rgb(${Math.round(col.r)}, ${Math.round(col.g)}, ${Math.round(col.b)})`
      // +y up: row 0 (y=0) at the bottom of the image.
      g.fillRect(c * CELL_PX, (result.rows - 1 - r) * CELL_PX, CELL_PX, CELL_PX)
    }
  }
  return canvas.toDataURL('image/png')
}
