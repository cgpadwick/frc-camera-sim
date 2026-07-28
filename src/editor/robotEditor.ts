import * as THREE from 'three'
import type { RobotConfig, CameraSpec } from '../core/types'
import { buildRobot } from '../robot/robotBuilder'
import { createFrustumView, CAMERA_COLORS } from '../viz/frustumView'
import { disposeObject3D } from '../viz/dispose'
import { normalToYawPitch } from './placementMath'
import type { SceneCtx } from '../viz/scene'

const EDITOR_POSE = { x: 0, y: 0, headingRad: 0 } // robot sits at the origin, heading +X
const HANDLE_RADIUS_M = 0.035

export interface MountUpdate {
  cameraIndex: number
  mount: CameraSpec['mount']
  /** False while dragging (visual-only refresh), true on release (persist + panel refresh). */
  commit: boolean
}

export interface RobotEditorOptions {
  getRobot(): RobotConfig
  getTagSize(): number
  onMountUpdate(u: MountUpdate): void
  /** Add a new camera with this mount; implementation appends to config. */
  onAddCamera(mount: CameraSpec['mount']): void
}

export interface RobotEditor {
  scene: THREE.Scene
  /** Per-frame sync of robot mesh, handles, and frustum previews from the live config. */
  update(): void
  /** Attach/detach pointer listeners; call with true when the Robot tab is active. */
  setActive(active: boolean): void
  /** Arm add-camera mode: the next click on the robot places a new camera. */
  armAddCamera(): void
  /** Rebuild the robot mesh (dims/superstructure changed via the panel). */
  rebuildRobot(): void
}

export function createRobotEditor(ctx: SceneCtx, opts: RobotEditorOptions): RobotEditor {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x14161c)
  scene.add(new THREE.AmbientLight(0xffffff, 0.9))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(2, 1.5, 3)
  scene.add(sun)
  const fill = new THREE.DirectionalLight(0xffffff, 0.5)
  fill.position.set(-2, -1.5, 1)
  scene.add(fill)

  const grid = new THREE.GridHelper(4, 40, 0x555555, 0x2c2f38)
  grid.rotation.x = Math.PI / 2 // GridHelper spans XZ; our floor is XY (Z-up)
  scene.add(grid)
  scene.add(new THREE.AxesHelper(0.5))

  let robotGroup = buildRobot(opts.getRobot())
  scene.add(robotGroup)

  const handles = new THREE.Group()
  handles.name = 'camera-handles'
  scene.add(handles)
  const frustums = createFrustumView(scene)

  let addArmed = false
  let dragIndex: number | null = null
  const raycaster = new THREE.Raycaster()

  function robotMeshes(): THREE.Object3D[] {
    const out: THREE.Object3D[] = []
    robotGroup.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) out.push(c)
    })
    return out
  }

  function syncHandles(robot: RobotConfig): void {
    while (handles.children.length > robot.cameras.length) {
      const dead = handles.children[handles.children.length - 1]
      handles.remove(dead)
      disposeObject3D(dead)
    }
    while (handles.children.length < robot.cameras.length) {
      const i = handles.children.length
      const handle = new THREE.Mesh(
        new THREE.SphereGeometry(HANDLE_RADIUS_M, 16, 12),
        new THREE.MeshBasicMaterial({
          color: CAMERA_COLORS[i % CAMERA_COLORS.length],
          transparent: true,
          opacity: 0.85,
          depthTest: false, // always grabbable, even half-sunk into a face
        }),
      )
      handle.renderOrder = 10
      handle.name = `handle-${i}`
      handles.add(handle)
    }
    robot.cameras.forEach((cam, i) => {
      handles.children[i].position.set(cam.mount.x, cam.mount.y, cam.mount.z)
    })
  }

  function pointerNdc(e: PointerEvent): THREE.Vector2 {
    const rect = ctx.renderer.domElement.getBoundingClientRect()
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    )
  }

  function surfaceHit(e: PointerEvent): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    raycaster.setFromCamera(pointerNdc(e), ctx.camera)
    const hit = raycaster.intersectObjects(robotMeshes(), false)[0]
    if (!hit || !hit.face) return null
    // Face normals are mesh-local; robotGroup sits at the origin with identity
    // rotation in the editor, so transforming by the mesh's world matrix
    // yields the robot-frame normal directly (and world point == robot frame).
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
    return { point: hit.point, normal }
  }

  function mountFromHit(hit: { point: THREE.Vector3; normal: THREE.Vector3 }): CameraSpec['mount'] {
    const { yawDeg, pitchDeg } = normalToYawPitch({ x: hit.normal.x, y: hit.normal.y, z: hit.normal.z })
    return {
      x: Number(hit.point.x.toFixed(3)),
      y: Number(hit.point.y.toFixed(3)),
      z: Number(hit.point.z.toFixed(3)),
      rollDeg: 0,
      pitchDeg: Number(pitchDeg.toFixed(1)),
      yawDeg: Number(yawDeg.toFixed(1)),
    }
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return
    raycaster.setFromCamera(pointerNdc(e), ctx.camera)
    if (addArmed) {
      const hit = surfaceHit(e)
      if (hit) {
        opts.onAddCamera(mountFromHit(hit))
        addArmed = false
        ctx.renderer.domElement.style.cursor = ''
      }
      return
    }
    const handleHit = raycaster.intersectObjects(handles.children, false)[0]
    if (handleHit) {
      dragIndex = handles.children.indexOf(handleHit.object)
      ctx.controls.enabled = false
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (dragIndex === null) return
    const hit = surfaceHit(e)
    if (!hit) return
    opts.onMountUpdate({ cameraIndex: dragIndex, mount: mountFromHit(hit), commit: false })
  }

  function onPointerUp(e: PointerEvent): void {
    if (dragIndex === null) return
    const i = dragIndex
    dragIndex = null
    ctx.controls.enabled = true
    const robot = opts.getRobot()
    if (i < robot.cameras.length) {
      opts.onMountUpdate({ cameraIndex: i, mount: robot.cameras[i].mount, commit: true })
    }
    void e
  }

  const el = () => ctx.renderer.domElement

  return {
    scene,
    update() {
      const robot = opts.getRobot()
      syncHandles(robot)
      frustums.update(EDITOR_POSE, robot, opts.getTagSize())
    },
    setActive(active) {
      if (active) {
        el().addEventListener('pointerdown', onPointerDown)
        el().addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
      } else {
        el().removeEventListener('pointerdown', onPointerDown)
        el().removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        dragIndex = null
        addArmed = false
        el().style.cursor = ''
      }
    },
    armAddCamera() {
      addArmed = true
      el().style.cursor = 'crosshair'
    },
    rebuildRobot() {
      scene.remove(robotGroup)
      disposeObject3D(robotGroup)
      robotGroup = buildRobot(opts.getRobot())
      scene.add(robotGroup)
    },
  }
}
