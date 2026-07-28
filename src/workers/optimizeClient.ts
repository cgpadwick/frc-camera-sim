import type { RobotConfig, TagLayout, OccluderBox } from '../core/types'
import type { SweepParams } from '../core/sweep'
import type { OptimizeResult } from '../core/optimize'

export interface OptimizeProgress {
  evals: number
  totalEvals: number
  bestScore: number
  /** Pure worst-case coverage % of the incumbent — comparable to the final proposal score. */
  bestWorstPct: number
  cameraIndex: number
  round: number
}

export interface OptimizeHandle {
  promise: Promise<OptimizeResult>
  /** Hard-stops the worker; the promise rejects with 'cancelled'. */
  cancel(): void
}

export function optimizeInWorker(
  robot: RobotConfig,
  layout: TagLayout,
  fieldOccluders: OccluderBox[],
  sweepParams: SweepParams,
  lockedCameras: number[],
  onProgress: (p: OptimizeProgress) => void,
): OptimizeHandle {
  const worker = new Worker(new URL('./optimizeWorker.ts', import.meta.url), { type: 'module' })
  let cancelled = false
  let rejectFn: ((e: Error) => void) | null = null
  const promise = new Promise<OptimizeResult>((resolve, reject) => {
    rejectFn = reject
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') onProgress(e.data)
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
    worker.postMessage({ robot, layout, fieldOccluders, sweepParams, lockedCameras })
  })
  return {
    promise,
    cancel() {
      if (cancelled) return
      cancelled = true
      worker.terminate()
      rejectFn?.(new Error('cancelled'))
    },
  }
}
