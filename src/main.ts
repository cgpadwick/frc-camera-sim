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

async function boot() {
  const app = document.getElementById('app')!
  const ctx = createScene(app)
  const layout = await loadLayout('layouts/2026-rebuilt-welded.json')
  const fieldOccluders = await loadOccluders('occluders/2026-rebuilt.json')
  const fieldGroup = buildFieldView(ctx.scene, layout)
  const tagSize = layout.tags[0]?.size ?? 0.1651

  const config = structuredClone(DEFAULT_CONFIG)
  const robotGroup = buildRobot(config.robot)
  ctx.scene.add(robotGroup)
  const drive = createDriveController(layout.field.length, layout.field.width)

  const frustumView = createFrustumView(ctx.scene)
  const tagHighlights = createTagHighlights(fieldGroup)
  const hud = createHud(app)

  ctx.onFrame((dt) => {
    drive.update(dt)
    robotGroup.position.set(drive.pose.x, drive.pose.y, 0)
    robotGroup.rotation.z = drive.pose.headingRad

    const ev = evaluatePose(drive.pose, config.robot, layout, fieldOccluders)
    frustumView.update(drive.pose, config.robot, tagSize)
    tagHighlights.update(ev, config.robot)
    hud.update(ev, config.robot)
  })

  ;(window as any).__sim = { ctx, layout, fieldOccluders, config, robotGroup, drive, frustumView, tagHighlights, hud } // grows in later tasks
}
boot().catch((e) => { document.body.innerHTML = `<pre>boot failed: ${e.message}</pre>` })
