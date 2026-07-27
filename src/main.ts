import './ui/styles.css'
import { createScene } from './viz/scene'
import { buildFieldView } from './viz/fieldView'
import { loadLayout, loadOccluders } from './field/layoutLoader'
import { buildRobot } from './robot/robotBuilder'
import { createDriveController } from './sim/driveController'
import { DEFAULT_CONFIG } from './core/defaults'

async function boot() {
  const app = document.getElementById('app')!
  const ctx = createScene(app)
  const layout = await loadLayout('layouts/2026-rebuilt-welded.json')
  const fieldOccluders = await loadOccluders('occluders/2026-rebuilt.json')
  buildFieldView(ctx.scene, layout)

  const config = structuredClone(DEFAULT_CONFIG)
  const robotGroup = buildRobot(config.robot)
  ctx.scene.add(robotGroup)
  const drive = createDriveController(layout.field.length, layout.field.width)
  ctx.onFrame((dt) => {
    drive.update(dt)
    robotGroup.position.set(drive.pose.x, drive.pose.y, 0)
    robotGroup.rotation.z = drive.pose.headingRad
  })

  ;(window as any).__sim = { ctx, layout, fieldOccluders, config, robotGroup, drive } // grows in later tasks
}
boot().catch((e) => { document.body.innerHTML = `<pre>boot failed: ${e.message}</pre>` })
