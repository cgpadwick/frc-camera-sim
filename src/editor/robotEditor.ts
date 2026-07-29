import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { RobotConfig, CameraSpec, OccluderBox } from '../core/types'
import { buildRobot } from '../robot/robotBuilder'
import { createFrustumView, CAMERA_COLORS } from '../viz/frustumView'
import { buildCameraGizmo } from '../viz/cameraModel'
import { disposeObject3D } from '../viz/dispose'
import { normalToYawPitch } from './placementMath'
import type { SceneCtx } from '../viz/scene'

const EDITOR_POSE = { x: 0, y: 0, headingRad: 0 } // robot sits at the origin, heading +X
const EDITOR_CONE_PREVIEW_M = 1.5

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
  /** Camera gizmo clicked/grabbed (null = clicked empty space) — main.ts mirrors this into the config panel. */
  onSelectCamera(index: number | null): void
  /** Superstructure box moved/rotated/scaled via the gizmo (fired on drag end). */
  onBoxUpdate(index: number, box: OccluderBox): void
  /** Superstructure box deleted via toolbar/Delete key. */
  onBoxRemove(index: number): void
  /** One-line contextual hint for the current editor state (QA round 5: replaces the instruction wall). */
  onHint?(text: string): void
}

export interface RobotEditor {
  scene: THREE.Scene
  /** Per-frame sync of robot mesh, handles, and frustum previews from the live config. */
  update(): void
  /** Attach/detach pointer listeners; call with true when the Robot tab is active. */
  setActive(active: boolean): void
  /** Arm add-camera mode: the next click on the robot places a new camera. */
  armAddCamera(): void
  /** Select a superstructure box (gizmo attaches); null deselects. */
  selectBox(index: number | null): void
  /** Select a camera (same as clicking its gizmo); null deselects. */
  selectCamera(index: number | null): void
  /** Show/hide the editor's frustum previews. */
  setFrustumsVisible(visible: boolean): void
  /** Fill opacity for the editor's frustum previews. */
  setFrustumFillOpacity(opacity: number): void
  /** Rebuild the robot mesh (dims/superstructure changed via the panel). */
  rebuildRobot(): void
  /** Frame the robot: centered, comfortable distance, ~35° elevation (QA round 7B). */
  frameRobot(): void
  /** Offscreen PNGs of the robot with camera gizmos + aim cones for the report: perspective 3/4 plus orthographic top/front/side, all framed wide enough to include the cones. */
  snapshots(width: number, height: number): { persp: string; top: string; front: string; side: string }
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

  /**
   * buildRobot bakes `cam-<i>` marker gizmos into the robot group; in the
   * editor those would ghost at stale positions next to the live drag
   * handles (which are the markers here). Hide them, and keep them out of
   * surface raycasts so a camera can't be "mounted" onto another camera.
   */
  function stripBakedCameraMarkers(group: THREE.Group): void {
    for (const child of group.children) {
      if (/^cam-\d+$/.test(child.name)) child.visible = false
    }
  }

  let robotGroup = buildRobot(opts.getRobot())
  stripBakedCameraMarkers(robotGroup)
  scene.add(robotGroup)

