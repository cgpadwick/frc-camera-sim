import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/**
 * Attempts to load a glTF/glb field model from `url` (expected at
 * `models/<fieldYear>.glb`). Resolves `null` on ANY failure — 404, network
 * error, malformed glTF — never throws/rejects, so callers can treat the
 * result directly as a "model or fall back to the flat field" signal.
 */
export async function tryLoadFieldModel(url: string): Promise<THREE.Group | null> {
  try {
    const gltf = await new GLTFLoader().loadAsync(url)
    return gltf.scene
  } catch {
    return null
  }
}

export interface FieldModelCorrection {
  position: { x: number; y: number; z: number }
  rotationX: number
}

/**
 * AdvantageScope field glTFs are exported field-centered (origin at field
 * center) and Y-up (glTF's own up-axis convention), while this app's scene
 * is WPILib-framed: origin at the blue-alliance corner, Z-up, meters. This
 * matches AdvantageScope's own per-field `config.json` metadata (checked
 * against the bundled 2026 field: `"coordinateSystem": "wall-blue"`,
 * `"rotations": [{ "axis": "x", "degrees": 90 }]`).
 *
 * The correction is a single parent-group transform: rotate Y-up onto
 * Z-up (`rotationX = +90°` about the model's local X axis) and then
 * translate the still-field-centered result to the field-corner origin by
 * half the field's length/width.
 *
 * Pure math, no THREE dependency in its return type, so it's unit-testable
 * headlessly (see tests/field/fieldModelLoader.test.ts) against two ground-
 * truth mappings: model-space field center (0,0,0) -> world field center
 * (L/2, W/2, 0), and model-space up-axis direction (0,1,0) -> world +Z.
 * Final on-screen alignment against the tag quads (ground truth from the
 * layout JSON) is a visual check left to the user.
 */
export function fieldModelCorrection(fieldLength: number, fieldWidth: number): FieldModelCorrection {
  return {
    position: { x: fieldLength / 2, y: fieldWidth / 2, z: 0 },
    rotationX: Math.PI / 2,
  }
}

/** Wraps `model` in a parent group carrying the `fieldModelCorrection` transform for `fieldLength`/`fieldWidth`. */
export function wrapFieldModel(model: THREE.Group, fieldLength: number, fieldWidth: number): THREE.Group {
  const correction = fieldModelCorrection(fieldLength, fieldWidth)
  const wrapper = new THREE.Group()
  wrapper.name = 'field-model'
  wrapper.rotation.x = correction.rotationX
  wrapper.position.set(correction.position.x, correction.position.y, correction.position.z)
  wrapper.add(model)
  return wrapper
}
