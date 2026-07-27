# FRC AprilTag Camera Placement Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browser-based simulator that shows where on an FRC field a given robot camera configuration can localize from AprilTags — interactive driving with live frustums, a batch coverage heatmap, and a shareable report.

**Architecture:** Pure client-side static web app. `src/core/` is pure TypeScript math (no three.js imports) shared by the live interactive loop and a Web Worker batch sweep. three.js renders field, robot, frustums, and heatmap. Config is one JSON object persisted to localStorage and import/exportable.

**Tech Stack:** Vite, TypeScript, three.js, vitest. Deployed to GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-07-26-frc-camera-sim-design.md`

## Global Constraints

- `src/core/` MUST NOT import three.js or any DOM API — pure functions only, fully unit-tested with vitest.
- Coordinate convention (WPILib): X forward (toward far end of field), Y left, Z up. Field origin at a corner; field is 16.541 m × 8.069 m (from layout JSON). Angles: roll about X, pitch about Y, yaw about Z; Rotation composed extrinsic X→Y→Z (`q = qz·qy·qx`).
- Camera optical frame: +X optical axis, +Y left, +Z up (matches WPILib).
- Tag frame: +X points out of the tag face; tag corners lie in the tag's local YZ plane. Tag size 0.1651 m (6.5 in, 36h11 black border).
- A tag counts as detected only if ALL 4 corners project inside the image, distance ≤ max range, skew ≤ 65°, and rays to all 4 corners + center are unoccluded.
- All scoring weights/thresholds are named constants in `src/core/scoring.ts`.
- Default field: 2026 REBUILT (welded). Layout JSONs live in `public/layouts/` and load by URL at runtime.
- Small focused files. One responsibility per module. No monolithic files.
- Commit after every task (message style: `feat:`/`test:`/`chore:`).

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `.gitignore`
- Create: `public/layouts/2026-rebuilt-welded.json`, `public/layouts/2025-reefscape-welded.json`

**Interfaces:**
- Consumes: nothing.
- Produces: running Vite dev server, vitest wired, layout JSONs served at `/layouts/*.json`.

- [ ] **Step 1: Scaffold Vite app**

```bash
cd /home/cpadwick/code/frc-simulator
npm create vite@latest . -- --template vanilla-ts
npm install
npm install three
npm install -D vitest @types/three
```

Delete the template demo files: `src/counter.ts`, `src/typescript.svg`, `public/vite.svg`, `src/style.css`. Replace `src/main.ts` with:

```ts
console.log('frc-camera-sim boot')
```

Replace `index.html` body content with:

```html
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
```

- [ ] **Step 2: Configure vite + vitest**

`vite.config.ts`:

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  test: { environment: 'node' },
})
```

Add to `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 3: Download layout JSONs**

```bash
mkdir -p public/layouts
curl -sL https://raw.githubusercontent.com/wpilibsuite/allwpilib/main/apriltag/src/main/native/resources/org/wpilib/vision/apriltag/2026-rebuilt-welded.json -o public/layouts/2026-rebuilt-welded.json
curl -sL https://raw.githubusercontent.com/wpilibsuite/allwpilib/main/apriltag/src/main/native/resources/org/wpilib/vision/apriltag/2025-reefscape-welded.json -o public/layouts/2025-reefscape-welded.json
```

Verify both files contain a `"tags"` array and a `"field"` object (`python3 -c "import json; d=json.load(open('public/layouts/2026-rebuilt-welded.json')); print(len(d['tags']), d['field'])"` → `32 {'length': 16.541, 'width': 8.069}`).

- [ ] **Step 4: Verify build + test run**

Run: `npm run build` → succeeds. `npm test` → "no test files found" is acceptable at this point (exit 0 with `--passWithNoTests`; add that flag to the test script).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold vite + ts + three + vitest, bundle tag layouts"
```

---

### Task 2: Core types and 3D math

**Files:**
- Create: `src/core/types.ts`, `src/core/math.ts`
- Test: `tests/core/math.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by every later core task):
  - `types.ts`: `Vec3 {x,y,z}`, `Quat {w,x,y,z}`, `Pose3 {translation: Vec3, rotation: Quat}`, `Tag {id: number, pose: Pose3, size: number}`, `TagLayout {field: {length: number, width: number}, tags: Tag[]}`, `CameraSpec {name: string, hfovDeg: number, vfovDeg: number, resWidth: number, resHeight: number, maxRangeM: number | null, mount: {x: number, y: number, z: number, rollDeg: number, pitchDeg: number, yawDeg: number}}`, `OccluderBox {center: Vec3, size: Vec3, yawDeg: number}`, `RobotConfig {lengthM: number, widthM: number, chassisHeightM: number, teamNumber: string, superstructure: OccluderBox[], cameras: CameraSpec[]}`, `SimConfig {fieldYear: string, robot: RobotConfig}`, `RobotPose {x: number, y: number, headingRad: number}`
  - `math.ts`: `vec3(x,y,z): Vec3`, `add/sub/scale/dot/cross/length/normalize`, `quatFromEuler(rollRad, pitchRad, yawRad): Quat`, `quatMul(a,b): Quat`, `quatConj(q): Quat`, `rotateVec(q, v): Vec3`, `poseToField(pose: Pose3, local: Vec3): Vec3`, `fieldToFrame(pose: Pose3, world: Vec3): Vec3`, `deg(x)/rad(x)` converters

- [ ] **Step 1: Write failing tests**

`tests/core/math.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { vec3, quatFromEuler, rotateVec, poseToField, fieldToFrame, rad } from '../../src/core/math'

const close = (a: any, b: any) => {
  expect(a.x).toBeCloseTo(b.x, 6); expect(a.y).toBeCloseTo(b.y, 6); expect(a.z).toBeCloseTo(b.z, 6)
}

describe('quatFromEuler + rotateVec', () => {
  it('yaw 90° sends +X to +Y', () => {
    close(rotateVec(quatFromEuler(0, 0, rad(90)), vec3(1, 0, 0)), vec3(0, 1, 0))
  })
  it('pitch 90° sends +X to -Z (nose down rotates forward vector downward? no: pitch +90 about Y sends +X to -Z)', () => {
    close(rotateVec(quatFromEuler(0, rad(90), 0), vec3(1, 0, 0)), vec3(0, 0, -1))
  })
  it('roll 90° sends +Y to +Z', () => {
    close(rotateVec(quatFromEuler(rad(90), 0, 0), vec3(0, 1, 0)), vec3(0, 0, 1))
  })
  it('extrinsic order: roll then yaw', () => {
    // roll 90 sends +Y->+Z, then yaw 90 leaves +Z alone
    close(rotateVec(quatFromEuler(rad(90), 0, rad(90)), vec3(0, 1, 0)), vec3(0, 0, 1))
  })
})

describe('frame transforms', () => {
  const pose = { translation: vec3(2, 3, 0), rotation: quatFromEuler(0, 0, rad(90)) }
  it('poseToField', () => close(poseToField(pose, vec3(1, 0, 0)), vec3(2, 4, 0)))
  it('fieldToFrame inverts poseToField', () => close(fieldToFrame(pose, vec3(2, 4, 0)), vec3(1, 0, 0)))
})
```

- [ ] **Step 2: Run tests, verify failure** — `npm test` → FAIL (module not found).

- [ ] **Step 3: Implement**

`src/core/math.ts`:

```ts
import type { Vec3, Quat, Pose3 } from './types'

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z)
export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z)
export const scale = (a: Vec3, s: number): Vec3 => vec3(a.x * s, a.y * s, a.z * s)
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / (length(a) || 1))
export const rad = (d: number): number => (d * Math.PI) / 180
export const deg = (r: number): number => (r * 180) / Math.PI

export function quatMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  }
}
export const quatConj = (q: Quat): Quat => ({ w: q.w, x: -q.x, y: -q.y, z: -q.z })

const axisAngle = (x: number, y: number, z: number, angle: number): Quat => {
  const s = Math.sin(angle / 2)
  return { w: Math.cos(angle / 2), x: x * s, y: y * s, z: z * s }
}

/** Extrinsic X (roll) -> Y (pitch) -> Z (yaw), WPILib Rotation3d convention. */
export function quatFromEuler(rollRad: number, pitchRad: number, yawRad: number): Quat {
  return quatMul(axisAngle(0, 0, 1, yawRad), quatMul(axisAngle(0, 1, 0, pitchRad), axisAngle(1, 0, 0, rollRad)))
}

export function rotateVec(q: Quat, v: Vec3): Vec3 {
  const p = quatMul(quatMul(q, { w: 0, ...v }), quatConj(q))
  return vec3(p.x, p.y, p.z)
}

export const poseToField = (pose: Pose3, local: Vec3): Vec3 => add(pose.translation, rotateVec(pose.rotation, local))
export const fieldToFrame = (pose: Pose3, world: Vec3): Vec3 => rotateVec(quatConj(pose.rotation), sub(world, pose.translation))
```

`src/core/types.ts`: exactly the interfaces listed in **Produces** above, each as `export interface`.

- [ ] **Step 4: Run tests, verify pass** — `npm test` → all math tests PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: core types and pure 3d math"`

---

### Task 3: Visibility — projection, frustum, range, skew

**Files:**
- Create: `src/core/visibility.ts`
- Test: `tests/core/visibility.test.ts`