  // --- Robot-frame axis indicators (WPILib: +X forward, +Y left) ---
  // Floor chevron + always-facing label, one per axis, just past the bumper.
  function makeAxisIndicator(text: string, cssColor: string, hexColor: number, yawRad: number): THREE.Group {
    const group = new THREE.Group()
    const chevron = new THREE.Shape()
    chevron.moveTo(0.14, 0)
    chevron.lineTo(-0.02, 0.09)
    chevron.lineTo(0.02, 0)
    chevron.lineTo(-0.02, -0.09)
    chevron.closePath()
    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(chevron),
      new THREE.MeshBasicMaterial({ color: hexColor, transparent: true, opacity: 0.9 }),
    )
    mesh.position.z = 0.002 // just above the grid
    group.add(mesh)

    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 96
    const g = canvas.getContext('2d')!
    g.font = 'bold 56px monospace'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = cssColor
    g.fillText(text, 256, 48)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }))
    label.scale.set(0.6, 0.113, 1)
    label.position.set(0.32, 0, 0.06)
    group.add(label)

    group.rotation.z = yawRad // chevron points along the group's local +X
    return group
  }

  const frontIndicator = makeAxisIndicator('FRONT (+X)', '#ffc107', 0xffc107, 0)
  const leftIndicator = makeAxisIndicator('LEFT (+Y)', '#81c784', 0x81c784, Math.PI / 2)
  scene.add(frontIndicator, leftIndicator)

  function updateFrontIndicator(): void {
    const robot = opts.getRobot()
    frontIndicator.position.x = robot.lengthM / 2 + 0.12
    leftIndicator.position.y = robot.widthM / 2 + 0.12
  }
  updateFrontIndicator()

  const handles = new THREE.Group()
  handles.name = 'camera-handles'
  scene.add(handles)
  const frustums = createFrustumView(scene, { outlineFirst: true })
  // Tracks the app-level cone toggle so snapshots can force cones on and restore.
  let frustumsVisibleLocal = true

  // --- Superstructure box editing (crayon-CAD style) ---
  const tc = new TransformControls(ctx.camera, ctx.renderer.domElement)
  tc.setSize(0.8)
  scene.add(tc.getHelper())
  tc.enabled = false
  let selectedBoxIndex: number | null = null

  const toolbar = document.createElement('div')
  toolbar.className = 'box-toolbar'
  toolbar.style.display = 'none'
  const toolButtons = new Map<string, HTMLButtonElement>()
  for (const [label, act] of [
    ['Move', 'translate'],
    ['Rotate', 'rotate'],
    ['Scale', 'scale'],
    ['🗑 Delete', 'delete'],
  ] as const) {
    const b = document.createElement('button')
    b.textContent = label
    b.addEventListener('click', () => (act === 'delete' ? removeSelectedBox() : setGizmoMode(act)))
    toolButtons.set(act, b)
    toolbar.appendChild(b)
  }
  ctx.renderer.domElement.parentElement?.appendChild(toolbar)

  function setGizmoMode(mode: 'translate' | 'rotate' | 'scale'): void {
    tc.setMode(mode)
    // Occluder boxes only support yaw — hide the other rotation rings.
    tc.showX = mode !== 'rotate'
    tc.showY = mode !== 'rotate'
    tc.showZ = true
    for (const [act, b] of toolButtons) b.classList.toggle('active', act === mode)
  }
  setGizmoMode('translate')

  function boxMesh(index: number): THREE.Object3D | null {
    return robotGroup.getObjectByName(`superstructure-${index}`) ?? null
  }

  function selectBox(index: number | null): void {
    selectedBoxIndex = index
    tc.detach()
    const mesh = index !== null ? boxMesh(index) : null
    if (mesh) {
      tc.attach(mesh)
      tc.enabled = true
      toolbar.style.display = ''
    } else {
      selectedBoxIndex = null
      tc.enabled = false
      toolbar.style.display = 'none'
    }
    updateHint()
  }

  /** Bake the gizmo-manipulated mesh transform back into config units. */
  function commitSelectedBox(): void {
    if (selectedBoxIndex === null) return
    const mesh = boxMesh(selectedBoxIndex)
    const base = opts.getRobot().superstructure[selectedBoxIndex]
    if (!mesh || !base) return
    const r3 = (v: number) => Number(v.toFixed(3))
    opts.onBoxUpdate(selectedBoxIndex, {
      center: { x: r3(mesh.position.x), y: r3(mesh.position.y), z: r3(mesh.position.z) },
      size: {
        x: r3(Math.max(0.01, base.size.x * Math.abs(mesh.scale.x))),
        y: r3(Math.max(0.01, base.size.y * Math.abs(mesh.scale.y))),
        z: r3(Math.max(0.01, base.size.z * Math.abs(mesh.scale.z))),
      },
      yawDeg: Number(((mesh.rotation.z * 180) / Math.PI).toFixed(1)),
    })
  }

  function removeSelectedBox(): void {
    if (selectedBoxIndex === null) return
    const i = selectedBoxIndex
    selectBox(null)
    opts.onBoxRemove(i)
  }

  tc.addEventListener('dragging-changed', (e) => {
    ctx.controls.enabled = !(e as unknown as { value: boolean }).value
    if (!(e as unknown as { value: boolean }).value) commitSelectedBox()
  })

  function onKeyDown(e: KeyboardEvent): void {
    if (e.target !== document.body) return
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedBoxIndex !== null) removeSelectedBox()
  }

  let addArmed = false
  let dragIndex: number | null = null
  let selectedIndex: number | null = null
  // White wireframe box around the selected gizmo; re-targeted on selection.
  let selectionBox: THREE.BoxHelper | null = null
  const raycaster = new THREE.Raycaster()

  function updateHint(): void {
    if (addArmed) opts.onHint?.('Click a spot on the robot to place the new camera')
    else if (selectedIndex !== null) opts.onHint?.('Drag the camera to move it across the robot · fine-tune numbers in the panel')
    else if (selectedBoxIndex !== null) opts.onHint?.('Drag the arrows to move · Rotate/Scale via the toolbar · Delete key removes')
    else opts.onHint?.('Click a camera or body shape to edit it · drag empty space to orbit')
  }

  function select(index: number | null): void {
    selectedIndex = index
    if (selectionBox) {
      scene.remove(selectionBox)
      selectionBox.dispose()
      selectionBox = null
    }
    if (index !== null && handles.children[index]) {
      selectionBox = new THREE.BoxHelper(handles.children[index], 0xffffff)
      scene.add(selectionBox)
    }
    opts.onSelectCamera(index)
    updateHint()
  }

  function robotMeshes(): THREE.Object3D[] {
    const out: THREE.Object3D[] = []
    robotGroup.traverse((c) => {
      // visible check also skips the hidden baked-in camera markers.
      if ((c as THREE.Mesh).isMesh && c.visible && (!c.parent || c.parent.visible)) out.push(c)
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
      // Grab handle = an oversized camera gizmo (body + lens barrel showing
      // aim), same shape as the field-scene markers but 2x for grabbability.
      const handle = buildCameraGizmo(CAMERA_COLORS[i % CAMERA_COLORS.length], 2)
      handle.name = `handle-${i}`
      handles.add(handle)
    }
    robot.cameras.forEach((cam, i) => {
      const handle = handles.children[i]
      handle.position.set(cam.mount.x, cam.mount.y, cam.mount.z)
      const rollQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (cam.mount.rollDeg * Math.PI) / 180)
      const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (cam.mount.pitchDeg * Math.PI) / 180)
      const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (cam.mount.yawDeg * Math.PI) / 180)
      handle.quaternion.multiplyQuaternions(yawQ, pitchQ).multiply(rollQ)
    })
  }

  function pointerNdc(e: PointerEvent): THREE.Vector2 {
    const rect = ctx.renderer.domElement.getBoundingClientRect()
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    )
  }

  function surfaceHit(
    e: PointerEvent,
  ): { point: THREE.Vector3; normal: THREE.Vector3; objectName: string } | null {
    raycaster.setFromCamera(pointerNdc(e), ctx.camera)
    const hit = raycaster.intersectObjects(robotMeshes(), false)[0]
    if (!hit || !hit.face) return null
    // Face normals are mesh-local; robotGroup sits at the origin with identity
    // rotation in the editor, so transforming by the mesh's world matrix
    // yields the robot-frame normal directly (and world point == robot frame).
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
    return { point: hit.point, normal, objectName: hit.object.name }
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
    // Pointer is on (or dragging) the transform gizmo — it owns this event.
    if (tc.dragging || tc.axis) return
    raycaster.setFromCamera(pointerNdc(e), ctx.camera)
    if (addArmed) {
      const hit = surfaceHit(e)
      if (hit) {
        opts.onAddCamera(mountFromHit(hit))
        addArmed = false
        ctx.renderer.domElement.style.cursor = ''
        syncHandles(opts.getRobot()) // gizmo must exist before selecting it
        select(opts.getRobot().cameras.length - 1)
      }
      updateHint()
      return
    }
    // Gizmos are Groups — raycast recursively, then walk up to the top-level handle.
    const handleHit = raycaster.intersectObjects(handles.children, true)[0]
    if (handleHit) {
      let top: THREE.Object3D | null = handleHit.object
      while (top && top.parent !== handles) top = top.parent
      if (top) {
        dragIndex = handles.children.indexOf(top)
        select(dragIndex)
        selectBox(null)
        ctx.controls.enabled = false
      }
      return
    }
    const hit = surfaceHit(e)
    const boxMatch = hit ? /^superstructure-(\d+)$/.exec(hit.objectName ?? '') : null
    if (boxMatch) {
      selectBox(Number(boxMatch[1]))
      select(null)
    } else if (!hit) {
      // clicked empty space
      select(null)
      selectBox(null)
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
      if (selectedIndex !== null && selectedIndex >= robot.cameras.length) select(null)
      selectionBox?.update() // track the gizmo while it's dragged
      // Editor cones are AIM previews, not reach displays — cap the drawn
      // length so entering Build shows a robot, not a wall of translucent
      // planes (QA round 7C; the Field view keeps true capped range).
      frustums.update(EDITOR_POSE, robot, opts.getTagSize(), null, EDITOR_CONE_PREVIEW_M, selectedIndex)
    },
    setActive(active) {
      if (active) {
        updateHint()
        el().addEventListener('pointerdown', onPointerDown)
        el().addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
        window.addEventListener('keydown', onKeyDown)
      } else {
        el().removeEventListener('pointerdown', onPointerDown)
        el().removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('keydown', onKeyDown)
        dragIndex = null
        addArmed = false
        selectBox(null)
        el().style.cursor = ''
      }
    },
    selectBox,
    selectCamera: (index) => select(index),
    snapshots(width, height) {
      // Fresh state; report wants the robot + its aim cones, not editor chrome.
      const robot = opts.getRobot()
      syncHandles(robot)
      // Cones ARE the payload here — force them visible and give every
      // camera the full fill (no outline-first dimming), restore after.
      frustums.setVisible(true)
      frustums.update(EDITOR_POSE, robot, opts.getTagSize(), null, EDITOR_CONE_PREVIEW_M, null)
      const helper = tc.getHelper()
      const helperWasVisible = helper.visible
      helper.visible = false
      if (selectionBox) selectionBox.visible = false

      // Frame radius includes the cones: farthest mount + preview length.
      let r = Math.hypot(robot.lengthM / 2, robot.widthM / 2)
      let top = robot.chassisHeightM
      for (const b of robot.superstructure) {
        r = Math.max(r, Math.hypot(Math.abs(b.center.x) + b.size.x / 2, Math.abs(b.center.y) + b.size.y / 2))
        top = Math.max(top, b.center.z + b.size.z / 2)
      }
      let coneR = r
      for (const c of robot.cameras) {
        coneR = Math.max(coneR, Math.hypot(c.mount.x, c.mount.y) + EDITOR_CONE_PREVIEW_M)
        top = Math.max(top, c.mount.z + EDITOR_CONE_PREVIEW_M * 0.5)
      }

      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
      renderer.setSize(width, height)
      const zC = top / 2
      const aspect = width / height

      const shoot = (cam: THREE.Camera): string => {
        renderer.render(scene, cam)
        return renderer.domElement.toDataURL('image/png')
      }

      // Perspective 3/4, wide enough for the cones.
      const persp = new THREE.PerspectiveCamera(45, aspect, 0.05, 100)
      persp.up.set(0, 0, 1)
      const dist = Math.max(2.5, coneR * 2.6)
      const elev = (32 * Math.PI) / 180
      const azim = (45 * Math.PI) / 180
      persp.position.set(
        Math.cos(azim) * Math.cos(elev) * dist,
        -Math.sin(azim) * Math.cos(elev) * dist,
        zC + Math.sin(elev) * dist,
      )
      persp.lookAt(0, 0, zC)

      // Orthographic views: half-extent fits the cone radius.
      const h = coneR * 1.12
      const ortho = (): THREE.OrthographicCamera => {
        const cam = new THREE.OrthographicCamera(-h * aspect, h * aspect, h, -h, 0.05, 100)
        cam.up.set(0, 0, 1)
        return cam
      }
      const topCam = ortho()
      topCam.position.set(0, 0, 20)
      topCam.up.set(1, 0, 0) // robot FRONT points up in the top view
      topCam.lookAt(0, 0, 0)
      const frontCam = ortho()
      frontCam.position.set(20, 0, zC)
      frontCam.lookAt(0, 0, zC)
      const sideCam = ortho()
      sideCam.position.set(0, 20, zC)
      sideCam.lookAt(0, 0, zC)

      const out = { persp: shoot(persp), top: shoot(topCam), front: shoot(frontCam), side: shoot(sideCam) }
      renderer.dispose()
      helper.visible = helperWasVisible
      if (selectionBox) selectionBox.visible = true
      frustums.setVisible(frustumsVisibleLocal)
      return out
    },
    frameRobot() {
      const robot = opts.getRobot()
      // Bounding radius from chassis + tallest/widest superstructure extents.
      let r = Math.hypot(robot.lengthM / 2, robot.widthM / 2)
      let top = robot.chassisHeightM
      for (const b of robot.superstructure) {
        r = Math.max(r, Math.hypot(Math.abs(b.center.x) + b.size.x / 2, Math.abs(b.center.y) + b.size.y / 2))
        top = Math.max(top, b.center.z + b.size.z / 2)
      }
      const dist = Math.max(1.6, r * 3.2)
      const elev = (35 * Math.PI) / 180
      const azim = (45 * Math.PI) / 180
      const targetZ = top / 2
      ctx.camera.position.set(
        Math.cos(azim) * Math.cos(elev) * dist,
        -Math.sin(azim) * Math.cos(elev) * dist,
        targetZ + Math.sin(elev) * dist,
      )
      ctx.controls.target.set(0, 0, targetZ)
    },
    setFrustumsVisible: (v) => {
      frustumsVisibleLocal = v
      frustums.setVisible(v)
    },
    setFrustumFillOpacity: (o) => frustums.setFillOpacity(o),
    armAddCamera() {
      // Deselect first: an attached gizmo eats the placement click (7b fix 3).
      selectBox(null)
      select(null)
      addArmed = true
      el().style.cursor = 'crosshair'
      updateHint()
    },
    rebuildRobot() {
      const keepBox = selectedBoxIndex
      tc.detach()
      scene.remove(robotGroup)
      disposeObject3D(robotGroup)
      robotGroup = buildRobot(opts.getRobot())
      stripBakedCameraMarkers(robotGroup)
      scene.add(robotGroup)
      updateFrontIndicator() // robot length may have changed
      // Re-attach the gizmo to the freshly built mesh (old one was disposed).
      if (keepBox !== null && keepBox < opts.getRobot().superstructure.length) {
        selectBox(keepBox)
      } else {
        selectBox(null)
      }
    },
  }
}
