/// <reference lib="webworker" />

import type { TagLayout, RobotConfig, OccluderBox } from '../core/types'
import type { SweepParams } from '../core/sweep'
import { runSweep } from '../core/sweep'

declare const self: DedicatedWorkerGlobalScope

self.onmessage = (e: MessageEvent) => {
  try {
    const { layout, robot, fieldOccluders, params } = e.data as {
      layout: TagLayout
      robot: RobotConfig
      fieldOccluders: OccluderBox[]
      params: SweepParams
    }
    const result = runSweep(layout, robot, fieldOccluders, params, (frac) =>
      self.postMessage({ type: 'progress', frac }),
    )
    self.postMessage(
      { type: 'done', result },
      {
        transfer: [result.minCount.buffer, result.perHeading.buffer, result.idealCount.buffer],
      },
    )
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
