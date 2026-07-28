# FRC Camera Sim

A browser-based tool for planning AprilTag camera placement on an FRC robot.
Drive a procedural robot around a 3D field, watch each camera's frustum and
which tags it can currently see (including self-occlusion from your own
superstructure and field-structure occlusion), then run a full coverage
sweep across the field to find blind spots before you ever mount a camera on
real hardware.

## What it does

- Renders the field (2026 REBUILT or 2025 REEFSCAPE, WELDED tag layouts) and
  a configurable robot chassis + superstructure in three.js.
- Drive the robot and see, live: each camera's view frustum, which AprilTags
  it currently detects (color-coded per camera, white when 2+ cameras see
  the same tag), and a HUD score.
- Detection accounts for field-of-view, range, tag skew/edge margin, robot
  self-occlusion (your own superstructure blocking a camera's view), and
  field-structure occlusion (obstacles between the camera and a tag).
- **Coverage sweep**: runs the detection model across a grid of field
  positions and headings (worker-threaded, so the UI stays responsive),
  then renders a heatmap (worst-case or average mode) and lets you click any
  cell to inspect exactly which cameras see which tags at which headings.
- **Report**: turns a completed sweep into a printable coverage report, with
  an optional side-by-side comparison against a saved baseline sweep.
- **Config panel**: edit robot dimensions, superstructure occluder boxes,
  and per-camera specs (FOV, resolution, mount pose) via camera presets or
  manual entry; persists to `localStorage`; export/import as JSON.

## Run locally

```bash
npm install
npm run dev
```

Then open the printed local URL (Vite dev server).

To type-check, run tests, and produce a production build:

```bash
npm test
npm run build   # runs tsc, then vite build -> dist/
npm run preview # serve the production build locally
```

## Controls

- **W / A / S / D** — drive the robot (field-relative translate)
- **Q / E** — rotate the robot
- Mouse drag / scroll on the 3D view — orbit / zoom the camera (does not
  move the robot)
- Click a heatmap cell after running a coverage sweep to open its detail
  (per-heading scores, worst heading, cameras/tags detected there)

The config panel (right side) lets you switch field year, edit the robot and
its cameras (via presets or manual fields), and **Export**/**Import** the
current configuration as JSON — useful for saving a robot's camera plan or
sharing it with teammates.

The bottom bar runs and controls the coverage sweep: **Run coverage sweep**,
a worst-case/average mode toggle, **Clear**, **Report** (opens a printable
report in a new tab once a sweep has completed), and **Set as baseline**
(captures the current sweep so the next report can show a before/after
comparison).

## Simulation model & correctness

"Correct" is defined against this explicit model. Every rule below is what the
detection engine computes — and what the drawn view cones show.

**Camera model** — ideal pinhole, no lens distortion. Boresight +X, image bounds
at tan(hfov/2) / tan(vfov/2). A tag is detected only if **all four corners**
project inside the image (real detectors need the full square).

**Range** — a tag counts only if its center is within the effective range =
min(optical range, trusted range). Optical range comes from the 20-pixel rule:
`tagSize x focalPx / 20`, focalPx = (resWidth/2)/tan(hfov/2) — a 36h11 tag
needs roughly 20 px across to decode. Trusted range (default 5 m) models pose
solutions degrading with distance. The boundary is a **sphere** around the
camera, and the rendered cone's curved far surface is that exact sphere.

**Skew** — view angle vs tag normal must be <= 65°; beyond that real decoders
fail. **Occlusion** — five rays (4 corners + center) from the camera must clear
every field/robot box; rays are shortened 1 cm at both ends so flush-mounted
tags and face-mounted cameras behave physically.

**Known simplifications** (stated, not hidden): no lens distortion or rolling
shutter; no motion blur or exposure effects; tags are detected or not — no
probabilistic middle ground; field occluders ship empty for 2026 (coverage
near field structures reads optimistic); the drawn cone's lateral edges show
the FOV for a tag CENTER — a tag hugging the edge needs its whole body inside,
so detection near the side edges is slightly stricter than the drawn cone
(conservative direction).

**The "ideal" layer** — perfect-lens cameras at YOUR actual mounts: same eye
positions, same range cap, same skew limit, same occlusion rays (including the
robot's own body) — only the lens FOV / full-tag-in-image constraint removed.
Because it strictly removes a constraint, actual <= ideal is a mathematical
identity, enforced by a 300-case fuzz test with no exclusions.

**How correctness is enforced in CI** (`npm test`):
- `tests/core/boundaryAgreement.test.ts` — the rendered far surface and the
  detection boundary are compared directly: tags straddling the drawn cap must
  flip detection exactly there, across multiple FOVs and view directions.
- `tests/core/referenceFuzz.test.ts` — a second, independent implementation of
  the whole pipeline (rotation matrices instead of quaternions, sampled
  occlusion instead of the slab method) is fuzz-compared against the shipped
  engine on 400 seeded-random configurations; any systematic math error must
  now be made twice, in different formulations, identically.
- Hand-computed geometry fixtures pin the conventions (frame axes, quaternion
  composition, tag corner layout, occlusion epsilon).

To validate against YOUR physical camera: print a tag, measure the distance and
angle where your detector loses it, and set trusted range / FOV to match. The
model's constants (20 px threshold, 65° skew) live in `src/core/visibility.ts`.

## Field model

The 3D field geometry is loaded from a glTF model at
`public/models/<fieldYear>.glb` when present; the app renders the actual
scanned/modeled field structures instead of the flat carpet-and-walls
placeholder. If the model is missing or fails to load/parse, the app
automatically falls back to the flat field (a banner notes this) — AprilTag
quads and detection logic are unaffected either way, since they come from
the layout JSON, not the model.

The bundled `public/models/2026-rebuilt-welded.glb` is the 2026 REBUILT
field model published by Team 6328 (Mechanical Advantage) in
[`Mechanical-Advantage/AdvantageScopeAssets`](https://github.com/Mechanical-Advantage/AdvantageScopeAssets)
(`Field3d_2026FRCFieldV1`, from the `default-assets-v2` release), used by
[AdvantageScope](https://github.com/Mechanical-Advantage/AdvantageScope).
That repository's `LICENSE` is a permissive BSD-3-Clause-style license
(`Copyright (c) 2021-2026 Littleton Robotics`) that allows redistribution in
source and binary form provided the copyright notice and disclaimer are
retained and the Littleton Robotics / FRC 6328 / AdvantageScope names aren't
used to imply endorsement — both conditions this README and the file's
origin note above satisfy. No 2025 REEFSCAPE model is bundled; that field
year always renders the flat fallback.

The model's own metadata (`config.json` in the asset bundle) documents its
coordinate convention as field-centered, Y-up
(`"coordinateSystem": "wall-blue"`, `"rotations": [{ "axis": "x", "degrees":
90 }]`), which is exactly the correction `fieldModelCorrection` in
`src/field/fieldModelLoader.ts` applies to align it with this app's
WPILib-framed scene (origin at the blue-alliance corner, Z-up). That
function's coordinate math is unit-tested; final on-screen alignment against
the AprilTag quads (which are ground truth from the layout JSON, and always
rendered regardless of which field geometry is behind them) should still be
spot-checked visually after any model swap.

## Field occluder data

`public/occluders/<field>.json` files list box colliders for field
structures that can block a camera's line of sight to a tag (independent of
the visual field model). `public/occluders/2026-rebuilt.json` currently
ships as `{"boxes": []}` — the REBUILT model above wasn't visually inspected
to author these boxes as part of this pass (no interactive 3D rendering was
available in the environment this was built in), so field-structure
occlusion for the 2026 field is not modeled yet; self-occlusion from a
robot's own superstructure still works correctly regardless. A team can add
boxes by measuring/eyeballing structure positions on the real field (or in
the glb, e.g. via the three.js editor) and adding entries in the same
`{ center: {x,y,z}, size: {x,y,z}, yawDeg }` shape used by the robot's own
superstructure occluders in the config panel.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds and deploys `dist/` to GitHub Pages on
every push to `main` (checkout, Node 20, `npm ci`, `npm test`, `npm run
build`, then `actions/upload-pages-artifact` + `actions/deploy-pages`).

To enable it on a new repository:

1. Push this repository to GitHub (`git remote add origin <url>`, `git push
   -u origin main`).
2. In the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main` (or re-run the workflow from the **Actions** tab) — the
   deployed URL appears in that run's summary and in **Settings → Pages**.

`vite.config.ts` uses `base: './'` (relative asset paths), so the build
works whether it's served from a Pages project site
(`https://<user>.github.io/<repo>/`) or any other subpath.