**Interfaces:**
- Consumes: `math.ts`, `types.ts` from Task 2.
- Produces:
  - `cameraFieldPose(robotPose: RobotPose, spec: CameraSpec): Pose3` — camera pose in field frame (robot at chassis origin on floor; mount offsets are from robot center at floor level).
  - `tagCorners(tag: Tag): Vec3[]` — 4 corners, field frame.
  - `projectToImage(camPose: Pose3, hfovDeg: number, vfovDeg: number, pField: Vec3): {u: number, v: number} | null` — null if point at or behind image plane (camera-frame x ≤ 1e-6). u,v normalized: |u|=1 at horizontal FOV edge (u>0 left), |v|=1 at vertical edge (v>0 up).
  - `maxRangeFor(spec: CameraSpec, tagSize: number): number` — `spec.maxRangeM` if set, else `tagSize * focalPx / MIN_TAG_PX` with `focalPx = (resWidth/2)/tan(hfov/2)`, `MIN_TAG_PX = 20`.
  - `Detection {tagId: number, distanceM: number, skewRad: number, edgeMargin: number, bearingRad: number}` — bearingRad is robot-frame horizontal bearing to tag center.
  - `detectTags(robotPose: RobotPose, spec: CameraSpec, tags: Tag[], occluders: OccluderBox[]): Detection[]` — occlusion added in Task 4; in this task pass `[]` and skip the occlusion check.

- [ ] **Step 1: Write failing tests**

`tests/core/visibility.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { detectTags, maxRangeFor, projectToImage, cameraFieldPose } from '../../src/core/visibility'
import { vec3, quatFromEuler, rad } from '../../src/core/math'
import type { Tag, CameraSpec } from '../../src/core/types'

const cam = (over: Partial<CameraSpec> = {}): CameraSpec => ({
  name: 'test', hfovDeg: 90, vfovDeg: 60, resWidth: 1280, resHeight: 800, maxRangeM: null,
  mount: { x: 0, y: 0, z: 0.5, rollDeg: 0, pitchDeg: 0, yawDeg: 0 }, ...over,
})
// Tag 3 m in front of origin, facing back toward origin (faces -X => yaw 180)
const tagAt = (x: number, y: number, z = 0.5, yawDeg = 180): Tag => ({
  id: 1, size: 0.1651,
  pose: { translation: vec3(x, y, z), rotation: quatFromEuler(0, 0, rad(yawDeg)) },
})
const origin = { x: 0, y: 0, headingRad: 0 }

describe('projectToImage', () => {
  const pose = cameraFieldPose(origin, cam())
  it('point on optical axis projects to center', () => {
    const p = projectToImage(pose, 90, 60, vec3(3, 0, 0.5))!
    expect(p.u).toBeCloseTo(0); expect(p.v).toBeCloseTo(0)
  })
  it('point at horizontal FOV edge has |u| = 1', () => {
    // hfov 90 => edge at 45°: y = x
    const p = projectToImage(pose, 90, 60, vec3(3, 3, 0.5))!
    expect(Math.abs(p.u)).toBeCloseTo(1)
  })
  it('point behind camera returns null', () => {
    expect(projectToImage(pose, 90, 60, vec3(-1, 0, 0.5))).toBeNull()
  })
})

describe('detectTags', () => {
  it('sees a facing tag in front', () => {
    const d = detectTags(origin, cam(), [tagAt(3, 0)], [])
    expect(d).toHaveLength(1)
    expect(d[0].distanceM).toBeCloseTo(3, 1)
    expect(d[0].skewRad).toBeCloseTo(0, 1)
  })
  it('rejects tag behind robot', () => {
    expect(detectTags(origin, cam(), [tagAt(-3, 0)], [])).toHaveLength(0)
  })
  it('rejects tag beyond max range', () => {
    expect(detectTags(origin, cam({ maxRangeM: 2 }), [tagAt(3, 0)], [])).toHaveLength(0)
  })
  it('rejects tag past skew threshold (edge-on)', () => {
    expect(detectTags(origin, cam(), [tagAt(3, 0, 0.5, 90)], [])).toHaveLength(0)
  })
  it('rejects tag straddling FOV edge even when center is inside', () => {
    // hfov 90 => at x=1, edge at |y|=1. Center just inside, one corner outside.
    const d = detectTags(origin, cam(), [tagAt(1, 0.999, 0.5, 180)], [])
    expect(d).toHaveLength(0)
  })
  it('camera yawed 180 sees tag behind robot', () => {
    const c = cam({ mount: { x: 0, y: 0, z: 0.5, rollDeg: 0, pitchDeg: 0, yawDeg: 180 } })
    expect(detectTags(origin, c, [tagAt(-3, 0, 0.5, 0)], [])).toHaveLength(1)
  })
})

describe('maxRangeFor', () => {
  it('derives from resolution when maxRangeM null', () => {
    // focalPx = 640/tan(45°) = 640; 0.1651*640/20 ≈ 5.28
    expect(maxRangeFor(cam(), 0.1651)).toBeCloseTo(5.28, 1)
  })
  it('uses override when set', () => {
    expect(maxRangeFor(cam({ maxRangeM: 4 }), 0.1651)).toBe(4)
  })
})
```

- [ ] **Step 2: Run tests, verify fail** — `npm test` → FAIL.

- [ ] **Step 3: Implement**

`src/core/visibility.ts`:

```ts
import type { Vec3, Pose3, Tag, CameraSpec, OccluderBox, RobotPose } from './types'
import { vec3, add, sub, length, normalize, dot, rad, quatFromEuler, quatMul, rotateVec, poseToField, fieldToFrame } from './math'

export const MIN_TAG_PX = 20
export const SKEW_MAX_RAD = rad(65)

export interface Detection {
  tagId: number
  distanceM: number
  skewRad: number
  edgeMargin: number // 1 = dead center, 0 = corner touching image edge
  bearingRad: number // robot-frame horizontal bearing to tag center
}

export function cameraFieldPose(robotPose: RobotPose, spec: CameraSpec): Pose3 {
  const robotQ = quatFromEuler(0, 0, robotPose.headingRad)
  const robot: Pose3 = { translation: vec3(robotPose.x, robotPose.y, 0), rotation: robotQ }
  const m = spec.mount
  return {
    translation: poseToField(robot, vec3(m.x, m.y, m.z)),
    rotation: quatMul(robotQ, quatFromEuler(rad(m.rollDeg), rad(m.pitchDeg), rad(m.yawDeg))),
  }
}

export function tagCorners(tag: Tag): Vec3[] {
  const h = tag.size / 2
  return [vec3(0, h, h), vec3(0, -h, h), vec3(0, -h, -h), vec3(0, h, -h)]
    .map((c) => poseToField(tag.pose, c))
}

export function projectToImage(camPose: Pose3, hfovDeg: number, vfovDeg: number, pField: Vec3) {
  const p = fieldToFrame(camPose, pField)
  if (p.x <= 1e-6) return null
  return {
    u: p.y / p.x / Math.tan(rad(hfovDeg) / 2),
    v: p.z / p.x / Math.tan(rad(vfovDeg) / 2),
  }
}

export function maxRangeFor(spec: CameraSpec, tagSize: number): number {
  if (spec.maxRangeM != null) return spec.maxRangeM
  const focalPx = spec.resWidth / 2 / Math.tan(rad(spec.hfovDeg) / 2)
  return (tagSize * focalPx) / MIN_TAG_PX
}

export function detectTags(robotPose: RobotPose, spec: CameraSpec, tags: Tag[], occluders: OccluderBox[]): Detection[] {
  const camPose = cameraFieldPose(robotPose, spec)
  const out: Detection[] = []
  for (const tag of tags) {
    const center = tag.pose.translation
    const toCam = sub(camPose.translation, center)
    const distanceM = length(toCam)
    if (distanceM > maxRangeFor(spec, tag.size)) continue
    const tagNormal = rotateVec(tag.pose.rotation, vec3(1, 0, 0))
    const skewRad = Math.acos(Math.min(1, Math.max(-1, dot(normalize(toCam), tagNormal))))
    if (skewRad > SKEW_MAX_RAD) continue
    const corners = tagCorners(tag)
    let edge = 1
    let inside = true
    for (const c of corners) {
      const uv = projectToImage(camPose, spec.hfovDeg, spec.vfovDeg, c)
      if (!uv || Math.abs(uv.u) > 1 || Math.abs(uv.v) > 1) { inside = false; break }
      edge = Math.min(edge, 1 - Math.max(Math.abs(uv.u), Math.abs(uv.v)))
    }
    if (!inside) continue
    if (occludedAny(camPose.translation, [...corners, center], occluders)) continue
    const bearingRad = Math.atan2(center.y - robotPose.y, center.x - robotPose.x) - robotPose.headingRad
    out.push({ tagId: tag.id, distanceM, skewRad, edgeMargin: edge, bearingRad })
  }
  return out
}

// Implemented in Task 4; stub returning false keeps Task 3 green.
function occludedAny(_from: Vec3, _targets: Vec3[], occluders: OccluderBox[]): boolean {
  if (occluders.length === 0) return false
  return occluders.some((b) => targetsHitBox(_from, _targets, b))
}
function targetsHitBox(_from: Vec3, _targets: Vec3[], _b: OccluderBox): boolean {
  return false // replaced in Task 4
}
```

- [ ] **Step 4: Run tests, verify pass** — `npm test` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: visibility model - projection, full-tag frustum, range, skew"`

---

### Task 4: Visibility — occlusion (segment vs oriented box)

