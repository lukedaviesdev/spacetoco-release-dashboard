// Hop verdicts and item warnings for a selected release. Pure, so the snapshot script precomputes them for the
// current release and the app recomputes them when another release is picked.
import type { Branch, Hop, Item, Presence, Release, RepoId, Warning } from '../types/snapshot.ts';
import { REPOS, ROLLING_VERSIONS } from './snapshot.ts';

/** Hops judged against the release (merge vs cherry-pick); the others only report pending syncs. */
const RELEASE_HOPS = new Set(['develop→staging', 'staging→main']);

/** How much of an item's work a branch holds. `partial` is less than all of it; `picked` counts as all. */
const RANK: Record<Presence, number> = {
  none: 0,
  partial: 1,
  merged: 2,
  picked: 2,
};

const rankOn = (item: Item, repo: RepoId, branch: Branch) => RANK[item.presence[repo]?.[branch] ?? 'none'];

/** Done, and in the release or a rolling version: safe to go through a release hop. */
export const isReady = (item: Item, release: string | null) => item.jira?.statusCategory === 'done'
  && item.jira.fixVersions.some((v) => v === release || ROLLING_VERSIONS.includes(v));

/** Every repo the item has work in holds all of it on `branch`. */
const fullyOn = (item: Item, branch: Branch) => {
  const repos = Object.keys(item.presence) as RepoId[];
  return repos.length > 0 && repos.every((repo) => rankOn(item, repo, branch) === 2);
};

export const computeHops = (items: Item[], release: string | null): Hop[] => REPOS.flatMap((repo) => repo.hops.map(
  ([from, to]): Hop => {
    const inRepo = items.filter((i) => i.presence[repo.id]);
    // Ahead: `from` holds more of the item's work than `to`. Two partials can't be compared, so they're not ahead.
    const aheadIds = inRepo.filter((i) => rankOn(i, repo.id, from) > rankOn(i, repo.id, to)).map((i) => i.id);
    const backSyncIds = inRepo.filter((i) => rankOn(i, repo.id, to) > rankOn(i, repo.id, from)).map((i) => i.id);
    const isReleaseHop = RELEASE_HOPS.has(`${from}→${to}`);
    const blockingIds = isReleaseHop
      ? aheadIds.filter((id) => !isReady(items.find((i) => i.id === id)!, release))
      : [];
    const verdict: Hop['verdict'] = !aheadIds.length
      ? 'in-sync'
      : !isReleaseHop ? 'sync' : blockingIds.length ? 'cherry-pick' : 'clean';
    return {
      repo: repo.id,
      from,
      to,
      verdict,
      aheadIds,
      blockingIds,
      backSyncIds,
    };
  },
));

export const computeWarnings = (item: Item, release: string | null, releases: Release[] = []): Warning[] => {
  const warnings: Warning[] = [];
  const shipped = new Set(releases.filter((r) => r.released).map((r) => r.name));
  const versions = item.jira?.fixVersions.filter((v) => !ROLLING_VERSIONS.includes(v)) ?? [];
  if (release && item.jira?.fixVersions.includes(release) && !fullyOn(item, 'develop')) warnings.push('not-on-develop');
  // Every version it's in has shipped, yet it isn't on main: it missed its release, or its fixVersion is stale.
  if (versions.length && versions.every((v) => shipped.has(v)) && !fullyOn(item, 'main')) warnings.push('missed-release');
  if (item.jira?.statusCategory === 'done' && !item.jira.fixVersions.length) warnings.push('done-no-fixversion');
  if (item.invalidKey) warnings.push('invalid-key');
  if (item.kind === 'untracked') warnings.push('untracked');
  return warnings;
};

/** Items with warnings for `release`, and hops judged against it. */
export const judge = (items: Item[], release: string | null, releases: Release[] = []): { items: Item[], hops: Hop[] } => {
  const judged = items.map((item) => ({
    ...item,
    warnings: computeWarnings(item, release, releases),
  }));
  return {
    items: judged,
    hops: computeHops(judged, release),
  };
};
