import { execFileSync } from 'node:child_process';
import type { Branch, Item, Presence, PullRequest } from '../../shared/types/snapshot.ts';
import { BRANCHES } from '../../shared/utils/snapshot.ts';

export const DEFAULT_PROJECTS = ['DEV', 'BUG'];

// ---------- pure helpers ----------

/** First ticket key in `text` for the given Jira projects, upper-cased. 'cursor/dev-1113-x' → 'DEV-1113'. */
export function extractKey(text: string, projects = DEFAULT_PROJECTS): string | undefined {
  const match = text.match(new RegExp(`(?:^|[^A-Za-z])(${projects.join('|')})-(\\d+)`, 'i'));
  return match ? `${match[1]!.toUpperCase()}-${match[2]}` : undefined;
}

/** 'Merge pull request #1162 from spacetoco/DEV-1314-x' → { number: 1162, headRef: 'DEV-1314-x' }. */
export function parsePrMerge(subject: string): { number: number, headRef: string } | undefined {
  const match = subject.match(/^Merge pull request #(\d+) from [^/\s]+\/(\S+)/);
  return match ? {
    number: Number(match[1]),
    headRef: match[2]!,
  } : undefined;
}

/** Combine per-commit presence on one branch into the item's presence. */
export function combinePresence(commits: ('merged' | 'picked' | 'missing')[]): Presence {
  const missing = commits.filter(c => c === 'missing').length;
  if (missing === commits.length) return 'none';
  if (missing) return 'partial';
  return commits.includes('picked') ? 'picked' : 'merged';
}

/** 'DEV-1314-Cannot-book-a-space' → 'Cannot book a space'. Placeholder title until Jira/GitHub enrichment. */
export function titleFromRef(headRef: string): string {
  return headRef.replace(/^[^/]*\//, '').replace(/^[A-Z]+-\d+-?/i, '').replace(/[-_]+/g, ' ').trim() || headRef;
}

// ---------- git ----------

export interface GitOptions {
  repo: string
  /** Ref prefix for env branches, e.g. 'origin/'. */
  remote?: string
  projects?: string[]
}

export interface GitSnapshot {
  heads: Record<Branch, string>
  items: Item[]
}

const SEP = '\x1F';

export function readGit({ repo, remote = 'origin/', projects = DEFAULT_PROJECTS }: GitOptions): GitSnapshot {
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
  const lines = (...args: string[]) => git(...args).split('\n').filter(Boolean);
  const refs = BRANCHES.map(b => remote + b);

  const heads = Object.fromEntries(
    BRANCHES.map((b, i) => [b, git('rev-parse', '--short', refs[i]!)]),
  ) as Record<Branch, string>;

  // Window: reachable from some env branch but not from all of them.
  const notInAll = lines('merge-base', '--octopus', '--all', ...refs).map(sha => `^${sha}`);
  const window = [...refs, ...notInAll];

  // Non-merge commits in the window with their subjects, oldest first.
  const subjects = new Map<string, string>();
  for (const line of lines('log', '--no-merges', '--reverse', '--date-order', `--format=%H${SEP}%s`, ...window)) {
    const [sha, subject] = line.split(SEP);
    subjects.set(sha!, subject!);
  }

  // Which window commits each branch contains by ancestry.
  const reachable = new Map<Branch, Set<string>>();
  for (const [i, b] of BRANCHES.entries()) reachable.set(b, new Set(lines('rev-list', '--no-merges', refs[i]!, ...notInAll)));

  // Patch-ids, to spot cherry-picks. Subjects are a fallback for picks whose diff changed in conflict resolution.
  const patchIdOf = new Map<string, string>();
  if (subjects.size) {
    const patches = execFileSync(
      'git',
      ['-C', repo, 'log', '--no-merges', '-p', '--format=commit %H', ...window],
      { maxBuffer: 1024 * 1024 * 1024 },
    );
    const ids = execFileSync('git', ['-C', repo, 'patch-id', '--stable'], {
      input: patches,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    for (const line of ids.split('\n').filter(Boolean)) {
      const [patchId, sha] = line.split(' ');
      patchIdOf.set(sha!, patchId!);
    }
  }

  // Group copies of the same change: same patch-id, or same keyed subject (a pick whose diff changed in conflict
  // resolution). Generic subjects ("fix lint") are not used, they would join unrelated commits.
  const changeOf = new Map<string, string>();
  const changeBy = new Map<string, string>();
  for (const [sha, subject] of subjects) {
    const keys = [patchIdOf.get(sha), extractKey(subject, projects) && `subject:${subject}`].filter(Boolean) as string[];
    const change = keys.map(k => changeBy.get(k)).find(Boolean) ?? sha;
    changeOf.set(sha, change);
    for (const k of keys) if (!changeBy.has(k)) changeBy.set(k, change);
  }
  const copies = new Map<string, string[]>();
  for (const [sha, change] of changeOf) copies.set(change, [...(copies.get(change) ?? []), sha]);

  // The env branch a merge landed on: the most upstream branch whose first-parent chain contains it.
  const landedOn = new Map<string, Branch>();
  for (const [i, b] of BRANCHES.entries()) {
    for (const sha of lines('rev-list', '--first-parent', '--merges', refs[i]!, ...notInAll)) {
      if (!landedOn.has(sha)) landedOn.set(sha, b);
    }
  }

  // PR merges in the window, oldest first. Merges whose head is an env branch (release/sync PRs) carry other PRs' commits, so skip them.
  const prOfCommit = new Map<string, PullRequest[]>();
  for (const line of lines('log', '--merges', '--reverse', `--format=%H${SEP}%cI${SEP}%s`, ...window)) {
    const [sha, date, subject] = line.split(SEP);
    const pr = parsePrMerge(subject!);
    if (!pr || (BRANCHES as readonly string[]).includes(pr.headRef)) continue;
    const base = landedOn.get(sha!);
    if (!base) continue;
    const entry: PullRequest = {
      ...pr,
      base,
      mergedAt: date,
    };
    for (const commit of lines('rev-list', '--no-merges', `${sha}^1..${sha}^2`)) {
      if (!subjects.has(commit)) continue;
      const prs = prOfCommit.get(commit) ?? [];
      if (!prs.some(p => p.number === pr.number)) prs.push(entry);
      prOfCommit.set(commit, prs);
    }
  }

  // Group commits into items: keyed PR head ref → subject key → oldest PR → the bare commit.
  const groups = new Map<string, { kind: Item['kind'], title: string, commits: Set<string>, prs: Map<number, PullRequest> }>();
  const addTo = (id: string, kind: Item['kind'], title: string, commit: string, prs: PullRequest[]) => {
    const group = groups.get(id) ?? {
      kind,
      title,
      commits: new Set(),
      prs: new Map(),
    };
    group.commits.add(commit);
    for (const pr of prs) group.prs.set(pr.number, pr);
    groups.set(id, group);
  };
  for (const [commit, subject] of subjects) {
    const prs = prOfCommit.get(commit) ?? [];
    const keyed = prs.filter(pr => extractKey(pr.headRef, projects));
    if (keyed.length) {
      for (const pr of keyed) addTo(extractKey(pr.headRef, projects)!, 'ticket', titleFromRef(pr.headRef), commit, [pr]);
      continue;
    }
    const key = extractKey(subject, projects);
    if (key) addTo(key, 'ticket', subject.replace(/^\[[^\]]*\]\s*/, ''), commit, prs);
    else if (prs[0]) addTo(`pr-${prs[0].number}`, 'untracked', prs[0].headRef, commit, [prs[0]]);
    else addTo(`commit-${commit.slice(0, 7)}`, 'untracked', subject, commit, []);
  }

  // A change is 'merged' on a branch holding its original (the oldest copy that came through a PR, else the
  // oldest copy), 'picked' if the branch only holds another copy.
  const originalOf = (change: string) => {
    const all = copies.get(change)!;
    return all.find(sha => prOfCommit.has(sha)) ?? all[0]!;
  };
  const presenceOf = (change: string, b: Branch): 'merged' | 'picked' | 'missing' => {
    const on = reachable.get(b)!;
    if (on.has(originalOf(change))) return 'merged';
    return copies.get(change)!.some(sha => on.has(sha)) ? 'picked' : 'missing';
  };

  // ponytail: presence only counts window commits; an item's commits already on every branch are ignored.
  const items: Item[] = [...groups].map(([id, g]) => {
    const prs = [...g.prs.values()];
    const changes = [...new Set([...g.commits].map(c => changeOf.get(c)!))];
    return {
      id,
      kind: g.kind,
      title: g.title,
      prs,
      presence: Object.fromEntries(
        BRANCHES.map((b) => [b, combinePresence(changes.map((c) => presenceOf(c, b)))]),
      ) as Record<Branch, Presence>,
      hotfix: prs.some(pr => pr.base !== 'develop'),
      warnings: g.kind === 'untracked' ? ['untracked'] : [],
    };
  });

  return {
    heads,
    items,
  };
}