**Files:**
- Modify: `src/core/visibility.ts`
- Test: `tests/core/occlusion.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces: `segmentHitsBox(a: Vec3, b: Vec3, box: OccluderBox): boolean` (exported); `detectTags` now rejects tags whose corner/center rays hit any occluder. `robotOccludersInField(robotPose: RobotPose, robot: RobotConfig): OccluderBox[]` — superstructure boxes transformed to field frame.

- [ ] **Step 1: Write failing tests**

`tests/core/occlusion.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { segmentHitsBox, detectTags, robotOccludersInField } from '../../src/core/visibility'
import { vec3, quatFromEuler, rad } from '../../src/core/math'
import type { Tag, CameraSpec, OccluderBox } from '../../src/core/types'

const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yawDeg = 0): OccluderBox =>
  ({ center: vec3(cx, cy, cz), size: vec3(sx, sy, sz), yawDeg })

describe('segmentHitsBox', () => {
  it('hits box between endpoints', () => {
    expect(segmentHitsBox(vec3(0, 0, 0.5), vec3(4, 0, 0.5), box(2, 0, 0.5, 0.5, 0.5, 0.5))).toBe(true)
  })
  it('misses box off to the side', () => {
    expect(segmentHitsBox(vec3(0, 0, 0.5), vec3(4, 0, 0.5), box(2, 2, 0.5, 0.5, 0.5, 0.5))).toBe(false)
  })
  it('misses box beyond the segment end', () => {
    expect(segmentHitsBox(vec3(0, 0, 0.5), vec3(1, 0, 0.5), box(2, 0, 0.5, 0.5, 0.5, 0.5))).toBe(false)
  })
  it('respects box yaw', () => {
    // Long thin box rotated 90°: now spans Y, blocks the X-axis ray
    expect(segmentHitsBox(vec3(0, 0, 0.5), vec3(4, 0, 0.5), box(2, 1.2, 0.5, 3, 0.1, 1, 90))).toBe(true)
    expect(segmentHitsBox(vec3(0, 0, 0.5), vec3(4, 0, 0.5), box(2, 1.2, 0.5, 3, 0.1, 1, 0))).toBe(false)
  })
})

describe('occluded detection', () => {
  const cam: CameraSpec = {
    name: 't', hfovDeg: 90, vfovDeg: 60, resWidth: 1280, resHeight: 800, maxRangeM: null,
    mount: { x: 0, y: 0, z: 0.5, rollDeg: 0, pitchDeg: 0, yawDeg: 0 },
  }
  const tag: Tag = { id: 1, size: 0.1651, pose: { translation: vec3(3, 0, 0.5), rotation: quatFromEuler(0, 0, rad(180)) } }
  it('wall between camera and tag blocks detection', () => {
    expect(detectTags({ x: 0, y: 0, headingRad: 0 }, cam, [tag], [box(1.5, 0, 0.5, 0.2, 2, 2)])).toHaveLength(0)
  })
  it('partially blocking wall (covers one corner ray) blocks detection', () => {
    // Thin post clipping only the upper corners' rays
    expect(detectTags({ x: 0, y: 0, headingRad: 0 }, cam, [tag], [box(1.5, 0.08, 0.58, 0.02, 0.02, 0.06)]).length)
      .toBeLessThan(2) // exact geometry: expect 0 — assert 0 after implementing and hand-checking
  })
})

describe('robotOccludersInField', () => {
  it('transforms superstructure boxes by robot pose', () => {
    const robot = { lengthM: 0.8, widthM: 0.8, chassisHeightM: 0.15, teamNumber: '0000', cameras: [],
      superstructure: [box(0.2, 0, 0.5, 0.1, 0.1, 1)] }
    const out = robotOccludersInField({ x: 5, y: 5, headingRad: rad(90) }, robot)
    expect(out[0].center.x).toBeCloseTo(5)
    expect(out[0].center.y).toBeCloseTo(5.2)
    expect(out[0].yawDeg).toBeCloseTo(90)
  })
})
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

Replace the Task 3 stubs in `src/core/visibility.ts`:

```ts
/** Slab-method segment vs yaw-oriented box. */
export function segmentHitsBox(a: Vec3, b: Vec3, box: OccluderBox): boolean {
  // Transform segment into box-local frame (undo yaw, then translate)
  const q = quatFromEuler(0, 0, -rad(box.yawDeg))
  const la = rotateVec(q, sub(a, box.center))
  const lb = rotateVec(q, sub(b, box.center))
  const d = sub(lb, la)
  const half = scale(box.size, 0.5)
  let tmin = 0, tmax = 1
  for (const ax of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[ax]) < 1e-12) {
      if (Math.abs(la[ax]) > half[ax]) return false
    } else {
      let t1 = (-half[ax] - la[ax]) / d[ax]
      let t2 = (half[ax] - la[ax]) / d[ax]
      if (t1 > t2) [t1, t2] = [t2, t1]
      tmin = Math.max(tmin, t1)
      tmax = Math.min(tmax, t2)
      if (tmin > tmax) return false
    }
  }
  return true
}

export function robotOccludersInField(robotPose: RobotPose, robot: RobotConfig): OccluderBox[] {
  const q = quatFromEuler(0, 0, robotPose.headingRad)
  return robot.superstructure.map((b) => ({
    center: add(vec3(robotPose.x, robotPose.y, 0), rotateVec(q, b.center)),
    size: b.size,
    yawDeg: b.yawDeg + deg(robotPose.headingRad),
  }))
}
```

Update `occludedAny` to call `segmentHitsBox` per target per box (drop `targetsHitBox`). Add `scale`, `deg`, `RobotConfig` imports. **Occlusion epsilon:** shorten each segment by 1 cm at the tag end (`b' = a + (b−a)·(1 − 0.01/len)`) so a tag mounted flush on an occluder box face does not self-occlude.

After implementing, hand-check the "thin post" test with a debug print and tighten its assertion to `toHaveLength(0)` (or adjust the post position until it clips a corner ray) — the test must assert exact behavior, not `lessThan(2)`.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `git commit -am "feat: occlusion - segment vs oriented box, robot self-occluders"`

---

### Task 5: Scoring

**Files:**
- Create: `src/core/scoring.ts`
- Test: `tests/core/scoring.test.ts`

**Interfaces:**
- Consumes: `Detection` from Task 3.
- Produces:
  - `SCORING` constants object: `{ DIST_FALLOFF_START: 0.4, SKEW_FALLOFF_POW: 1, EDGE_POW: 0.5, TAG_CAP: 4, SPREAD_BONUS_MAX: 1.5, BASE_SCALE: 25 }`
  - `tagQuality(d: Detection, maxRangeM: number): number` — 0..1.
  - `poseScore(detectionsPerCamera: { detections: Detection[], maxRangeM: number }[]): number` — 0..100. Dedupes by tagId (keeps max quality). Also exported: `scoreBand(score: number): 'dead' | 'poor' | 'ok' | 'strong'` (0 / 1–39 / 40–69 / ≥70).

- [ ] **Step 1: Write failing tests**

`tests/core/scoring.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { tagQuality, poseScore, scoreBand, SCORING } from '../../src/core/scoring'
import type { Detection } from '../../src/core/visibility'

const det = (over: Partial<Detection> = {}): Detection => ({
  tagId: 1, distanceM: 1, skewRad: 0, edgeMargin: 1, bearingRad: 0, ...over,
})

describe('tagQuality', () => {
  it('perfect close head-on centered tag ≈ 1', () => {
    expect(tagQuality(det(), 5)).toBeGreaterThan(0.95)
  })
  it('monotonic: farther is not better', () => {
    expect(tagQuality(det({ distanceM: 4 }), 5)).toBeLessThanOrEqual(tagQuality(det({ distanceM: 2 }), 5))
  })
  it('monotonic: more skew is not better', () => {
    expect(tagQuality(det({ skewRad: 1.0 }), 5)).toBeLessThanOrEqual(tagQuality(det({ skewRad: 0.3 }), 5))
  })
  it('edge-hugging tag scores lower than centered', () => {
    expect(tagQuality(det({ edgeMargin: 0.05 }), 5)).toBeLessThan(tagQuality(det({ edgeMargin: 0.9 }), 5))
  })
})

describe('poseScore', () => {
  const cam = (ds: Detection[]) => [{ detections: ds, maxRangeM: 5 }]
  it('no tags => 0', () => expect(poseScore(cam([]))).toBe(0))
  it('one perfect tag => BASE_SCALE-ish (poor band)', () => {
    const s = poseScore(cam([det()]))
    expect(s).toBeGreaterThan(15); expect(s).toBeLessThan(40)
  })
  it('two spread tags beat two clustered tags', () => {
    const clustered = poseScore(cam([det(), det({ tagId: 2, bearingRad: 0.05 })]))
    const spread = poseScore(cam([det(), det({ tagId: 2, bearingRad: Math.PI / 2 })]))
    expect(spread).toBeGreaterThan(clustered)
  })
  it('more tags never lowers score', () => {
    const two = poseScore(cam([det(), det({ tagId: 2, bearingRad: 1 })]))
    const three = poseScore(cam([det(), det({ tagId: 2, bearingRad: 1 }), det({ tagId: 3, bearingRad: 2 })]))
    expect(three).toBeGreaterThanOrEqual(two)
  })
  it('same tag from two cameras counts once', () => {
    const one = poseScore(cam([det()]))
    const dup = poseScore([{ detections: [det()], maxRangeM: 5 }, { detections: [det()], maxRangeM: 5 }])
    expect(dup).toBeCloseTo(one, 5)
  })
  it('capped at 100', () => {
    const many = Array.from({ length: 8 }, (_, i) => det({ tagId: i + 1, bearingRad: (i * Math.PI) / 4 }))
    expect(poseScore(cam(many))).toBeLessThanOrEqual(100)
  })
})

describe('scoreBand', () => {
  it('bands', () => {
    expect(scoreBand(0)).toBe('dead'); expect(scoreBand(20)).toBe('poor')
    expect(scoreBand(50)).toBe('ok'); expect(scoreBand(85)).toBe('strong')
  })
})
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

`src/core/scoring.ts`:

```ts
import type { Detection } from './visibility'
import { SKEW_MAX_RAD } from './visibility'

