import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Snapshot } from '../../shared/types/snapshot'
import { BRANCHES, HOPS, PRESENCES, STATUS_CATEGORIES, VERDICTS, WARNINGS } from '../../shared/utils/snapshot'

const snapshot: Snapshot = JSON.parse(readFileSync(new URL('../../public/snapshot.json', import.meta.url), 'utf8'))
const ids = new Set(snapshot.items.map(i => i.id))

describe('fixture snapshot.json', () => {
  it('has a head and a presence for every branch', () => {
    expect(Object.keys(snapshot.heads).sort()).toEqual([...BRANCHES].sort())
    for (const item of snapshot.items) {
      expect(Object.keys(item.presence).sort(), item.id).toEqual([...BRANCHES].sort())
      for (const p of Object.values(item.presence)) expect(PRESENCES, item.id).toContain(p)
    }
  })

  it('uses only known enum values', () => {
    for (const item of snapshot.items) {
      if (item.jira) expect(STATUS_CATEGORIES).toContain(item.jira.statusCategory)
      for (const w of item.warnings) expect(WARNINGS).toContain(w)
    }
    for (const hop of snapshot.hops) expect(VERDICTS).toContain(hop.verdict)
  })

  it('has unique item ids and hops that reference real items', () => {
    expect(ids.size).toBe(snapshot.items.length)
    for (const hop of snapshot.hops) {
      for (const id of [...hop.aheadIds, ...hop.blockingIds, ...hop.backSyncIds]) expect(ids, `${hop.from}→${hop.to}`).toContain(id)
      for (const id of hop.blockingIds) expect(hop.aheadIds).toContain(id)
    }
  })

  it('lists every forward hop once, in topology order', () => {
    expect(snapshot.hops.map(h => [h.from, h.to])).toEqual(HOPS.map(h => [h.from, h.to]))
  })

  it('covers every presence, verdict and warning so the UI can be built against it', () => {
    const presences = new Set(snapshot.items.flatMap(i => Object.values(i.presence)))
    expect([...presences].sort()).toEqual([...PRESENCES].sort())
    expect([...new Set(snapshot.hops.map(h => h.verdict))].sort()).toEqual([...VERDICTS].sort())
    expect([...new Set(snapshot.items.flatMap(i => i.warnings))].sort()).toEqual([...WARNINGS].sort())
    expect(snapshot.items.some(i => i.hotfix)).toBe(true)
    expect(snapshot.hops.some(h => h.backSyncIds.length)).toBe(true)
  })

  it('points currentRelease at an unreleased version', () => {
    expect(snapshot.releases.find(r => r.name === snapshot.currentRelease)?.released).toBe(false)
  })
})
