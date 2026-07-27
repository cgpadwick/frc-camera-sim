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

interface LoadedField {
  layout: TagLayout
  occluders: OccluderBox[]
}

async function loadField(year: string): Promise<LoadedField> {
  const layout = await loadLayout(`layouts/${year}.json`)
  const occluders = await loadOccluders(occluderUrlForYear(year))
  return { layout, occluders }
}

async function boot() {
  const app = document.getElementById('app')!
  const ctx = createScene(app)

  let config: SimConfig = loadConfig() ?? structuredClone(DEFAULT_CONFIG)

  // Guard the initial load: a corrupted/unknown fieldYear that slipped into
  // localStorage (e.g. via a hand-edited import) must not brick every
  // future boot. Fall back to DEFAULT_CONFIG's field and persist the
  // correction; if even the default field fails to load, that's a real
  // asset problem and the boot-failed screen is the right outcome.
  let bootYear = config.fieldYear
  let bootField: LoadedField
  try {
    bootField = await loadField(bootYear)
  } catch (e) {
    if (bootYear === DEFAULT_CONFIG.fieldYear) throw e
    showToast(`Failed to load field "${bootYear}": ${e instanceof Error ? e.message : String(e)} — falling back to default field.`)
    bootYear = DEFAULT_CONFIG.fieldYear
    bootField = await loadField(bootYear)
  }
  if (bootYear !== config.fieldYear) {
    config.fieldYear = bootYear
    saveConfig(config)
  }

  let layout: TagLayout = bootField.layout
  let fieldOccluders: OccluderBox[] = bootField.occluders
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
    let loaded: LoadedField
    try {
      loaded = await loadField(year)
    } catch (e) {
      showToast(`Failed to load field "${year}": ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    // Only mutate/persist fieldYear and swap live state once the load has
    // fully succeeded — an in-flight failure must leave the old field (and
    // the previously-saved, known-good fieldYear) untouched.
    ctx.scene.remove(fieldGroup)
    disposeObject3D(fieldGroup)
    layout = loaded.layout
    fieldOccluders = loaded.occluders
    tagSize = layout.tags[0]?.size ?? 0.1651
    fieldGroup = buildFieldView(ctx.scene, layout)
    tagHighlights = createTagHighlights(fieldGroup)
    drive.setFieldBounds(layout.field.length, layout.field.width)
    config.fieldYear = year
    saveConfig(config)
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
      // fieldYear is main.ts's own responsibility (see rebuildField): it's
      // only ever mutated after a field load actually succeeds. The panel's
      // `newConfig.fieldYear` may be stale/unconfirmed (e.g. it optimistically
      // updates on select before the async load resolves, including on a
      // load that ultimately fails), so it is intentionally *not* trusted
      // here — only the robot config is taken from panel edits.
      config = { ...newConfig, fieldYear: config.fieldYear }
      saveConfig(config)
      rebuildRobot()
    },
    onFieldChange(year) {
      // config.fieldYear is only mutated + persisted inside rebuildField,
      // after the new layout/occluders have actually loaded successfully.
      void rebuildField(year)
    },
  })
  app.appendChild(panel)

  ;(window as any).__sim = { ctx, layout, fieldOccluders, config, robotGroup, drive, frustumView, tagHighlights, hud, panel } // grows in later tasks
}
boot().catch((e) => { document.body.innerHTML = `<pre>boot failed: ${e.message}</pre>` })
