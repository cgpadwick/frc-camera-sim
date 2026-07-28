import type { PoseEvaluation } from '../core/evaluate'
import type { RobotConfig } from '../core/types'
import { countBand, cameraInsideBoxIndex } from '../core/evaluate'
import { CAMERA_COLORS } from '../viz/frustumView'

/** Single source of truth for count-band -> color, shared by any future consumer (report, UI). */
export const BAND_COLORS: Record<ReturnType<typeof countBand>, string> = {
  dead: '#f44336',
  poor: '#ff9800',
  ok: '#ffeb3b',
  strong: '#4caf50',
}

/** Pure: visible-tag count -> its band's display color. */
export function colorForCount(tagCount: number): string {
  return BAND_COLORS[countBand(tagCount)]
}

function hexColor(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`
}

export interface Hud {
  el: HTMLElement
  /** `idealCount`: tags an ideal omnidirectional setup would see from here (live idealTagCount) — shown as "seen / ideal". */
  update(ev: PoseEvaluation, robot: RobotConfig, idealCount?: number): void
}

/** Fixed-position DOM overlay: big score number (band-colored) + one "<name>: N tags" line per camera. */
export function createHud(container: HTMLElement): Hud {
  const root = document.createElement('div')
  root.className = 'hud'
  container.appendChild(root)

  const scoreEl = document.createElement('div')
  scoreEl.className = 'hud-score'
  root.appendChild(scoreEl)

  const camerasEl = document.createElement('div')
  camerasEl.className = 'hud-cameras'
  root.appendChild(camerasEl)

  const cameraLines: HTMLDivElement[] = []

  return {
    el: root,
    update(ev, robot, idealCount) {
      scoreEl.textContent =
        idealCount === undefined
          ? `${ev.tagCount} ${ev.tagCount === 1 ? 'tag' : 'tags'}`
          : `${ev.tagCount} / ${idealCount} tags`
      scoreEl.title = idealCount === undefined ? '' : 'tags seen now / ideally visible here (omnidirectional, at the Ideal range)'
      scoreEl.style.color = colorForCount(ev.tagCount)

      if (cameraLines.length !== robot.cameras.length) {
        camerasEl.replaceChildren()
        cameraLines.length = 0
        robot.cameras.forEach((_cam, i) => {
          const line = document.createElement('div')
          line.style.color = hexColor(CAMERA_COLORS[i % CAMERA_COLORS.length])
          camerasEl.appendChild(line)
          cameraLines.push(line)
        })
      }
      robot.cameras.forEach((cam, i) => {
        const count = ev.perCamera[i]?.detections.length ?? 0
        const insideBox = cameraInsideBoxIndex(robot, i)
        cameraLines[i].textContent =
          insideBox !== null
            ? `${cam.name}: ⚠ inside Box ${insideBox} — blind`
            : `${cam.name}: ${count} tags`
        cameraLines[i].title =
          insideBox !== null
            ? `This camera's mount point is inside superstructure Box ${insideBox}; every sightline starts occluded. Move it to a surface in the Robot editor.`
            : ''
      })
    },
  }
}
