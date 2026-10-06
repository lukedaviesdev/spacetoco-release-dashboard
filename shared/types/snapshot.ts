import type { EXEMPT_ORDER, PRESENCES, REPOS, STATUS_CATEGORIES, VERDICTS, WARNINGS } from '../utils/snapshot';

export type RepoId = typeof REPOS[number]['id'];
/** Any env branch in any repo. */
export type Branch = typeof REPOS[number]['branches'][number];
export type Presence = typeof PRESENCES[number];
export type StatusCategory = typeof STATUS_CATEGORIES[number];
export type Verdict = typeof VERDICTS[number];
export type Warning = typeof WARNINGS[number];
/** Why a ticket is off the release path. */
export type Exempt = typeof EXEMPT_ORDER[number];

/** Presence on each of one repo's branches. */
export type RepoPresence = Partial<Record<Branch, Presence>>;

export interface Release {
  name: string
  released: boolean
  releaseDate?: string
}

export interface PullRequest {
  repo: RepoId
  number: number
  headRef: string
  /** Branch the PR merged into. */
  base: Branch
  title?: string
  author?: string
  mergedAt?: string
  /** Branches this PR's merge commit is on (and not reverted). */
  on?: Branch[]
  /** Branches where this PR was merged and then reverted. */
  revertedOn?: Branch[]
}

export interface JiraInfo {
  status: string
  statusCategory: StatusCategory
  fixVersions: string[]
  sprint?: string
  assignee?: string
}

export interface Item {
  /** Ticket key ('DEV-1314'), or '<repo>-pr-<number>' / '<repo>-commit-<sha7>' for untracked work. */
  id: string
  /** 'dependency' = dependabot bumps: shown, never blocking. */
  kind: 'ticket' | 'untracked' | 'dependency'
  title: string
  jira?: JiraInfo
  invalidKey?: boolean
  prs: PullRequest[]
  /** Only repos with work for this item; empty for a ticket not merged anywhere yet. */
  presence: Partial<Record<RepoId, RepoPresence>>
  /** Some PR merged straight into a branch other than develop. */
  hotfix: boolean
  /** Off the release path: every PR only changes exempt paths. */
  exempt?: Exempt
  /** Branch-convention breaks across the item's PRs, as readable reasons. */
  conventionIssues?: string[]
  warnings: Warning[]
}

export interface Hop {
  repo: RepoId
  from: Branch
  to: Branch
  verdict: Verdict
  /** On `from`, missing on `to`. */
  aheadIds: string[]
  /** Release hops: wanted and ahead, so they need to go up. */
  bringUpIds: string[]
  /** Release hops: ahead but not wanted. develop→staging: would wrongly come along; staging→main: hold back. */
  blockingIds: string[]
  /** On `to`, missing on `from`. */
  backSyncIds: string[]
}

export interface Snapshot {
  /** ISO timestamp. */
  generatedAt: string
  /** Short SHAs of each repo's branch heads. */
  heads: Partial<Record<RepoId, RepoHeads>>
  releases: Release[]
  currentRelease: string | null
  items: Item[]
  hops: Hop[]
}

export type RepoHeads = Partial<Record<Branch, string>>;
