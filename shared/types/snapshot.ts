import type { BRANCHES, PRESENCES, STATUS_CATEGORIES, VERDICTS, WARNINGS } from '../utils/snapshot'

export type Branch = typeof BRANCHES[number]
export type Presence = typeof PRESENCES[number]
export type StatusCategory = typeof STATUS_CATEGORIES[number]
export type Verdict = typeof VERDICTS[number]
export type Warning = typeof WARNINGS[number]

export interface Release {
  name: string
  released: boolean
  releaseDate?: string
}

export interface PullRequest {
  number: number
  headRef: string
  /** Branch the PR merged into. */
  base: Branch
  title?: string
  author?: string
  mergedAt?: string
}

export interface JiraInfo {
  status: string
  statusCategory: StatusCategory
  fixVersions: string[]
  sprint?: string
  assignee?: string
}

export interface Item {
  /** Ticket key ('DEV-1314') or 'pr-<number>' for untracked work. */
  id: string
  kind: 'ticket' | 'untracked'
  title: string
  jira?: JiraInfo
  invalidKey?: boolean
  prs: PullRequest[]
  presence: Record<Branch, Presence>
  /** Reached main outside a staging release. */
  hotfix: boolean
  warnings: Warning[]
}

export interface Hop {
  from: Branch
  to: Branch
  verdict: Verdict
  /** On `from`, missing on `to`. */
  aheadIds: string[]
  /** Subset of aheadIds causing 'cherry-pick'. */
  blockingIds: string[]
  /** On `to`, missing on `from`. */
  backSyncIds: string[]
}

export interface Snapshot {
  /** ISO timestamp. */
  generatedAt: string
  /** Short SHAs of each branch head. */
  heads: Record<Branch, string>
  releases: Release[]
  currentRelease: string | null
  items: Item[]
  hops: Hop[]
}
