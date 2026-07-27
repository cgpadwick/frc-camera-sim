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
