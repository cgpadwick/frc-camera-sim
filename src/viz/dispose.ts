import * as THREE from 'three'

/**
 * Frees GPU/canvas resources (geometries, materials, and any material
 * texture maps) for every mesh/line under `obj` before it's discarded.
 * `buildRobot`/`buildFieldView` allocate these with no disposal path of
 * their own, so rebuild call sites must dispose the old group themselves.
 */
export function disposeObject3D(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const withGeometry = child as THREE.Mesh
    withGeometry.geometry?.dispose()
    const material = (child as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
    if (!material) return
    for (const m of Array.isArray(material) ? material : [material]) {
      ;(m as THREE.MeshBasicMaterial).map?.dispose()
      m.dispose()
    }
  })
}
