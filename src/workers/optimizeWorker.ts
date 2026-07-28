/// <reference lib="webworker" />

import { optimizeCameraMounts } from '../core/optimize'

declare const self: DedicatedWorkerGlobalScope

self.onmessage = (e: MessageEvent) => {
  try {
    const { robot, layout, fieldOccluders, sweepParams, lockedCameras } = e.data
    const result = optimizeCameraMounts(robot, layout, fieldOccluders, {
      sweepParams,
      lockedCameras,
      onProgress: (p) => self.postMessage({ type: 'progress', ...p }),
    })
    self.postMessage({ type: 'done', result })
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
