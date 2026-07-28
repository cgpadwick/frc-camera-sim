import * as THREE from 'three'

/**
 * Small procedural camera gizmo: body box + lens barrel + dark lens face,
 * boresight along local +X (matching the optical-frame convention). Body
 * is tinted with the per-camera color; the lens stays dark so the "which
 * way does it look" read is instant. `scale` grows the whole gizmo (the
 * robot editor uses a larger one as its grab handle).
 */
export function buildCameraGizmo(color: number, scale = 1): THREE.Group {
  const g = new THREE.Group()

  const bodyMat = new THREE.MeshLambertMaterial({ color })
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x14161a })

  // Body: 3cm deep (X) × 5cm wide (Y) × 3cm tall (Z), like a Limelight-ish brick.
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.03), bodyMat)
  g.add(body)

  // Lens barrel sticking out the front (+X). Cylinder axis is local Y by
  // default — rotate about Z so it points along +X.
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.018, 16), darkMat)
  barrel.rotation.z = Math.PI / 2
  barrel.position.x = 0.015 + 0.009
  g.add(barrel)

  // Lens face: slightly proud disc so it catches light.
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.002, 16),
    new THREE.MeshBasicMaterial({ color: 0x3355aa }))
  lens.rotation.z = Math.PI / 2
  lens.position.x = 0.015 + 0.018 + 0.001
  g.add(lens)

  g.scale.setScalar(scale)
  return g
}
