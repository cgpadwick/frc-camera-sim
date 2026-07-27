import './ui/styles.css'
import { createScene } from './viz/scene'
import { buildFieldView } from './viz/fieldView'
import { loadLayout, loadOccluders } from './field/layoutLoader'

async function boot() {
  const app = document.getElementById('app')!
  const ctx = createScene(app)
  const layout = await loadLayout('layouts/2026-rebuilt-welded.json')
  const fieldOccluders = await loadOccluders('occluders/2026-rebuilt.json')
  buildFieldView(ctx.scene, layout)
  ;(window as any).__sim = { ctx, layout, fieldOccluders } // grows in later tasks
}
boot().catch((e) => { document.body.innerHTML = `<pre>boot failed: ${e.message}</pre>` })
