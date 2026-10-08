// Hop verdicts and item warnings for a selected release (docs/architecture.md "Verdict rules"). Pure, so the snapshot
// script precomputes them for the current release and the app recomputes them when another release is picked.
import type { Branch, Hop, Item, Presence, Release, RepoId, Warning } from '../types/snapshot.ts';
import { REPOS, ROLLING_VERSIONS } from './snapshot.ts';

/** Release hops ask "is a whole-branch merge safe?"; the rest only report pending syncs. */
const RELEASE_HOPS: Record<string, Hop['verdict']> = {
  'develop→staging': 'not-safe',
  'staging→main': 'hold-back',
};

/** How much of an item's work a branch holds. `partial` is less than all of it; `picked` counts as all. */
const RANK: Record<Presence, number> = {
  none: 0,
  partial: 1,
  merged: 2,
  picked: 2,
};

const rankOn = (item: Item, repo: RepoId, branch: Branch) => RANK[item.presence[repo]?.[branch] ?? 'none'];

/**
 * The status the team sets once work is merged to main. Matched by name because Done and Released share Jira's `done`
 * category. Ignores numbering and case: 'RELEASED', '(9) Released'; not 'READY TO RELEASE'.
 */
const RELEASED_STATUS = /\breleased\b/i;

const inRelease = (item: Item, release: string | null) => !!item.jira?.fixVersions
  .some((v) => v === release || ROLLING_VERSIONS.includes(v));

/** Wanted in the release: in it (or a rolling version) and Done, i.e. passed QA on develop. */
export const isWanted = (item: Item, release: string | null) => item.kind === 'ticket'
  && inRelease(item, release)
  && item.jira?.statusCategory === 'done';

/** Every repo the item has work in holds all of it on `branch`. */
const fullyOn = (item: Item, branch: Branch) => {
  const repos = Object.keys(item.presence) as RepoId[];
  return repos.length > 0 && repos.every((repo) => rankOn(item, repo, branch) === 2);
};

/** Only a follow-up PR is missing on `to`: the ticket is already there, so it never decides a merge. */
const followUpOnly = (item: Item, repo: RepoId, to: Branch) => item.presence[repo]?.[to] === 'partial';

export const computeHops = (items: Item[], release: string | null): Hop[] => REPOS.flatMap((repo) => repo.hops.map(
  ([from, to]): Hop => {
    // Exempt work (infra, tooling, not-live backend) rides the branches freely.
    const inRepo = items.filter((i) => i.presence[repo.id] && !i.exempt);
    // Ahead: `from` holds more of the item's work than `to`. Two partials can't be compared, so they're not ahead.
    const ahead = inRepo.filter((i) => rankOn(i, repo.id, from) > rankOn(i, repo.id, to));
    const backSyncIds = inRepo.filter((i) => rankOn(i, repo.id, to) > rankOn(i, repo.id, from)).map((i) => i.id);
    const notReady = RELEASE_HOPS[`${from}→${to}`];
    const deciding = notReady ? ahead.filter((i) => !followUpOnly(i, repo.id, to) && i.kind !== 'dependency') : [];
    const bringUpIds = deciding.filter((i) => isWanted(i, release)).map((i) => i.id);
    const blockingIds = deciding.filter((i) => !isWanted(i, release)).map((i) => i.id);
    const verdict: Hop['verdict'] = !ahead.length
      ? 'in-sync'
      : !notReady ? 'sync' : blockingIds.length ? notReady : 'safe';
    return {
      repo: repo.id,
      from,
      to,
      verdict,
      aheadIds: ahead.map((i) => i.id),
      bringUpIds,
      blockingIds,
      backSyncIds,
    };
  },
));

/**
 * The release to judge against: the earliest unreleased version that hasn't already shipped. A version has shipped
 * (whatever Jira says) when most of its tickets with code are fully on main. Not all of them: a release usually leaves a
 * straggler or two behind (27.3.0 shipped on 1 Oct without DEV-1159), and those get `missed-release`.
 * ponytail: majority vote; a release with one big early hotfix and little else could trip it. Use release-merge dates
 * (staging→main PRs) if that happens.
 */
