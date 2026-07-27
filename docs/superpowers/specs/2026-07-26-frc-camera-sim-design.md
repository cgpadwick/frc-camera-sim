# FRC AprilTag Camera Placement Simulator — Design

**Date:** 2026-07-26
**Status:** Approved for planning

## Problem

FRC teams place vision cameras for AprilTag localization by guesswork, then discover dead
zones and poor pose quality at competition. There is no tool that shows, before the robot
is built, where on the field a given camera configuration can and cannot localize, or how
good the localization is. PhotonVision simulates individual cameras and WPILib publishes
official AprilTag field layouts, but nothing produces coverage maps, dead-zone reports, or
compares mounting options.

## Goal

A browser-based simulator where a team:

1. Loads an FRC field with its official AprilTag layout (default: 2026 REBUILT).
2. Configures a parametric robot and N cameras (preset or manual optics, mount pose).
3. Drives the robot interactively, watching camera frustums and live tag detections.
4. Runs a batch sweep producing a field-wide coverage heatmap and a shareable report.
5. Compares two configurations to decide between mounting options.

## Non-goals (v2 parking lot)

- Camera placement optimizer (auto-search positions/angles for maximal coverage).
- Onshape/CAD robot import.
- Gamepad driving.
- Multi-robot occlusion (opponent robots blocking tags).
- Pose-error covariance estimates in centimeters.
- Rendered-image detection simulation.

## Architecture

Pure client-side static web app. No backend.

- **Stack:** Vite + TypeScript + three.js. No UI framework; plain DOM config panel
  (lil-gui or small hand-rolled panel) plus one 3D canvas.
- **Deploy:** GitHub Pages.
- **Compute:** All simulation math runs in the browser. Batch sweeps run in a Web Worker
  so the UI stays responsive.
- **Persistence:** The entire setup (robot dims, cameras, field year) is one JSON config
  object. Import/export buttons for sharing; autosaved to localStorage.

### Module layout

```
src/
  core/            # pure math, zero three.js imports — unit testable
    visibility.ts  #   frustum + range + skew + occlusion test
    scoring.ts     #   0-100 localization quality score
    sweep.ts       #   heatmap grid sweep logic
    types.ts       #   Config, CameraSpec, TagLayout, FieldOccluders, ...
  field/           # WPILib tag layout JSON loader, field glTF loader, occluder colliders
  robot/           # procedural robot mesh builder + self-occluder shapes
  sim/             # drive controller (WASD), robot pose state
  viz/             # three.js scene, frustum rendering, tag highlights, heatmap overlay
  ui/              # config panel, presets, report view
  workers/         # heatmap sweep Web Worker (imports core/ only)
```

**Key rule:** `core/` is pure functions — pose in, visibility/score out. The same code
runs live in interactive mode and batch in the worker sweep. One implementation, so the
heatmap always agrees with what you see while driving. Modules stay small and focused;
no monolithic files.

## Visibility model

A tag is visible to a camera when ALL of the following pass:

1. **Frustum (whole tag):** all four tag corners project inside the image bounds.
   Partially visible tags do not count — real detectors require the full tag.
2. **Range:** distance ≤ max detection range. Default derived from resolution: the tag
   must span at least ~20 px, so `maxRange ≈ tagSize × focalLength_px / 20`. Manual
   override allowed per camera.
3. **Skew:** angle between the tag normal and the camera→tag ray ≤ threshold
   (default 65°). Beyond that, real detectors fail.
4. **Occlusion:** rays from the camera to all four corners plus the center must be clear
   of field-element colliders and robot self-occluders. A partially blocked tag is not
   detected. Colliders are simplified boxes (hand-authored JSON per field), not full
   mesh raycasts.

## Scoring model

**Per-camera per-tag quality (0–1):** product of three factors —

- Distance falloff: 1 when near, fading to 0 at max range.
- Skew falloff: 1 head-on, fading to 0 at the skew threshold.
- Edge margin: a fully visible tag near the image edge scores lower (lens distortion
  makes detection and pose flakier there).

**Pose score (0–100)** at a robot pose:

