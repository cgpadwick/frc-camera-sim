import type { PoseEvaluation } from '../core/evaluate'
import type { RobotConfig } from '../core/types'
import { scoreBand } from '../core/scoring'
import { CAMERA_COLORS } from '../viz/frustumView'

/** Single source of truth for score-band -> color, shared by any future consumer (report, UI). */
export const BAND_COLORS: Record<ReturnType<typeof scoreBand>, string> = {
  dead: '#f44336',
  poor: '#ff9800',
  ok: '#ffeb3b',
  strong: '#4caf50',
}

/** Pure: score -> its band's display color. */
export function colorForScore(score: number): string {
  return BAND_COLORS[scoreBand(score)]
}

function hexColor(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`
}

export interface Hud {
  update(ev: PoseEvaluation, robot: RobotConfig): void
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
    update(ev, robot) {
      scoreEl.textContent = String(Math.round(ev.score))
      scoreEl.style.color = colorForScore(ev.score)

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
        cameraLines[i].textContent = `${cam.name}: ${count} tags`
      })
    },
  }
}