export const SCORING = {
  DIST_FALLOFF_START: 0.4, // fraction of max range where distance falloff begins
  EDGE_POW: 0.5,
  TAG_CAP: 4,
  SPREAD_BONUS_MAX: 1.5,
  BASE_SCALE: 25, // one perfect tag ≈ 25 points
}

export function tagQuality(d: Detection, maxRangeM: number): number {
  const start = SCORING.DIST_FALLOFF_START * maxRangeM
  const distFactor = d.distanceM <= start ? 1 : Math.max(0, 1 - (d.distanceM - start) / (maxRangeM - start))
  const skewFactor = Math.max(0, 1 - d.skewRad / SKEW_MAX_RAD)
  const edgeFactor = Math.pow(Math.min(1, d.edgeMargin / 0.5), SCORING.EDGE_POW)
  return distFactor * skewFactor * edgeFactor
}

export function poseScore(perCamera: { detections: Detection[]; maxRangeM: number }[]): number {
  // Dedupe by tag id, keep best quality (and that detection's bearing)
  const best = new Map<number, { q: number; bearing: number }>()
  for (const { detections, maxRangeM } of perCamera) {
    for (const d of detections) {
      const q = tagQuality(d, maxRangeM)
      const cur = best.get(d.tagId)
      if (!cur || q > cur.q) best.set(d.tagId, { q, bearing: d.bearingRad })
    }
  }
  if (best.size === 0) return 0
  const items = [...best.values()].sort((a, b) => b.q - a.q).slice(0, SCORING.TAG_CAP)
  const base = items.reduce((s, i) => s + i.q, 0)
  // Bearing spread in [0,1]: 1 - |mean unit vector| (circular variance)
  let sx = 0, sy = 0
  for (const i of items) { sx += Math.cos(i.bearing); sy += Math.sin(i.bearing) }
  const spread = items.length < 2 ? 0 : 1 - Math.hypot(sx, sy) / items.length
  const spreadFactor = 1 + (SCORING.SPREAD_BONUS_MAX - 1) * Math.min(1, spread * 2)
  return Math.min(100, base * spreadFactor * SCORING.BASE_SCALE)
}

export function scoreBand(score: number): 'dead' | 'poor' | 'ok' | 'strong' {
  if (score <= 0) return 'dead'
  if (score < 40) return 'poor'
  if (score < 70) return 'ok'
  return 'strong'
}
```

- [ ] **Step 4: Run, verify pass.** If "more tags never lowers score" fails because spread drops when adding a clustered tag: sort keeps top-quality tags, and `spreadFactor` uses `Math.min(1, spread * 2)` — verify with the failing case and adjust `TAG_CAP` slice to also try the subset without the new tag is NOT allowed; instead compute base sum so added tags only add (they do — qualities are non-negative) and ensure spread uses the same items as base. If monotonicity still fails, take `max(spreadFactor(items), spreadFactor(items.slice(0,-1)))`.

- [ ] **Step 5: Commit** — `git commit -am "feat: localization quality scoring with bearing-spread bonus"`

---

### Task 6: Field layout loader + evaluatePose façade

**Files:**
- Create: `src/field/layoutLoader.ts`, `src/core/evaluate.ts`, `public/occluders/2026-rebuilt.json`, `public/occluders/2025-reefscape.json`
- Test: `tests/field/layoutLoader.test.ts`, `tests/core/evaluate.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - `parseWpilibLayout(json: unknown): TagLayout` — validates and converts WPILib schema (`{tags: [{ID, pose: {translation:{x,y,z}, rotation:{quaternion:{W,X,Y,Z}}}}], field: {length, width}}`) into our `TagLayout`; every tag gets `size: 0.1651`. Throws `Error` with a human-readable message on bad shape (missing tags array, non-numeric pose, duplicate IDs).
  - `loadLayout(url: string): Promise<TagLayout>` — fetch + parse.
  - `parseOccluders(json: unknown): OccluderBox[]` — validates `{boxes: [{center:{x,y,z}, size:{x,y,z}, yawDeg}]}`.
  - `evaluatePose(robotPose: RobotPose, robot: RobotConfig, layout: TagLayout, fieldOccluders: OccluderBox[]): PoseEvaluation` in `src/core/evaluate.ts` where `PoseEvaluation = { score: number, perCamera: { cameraIndex: number, detections: Detection[] }[] }`. Combines field occluders + `robotOccludersInField`, runs `detectTags` per camera, scores. THE single entry point used by both interactive loop and sweep.
- Occluder data files: `2026-rebuilt.json` and `2025-reefscape.json` each ship as `{"boxes": []}` initially — empty list means no field occlusion (a conservative overestimate of coverage, stated in the report). Boxes get authored by measuring the AdvantageScope field model once the visual field is up (Task 12 revisits).

- [ ] **Step 1: Write failing tests**

`tests/field/layoutLoader.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseWpilibLayout, parseOccluders } from '../../src/field/layoutLoader'

describe('parseWpilibLayout', () => {
  const real = JSON.parse(readFileSync('public/layouts/2026-rebuilt-welded.json', 'utf8'))
  it('parses the real 2026 file: 32 tags, field dims, quaternion mapped w<-W', () => {
    const l = parseWpilibLayout(real)
    expect(l.tags).toHaveLength(32)
    expect(l.field.length).toBeCloseTo(16.541)
    expect(l.tags[0].size).toBeCloseTo(0.1651)
    expect(typeof l.tags[0].pose.rotation.w).toBe('number')
  })
  it('rejects missing tags array', () => {
    expect(() => parseWpilibLayout({ field: { length: 1, width: 1 } })).toThrow(/tags/)
  })
  it('rejects duplicate tag IDs', () => {
    const dup = { ...real, tags: [real.tags[0], real.tags[0]] }
    expect(() => parseWpilibLayout(dup)).toThrow(/duplicate/i)
  })
})

describe('parseOccluders', () => {
  it('parses boxes', () => {
    const o = parseOccluders({ boxes: [{ center: { x: 1, y: 2, z: 0.5 }, size: { x: 1, y: 1, z: 1 }, yawDeg: 0 }] })
    expect(o).toHaveLength(1)
  })
  it('rejects non-numeric size', () => {
    expect(() => parseOccluders({ boxes: [{ center: { x: 1, y: 2, z: 0.5 }, size: { x: 'a', y: 1, z: 1 }, yawDeg: 0 }] })).toThrow()
  })
})
```

`tests/core/evaluate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseWpilibLayout } from '../../src/field/layoutLoader'
import { evaluatePose } from '../../src/core/evaluate'
import type { RobotConfig } from '../../src/core/types'

const layout = parseWpilibLayout(JSON.parse(readFileSync('public/layouts/2026-rebuilt-welded.json', 'utf8')))
const robot: RobotConfig = {
  lengthM: 0.8, widthM: 0.8, chassisHeightM: 0.15, teamNumber: '0000', superstructure: [],
  cameras: [{ name: 'front', hfovDeg: 80, vfovDeg: 55, resWidth: 1280, resHeight: 800, maxRangeM: null,
    mount: { x: 0.3, y: 0, z: 0.4, rollDeg: 0, pitchDeg: 15, yawDeg: 0 } }],
}

describe('evaluatePose on real field', () => {
  it('center of field, some heading sees at least one tag', () => {
    // Sweep 8 headings at field center; at least one should see tags on a 32-tag field
    const scores = Array.from({ length: 8 }, (_, i) =>
      evaluatePose({ x: 16.541 / 2, y: 8.069 / 2, headingRad: (i * Math.PI) / 4 }, robot, layout, []).score)
    expect(Math.max(...scores)).toBeGreaterThan(0)
  })
  it('zero cameras => score 0', () => {
    const r = { ...robot, cameras: [] }
    expect(evaluatePose({ x: 4, y: 4, headingRad: 0 }, r, layout, []).score).toBe(0)
  })
})
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

`src/field/layoutLoader.ts`:

```ts
import type { TagLayout, Tag, OccluderBox } from '../core/types'

export const TAG_SIZE_M = 0.1651

