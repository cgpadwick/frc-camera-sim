import { describe, it, expect } from 'vitest'
import { computeChecklist, diffRobotEdits } from '../../src/ui/setupChecklist'
import type { SetupState } from '../../src/ui/setupChecklist'

const state = (over: Partial<SetupState> = {}): SetupState => ({
  bodyShapeTouched: false,
  cameraCount: 0,
  cameraAimed: false,
  hasSweep: false,
  ...over,
})

describe('computeChecklist', () => {
  it('fresh profile: row 1 active, nothing done', () => {
    const { rows, allDone } = computeChecklist(state())
    expect(rows.map((r) => r.done)).toEqual([false, false, false, false])
    expect(rows.map((r) => r.active)).toEqual([true, false, false, false])
    expect(allDone).toBe(false)
  })
  it('ticks in order as the user progresses', () => {
    const s1 = computeChecklist(state({ bodyShapeTouched: true }))
    expect(s1.rows[0].done).toBe(true)
    expect(s1.rows[1].active).toBe(true)
    const s2 = computeChecklist(state({ bodyShapeTouched: true, cameraCount: 1 }))
    expect(s2.rows[1].done).toBe(true)
    expect(s2.rows[2].active).toBe(true)
  })
  it('aim only counts once a camera exists', () => {
    // aimed=true with zero cameras (stale flag) must not tick row 3
    const s = computeChecklist(state({ bodyShapeTouched: true, cameraAimed: true }))
    expect(s.rows[2].done).toBe(false)
  })
  it('rows 1-3 done -> analyze row is the active one (drives the step-2 pulse)', () => {
    const s = computeChecklist(state({ bodyShapeTouched: true, cameraCount: 2, cameraAimed: true }))
    expect(s.rows.map((r) => r.done)).toEqual([true, true, true, false])
    expect(s.rows[3].active).toBe(true)
  })
  it('out-of-order progress still renders honestly (camera before box)', () => {
    const s = computeChecklist(state({ cameraCount: 1 }))
    expect(s.rows[0].active).toBe(true) // first open row wins
    expect(s.rows[1].done).toBe(true)
  })
  it('all done', () => {
    const s = computeChecklist(state({ bodyShapeTouched: true, cameraCount: 1, cameraAimed: true, hasSweep: true }))
    expect(s.allDone).toBe(true)
    expect(s.rows.every((r) => !r.active)).toBe(true)
  })
})

describe('diffRobotEdits (7b fix 1: panel edits count)', () => {
  const robot = (sz: number, camPitch: number) => ({
    superstructure: [{ center: { x: 0, y: 0, z: 0.5 }, size: { x: 0.3, y: 0.3, z: sz }, yawDeg: 0 }],
    cameras: [{ name: 'c', mount: { pitchDeg: camPitch } }],
  })
  it('panel box size edit flags boxesChanged only', () => {
    const d = diffRobotEdits(robot(0.8, 0), robot(0.7, 0))
    expect(d).toEqual({ boxesChanged: true, camerasChanged: false })
  })
  it('camera edit flags camerasChanged only', () => {
    const d = diffRobotEdits(robot(0.8, 0), robot(0.8, -15))
    expect(d).toEqual({ boxesChanged: false, camerasChanged: true })
  })
  it('no edit flags nothing', () => {
    expect(diffRobotEdits(robot(0.8, 0), robot(0.8, 0))).toEqual({ boxesChanged: false, camerasChanged: false })
  })
})
