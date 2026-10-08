// PR-based engine (docs/architecture.md "Engine rules"). scanRepo does all the git work; buildItems turns a scan plus
// GitHub PR details into dashboard items without any I/O, so every rule is testable on a scripted repo.
import { execFileSync } from 'node:child_process';
import type { Branch, Exempt, Item, Presence, PullRequest, RepoHeads, RepoId, RepoPresence } from '../../shared/types/snapshot.ts';
import { EXEMPT_ORDER, REPOS } from '../../shared/utils/snapshot.ts';

export const DEFAULT_PROJECTS = ['DEV', 'BUG'];

/** PRs into different bases within this window are twins: the same change made once per branch. */
const TWIN_MS = 24 * 3600 * 1000;

// ---------- pure helpers ----------

const keyPattern = (projects: string[]) => new RegExp(`(?:^|[^A-Za-z])(${projects.join('|')})-(\\d+)`, 'gi');

/** Every ticket key in `text`, upper-cased, in order. 'cursor/dev-1113-x' → ['DEV-1113']. */
export function extractKeys(text: string, projects = DEFAULT_PROJECTS): string[] {
  return [...new Set([...text.matchAll(keyPattern(projects))].map((m) => `${m[1]!.toUpperCase()}-${m[2]}`))];
}

/** First ticket key in `text`. */
export function extractKey(text: string, projects = DEFAULT_PROJECTS): string | undefined {
  return extractKeys(text, projects)[0];
}

