import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

export interface SceneCtx {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
  onFrame(cb: (dt: number) => void): void
  /** Swap what the render loop draws (e.g. the robot-editor scene). Defaults to `scene`. */
  setActiveScene(s: THREE.Scene): void
}

export function createScene(container: HTMLElement): SceneCtx {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1d24)
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(8, -6, 8)
  camera.up.set(0, 0, 1) // Z-up to match WPILib frame
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  container.appendChild(renderer.domElement)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(8.27, 4.03, 0)
  // PBR materials in glTF field models are near-black without environment lighting
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  scene.add(new THREE.AmbientLight(0xffffff, 0.5))
  const sun = new THREE.DirectionalLight(0xffffff, 1.5)
  sun.position.set(5, 3, 10)
  scene.add(sun)

  const callbacks: ((dt: number) => void)[] = []
  let activeScene = scene
  const resize = () => {
    const w = container.clientWidth
    const h = container.clientHeight
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  resize()
  let last = performance.now()
  renderer.setAnimationLoop(() => {
    const now = performance.now()
    const dt = (now - last) / 1000
    last = now
    for (const cb of callbacks) cb(dt)
    // OrbitControls.update() repositions the camera from its own spherical
    // state even when .enabled is false — skip it entirely in camera-POV
    // view modes or it would clobber the pose set by viewModes.update().
    if (controls.enabled) controls.update()
    renderer.render(activeScene, camera)
  })
  return {
    scene,
    camera,
    renderer,
    controls,
    onFrame: (cb) => callbacks.push(cb),
    setActiveScene: (s) => {
      activeScene = s
    },
  }
}
