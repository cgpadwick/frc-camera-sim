import type { SimConfig } from './types'

const CHASSIS_HEIGHT_M = 0.13
const SUPERSTRUCTURE_HEIGHT_M = 0.8

export const DEFAULT_CONFIG: SimConfig = {
  fieldYear: '2026-rebuilt-welded',
  robot: {
    lengthM: 0.75,
    widthM: 0.75,
    chassisHeightM: CHASSIS_HEIGHT_M,
    teamNumber: '0000',
    superstructure: [
      {
        // Stand-in elevator, centered on the chassis footprint, sitting on top of it.
        center: { x: 0, y: 0, z: CHASSIS_HEIGHT_M + SUPERSTRUCTURE_HEIGHT_M / 2 },
        size: { x: 0.3, y: 0.3, z: SUPERSTRUCTURE_HEIGHT_M },
        yawDeg: 0,
      },
    ],
    cameras: [
      {
        name: 'front',
        hfovDeg: 75,
        vfovDeg: 47,
        resWidth: 1280,
        resHeight: 800,
        maxRangeM: null,
        mount: { x: 0.32, y: 0, z: 0.25, rollDeg: 0, pitchDeg: 10, yawDeg: 0 },
      },
      {
        name: 'rear-left',
        hfovDeg: 75,
        vfovDeg: 47,
        resWidth: 1280,
        resHeight: 800,
        maxRangeM: null,
        mount: { x: -0.32, y: 0.32, z: 0.25, rollDeg: 0, pitchDeg: 15, yawDeg: 160 },
      },
    ],
  },
}