export const pickCurrentRelease = (
  items: Item[],
  releases: Release[],
): { current: string | null, shippedUnmarked: string[] } => {
  const shippedUnmarked: string[] = [];
  for (const r of releases) {
    if (r.released || ROLLING_VERSIONS.includes(r.name)) continue;
    const withCode = items.filter((i) => !i.exempt && i.jira?.fixVersions.includes(r.name) && Object.keys(i.presence).length);
    if (withCode.length && withCode.filter((i) => fullyOn(i, 'main')).length * 2 > withCode.length) {
      shippedUnmarked.push(r.name);
      continue;
    }
    return {
      current: r.name,
      shippedUnmarked,
    };
  }
  return {
    current: null,
    shippedUnmarked,
  };
};

export const computeWarnings = (
  item: Item,
  release: string | null,
  releases: Release[] = [],
  shippedUnmarked: string[] = [],
): Warning[] => {
  const warnings: Warning[] = [];
  const add = (w: Warning, when: unknown) => when && warnings.push(w);
  const repos = Object.keys(item.presence) as RepoId[];
  if (!item.exempt) {
    const shipped = new Set([...releases.filter((r) => r.released).map((r) => r.name), ...shippedUnmarked]);
    const versions = item.jira?.fixVersions.filter((v) => !ROLLING_VERSIONS.includes(v)) ?? [];
    const aheadOnStaging = repos.some((r) => rankOn(item, r, 'staging') > rankOn(item, r, 'main'));
    const releaseWork = item.kind !== 'dependency' && aheadOnStaging && !!release;
    // On staging ahead of main: outside the release must not go to main; inside it but not Done skipped QA on dev.
    add('extra-on-staging', releaseWork && !inRelease(item, release));
    // Release work on staging, or any ticket work on main, that hasn't passed QA on develop.
    const onMain = repos.some((r) => rankOn(item, r, 'main') > 0);
    const untested = item.kind === 'ticket' && item.jira?.statusCategory !== 'done';
    add('not-tested', untested && ((releaseWork && inRelease(item, release)) || onMain));
    add('not-on-develop', release && item.jira?.fixVersions.includes(release) && !fullyOn(item, 'develop'));
    // Every version it's in has shipped, yet it isn't on main: it missed its release, or its fixVersion is stale.
    add('missed-release', versions.length && versions.every((v) => shipped.has(v)) && !fullyOn(item, 'main'));
    // Jira's lifecycle (Released once on main) disagrees with where the code is.
    add('status-mismatch', item.jira && repos.length && RELEASED_STATUS.test(item.jira.status) !== fullyOn(item, 'main'));
    add('follow-up', repos.some((r) => Object.values(item.presence[r] ?? {}).includes('partial')));
    // The fixVersion is set when a ticket moves to Done. Done without one can't be wanted by any release; once the work
    // is fully on main it no longer affects a decision, so it's left alone.
    add('needs-fixversion', item.kind === 'ticket' && item.jira?.statusCategory === 'done' && !item.jira.fixVersions.length
      && repos.length && !fullyOn(item, 'main'));
  }
  add('convention', item.conventionIssues?.length);
  add('invalid-key', item.invalidKey);
  add('untracked', item.kind === 'untracked');
  return warnings;
};

/** Items with warnings for `release`, and hops judged against it. */
export const judge = (
  items: Item[],
  release: string | null,
  releases: Release[] = [],
  shippedUnmarked: string[] = [],
): { items: Item[], hops: Hop[] } => {
  const judged = items.map((item) => ({
    ...item,
    warnings: computeWarnings(item, release, releases, shippedUnmarked),
  }));
  return {
    items: judged,
    hops: computeHops(judged, release),
  };
};