/** 'Merge pull request #1162 from spacetoco/DEV-1314-x' → { number: 1162, headRef: 'DEV-1314-x' }. */
export function parsePrMerge(subject: string): { number: number, headRef: string } | undefined {
  const match = subject.match(/^Merge pull request #(\d+) from [^/\s]+\/(\S+)/);
  return match ? {
    number: Number(match[1]),
    headRef: match[2]!,
  } : undefined;
}

/** Presence of two items' work combined, e.g. the same ticket found in both repos. */
export function mergePresence(a: Presence, b: Presence): Presence {
  if (a === 'none' && b === 'none') return 'none';
  if (a === 'none' || b === 'none' || a === 'partial' || b === 'partial') return 'partial';
  return a === 'merged' && b === 'merged' ? 'merged' : 'picked';
}

/** Two items for the same id combined (the same ticket in both repos). Presence merges per repo and branch. */
export function mergeItems(a: Item, b: Item): Item {
  const presence = { ...a.presence };
  for (const [repo, branches] of Object.entries(b.presence) as [RepoId, RepoPresence][]) {
    const mine = presence[repo];
    presence[repo] = mine
      ? Object.fromEntries(Object.entries(branches).map(([branch, p]) => [branch, mergePresence(mine[branch as Branch]!, p)]))
      : branches;
  }
  const issues = [...new Set([...a.conventionIssues ?? [], ...b.conventionIssues ?? []])];
  // Exempt only if both repos' work is exempt.
  const exempt = a.exempt && b.exempt ? EXEMPT_ORDER.find((e) => e === a.exempt || e === b.exempt) : undefined;
  const { exempt: _a, conventionIssues: _b, ...rest } = a;
  return {
    ...rest,
    prs: [...a.prs, ...b.prs.filter((pr) => !a.prs.some((p) => p.repo === pr.repo && p.number === pr.number))],
    presence,
    hotfix: a.hotfix || b.hotfix,
    ...(exempt && { exempt }),
    ...(issues.length && { conventionIssues: issues }),
  };
}

/**
 * Tickets with no work in a repo's scope whose key is in that repo's shipped history are fully released there:
 * merged on all its branches (Jira-only tickets, or tickets still open in the other repo).
 */
export function addSyncedPresence(items: Item[], syncedKeys: Partial<Record<RepoId, string[]>>): Item[] {
  return items.map((item) => {
    if (item.kind !== 'ticket') return item;
    const add = REPOS.filter((r) => !item.presence[r.id] && syncedKeys[r.id]?.includes(item.id));
    if (!add.length) return item;
    return {
      ...item,
      presence: {
        ...item.presence,
        ...Object.fromEntries(add.map((r) => [r.id, Object.fromEntries(r.branches.map((b) => [b, 'merged']))])),
      },
    };
  });
}

/** 'DEV-1314-Cannot-book-a-space' → 'Cannot book a space'. Placeholder title until Jira/GitHub enrichment. */
export function titleFromRef(headRef: string): string {
  return headRef.replace(/^[^/]*\//, '').replace(/^[A-Z]+-\d+-?/i, '').replace(/[-_]+/g, ' ').trim() || headRef;
}

export type PrKind = 'env' | 'carrier' | 'conflict' | 'revert-chore' | 'dependency' | 'ticket' | 'untracked';

/** PR kind from its head branch (docs/architecture.md "PR kinds"). Ticket vs untracked depends on keys. */
export function prKind(head: string, envBranches: readonly string[], hasKeys: boolean): PrKind {
  if (envBranches.includes(head)) return 'env';
  if (/^(release\/|mini-release|sync\/|chore\/cherry-pick)/i.test(head)) return 'carrier';
  if (/conflict/i.test(head)) return 'conflict';
  if (/^(revert-|chore\/pull-)/i.test(head)) return 'revert-chore';
  if (/^dependabot\//i.test(head)) return 'dependency';
  return hasKeys ? 'ticket' : 'untracked';
}

/** Readable reasons a PR breaks the branch convention; empty when it follows it. */
export function conventionIssues(
  pr: { head: string, title?: string, number: number },
  kind: PrKind,
  projects = DEFAULT_PROJECTS,
): string[] {
  const issues: string[] = [];
  const ref = `#${pr.number} \`${pr.head}\``;
  const headKeys = extractKeys(pr.head, projects);
  if (kind === 'untracked') issues.push(`${ref}: branch has no ticket key (use <KEY>-<slug>, or release/, sync/, chore/)`);
  if (kind === 'ticket' && !new RegExp(`^(${projects.join('|')})-\\d+-[a-z0-9]`, 'i').test(pr.head)) {
    issues.push(`${ref}: branch should start <KEY>-<slug>`);
  }
  if (kind === 'ticket' && pr.title !== undefined) {
    const titleKey = pr.title.match(/^\s*\[([A-Z]+-\d+)\]/i)?.[1]?.toUpperCase();
    if (!titleKey) issues.push(`${ref}: title should start [<KEY>]`);
    else if (headKeys.length && !headKeys.includes(titleKey)) {
      issues.push(`${ref}: title key ${titleKey} ≠ branch key ${headKeys.join(', ')}`);
    }
  }
  return issues;
}

/** Root manifests and lockfiles change alongside any work, so they don't decide whether it rides the release path. */
const NEUTRAL_FILES = new Set(['package.json', 'pnpm-lock.yaml']);

/** Which exempt group a file belongs to, if any. */
const exemptOf = (file: string, exemptPaths: readonly { prefix: string, exempt: Exempt }[]) => exemptPaths
  .find((e) => file.startsWith(e.prefix))?.exempt;

// ---------- scan (git) ----------

export interface ScannedPr {
  number: number;
  head: string;
  mergeSha: string;
  mergedAt: string;
  /** Most upstream env branch whose first-parent chain holds the merge. */
  landedOn?: Branch;
  /** Non-merge commits the PR brought in. */
  commits: string[];
  files: string[];
  /** Branches holding the merge commit and not reverting it. */
  on: Branch[];
  revertedOn: Branch[];
}

export interface ScannedCommit {
  sha: string;
  subject: string;
  date: string;
  /** Branches holding this commit, minus those where it (or its PR) was reverted. */
  on: Branch[];
  /** A revert commit: never counts as a copy of the work it names. */
  revert?: boolean;
}

export interface RepoScan {
  repo: RepoId;
  heads: RepoHeads;
  /** Ticket keys in history every branch shares (shipped). */
  syncedKeys: string[];
  prs: ScannedPr[];
  /** Non-merge commits in scope, for work that reached a branch without its PR (cherry-picks, carriers, pushes). */
  commits: ScannedCommit[];
}

export interface ScanOptions {
  path: string;
  repo: RepoId;
  /** Ref prefix for env branches, e.g. 'origin/'. */
  remote?: string;
  projects?: string[];
}

const SEP = '\x1F';
const REC = '\x1E';

export function scanRepo({ path, repo, remote = 'origin/', projects = DEFAULT_PROJECTS }: ScanOptions): RepoScan {
  const branches: readonly Branch[] = REPOS.find((r) => r.id === repo)!.branches;
  const git = (...args: string[]) => execFileSync('git', ['-C', path, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
  const lines = (...args: string[]) => git(...args).split('\n').filter(Boolean);
  const refs = branches.map((b) => remote + b);

  const heads = Object.fromEntries(branches.map((b, i) => [b, git('rev-parse', '--short', refs[i]!)])) as RepoHeads;

  // Scope: on some env branch but not on all of them.
  const bases = lines('merge-base', '--octopus', '--all', ...refs);
  const notInAll = bases.map((sha) => `^${sha}`);
  const scope = [...refs, ...notInAll];

  // ponytail: scans all shared history's subjects (~0.2s on spacetoco-app); bound it with --since if it grows slow.
  const syncedKeys = [...new Set(lines('log', '--format=%s', ...bases).flatMap((s) => extractKeys(s, projects)))];

  // Every in-scope commit each branch holds (merges included).
  const holds = new Map<Branch, Set<string>>(branches.map((b, i) => [b, new Set(lines('rev-list', refs[i]!, ...notInAll))]));

  // The env branch a merge landed on: the most upstream branch whose first-parent chain contains it.
  const landedOn = new Map<string, Branch>();
  for (const [i, b] of branches.entries()) {
    for (const sha of lines('rev-list', '--first-parent', '--merges', refs[i]!, ...notInAll)) {
      if (!landedOn.has(sha)) landedOn.set(sha, b);
    }
  }

  // Reverts: 'This reverts commit <sha>' in any in-scope commit. A revert that is itself reverted on a branch is inactive.
  const revertsOf = new Map<string, string>(); // revert commit → reverted commit
  for (const record of git('log', `--format=%H${SEP}%B${REC}`, ...scope).split(REC)) {
    const [sha, body] = record.trim().split(SEP);
    const target = body?.match(/This reverts commit ([0-9a-f]{7,40})/)?.[1];
    if (sha && target) revertsOf.set(sha, git('rev-parse', target));
  }
  const revertedOnBranch = (target: string, b: Branch, depth = 0): boolean => [...revertsOf]
    .some(([revert, t]) => t === target && holds.get(b)!.has(revert) && (depth > 5 || !revertedOnBranch(revert, b, depth + 1)));

  const prs: ScannedPr[] = [];
  for (const line of lines('log', '--merges', '--reverse', `--format=%H${SEP}%cI${SEP}%s`, ...scope)) {
    const [sha, date, subject] = line.split(SEP) as [string, string, string];
    const pr = parsePrMerge(subject);
    if (!pr) continue;
    const commits = lines('rev-list', '--no-merges', `${sha}^1..${sha}^2`);
    const reverted = (b: Branch) => revertedOnBranch(sha, b) || commits.some((c) => revertedOnBranch(c, b));
    const revertedOn = branches.filter((b) => holds.get(b)!.has(sha) && reverted(b));
    prs.push({
      number: pr.number,
      head: pr.headRef,
      mergeSha: sha,
      mergedAt: date,
      landedOn: landedOn.get(sha),
      commits,
      files: lines('diff', '--name-only', `${sha}^1`, sha),
      on: branches.filter((b) => holds.get(b)!.has(sha) && !revertedOn.includes(b)),
      revertedOn,
    });
  }

  const revertedWithPr = new Map<string, Branch[]>();
  for (const pr of prs) for (const c of pr.commits) revertedWithPr.set(c, [...revertedWithPr.get(c) ?? [], ...pr.revertedOn]);
  const commits: ScannedCommit[] = lines('log', '--no-merges', `--format=%H${SEP}%cI${SEP}%s`, ...scope).map((line) => {
    const [sha, date, subject] = line.split(SEP) as [string, string, string];
    return {
      sha,
      subject,
      date,
      on: branches.filter((b) => holds.get(b)!.has(sha) && !revertedWithPr.get(sha)?.includes(b) && !revertedOnBranch(sha, b)),
      ...(revertsOf.has(sha) && { revert: true }),
    };
  });

  return {
    repo,
    heads,
    syncedKeys,
    prs,
    commits,
  };
}

// ---------- build (pure) ----------

export interface PrDetail {
  title?: string;
  author?: string;
  /** GitHub's base branch, when known; otherwise where the merge landed. */
  base?: string;
}

interface Classified {
  pr: ScannedPr;
  kind: PrKind;
  keys: string[];
  entry: PullRequest;
}

const presenceRow = (branches: readonly Branch[], on: Branch[]) => Object.fromEntries(
  branches.map((b) => [b, on.includes(b) ? 'merged' : 'none']),
) as RepoPresence;

export function buildItems(scan: RepoScan, details: Map<number, PrDetail>, projects = DEFAULT_PROJECTS): Item[] {
  const repoDef = REPOS.find((r) => r.id === scan.repo)!;
  const branches: readonly Branch[] = repoDef.branches;
  const synced = new Set(scan.syncedKeys);
  const time = (iso: string) => Date.parse(iso);
  const subjectOf = new Map(scan.commits.map((c) => [c.sha, c.subject]));

  const classified: Classified[] = scan.prs.map((pr) => {
    const detail = details.get(pr.number);
    let keys = [...new Set([...extractKeys(detail?.title ?? '', projects), ...extractKeys(pr.head, projects)])];
    let kind = prKind(pr.head, branches, keys.length > 0);
    // A PR with no key in title or branch still belongs to the tickets its commit messages name.
    const subjectKeys = [...new Set(pr.commits.flatMap((c) => extractKeys(subjectOf.get(c) ?? '', projects)))];
    if (kind === 'untracked' && subjectKeys.length) {
      keys = subjectKeys;
      kind = 'ticket';
    }
    const githubBase = (branches as readonly string[]).includes(detail?.base ?? '') ? detail!.base as Branch : undefined;
    const base = githubBase ?? pr.landedOn ?? 'develop';
    return {
      pr,
      kind,
      keys,
      entry: {
        repo: scan.repo,
        number: pr.number,
        headRef: pr.head,
        base,
        mergedAt: pr.mergedAt,
        on: pr.on,
        ...(pr.revertedOn.length && { revertedOn: pr.revertedOn }),
        ...(detail?.title && { title: detail.title }),
        ...(detail?.author && { author: detail.author }),
      },
    };
  });

  const items: Item[] = [];
  const ticketPrs = classified.filter((c) => c.kind === 'ticket');
  const ticketCommits = new Set(ticketPrs.flatMap((c) => c.pr.commits));
  // Commits that reached branches outside their ticket's own PRs: cherry-picks, carrier branches, direct pushes.
  const copies = scan.commits.filter((c) => !ticketCommits.has(c.sha) && !c.revert);
  const keys = new Set([...ticketPrs.flatMap((c) => c.keys), ...copies.flatMap((c) => extractKeys(c.subject, projects))]);

  for (const key of keys) {
    const own = ticketPrs.filter((c) => c.keys.includes(key));
    const keyCopies = copies.filter((c) => extractKeys(c.subject, projects).includes(key));
    const presence = Object.fromEntries(branches.map((b): [Branch, Presence] => {
      const here = own.filter((c) => c.pr.on.includes(b));
      if (!here.length && !synced.has(key)) return [b, keyCopies.some((c) => c.on.includes(b)) ? 'picked' : 'none'];
      // Follow-up: a later PR of this ticket, not a twin of one already here, that hasn't reached b.
      const arrived = synced.has(key) ? -Infinity : Math.min(...here.map((c) => time(c.pr.mergedAt)));
      const followUpMissing = own.some((c) => !c.pr.on.includes(b)
        && time(c.pr.mergedAt) > arrived + TWIN_MS
        && !here.some((h) => Math.abs(time(h.pr.mergedAt) - time(c.pr.mergedAt)) <= TWIN_MS));
      return [b, followUpMissing ? 'partial' : 'merged'];
    })) as RepoPresence;

    const files = own.flatMap((c) => c.pr.files).filter((f) => !NEUTRAL_FILES.has(f));
    const groups = files.map((f) => exemptOf(f, repoDef.exemptPaths));
    const exempt = own.length && files.length && groups.every(Boolean)
      ? EXEMPT_ORDER.find((e) => groups.includes(e))
      : undefined;
    const issues = own.flatMap((c) => conventionIssues({
      head: c.pr.head,
      title: c.entry.title,
      number: c.pr.number,
    }, c.kind, projects));
    const first = own[0];
    items.push({
      id: key,
      kind: 'ticket',
      title: first ? first.entry.title?.replace(/^\s*\[[^\]]*\]\s*/, '') || titleFromRef(first.pr.head)
        : keyCopies[0]!.subject.replace(/^\s*\[[^\]]*\]\s*/, ''),
      prs: own.map((c) => c.entry),
      presence: { [scan.repo]: presence },
      hotfix: own.some((c) => c.entry.base !== 'develop'),
      warnings: [],
      ...(exempt && { exempt }),
      ...(issues.length && { conventionIssues: issues }),
    });
  }

  // Untracked work and dependency bumps: one item per PR.
  for (const c of classified.filter((x) => x.kind === 'untracked' || x.kind === 'dependency')) {
    const issues = conventionIssues({
      head: c.pr.head,
      title: c.entry.title,
      number: c.pr.number,
    }, c.kind, projects);
    items.push({
      id: `${scan.repo}-pr-${c.pr.number}`,
      kind: c.kind === 'dependency' ? 'dependency' : 'untracked',
      title: c.entry.title ?? c.pr.head,
      prs: [c.entry],
      presence: { [scan.repo]: presenceRow(branches, c.pr.on) },
      hotfix: c.entry.base !== 'develop',
      warnings: [],
      ...(issues.length && { conventionIssues: issues }),
    });
  }

  // Commits pushed straight to a branch, with no PR and no ticket key: untracked, one item each.
  const prCommits = new Set(classified.flatMap((c) => c.pr.commits));
  const pushed = scan.commits
    .filter((x) => !prCommits.has(x.sha) && !x.revert && !extractKeys(x.subject, projects).length && x.on.length);
  for (const c of pushed) {
    items.push({
      id: `${scan.repo}-commit-${c.sha.slice(0, 7)}`,
      kind: 'untracked',
      title: c.subject,
      prs: [],
      presence: { [scan.repo]: presenceRow(branches, c.on) },
      hotfix: false,
      warnings: [],
    });
  }

  return items;
}
