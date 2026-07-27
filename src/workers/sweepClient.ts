import type { TagLayout, RobotConfig, OccluderBox } from '../core/types'
import type { SweepParams, SweepResult } from '../core/sweep'

export function sweepInWorker(
  layout: TagLayout,
  robot: RobotConfig,
  fieldOccluders: OccluderBox[],
  params: SweepParams,
  onProgress: (frac: number) => void,
): Promise<SweepResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sweepWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') onProgress(e.data.frac)
      else if (e.data.type === 'done') {
        worker.terminate()
        resolve(e.data.result)
      } else {
        worker.terminate()
        reject(new Error(e.data.message))
      }
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message))
    }
    worker.postMessage({ layout, robot, fieldOccluders, params })
  })
}