const num = (v: unknown, path: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Layout invalid: ${path} is not a number`)
  return v
}

export function parseWpilibLayout(json: unknown): TagLayout {
  const j = json as any
  if (!j || !Array.isArray(j.tags)) throw new Error('Layout invalid: missing "tags" array')
  if (!j.field) throw new Error('Layout invalid: missing "field"')
  const seen = new Set<number>()
  const tags: Tag[] = j.tags.map((t: any, i: number) => {
    const id = num(t?.ID, `tags[${i}].ID`)
    if (seen.has(id)) throw new Error(`Layout invalid: duplicate tag ID ${id}`)
    seen.add(id)
    const tr = t?.pose?.translation, q = t?.pose?.rotation?.quaternion
    return {
      id, size: TAG_SIZE_M,
      pose: {
        translation: { x: num(tr?.x, `tags[${i}].x`), y: num(tr?.y, `tags[${i}].y`), z: num(tr?.z, `tags[${i}].z`) },
        rotation: { w: num(q?.W, `tags[${i}].W`), x: num(q?.X, `tags[${i}].X`), y: num(q?.Y, `tags[${i}].Y`), z: num(q?.Z, `tags[${i}].Z`) },
      },
    }
  })
  return { field: { length: num(j.field.length, 'field.length'), width: num(j.field.width, 'field.width') }, tags }
}

export async function loadLayout(url: string): Promise<TagLayout> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch layout ${url}: ${res.status}`)
  return parseWpilibLayout(await res.json())
}

export function parseOccluders(json: unknown): OccluderBox[] {
  const j = json as any
  if (!j || !Array.isArray(j.boxes)) throw new Error('Occluders invalid: missing "boxes" array')
  return j.boxes.map((b: any, i: number) => ({
    center: { x: num(b?.center?.x, `boxes[${i}]`), y: num(b?.center?.y, `boxes[${i}]`), z: num(b?.center?.z, `boxes[${i}]`) },
    size: { x: num(b?.size?.x, `boxes[${i}]`), y: num(b?.size?.y, `boxes[${i}]`), z: num(b?.size?.z, `boxes[${i}]`) },
    yawDeg: num(b?.yawDeg ?? 0, `boxes[${i}].yawDeg`),
  }))
}

export async function loadOccluders(url: string): Promise<OccluderBox[]> {
  const res = await fetch(url)
  if (!res.ok) return [] // no occluder file for this field => no field occlusion
  return parseOccluders(await res.json())
}
```

`src/core/evaluate.ts`:

```ts
import type { RobotPose, RobotConfig, TagLayout, OccluderBox } from './types'
import { detectTags, robotOccludersInField, maxRangeFor, type Detection } from './visibility'
import { poseScore } from './scoring'

export interface PoseEvaluation {
  score: number
  perCamera: { cameraIndex: number; detections: Detection[] }[]
}

export function evaluatePose(robotPose: RobotPose, robot: RobotConfig, layout: TagLayout, fieldOccluders: OccluderBox[]): PoseEvaluation {
  const occluders = [...fieldOccluders, ...robotOccludersInField(robotPose, robot)]
  const perCamera = robot.cameras.map((spec, cameraIndex) => ({
    cameraIndex,
    detections: detectTags(robotPose, spec, layout.tags, occluders),
  }))
  const score = poseScore(perCamera.map((c, i) => ({
    detections: c.detections,
    maxRangeM: maxRangeFor(robot.cameras[i], layout.tags[0]?.size ?? 0.1651),
  })))
  return { score, perCamera }
}
```

Create `public/occluders/2026-rebuilt.json` and `public/occluders/2025-reefscape.json`, each containing `{"boxes": []}`.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `git commit -am "feat: wpilib layout loader, occluder loader, evaluatePose facade"`

---

### Task 7: Sweep

**Files:**
- Create: `src/core/sweep.ts`
- Test: `tests/core/sweep.test.ts`

**Interfaces:**
- Consumes: `evaluatePose` (Task 6).
- Produces:
  - `SweepParams { cellSizeM: number, headingCount: number }` (defaults 0.25, 16)
  - `SweepResult { cols: number, rows: number, cellSizeM: number, headingCount: number, minScore: Float32Array, avgScore: Float32Array, perHeading: Float32Array /* cols*rows*headingCount, row-major cell then heading */, tagSeen: Record<number, number> /* tagId -> #cell-heading samples seen */, cameraDetections: number[] /* per camera index */ }`
  - `runSweep(layout, robot, fieldOccluders, params, onProgress?: (frac: number) => void): SweepResult` — cell (c, r) center at `x = (c + 0.5) * cellSizeM`, `y = (r + 0.5) * cellSizeM`; `cols = ceil(field.length / cellSizeM)`, `rows = ceil(field.width / cellSizeM)`; headings `2πk/headingCount`. `onProgress` called once per row.
  - `cellIndex(c: number, r: number, cols: number): number` = `r * cols + c` (exported; viz + report reuse it).

- [ ] **Step 1: Write failing tests**

`tests/core/sweep.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runSweep, cellIndex } from '../../src/core/sweep'
import { parseWpilibLayout } from '../../src/field/layoutLoader'
import type { RobotConfig } from '../../src/core/types'

const layout = parseWpilibLayout(JSON.parse(readFileSync('public/layouts/2026-rebuilt-welded.json', 'utf8')))
const robot: RobotConfig = {
  lengthM: 0.8, widthM: 0.8, chassisHeightM: 0.15, teamNumber: '0000', superstructure: [],
  cameras: [{ name: 'front', hfovDeg: 80, vfovDeg: 55, resWidth: 1280, resHeight: 800, maxRangeM: null,
    mount: { x: 0.3, y: 0, z: 0.4, rollDeg: 0, pitchDeg: 15, yawDeg: 0 } }],
}

describe('runSweep', () => {
  // Coarse grid to keep the test fast
  const params = { cellSizeM: 1.0, headingCount: 4 }
  const result = runSweep(layout, robot, [], params)

  it('grid dimensions', () => {
    expect(result.cols).toBe(Math.ceil(16.541 / 1.0))
    expect(result.rows).toBe(Math.ceil(8.069 / 1.0))
    expect(result.minScore.length).toBe(result.cols * result.rows)
    expect(result.perHeading.length).toBe(result.cols * result.rows * 4)
  })
  it('min <= avg everywhere', () => {
    for (let i = 0; i < result.minScore.length; i++)
      expect(result.minScore[i]).toBeLessThanOrEqual(result.avgScore[i] + 1e-6)
  })
  it('single fixed camera: worst-case has blind headings near walls, avg > 0 somewhere', () => {
    expect(Math.max(...result.avgScore)).toBeGreaterThan(0)
  })
  it('progress callback fires and ends at 1', () => {
    const fracs: number[] = []
    runSweep(layout, robot, [], params, (f) => fracs.push(f))
    expect(fracs.length).toBe(result.rows)
    expect(fracs[fracs.length - 1]).toBeCloseTo(1)
  })
  it('cellIndex row-major', () => expect(cellIndex(2, 3, 17)).toBe(53))
})
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

`src/core/sweep.ts`:

```ts
import type { TagLayout, RobotConfig, OccluderBox } from './types'
import { evaluatePose } from './evaluate'

export interface SweepParams { cellSizeM: number; headingCount: number }
export const DEFAULT_SWEEP: SweepParams = { cellSizeM: 0.25, headingCount: 16 }

export interface SweepResult {
  cols: number; rows: number; cellSizeM: number; headingCount: number
  minScore: Float32Array; avgScore: Float32Array; perHeading: Float32Array
  tagSeen: Record<number, number>; cameraDetections: number[]
}

export const cellIndex = (c: number, r: number, cols: number): number => r * cols + c

export function runSweep(
  layout: TagLayout, robot: RobotConfig, fieldOccluders: OccluderBox[],
  params: SweepParams, onProgress?: (frac: number) => void,
): SweepResult {
  const cols = Math.ceil(layout.field.length / params.cellSizeM)
  const rows = Math.ceil(layout.field.width / params.cellSizeM)
  const n = cols * rows
  const minScore = new Float32Array(n).fill(Infinity)
  const avgScore = new Float32Array(n)
  const perHeading = new Float32Array(n * params.headingCount)
  const tagSeen: Record<number, number> = {}
  const cameraDetections = robot.cameras.map(() => 0)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = cellIndex(c, r, cols)
      for (let h = 0; h < params.headingCount; h++) {
        const pose = {
          x: (c + 0.5) * params.cellSizeM,
          y: (r + 0.5) * params.cellSizeM,
          headingRad: (2 * Math.PI * h) / params.headingCount,
        }
        const ev = evaluatePose(pose, robot, layout, fieldOccluders)
        perHeading[i * params.headingCount + h] = ev.score
        minScore[i] = Math.min(minScore[i], ev.score)
        avgScore[i] += ev.score / params.headingCount
        for (const cam of ev.perCamera) {
          cameraDetections[cam.cameraIndex] += cam.detections.length
          for (const d of cam.detections) tagSeen[d.tagId] = (tagSeen[d.tagId] ?? 0) + 1
        }
      }
    }
    onProgress?.((r + 1) / rows)
  }
  return { cols, rows, cellSizeM: params.cellSizeM, headingCount: params.headingCount, minScore, avgScore, perHeading, tagSeen, cameraDetections }
}
```

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `git commit -am "feat: field sweep with per-heading scores and min/avg aggregation"`

---

### Task 8: Sweep Web Worker

**Files:**
- Create: `src/workers/sweepWorker.ts`, `src/workers/sweepClient.ts`

**Interfaces:**
- Consumes: `runSweep` (Task 7).
- Produces:
  - Worker protocol: main→worker `{ layout: TagLayout, robot: RobotConfig, fieldOccluders: OccluderBox[], params: SweepParams }`; worker→main `{ type: 'progress', frac: number }` then `{ type: 'done', result: SweepResult }` or `{ type: 'error', message: string }`.
  - `sweepInWorker(layout, robot, fieldOccluders, params, onProgress: (frac: number) => void): Promise<SweepResult>` in `sweepClient.ts` — creates worker via `new Worker(new URL('./sweepWorker.ts', import.meta.url), { type: 'module' })`, terminates it on done/error.

