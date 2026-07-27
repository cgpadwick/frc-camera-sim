import * as THREE from 'three'
import type { RobotConfig } from '../core/types'

const BUMPER_THICKNESS_M = 0.05
const BUMPER_HEIGHT_M = 0.13
const BUMPER_Z_M = 0.09
const POD_RADIUS_M = 0.06
const POD_HEIGHT_M = 0.15
const POD_INSET_M = 0.1
const CAM_MARKER_RADIUS_M = 0.03
const CAM_MARKER_HEIGHT_M = 0.08

const X_AXIS = new THREE.Vector3(1, 0, 0)
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)

// THREE.ConeGeometry's tip points along local +Y by default. Camera markers
// should point along the camera's local +X (its boresight, matching the
// `p.x` forward axis used by core/visibility.ts's projectToImage). This
// fixed quaternion re-bases the cone so its tip points along +X before the
// per-camera mount rotation (roll -> pitch -> yaw, same order/axes as
// core/math.ts quatFromEuler) is applied on top of it.
const CONE_TIP_TO_LOCAL_X = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, -Math.PI / 2)

/** Only creates a canvas/texture when a DOM is present; returns null in headless (Node/test) environments. */
function bumperTexture(teamNumber: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const g = canvas.getContext('2d')
  if (!g) return null
  g.fillStyle = '#c1121f'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = '#ffffff'
  g.font = 'bold 40px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(teamNumber, canvas.width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function bumperMaterial(teamNumber: string): THREE.MeshLambertMaterial {
  const map = bumperTexture(teamNumber)
  return map ? new THREE.MeshLambertMaterial({ map }) : new THREE.MeshLambertMaterial({ color: 0xc1121f })
}

function addBumpers(group: THREE.Group, lengthM: number, widthM: number, teamNumber: string): void {
  const material = bumperMaterial(teamNumber)
  const frontBack = new THREE.BoxGeometry(BUMPER_THICKNESS_M, widthM, BUMPER_HEIGHT_M)
  const leftRight = new THREE.BoxGeometry(lengthM, BUMPER_THICKNESS_M, BUMPER_HEIGHT_M)

  const front = new THREE.Mesh(frontBack, material)
  front.name = 'bumper-front'
  front.position.set(lengthM / 2 + BUMPER_THICKNESS_M / 2, 0, BUMPER_Z_M)

  const back = new THREE.Mesh(frontBack, material)
  back.name = 'bumper-back'
  back.position.set(-(lengthM / 2 + BUMPER_THICKNESS_M / 2), 0, BUMPER_Z_M)

  const left = new THREE.Mesh(leftRight, material)
  left.name = 'bumper-left'
  left.position.set(0, widthM / 2 + BUMPER_THICKNESS_M / 2, BUMPER_Z_M)

  const right = new THREE.Mesh(leftRight, material)
  right.name = 'bumper-right'
  right.position.set(0, -(widthM / 2 + BUMPER_THICKNESS_M / 2), BUMPER_Z_M)

  group.add(front, back, left, right)
}

function addWheelPods(group: THREE.Group, lengthM: number, widthM: number, chassisHeightM: number): void {
  const material = new THREE.MeshLambertMaterial({ color: 0x111318 })
  const geometry = new THREE.CylinderGeometry(POD_RADIUS_M, POD_RADIUS_M, POD_HEIGHT_M, 16)
  const cx = lengthM / 2 - POD_INSET_M
  const cy = widthM / 2 - POD_INSET_M
  let i = 0
  for (const x of [cx, -cx]) {
    for (const y of [cy, -cy]) {
      const pod = new THREE.Mesh(geometry, material)
      pod.name = `wheel-pod-${i++}`
      // Cylinder's axis defaults to local Y; tip it onto Z (up) to stand it upright.
      pod.rotation.x = Math.PI / 2
      pod.position.set(x, y, chassisHeightM / 2)
      group.add(pod)
    }
  }
}

function addSuperstructure(group: THREE.Group, config: RobotConfig): void {
  const material = new THREE.MeshLambertMaterial({ color: 0x555b66, transparent: true, opacity: 0.75 })
  config.superstructure.forEach((box, i) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(box.size.x, box.size.y, box.size.z), material)
    mesh.name = `superstructure-${i}`
    mesh.position.set(box.center.x, box.center.y, box.center.z)
    mesh.rotation.z = (box.yawDeg * Math.PI) / 180
    group.add(mesh)
  })
}

function addCameraMarkers(group: THREE.Group, config: RobotConfig): void {
  const material = new THREE.MeshBasicMaterial({ color: 0xffdd00 })
  const geometry = new THREE.ConeGeometry(CAM_MARKER_RADIUS_M, CAM_MARKER_HEIGHT_M, 12)
  config.cameras.forEach((cam, i) => {
    const marker = new THREE.Mesh(geometry, material)
    marker.name = `cam-${i}`
    marker.position.set(cam.mount.x, cam.mount.y, cam.mount.z)

    const rollQ = new THREE.Quaternion().setFromAxisAngle(X_AXIS, (cam.mount.rollDeg * Math.PI) / 180)
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, (cam.mount.pitchDeg * Math.PI) / 180)
    const yawQ = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, (cam.mount.yawDeg * Math.PI) / 180)
    // Same composition order as core/math.ts quatFromEuler: yaw * pitch * roll.
    const mountQ = new THREE.Quaternion().multiplyQuaternions(yawQ, pitchQ).multiply(rollQ)
    marker.quaternion.multiplyQuaternions(mountQ, CONE_TIP_TO_LOCAL_X)

    group.add(marker)
  })
}

export function buildRobot(config: RobotConfig): THREE.Group {
  const group = new THREE.Group()
  group.name = 'robot'

  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(config.lengthM, config.widthM, config.chassisHeightM),
    new THREE.MeshLambertMaterial({ color: 0x3a3f4a }),
  )
  chassis.name = 'chassis'
  chassis.position.set(0, 0, config.chassisHeightM / 2)
  group.add(chassis)

  addBumpers(group, config.lengthM, config.widthM, config.teamNumber)
  addWheelPods(group, config.lengthM, config.widthM, config.chassisHeightM)
  addSuperstructure(group, config)
  addCameraMarkers(group, config)

  return group
}