- Zero visible tags → 0 (dead zone).
- Otherwise: sum of tag qualities with a multi-tag bearing-spread bonus — tags spread
  across wide bearings constrain pose far better than clustered tags (two tags 90° apart
  beat two adjacent ones). Spread is measured from the bearing variance of visible tags.
- Diminishing returns past ~4 good tags (capped contribution).
- Display bands: 0 dead, 1–39 poor, 40–69 ok, 70+ strong.

All weights and thresholds are named constants in `scoring.ts`, tunable in one place.

## Field

- **Tag layout:** WPILib official per-year AprilTag layout JSON (tag ID, pose, size).
  Bundled default: 2026 REBUILT (fetched from the `allwpilib` repository during
  implementation). 2025 Reefscape also bundled; any year's JSON loads as a drop-in.
- **Visuals:** AdvantageScope glTF field model when available (assets are MIT licensed);
  fallback is a flat carpet + walls + tag quads at exact layout poses.
- **Occluders:** hand-authored simplified collider boxes per field (JSON list), authored
  for REBUILT field elements during implementation. Not derived from the glTF mesh.

## Robot

Procedural mesh from primitives — no CAD import in v1:

- Chassis box + bumpers (team number texture), corner swerve pods.
- Optional superstructure primitives (boxes/cylinders at configurable poses) which
  double as **self-occluders** — a camera staring at its own elevator is exactly the
  mistake this tool exists to catch.
- Dimensions configurable.
- **Cameras:** N per robot. Each is a preset (OV9281, Limelight 3/3G/4, Arducam
  variants — prefilled FOV/resolution/range) or fully manual (horizontal/vertical FOV,
  resolution, max range), plus mount pose (x/y/z, roll/pitch/yaw from robot center).

## Interactive mode

- WASD translate + Q/E rotate, swerve-style field-relative driving.
- Live per frame: color-coded frustum wireframes per camera; tags light up when detected
  (color of the detecting camera, white when multiple); HUD with pose score and
  per-camera tag counts.
- Orbit camera with follow-robot toggle.

## Heatmap sweep

Runs in a Web Worker with a progress bar; target < 10 s for a full sweep.

- Grid over the field, default 0.25 m cells (~2800 cells), robot at fixed height.
- Heading matters, so per cell: sample 16 headings, score each.
- Two aggregations, toggled in the UI:
  - **Worst-case** (min over headings) — default; answers "is there any heading where
    I'm blind here."
  - **Average.**
- Overlay: colored heatmap plane on the carpet, score → color ramp, dead zones red.
  Clicking a cell opens per-heading scores and which tags/cameras contributed.

## Report

Button generates a printable HTML page:

- Coverage %: field area in each score band (dead/poor/ok/strong), worst-case and average.
- Dead-zone list with field coordinates.
- Per-camera contribution: % of detections each camera provides (flags near-useless
  cameras worth moving).
- Per-tag stats: which tags are never or rarely seen.
- Embedded config snapshot so the report is self-describing.
- **Compare mode:** sweep config A and config B, report shows the delta — for deciding
  between two mounting options.

## Error handling

- Bad layout JSON upload → validate shape (tag IDs, poses), show what is wrong, keep the
  prior field loaded.
- Bad config import → same pattern; never crash the scene; fall back to defaults with a
  toast message.
- glTF field model load failure → auto-fallback to the flat field with a banner note.
- Worker sweep failure → surface the error; UI stays usable.
- Degenerate configs (0 cameras, 0° FOV) → validation warnings, but the sim still runs
  (a score of 0 everywhere is a legitimate answer).

## Testing

- `core/` is pure math, covered by vitest unit tests:
  - Frustum corner cases (tag straddling the FOV edge, tag behind camera).
  - Range and skew threshold boundaries.
  - Occlusion ray-box tests.
  - Score monotonicity (closer ⇒ score not lower; more tags ⇒ score not lower).
  - Bearing-spread bonus behavior.
  - Sweep aggregation (worst-case vs average).
- Known-geometry fixtures: hand-computed camera + tag setups with expected
  visible/not-visible results.
- Viz/UI smoke-tested manually. No browser e2e in v1.