- [ ] **Step 1: Implement worker**

`src/workers/sweepWorker.ts`:

```ts
import { runSweep } from '../core/sweep'

self.onmessage = (e: MessageEvent) => {
  try {
    const { layout, robot, fieldOccluders, params } = e.data
    const result = runSweep(layout, robot, fieldOccluders, params, (frac) =>
      self.postMessage({ type: 'progress', frac }))
    self.postMessage({ type: 'done', result }, {
      transfer: [result.minScore.buffer, result.avgScore.buffer, result.perHeading.buffer],
    })
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
```

`src/workers/sweepClient.ts`:

```ts
import type { TagLayout, RobotConfig, OccluderBox } from '../core/types'
import type { SweepParams, SweepResult } from '../core/sweep'

export function sweepInWorker(
  layout: TagLayout, robot: RobotConfig, fieldOccluders: OccluderBox[],
  params: SweepParams, onProgress: (frac: number) => void,
): Promise<SweepResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sweepWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') onProgress(e.data.frac)
      else if (e.data.type === 'done') { worker.terminate(); resolve(e.data.result) }
      else { worker.terminate(); reject(new Error(e.data.message)) }
    }
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message)) }
    worker.postMessage({ layout, robot, fieldOccluders, params })
  })
}
```

- [ ] **Step 2: Verify build** — `npm run build` succeeds (worker bundling is the risk; Vite handles `new URL` pattern natively). Logic is Task 7's, already unit-tested; the worker wrapper gets verified in-browser in Task 13.

- [ ] **Step 3: Commit** — `git commit -am "feat: sweep web worker + promise client"`

---

### Task 9: three.js scene + field rendering (flat fallback)

**Files:**
- Create: `src/viz/scene.ts`, `src/viz/fieldView.ts`, `src/ui/styles.css`
- Modify: `src/main.ts`, `index.html`

**Interfaces:**
- Consumes: `TagLayout` (Task 6).
- Produces:
  - `createScene(container: HTMLElement): SceneCtx` where `SceneCtx = { scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, controls: OrbitControls, onFrame(cb: (dt: number) => void): void }` — starts a requestAnimationFrame loop calling registered callbacks then rendering; handles window resize.
  - `buildFieldView(scene: THREE.Scene, layout: TagLayout): void` — green carpet plane (field.length × field.width, +X along length), gray walls, white center marks, and one textured quad per tag at its exact pose (canvas-generated texture: white square, black border, tag ID number). Tag quads named `tag-<id>` for later highlight lookup. Axes helper at origin.

- [ ] **Step 1: Implement scene + field**

`src/viz/scene.ts`:

```ts
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export interface SceneCtx {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer; controls: OrbitControls
  onFrame(cb: (dt: number) => void): void
}

export function createScene(container: HTMLElement): SceneCtx {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1d24)
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(8, -6, 8)
  camera.up.set(0, 0, 1) // Z-up to match WPILib frame
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  container.appendChild(renderer.domElement)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(8.27, 4.03, 0)
  scene.add(new THREE.AmbientLight(0xffffff, 0.7))
  const sun = new THREE.DirectionalLight(0xffffff, 1.2)
  sun.position.set(5, 3, 10)
  scene.add(sun)

  const callbacks: ((dt: number) => void)[] = []
  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize); resize()
  let last = performance.now()
  renderer.setAnimationLoop(() => {
    const now = performance.now(); const dt = (now - last) / 1000; last = now
    for (const cb of callbacks) cb(dt)
    controls.update(); renderer.render(scene, camera)
  })
  return { scene, camera, renderer, controls, onFrame: (cb) => callbacks.push(cb) }
}
```

`src/viz/fieldView.ts`:

```ts
import * as THREE from 'three'
import type { TagLayout } from '../core/types'

function tagTexture(id: number): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128)
  g.fillStyle = '#fff'; g.fillRect(16, 16, 96, 96)
  g.fillStyle = '#000'; g.font = 'bold 48px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText(String(id), 64, 64)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function buildFieldView(scene: THREE.Scene, layout: TagLayout): THREE.Group {
  const group = new THREE.Group(); group.name = 'field'
  const { length: L, width: W } = layout.field

  const carpet = new THREE.Mesh(
    new THREE.PlaneGeometry(L, W),
    new THREE.MeshLambertMaterial({ color: 0x2e5d34 }))
  carpet.position.set(L / 2, W / 2, 0)
  group.add(carpet)

  const wallMat = new THREE.MeshLambertMaterial({ color: 0x888888 })
  const mkWall = (w: number, h: number, x: number, y: number, rotZ: number) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, h), wallMat)
    wall.position.set(x, y, h / 2); wall.rotation.z = rotZ
    group.add(wall)
  }
  mkWall(L, 0.5, L / 2, 0, 0); mkWall(L, 0.5, L / 2, W, 0)
  mkWall(W, 0.5, 0, W / 2, Math.PI / 2); mkWall(W, 0.5, L, W / 2, Math.PI / 2)

  for (const tag of layout.tags) {
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(tag.size, tag.size),
      new THREE.MeshBasicMaterial({ map: tagTexture(tag.id), side: THREE.DoubleSide }))
    quad.name = `tag-${tag.id}`
    const t = tag.pose.translation, q = tag.pose.rotation
    quad.position.set(t.x, t.y, t.z)
    quad.quaternion.set(q.x, q.y, q.z, q.w)
    // Tag plane is local YZ with +X normal; PlaneGeometry lies in XY with +Z normal — pre-rotate.
    quad.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, Math.PI / 2, 0)))
    group.add(quad)
  }
  group.add(new THREE.AxesHelper(1))
  scene.add(group)
  return group
}
```

`src/main.ts`:

```ts
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
```

`src/ui/styles.css`:

```css
html, body, #app { margin: 0; height: 100%; overflow: hidden; }
#app { position: relative; }
```

- [ ] **Step 2: Visual verify** — `npm run dev`, open browser: green field with walls, 32 numbered tag quads standing at correct poses facing plausible directions (tags on walls/structures face into the field — orbit around and eyeball several). If tag quads lie flat or face wrong way, fix the pre-rotation quaternion (this is the likely bug spot; correct pre-rotation maps plane normal +Z onto tag +X and plane "up" onto tag +Z).

- [ ] **Step 3: Run tests + build** — `npm test && npm run build` both pass.

- [ ] **Step 4: Commit** — `git commit -am "feat: three.js scene, flat field with posed tag quads"`

---

### Task 10: Procedural robot + driving

**Files:**
- Create: `src/robot/robotBuilder.ts`, `src/sim/driveController.ts`, `src/core/defaults.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `RobotConfig`, `RobotPose`, SceneCtx.
- Produces:
  - `DEFAULT_CONFIG: SimConfig` in `src/core/defaults.ts` — fieldYear `'2026-rebuilt-welded'`, robot 0.75×0.75 m chassis 0.13 m high, team `'0000'`, one superstructure box (0.3×0.3×0.8 at center — a stand-in elevator), two cameras: `front` (OV9281 preset values: hfov 75, vfov 47, 1280×800, mount x 0.32, z 0.25, pitch 10) and `rear-left` (hfov 75, vfov 47, 1280×800, mount x −0.32, y 0.32, z 0.25, yaw 160, pitch 15).
  - `buildRobot(config: RobotConfig): THREE.Group` — chassis box, bumper ring (red, team number on canvas texture each side), 4 corner wheel pods (dark cylinders), superstructure boxes rendered semi-transparent gray, small camera markers (yellow cones at each mount pose pointing along camera +X).
  - `createDriveController(): DriveController` where `DriveController = { pose: RobotPose, update(dt: number): void, dispose(): void }` — listens to keydown/keyup on window. WASD field-relative translate (W = +X), Q/E rotate CCW/CW. Speed 3 m/s, 2.5 rad/s. `update` integrates and clamps x/y to the field bounds (pass field dims to the factory: `createDriveController(fieldLength: number, fieldWidth: number)`).
  - In `main.ts`: robot group added to scene; each frame `drive.update(dt)` then robot group position/rotation set from `drive.pose`.

- [ ] **Step 1: Implement**

`src/sim/driveController.ts`:

```ts
import type { RobotPose } from '../core/types'

const SPEED = 3, TURN = 2.5

export interface DriveController { pose: RobotPose; update(dt: number): void; dispose(): void }

