# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # setup
npm run dev          # Vite dev server
npm test             # vitest run (all tests)
npx vitest run tests/core/visibility.test.ts   # single test file
npm run build        # tsc (type-check, noEmit) then vite build -> dist/
npm run preview      # serve the production build
```

There is no linter; `tsc` (via `npm run build`) is the only static check. The tsconfig enables `noUnusedLocals`, `noUnusedParameters`, and `verbatimModuleSyntax` — type-only imports must use `import type`.

Tests default to the node environment (`vite.config.ts`); DOM-touching tests opt in per file with `// @vitest-environment happy-dom` on line 1.

CI (`.github/workflows/deploy.yml`) runs `npm ci && npm test && npm run build` and deploys `dist/` to GitHub Pages on every push to `main`.

## What this is

A pure client-side Vite + TypeScript + three.js app (no backend, no UI framework — hand-rolled DOM panels) for planning AprilTag camera placement on an FRC robot: drive a robot around a 3D field with live per-camera tag detection, then run a field-wide coverage sweep/heatmap and generate a printable report. Design doc: `docs/superpowers/specs/2026-07-26-frc-camera-sim-design.md`.

## Architecture

**The load-bearing rule: `src/core/` is pure math with zero three.js imports.** The same detection code runs live in the interactive render loop and batch inside Web Workers, so the heatmap always agrees with what you see while driving. `src/workers/` imports only `core/`. Keep it that way.

Detection pipeline in `core/`:
- `visibility.ts` — a tag is detected only if ALL pass: all four corners project inside the image (pinhole model, no distortion), center within effective range (min of the 20-px optical rule and the trusted-range cap), skew ≤ 65°, and five rays (4 corners + center) clear every occluder box (rays shortened 1 cm at both ends). Model constants (`MIN_TAG_PX`, `SKEW_MAX_RAD`) live here.
- `evaluate.ts` — `evaluatePose` combines field occluders + robot self-occluders across all cameras; the headline metric everywhere is **unique** tag count. `idealTagCount` is the heading-independent upper bound used as the sweep's comparison layer.
- `scoring.ts` — 0–100 pose quality score; all weights/thresholds are named constants there.
- `sweep.ts` — grid sweep over positions × headings, results in `Float32Array`s (transferred, not copied, from the worker).
- `optimize.ts` — camera-mount search over candidates sampled from real robot surfaces.

Around the core:
- `src/main.ts` is the composition root — all wiring of scene, config, UI panels, workers, and the render loop happens there (it's the one big file).
- `src/viz/` — three.js rendering. Frame conventions matter: the app uses WPILib frames (origin at blue-alliance corner, Z-up; camera boresight +X, +Z up; `quatFromEuler` in `core/math.ts` is extrinsic X→Y→Z, WPILib Rotation3d). `viz/viewModes.ts` `OPTICAL_TO_THREE` converts to three.js camera axes; `field/fieldModelLoader.ts` `fieldModelCorrection` converts the Y-up glb field model.
- `src/workers/` — `sweepClient.ts`/`sweepWorker.ts` (and the optimize pair) follow one pattern: `new Worker(new URL('./xWorker.ts', import.meta.url), { type: 'module' })`, postMessage progress, transfer result buffers.
- `src/ui/configStore.ts` — config validation, localStorage persistence, JSON export/import. `KNOWN_FIELD_YEARS` there is the single source of truth for selectable fields.

Field data (all in `public/`, fetched at runtime):
- `layouts/<year>.json` — WPILib AprilTag layouts; **ground truth** for tag poses and detection.
- `models/<year>.glb` — visual field model only; missing/broken models fall back to a flat field without affecting detection.
- `occluders/<field>.json` — hand-authored box colliders for field-structure occlusion (`2026-rebuilt.json` currently ships empty, so 2026 field occlusion is not modeled).

## Correctness invariants (enforced by tests)

The README's "Simulation model & correctness" section defines the explicit model; two test files enforce it structurally and must be kept in agreement with any detection-math change:
- `tests/core/boundaryAgreement.test.ts` — the rendered frustum's far surface and the detection boundary must flip detection at exactly the same place.
- `tests/core/referenceFuzz.test.ts` — an independent reimplementation of the whole pipeline (rotation matrices, sampled occlusion) is fuzz-compared against the shipped engine on 400 seeded configs. If you change the model intentionally, the reference implementation must change to match.

Hand-computed fixtures in the core tests pin the frame conventions (quaternion composition, tag corner layout, occlusion epsilon) — don't "fix" them to match new code without verifying the geometry by hand.
