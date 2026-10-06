// Runtime constants for the snapshot contract. Types in shared/types/snapshot.ts derive from these.

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
export const VERDICTS = ['in-sync', 'clean', 'cherry-pick', 'sync'] as const;
export const WARNINGS = ['not-on-develop', 'missed-release', 'done-no-fixversion', 'invalid-key', 'untracked'] as const;
