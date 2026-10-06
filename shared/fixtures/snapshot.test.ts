// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../types/snapshot';
import { PRESENCES, REPOS, STATUS_CATEGORIES, VERDICTS, WARNINGS } from '../utils/snapshot';

const snapshot: Snapshot = JSON.parse(readFileSync(new URL('./snapshot.json', import.meta.url), 'utf8'));
const ids = new Set(snapshot.items.map((i) => i.id));
const repoById = new Map(REPOS.map((r) => [r.id as string, r]));
const sorted = (xs: readonly string[]) => [...xs].sort();

describe('fixture snapshot.json', () => {
  it('has a head for every branch of every repo', () => {
    for (const repo of REPOS) {
      expect(sorted(Object.keys(snapshot.heads[repo.id] ?? {})), repo.id).toEqual(sorted(repo.branches));
    }
  });

  it('gives presence only for known repos, covering each repo\'s branches exactly', () => {
    for (const item of snapshot.items) {
      for (const [repoId, branches] of Object.entries(item.presence)) {
        const repo = repoById.get(repoId);
        expect(repo, `${item.id} ${repoId}`).toBeDefined();
        expect(sorted(Object.keys(branches!)), `${item.id} ${repoId}`).toEqual(sorted(repo!.branches));
        for (const p of Object.values(branches!)) expect(PRESENCES, item.id).toContain(p);
      }
      for (const pr of item.prs) expect(repoById.has(pr.repo), `${item.id} #${pr.number}`).toBe(true);
    }
  });

  it('uses only known enum values', () => {
    for (const item of snapshot.items) {
      if (item.jira) expect(STATUS_CATEGORIES).toContain(item.jira.statusCategory);
      for (const w of item.warnings) expect(WARNINGS).toContain(w);
    }
    for (const hop of snapshot.hops) expect(VERDICTS).toContain(hop.verdict);
  });

  it('has unique item ids and hops that reference real items', () => {
    expect(ids.size).toBe(snapshot.items.length);
    for (const hop of snapshot.hops) {
      for (const id of [...hop.aheadIds, ...hop.blockingIds, ...hop.backSyncIds]) expect(ids, `${hop.repo} ${hop.from}→${hop.to}`).toContain(id);
      for (const id of hop.blockingIds) expect(hop.aheadIds).toContain(id);
    }
  });

  it('lists every repo\'s forward hops once, in topology order', () => {
    const expected = REPOS.flatMap((r) => r.hops.map(([from, to]) => [r.id, from, to]));
    expect(snapshot.hops.map((h) => [h.repo, h.from, h.to])).toEqual(expected);
  });

  it('covers every presence, verdict and warning, both repos and a two-repo ticket', () => {
    const presences = new Set(snapshot.items.flatMap((i) => Object.values(i.presence).flatMap((b) => Object.values(b!))));
    expect(sorted([...presences])).toEqual(sorted(PRESENCES));
    expect(sorted([...new Set(snapshot.hops.map((h) => h.verdict))])).toEqual(sorted(VERDICTS));
    expect(sorted([...new Set(snapshot.items.flatMap((i) => i.warnings))])).toEqual(sorted(WARNINGS));
    expect(snapshot.items.some((i) => i.hotfix)).toBe(true);
    expect(snapshot.hops.some((h) => h.backSyncIds.length)).toBe(true);
    expect(snapshot.items.some((i) => Object.keys(i.presence).length === 2)).toBe(true);
    expect(snapshot.items.some((i) => Object.keys(i.presence).length === 0)).toBe(true);
  });

  it('points currentRelease at an unreleased version', () => {
    expect(snapshot.releases.find((r) => r.name === snapshot.currentRelease)?.released).toBe(false);
  });
});
