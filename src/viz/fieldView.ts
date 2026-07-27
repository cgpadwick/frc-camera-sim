import * as THREE from 'three'
import type { TagLayout, Quat } from '../core/types'

// Tag local frame (WPILib convention): +X points out of the tag face, tag
// corners lie in the local YZ plane. THREE.PlaneGeometry lies in the local XY
// plane: its face normal is local +Z, and its "up" direction (local +Y, the
// direction the texture's V axis increases toward) is local +Y.
//
// PRE_ROTATION is the fixed rotation that reorients a PlaneGeometry's local
// frame onto the tag's local frame, before the tag's own pose rotation is
// applied:
//   plane +Z (face normal)      -> tag +X (out of tag face)
//   plane +Y (texture "up")     -> tag +Z (so the ID digit reads upright)
//   plane +X                    -> tag +Y (completes a right-handed basis)
//
// Built via Matrix4.makeBasis (columns = images of local X/Y/Z) rather than
// an Euler triple, so the mapping above is exact and independent of Euler
// axis-order pitfalls.
const PRE_ROTATION = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 1, 0), // image of plane local +X
    new THREE.Vector3(0, 0, 1), // image of plane local +Y (texture up)
    new THREE.Vector3(1, 0, 0), // image of plane local +Z (normal)
  ),
)

/**
 * Composed quaternion for a tag quad: the tag's own pose rotation applied
 * after PRE_ROTATION, i.e. world = R(tagRotation) * R(PRE_ROTATION) * local.
 * Pure THREE math, no DOM — safe to import and exercise from a headless test.
 */
export function tagQuadQuaternion(tagRotation: Quat): THREE.Quaternion {
  return new THREE.Quaternion(tagRotation.x, tagRotation.y, tagRotation.z, tagRotation.w).multiply(PRE_ROTATION)
}

function tagTexture(id: number): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, 128, 128)
  g.fillStyle = '#fff'
  g.fillRect(16, 16, 96, 96)
  g.fillStyle = '#000'
  g.font = 'bold 48px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(String(id), 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function buildFieldView(scene: THREE.Scene, layout: TagLayout): THREE.Group {
  const group = new THREE.Group()
  group.name = 'field'
  const { length: L, width: W } = layout.field

  const carpet = new THREE.Mesh(
    new THREE.PlaneGeometry(L, W),
    new THREE.MeshLambertMaterial({ color: 0x2e5d34 }),
  )
  carpet.position.set(L / 2, W / 2, 0)
  group.add(carpet)

  const wallMat = new THREE.MeshLambertMaterial({ color: 0x888888 })
  const mkWall = (w: number, h: number, x: number, y: number, rotZ: number) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, h), wallMat)
    wall.position.set(x, y, h / 2)
    wall.rotation.z = rotZ
    group.add(wall)
  }
  mkWall(L, 0.5, L / 2, 0, 0)
  mkWall(L, 0.5, L / 2, W, 0)
  mkWall(W, 0.5, 0, W / 2, Math.PI / 2)
  mkWall(W, 0.5, L, W / 2, Math.PI / 2)

  const centerMat = new THREE.LineBasicMaterial({ color: 0xffffff })
  const centerLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(L / 2, 0, 0.001),
      new THREE.Vector3(L / 2, W, 0.001),
    ]),
    centerMat,
  )
  group.add(centerLine)

  for (const tag of layout.tags) {
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(tag.size, tag.size),
      new THREE.MeshBasicMaterial({ map: tagTexture(tag.id), side: THREE.DoubleSide }),
    )
    quad.name = `tag-${tag.id}`
    const t = tag.pose.translation
    quad.position.set(t.x, t.y, t.z)
    quad.quaternion.copy(tagQuadQuaternion(tag.pose.rotation))
    group.add(quad)
  }
  group.add(new THREE.AxesHelper(1))
  scene.add(group)
  return group
}
