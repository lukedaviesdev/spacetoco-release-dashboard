// Runtime constants for the snapshot contract. Types in shared/types/snapshot.ts derive from these.

/** Tickets whose PRs only change these paths don't ride the release branches. First match wins per file. */
export const EXEMPT_PATHS = [
  {
    prefix: 'deployments/',
    exempt: 'released-on-develop',
  },
  {
    prefix: 'packages/backend/',
    exempt: 'not-live',
  },
  {
    prefix: 'packages/testing/',
    exempt: 'never-ships',
  },
  {
    prefix: '.github/',
    exempt: 'never-ships',
  },
  {
    prefix: '.cursor/',
    exempt: 'never-ships',
  },
] as const;
/** When a ticket's files span several exempt groups, the first in this list wins. */
export const EXEMPT_ORDER = ['released-on-develop', 'not-live', 'never-ships'] as const;

/**
 * Repos the dashboard tracks. Both share Jira projects and fixVersions, so a ticket can have work in either or both.
 * `branches` are in display order; `hops` are the forward merges in topology order.
 */
export const REPOS = [
  {
    id: 'app',
    name: 'spacetoco-app',
    github: 'spacetoco/spacetoco-app',
    branches: ['develop', 'staging', 'main', 'demo', 'main-uk', 'demo-uk'],
    exemptPaths: EXEMPT_PATHS,
    hops: [
      ['develop', 'staging'],
      ['staging', 'main'],
      ['main', 'demo'],
      ['main', 'main-uk'],
      ['main-uk', 'demo-uk'],
    ],
  },
  {
    id: 'api',
    name: 'spacetoco-api',
    github: 'spacetoco/spacetoco-api',
    branches: ['develop', 'staging', 'main'],
    exemptPaths: [],
    hops: [
      ['develop', 'staging'],
      ['staging', 'main'],
    ],
  },
] as const;

/**
 * Jira versions that never ship on their own: a Done ticket in one goes out with whichever release is next.
 * Never picked as the current release.
 */
export const ROLLING_VERSIONS = ['Rolling Hotfixes'];

export const PRESENCES = ['merged', 'picked', 'partial', 'none'] as const;
export const STATUS_CATEGORIES = ['new', 'indeterminate', 'done'] as const;
export const VERDICTS = ['in-sync', 'safe', 'not-safe', 'hold-back', 'sync'] as const;
export const WARNINGS = [
  'extra-on-staging',
  'not-tested',
  'not-on-develop',
  'missed-release',
  'status-mismatch',
  'follow-up',
  'convention',
  'needs-fixversion',
  'invalid-key',
  'untracked',
] as const;


