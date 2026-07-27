import * as THREE from 'three'
import './ui/styles.css'
import { createScene } from './viz/scene'
import { buildFieldView } from './viz/fieldView'
import { loadLayout, loadOccluders } from './field/layoutLoader'
import { buildRobot } from './robot/robotBuilder'
import { createDriveController } from './sim/driveController'
import { DEFAULT_CONFIG } from './core/defaults'
import { evaluatePose } from './core/evaluate'
import { createFrustumView } from './viz/frustumView'
import { createTagHighlights } from './viz/tagHighlights'
import { createHud } from './ui/hud'
import { createConfigPanel } from './ui/configPanel'
import { loadConfig, saveConfig, occluderUrlForYear } from './ui/configStore'
import { showToast } from './ui/toast'
import type { OccluderBox, SimConfig, TagLayout } from './core/types'

/**
 * Frees GPU/canvas resources (geometries, materials, and any material
 * texture maps) for every mesh/line under `obj` before it's discarded.
 * `buildRobot`/`buildFieldView` allocate these with no disposal path of
 * their own, so rebuild call sites must dispose the old group themselves.
 */
function disposeObject3D(obj: THREE.Object3D): void {
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

async function boot() {
  const app = document.getElementById('app')!
  const ctx = createScene(app)

  let config: SimConfig = loadConfig() ?? structuredClone(DEFAULT_CONFIG)

  let layout: TagLayout = await loadLayout(`layouts/${config.fieldYear}.json`)
  let fieldOccluders: OccluderBox[] = await loadOccluders(occluderUrlForYear(config.fieldYear))
  let fieldGroup = buildFieldView(ctx.scene, layout)
  let tagSize = layout.tags[0]?.size ?? 0.1651

  let robotGroup = buildRobot(config.robot)
  ctx.scene.add(robotGroup)
  const drive = createDriveController(layout.field.length, layout.field.width)

  const frustumView = createFrustumView(ctx.scene)
  let tagHighlights = createTagHighlights(fieldGroup)
  const hud = createHud(app)

  function rebuildRobot(): void {
    ctx.scene.remove(robotGroup)
    disposeObject3D(robotGroup)
    robotGroup = buildRobot(config.robot)
    ctx.scene.add(robotGroup)
  }

  async function rebuildField(year: string): Promise<void> {
    let newLayout: TagLayout
    let newOccluders: OccluderBox[]
    try {
      newLayout = await loadLayout(`layouts/${year}.json`)
      newOccluders = await loadOccluders(occluderUrlForYear(year))
    } catch (e) {
      showToast(`Failed to load field "${year}": ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    ctx.scene.remove(fieldGroup)
    disposeObject3D(fieldGroup)
    layout = newLayout
    fieldOccluders = newOccluders
    tagSize = layout.tags[0]?.size ?? 0.1651
    fieldGroup = buildFieldView(ctx.scene, layout)
    tagHighlights = createTagHighlights(fieldGroup)
  }

  ctx.onFrame((dt) => {
    drive.update(dt)
    robotGroup.position.set(drive.pose.x, drive.pose.y, 0)
    robotGroup.rotation.z = drive.pose.headingRad

    const ev = evaluatePose(drive.pose, config.robot, layout, fieldOccluders)
    frustumView.update(drive.pose, config.robot, tagSize)
    tagHighlights.update(ev, config.robot)
    hud.update(ev, config.robot)
  })

  const panel = createConfigPanel({
    config,
    onChange(newConfig) {
      config = newConfig
      saveConfig(config)
      rebuildRobot()
    },
    onFieldChange(year) {
      config.fieldYear = year
      saveConfig(config)
      void rebuildField(year)
    },
  })
  app.appendChild(panel)

  ;(window as any).__sim = { ctx, layout, fieldOccluders, config, robotGroup, drive, frustumView, tagHighlights, hud, panel } // grows in later tasks
}
boot().catch((e) => { document.body.innerHTML = `<pre>boot failed: ${e.message}</pre>` })