export function createDriveController(fieldLength: number, fieldWidth: number): DriveController {
  const keys = new Set<string>()
  const down = (e: KeyboardEvent) => { if (!e.repeat && e.target === document.body) keys.add(e.key.toLowerCase()) }
  const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase())
  window.addEventListener('keydown', down); window.addEventListener('keyup', up)
  const pose: RobotPose = { x: fieldLength / 2, y: fieldWidth / 2, headingRad: 0 }
  return {
    pose,
    update(dt) {
      const vx = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0)
      const vy = (keys.has('a') ? 1 : 0) - (keys.has('d') ? 1 : 0)
      const om = (keys.has('q') ? 1 : 0) - (keys.has('e') ? 1 : 0)
      pose.x = Math.min(fieldLength - 0.4, Math.max(0.4, pose.x + vx * SPEED * dt))
      pose.y = Math.min(fieldWidth - 0.4, Math.max(0.4, pose.y + vy * SPEED * dt))
      pose.headingRad += om * TURN * dt
    },
    dispose() { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) },
  }
}
```

`src/robot/robotBuilder.ts` — build the group exactly as described in Produces; bumper is 4 boxes around the chassis perimeter at z 0.09, height 0.13, canvas texture with `teamNumber` in white bold text; camera markers `THREE.ConeGeometry(0.03, 0.08)` rotated to point along mount yaw/pitch, positioned at mount x/y/z, named `cam-<index>`. Superstructure boxes: `MeshLambertMaterial({ color: 0x555b66, transparent: true, opacity: 0.75 })`.

`src/core/defaults.ts` — the `DEFAULT_CONFIG` literal from Produces.

`src/main.ts` additions:

```ts
import { buildRobot } from './robot/robotBuilder'
import { createDriveController } from './sim/driveController'
import { DEFAULT_CONFIG } from './core/defaults'

// in boot(), after buildFieldView:
const config = structuredClone(DEFAULT_CONFIG)
let robotGroup = buildRobot(config.robot)
ctx.scene.add(robotGroup)
const drive = createDriveController(layout.field.length, layout.field.width)
ctx.onFrame((dt) => {
  drive.update(dt)
  robotGroup.position.set(drive.pose.x, drive.pose.y, 0)
  robotGroup.rotation.z = drive.pose.headingRad
})
```

- [ ] **Step 2: Visual verify** — dev server: robot with bumpers + team number + pods + translucent elevator sits mid-field; WASD drives field-relative; Q/E rotates; robot stops at walls.

- [ ] **Step 3: `npm test && npm run build` pass.**

- [ ] **Step 4: Commit** — `git commit -am "feat: procedural robot, WASD drive controller, defaults"`

---

### Task 11: Live frustums, tag highlights, HUD

**Files:**
- Create: `src/viz/frustumView.ts`, `src/viz/tagHighlights.ts`, `src/ui/hud.ts`
- Modify: `src/main.ts`, `src/ui/styles.css`

**Interfaces:**
- Consumes: `evaluatePose` (Task 6), `cameraFieldPose`/`maxRangeFor` (Task 3), SceneCtx, `SimConfig`.
- Produces:
  - `CAMERA_COLORS: number[]` = `[0x4fc3f7, 0xffb74d, 0xba68c8, 0x81c784, 0xf06292, 0xfff176]` (exported from `frustumView.ts`; UI and report reuse by index, wrap around).
  - `createFrustumView(scene: THREE.Scene): { update(robotPose: RobotPose, robot: RobotConfig, tagSize: number): void }` — per camera, a wireframe frustum (`THREE.LineSegments`): 4 edges from camera position to the 4 far-plane corners at distance `maxRangeFor(...)` plus the far rectangle, colored `CAMERA_COLORS[i % len]`, rebuilt when camera count changes, repositioned each frame.
  - `createTagHighlights(fieldGroup: THREE.Group): { update(ev: PoseEvaluation, robot: RobotConfig): void }` — per tag: emissive ring (`THREE.RingGeometry(0.12, 0.16)`) placed just in front of each tag quad (offset 0.01 along tag normal), hidden by default; shown colored by detecting camera, white when ≥2 cameras detect it.
  - `createHud(container: HTMLElement): { update(ev: PoseEvaluation, robot: RobotConfig): void }` — fixed-position DOM overlay (top-left): big score number colored by band (dead #f44336 / poor #ff9800 / ok #ffeb3b / strong #4caf50), then one line per camera `"<name>: N tags"` in its camera color.
  - `main.ts` frame loop: `const ev = evaluatePose(drive.pose, config.robot, layout, fieldOccluders)` then update frustums, highlights, HUD.

- [ ] **Step 1: Implement** the three modules per Produces. Frustum far-corner directions in camera frame: `(1, ±tan(hfov/2), ±tan(vfov/2))` normalized, scaled to range, transformed by `cameraFieldPose` (reuse core math — convert `Pose3` to `THREE.Matrix4` once per frame via position + quaternion). HUD is plain DOM (`position: absolute; top: 12px; left: 12px; font-family: monospace; color: #eee; background: rgba(0,0,0,0.55); padding: 10px 14px; border-radius: 8px`).

- [ ] **Step 2: Visual verify** — driving around: frustum cones follow cameras; tags light up in camera color exactly when inside a frustum, near enough, facing the camera; drive behind the center elevator box and confirm the front camera loses tags it was seeing (self-occlusion working live); HUD score rises with more/better tags and reads 0 facing empty walls.

- [ ] **Step 3: `npm test && npm run build` pass.**

- [ ] **Step 4: Commit** — `git commit -am "feat: live frustums, tag detection highlights, score HUD"`

---

### Task 12: Config panel, presets, persistence

**Files:**
- Create: `src/ui/configPanel.ts`, `src/ui/presets.ts`, `src/ui/configStore.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `SimConfig`, robot/scene rebuild path from Task 10/11.
- Produces:
  - `CAMERA_PRESETS: { label: string, hfovDeg: number, vfovDeg: number, resWidth: number, resHeight: number }[]` in `presets.ts`: `OV9281 + 75° lens (75/47/1280/800)`, `OV9281 + 100° lens (100/70/1280/800)`, `Limelight 3 (63.3/49.7/1280/960)`, `Limelight 3G (80/52/1280/800)`, `Limelight 4 (82/56/1280/800)`, `Custom` (leaves values untouched).
  - `configStore.ts`: `saveConfig(c: SimConfig): void` (localStorage key `frc-camera-sim.config`), `loadConfig(): SimConfig | null` (parse errors → null), `exportConfig(c: SimConfig): void` (download `camera-sim-config.json`), `parseConfig(json: unknown): SimConfig` (validates numbers present; throws readable errors), `importConfig(file: File): Promise<SimConfig>`.
  - `createConfigPanel(opts: { config: SimConfig, onChange(c: SimConfig): void, onFieldChange(year: string): void }): HTMLElement` — right-side panel (plain DOM, no framework): field year select (`2026-rebuilt-welded`, `2025-reefscape-welded`); robot dims + team number inputs; superstructure box list (add/remove, 7 number inputs each); camera list: add/remove camera, preset select (fills FOV/res), FOV/res/maxRange inputs, mount x/y/z/roll/pitch/yaw inputs; Export / Import buttons. Every input change → `onChange(structuredClone(config))`. Validation warnings inline (red text) for 0 cameras or non-positive FOV — warn, don't block.
  - `main.ts`: on change — save to localStorage, rebuild robot group (`scene.remove(old)`, dispose geometries, `buildRobot(new)`), frustum view rebuilds (Task 11 handles camera-count change). On field change — reload layout + occluders (`layouts/<year>.json`, occluder file mapped by year prefix), rebuild field group; on layout load failure show a toast (`div.toast`, auto-hide 5 s) and keep the old field. Boot config = `loadConfig() ?? structuredClone(DEFAULT_CONFIG)`.

- [ ] **Step 1: Implement** per Produces. Keyboard: config panel inputs must not fight WASD — drive controller already filters `e.target === document.body`.

- [ ] **Step 2: Visual verify** — change FOV: frustum widens live. Add third camera with preset: appears with new color, HUD gains a row. Reload page: config persists. Export → file downloads; wipe localStorage, import the file → config restored. Switch field year to 2025 → 22-tag Reefscape field appears; switch back. Break a downloaded config file by hand (set hfovDeg to "x"), import → readable error toast, sim keeps running.

- [ ] **Step 3: `npm test && npm run build` pass.**

- [ ] **Step 4: Commit** — `git commit -am "feat: config panel with camera presets, localStorage, import/export"`

---

### Task 13: Heatmap overlay + cell inspection

**Files:**
- Create: `src/viz/heatmapView.ts`, `src/ui/sweepControls.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `sweepInWorker` (Task 8), `SweepResult`/`cellIndex` (Task 7), `scoreBand` (Task 5), SceneCtx.
- Produces:
  - `createHeatmapView(scene: THREE.Scene): { show(result: SweepResult, mode: 'min' | 'avg'): void, hide(): void, pickCell(ndc: {x: number, y: number}, camera: THREE.Camera): {c: number, r: number} | null }` — one `THREE.Mesh` plane at z 0.02 sized to the grid, `THREE.DataTexture` colored per cell from the selected score array: score 0 → `#d32f2f`, 1–39 → lerp red→orange, 40–69 → lerp orange→yellow, ≥70 → lerp yellow-green→green (`NearestFilter` so cells stay crisp), opacity 0.85. `pickCell` raycasts the plane and converts hit point to cell coords.
  - `createSweepControls(opts: { onRun(): void, onModeChange(m: 'min' | 'avg'): void, onClear(): void }): HTMLElement` — bottom bar: "Run coverage sweep" button, min/avg radio (labeled "Worst-case heading" / "Average over headings"), progress bar (`<progress>`), clear button, and a cell-detail box.
  - `main.ts` wiring: Run → `sweepInWorker(layout, config.robot, fieldOccluders, DEFAULT_SWEEP, setProgress)`; on done → `heatmap.show(result, mode)`, stash `lastSweep = { result, config: structuredClone(config) }` on `window.__sim`. Worker error → toast, controls re-enabled. Canvas click while heatmap shown → `pickCell`; detail box lists the cell's field coords and per-heading scores (16 rows: heading degrees + score + band), plus which cameras/tags detected at the worst heading (recompute that single pose with `evaluatePose` on the main thread — cheap).

