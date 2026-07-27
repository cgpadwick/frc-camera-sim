import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildRobot } from '../../src/robot/robotBuilder'
import { DEFAULT_CONFIG } from '../../src/core/defaults'

describe('buildRobot', () => {
  it('constructs without throwing (headless, no document) and is a THREE.Group', () => {
    const group = buildRobot(DEFAULT_CONFIG.robot)
    expect(group).toBeInstanceOf(THREE.Group)
  })

  it('contains a named marker for each configured camera', () => {
    const group = buildRobot(DEFAULT_CONFIG.robot)
    expect(group.getObjectByName('cam-0')).toBeTruthy()
    expect(group.getObjectByName('cam-1')).toBeTruthy()
  })

  it('has no more or fewer camera markers than configured cameras', () => {
    const group = buildRobot(DEFAULT_CONFIG.robot)
    expect(group.getObjectByName('cam-2')).toBeUndefined()
  })
})
