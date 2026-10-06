// Runtime constants for the snapshot contract. Types in shared/types/snapshot.ts derive from these.

/** Env branches in display order: trunk first, then the UK line. */
export const BRANCHES = ['develop', 'staging', 'main', 'demo', 'main-uk', 'demo-uk'] as const

/** Forward hops in topology order. */
export const HOPS = [
  { from: 'develop', to: 'staging' },
  { from: 'staging', to: 'main' },
  { from: 'main', to: 'demo' },
  { from: 'main', to: 'main-uk' },
  { from: 'main-uk', to: 'demo-uk' },
] as const

export const PRESENCES = ['merged', 'picked', 'partial', 'none'] as const
export const STATUS_CATEGORIES = ['new', 'indeterminate', 'done'] as const
export const VERDICTS = ['in-sync', 'clean', 'cherry-pick', 'sync'] as const
export const WARNINGS = ['not-on-develop', 'done-no-fixversion', 'invalid-key', 'untracked'] as const