- [ ] **Step 1: Implement** per Produces.

- [ ] **Step 2: Visual verify** — default 2-camera robot: sweep completes with progress bar (time it: 0.25 m grid ≈ 2100 cells × 16 headings ≈ 34k evaluatePose calls — target < 10 s; if slower, profile: the likely cost is `tagCorners`+projection allocations; acceptable optimization is hoisting corner arrays per tag into the sweep via a precomputed cache keyed by tag id — only if needed). Worst-case mode shows red zones (single-camera headings blind); average mode greener. Click a red cell → details show blind headings. Remove all cameras → sweep runs, all-red map (legitimate 0 answer).

- [ ] **Step 3: `npm test && npm run build` pass.**

- [ ] **Step 4: Commit** — `git commit -am "feat: coverage heatmap with worst-case/average modes and cell inspection"`

---

### Task 14: Report + compare mode

**Files:**
- Create: `src/report/report.ts`, `src/report/reportTemplate.ts`
- Modify: `src/ui/sweepControls.ts`, `src/main.ts`
- Test: `tests/report/reportStats.test.ts`

**Interfaces:**
- Consumes: `SweepResult`, `SimConfig`, `scoreBand`, `CAMERA_COLORS`.
- Produces:
  - `computeReportStats(result: SweepResult, robot: RobotConfig): ReportStats` in `report.ts` (pure, tested) where `ReportStats = { bandPctMin: Record<Band, number>, bandPctAvg: Record<Band, number>, deadZones: { xM: number, yM: number }[] /* cells with minScore 0, clustered: list every cell, capped at 40 with a "+N more" count */, deadZoneOverflow: number, cameraShare: { name: string, pct: number }[], tagsNeverSeen: number[], tagsRarelySeen: { id: number, seenPct: number }[] /* < 2% of samples */ }` (`Band = 'dead' | 'poor' | 'ok' | 'strong'`).
  - `renderReport(stats: ReportStats, config: SimConfig, compare?: { label: string, stats: ReportStats }): string` in `reportTemplate.ts` — self-contained printable HTML document string: title + date, coverage table (band × min/avg %), dead-zone coordinate list, per-camera contribution bars, never/rarely-seen tag lists, embedded `<pre>` config JSON, and — when `compare` present — a delta column (`+/−` percentage points per band, green/red). Inline CSS only.
  - `openReport(html: string): void` — `window.open('', '_blank')` + `document.write(html)`; toast if popup blocked.
  - Sweep controls gain: "Report" button (enabled after a sweep), "Set as baseline" button (stores `{label: 'Baseline', stats}` from current sweep), report includes baseline compare when set.
  - Note in report when field occluder list is empty: "Field-element occlusion not modeled for this field — coverage is optimistic near field structures."

- [ ] **Step 1: Write failing tests**

`tests/report/reportStats.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeReportStats } from '../../src/report/report'
import type { SweepResult } from '../../src/core/sweep'

function fakeSweep(minVals: number[], avgVals: number[]): SweepResult {
  return {
    cols: minVals.length, rows: 1, cellSizeM: 1, headingCount: 2,
    minScore: Float32Array.from(minVals), avgScore: Float32Array.from(avgVals),
    perHeading: new Float32Array(minVals.length * 2),
    tagSeen: { 1: 100, 2: 1 }, cameraDetections: [90, 10],
  }
}
const robot = { lengthM: 1, widthM: 1, chassisHeightM: 0.1, teamNumber: '0', superstructure: [],
  cameras: [
    { name: 'front', hfovDeg: 80, vfovDeg: 55, resWidth: 1280, resHeight: 800, maxRangeM: null, mount: { x: 0, y: 0, z: 0.3, rollDeg: 0, pitchDeg: 0, yawDeg: 0 } },
    { name: 'rear', hfovDeg: 80, vfovDeg: 55, resWidth: 1280, resHeight: 800, maxRangeM: null, mount: { x: 0, y: 0, z: 0.3, rollDeg: 0, pitchDeg: 0, yawDeg: 180 } },
  ] }

describe('computeReportStats', () => {
  const stats = computeReportStats(fakeSweep([0, 20, 50, 80], [10, 30, 60, 90]), robot)
  it('band percentages from minScore', () => {
    expect(stats.bandPctMin.dead).toBeCloseTo(25)
    expect(stats.bandPctMin.poor).toBeCloseTo(25)
    expect(stats.bandPctMin.ok).toBeCloseTo(25)
    expect(stats.bandPctMin.strong).toBeCloseTo(25)
  })
  it('dead zones list cell centers', () => {
    expect(stats.deadZones).toEqual([{ xM: 0.5, yM: 0.5 }])
  })
  it('camera share percentages', () => {
    expect(stats.cameraShare).toEqual([{ name: 'front', pct: 90 }, { name: 'rear', pct: 10 }])
  })
  it('rarely-seen tags under 2% of samples', () => {
    // 4 cells * 2 headings = 8 samples; tag 2 seen once = 12.5% -> not rare with this tiny grid
    expect(stats.tagsRarelySeen.map(t => t.id)).not.toContain(1)
  })
})
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** `computeReportStats` (pure array math over `SweepResult`; sample count = `cols*rows*headingCount`; rare threshold 2%), `reportTemplate.ts` (template literal HTML), `openReport`, and the two buttons.

- [ ] **Step 4: Run tests, verify pass. Visual verify** — run sweep → Report: readable printable page with all sections; Ctrl+P print preview sane. Set baseline, move a camera in the panel, re-sweep, Report → delta column shows changes.

- [ ] **Step 5: Commit** — `git commit -am "feat: coverage report with baseline compare"`

---

### Task 15: glTF field model + GitHub Pages deploy

**Files:**
- Create: `src/field/fieldModelLoader.ts`, `.github/workflows/deploy.yml`
- Modify: `src/main.ts`, `src/viz/fieldView.ts`, `README.md`

**Interfaces:**
- Consumes: field group from Task 9.
- Produces:
  - `tryLoadFieldModel(url: string): Promise<THREE.Group | null>` — `GLTFLoader` wrapped; resolves null on any failure. Model expected at `public/models/<fieldYear>.glb`. AdvantageScope publishes per-year field models (MIT) in `Mechanical-Advantage/AdvantageScopeAssets` releases — download the 2026 field glb, verify its license file, commit under `public/models/` with attribution in README. If the asset's coordinate convention differs (AdvantageScope field models are centered at field center, Y-up), wrap in a parent group with the corrective rotation (`rotation.x = Math.PI / 2`) and translation (`+L/2, +W/2`) — verify visually against tag quad positions, which are ground truth from the layout JSON.
  - `buildFieldView` gains an option: when a model group is provided, add it and skip carpet/walls (tag quads STAY — they are the localization ground truth and highlight anchors).
  - Banner (reuse toast, persistent variant) when model load fails: "Field model unavailable — showing simplified field."
  - `.github/workflows/deploy.yml`: on push to main — checkout, setup-node 20, `npm ci`, `npm test`, `npm run build`, upload `dist/`, deploy via `actions/deploy-pages@v4` (with `actions/upload-pages-artifact@v3`, permissions `pages: write`, `id-token: write`).
  - `README.md`: what the tool does, screenshot placeholder-free description, how to run locally (`npm install && npm run dev`), controls (WASD/QE), config export/import, deploy URL note, AdvantageScope asset attribution.
- Also in this task: revisit `public/occluders/2026-rebuilt.json` — with the glb visible, author collider boxes for the major REBUILT field structures by reading positions off the rendered model (orbit + click positions logged via a temporary `console.log` raycast helper is fine, or measure in the glb with three.js editor). Every box added must visually match a structure. If the glb cannot be obtained, leave `{"boxes": []}` and keep the report's optimism note — the app is fully functional without it.

- [ ] **Step 1: Implement** loader + fieldView option + workflow + README.

- [ ] **Step 2: Verify** — dev server with glb present: real field geometry, tag quads coincide with model's tag locations (alignment check). Delete/rename glb: fallback field + banner. `npm test && npm run build` pass.

- [ ] **Step 3: Push to GitHub, verify Pages deploy** — create repo, push, enable Pages (workflow source), confirm the deployed URL boots and a sweep runs.

- [ ] **Step 4: Commit** — `git commit -am "feat: gltf field model with fallback, gh-pages deploy"`

---

## Self-Review Notes

- **Spec coverage:** interactive drive + frustums (Tasks 10–11), heatmap (13), report + compare (14), presets + manual (12), self-occlusion (4, verified live in 11), full-tag frustum (3), 2026 REBUILT default (1, 6), glTF + fallback (15), error handling (6 loader errors, 12 import errors, 13 worker errors, 15 model fallback), testing (core fully TDD; viz visually verified per task). Field occluder authoring is data work gated on the glb (15) with an explicit honest-degradation path (empty list + report note).
- **Type consistency:** `CameraSpec` uses flat `resWidth`/`resHeight` everywhere (Tasks 2, 3, 6, 12, 14). `Detection` defined once in `visibility.ts`, consumed by scoring/evaluate/report. `cellIndex` shared by sweep/heatmap/report.
- **Known risk spots called out in-task:** tag quad pre-rotation (9), sweep performance (13), glb coordinate convention (15), scoring monotonicity interaction with spread bonus (5).
