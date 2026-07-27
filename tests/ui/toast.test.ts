import { describe, it, expect } from 'vitest'
import { takeKeyed } from '../../src/ui/toast'

// `takeKeyed` is the pure bookkeeping `showToast`/`dismissToast` use to
// dedupe keyed toasts (see the task-15 review fix: repeated
// "field model unavailable" banners must replace, not stack). It's plain
// Map manipulation with no DOM dependency, so — unlike `showToast` itself,
// which needs `document` and can't run under this project's node test
// environment — it's directly unit-testable here.
describe('takeKeyed', () => {
  it('returns undefined and leaves the registry empty when the key is absent', () => {
    const registry = new Map<string, string>()
    expect(takeKeyed(registry, 'missing')).toBeUndefined()
    expect(registry.size).toBe(0)
  })

  it('returns the previous value and removes the key when present', () => {
    const registry = new Map<string, string>([['a', 'first']])
    expect(takeKeyed(registry, 'a')).toBe('first')
    expect(registry.has('a')).toBe(false)
  })

  it('only affects the given key, leaving other entries untouched', () => {
    const registry = new Map<string, string>([
      ['a', 'first'],
      ['b', 'second'],
    ])
    expect(takeKeyed(registry, 'a')).toBe('first')
    expect(registry.get('b')).toBe('second')
    expect(registry.size).toBe(1)
  })

  it('a replace-in-place sequence (take then set) never leaves two entries for the same key', () => {
    const registry = new Map<string, string>()
    // Simulates showToast(msg, key): take the old element (to remove from
    // the DOM) before inserting the new one under the same key.
    const first = takeKeyed(registry, 'k')
    expect(first).toBeUndefined()
    registry.set('k', 'toast-1')

    const second = takeKeyed(registry, 'k')
    expect(second).toBe('toast-1') // caller would .remove() this
    registry.set('k', 'toast-2')

    expect(registry.size).toBe(1)
    expect(registry.get('k')).toBe('toast-2')
  })

  it('dismiss-without-replace (take, do not re-set) clears the key entirely', () => {
    const registry = new Map<string, string>([['k', 'toast-1']])
    const removed = takeKeyed(registry, 'k')
    expect(removed).toBe('toast-1')
    expect(registry.size).toBe(0)
  })
})
