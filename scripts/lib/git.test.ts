// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Item } from '../../shared/types/snapshot';
import { addSyncedPresence, combinePresence, extractKey, mergeItems, mergePresence, parsePrMerge, readGit, titleFromRef } from './git';

describe('pure helpers', () => {
  it('extracts ticket keys from branch names and subjects', () => {
    expect(extractKey('DEV-1314-Cannot-book')).toBe('DEV-1314');
    expect(extractKey('cursor/dev-1113-tasks-56f6')).toBe('DEV-1113');
    expect(extractKey('[BUG-554] 🐛 fix')).toBe('BUG-554');
    expect(extractKey('DEV-11940bugfix-submit')).toBe('DEV-11940');
    expect(extractKey('EC-2398')).toBeUndefined();
    expect(extractKey('seo-hotfix')).toBeUndefined();
    expect(extractKey('MYDEV-12')).toBeUndefined();
  });

  it('parses PR merge subjects', () => {
    expect(parsePrMerge('Merge pull request #1162 from spacetoco/DEV-1314-x')).toEqual({
      number: 1162,
      headRef: 'DEV-1314-x',
    });
    expect(parsePrMerge('Merge pull request #12 from spacetoco/sync/main-into-develop')).toEqual({
      number: 12,
      headRef: 'sync/main-into-develop',
    });
    expect(parsePrMerge('Merge branch \'develop\' into DEV-1113')).toBeUndefined();
  });

  it('combines per-commit presence', () => {
    expect(combinePresence(['merged', 'merged'])).toBe('merged');
    expect(combinePresence(['merged', 'picked'])).toBe('picked');
    expect(combinePresence(['merged', 'missing'])).toBe('partial');
    expect(combinePresence(['missing'])).toBe('none');
  });

  it('merges two items\' presence', () => {
    expect(mergePresence('merged', 'merged')).toBe('merged');
    expect(mergePresence('merged', 'picked')).toBe('picked');
    expect(mergePresence('merged', 'none')).toBe('partial');
    expect(mergePresence('none', 'none')).toBe('none');
  });

  it('makes a readable placeholder title from a ref', () => {
    expect(titleFromRef('DEV-1314-Cannot-book-a-space')).toBe('Cannot book a space');
    expect(titleFromRef('cursor/dev-1113-tasks')).toBe('tasks');
    expect(titleFromRef('seo-hotfix')).toBe('seo hotfix');
  });
});

describe('readGit on a scripted repo', () => {
  let repo: string;
  let items: Map<string, Item>;
  let heads: Record<string, string>;
  let syncedKeys: string[];

  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  }).trim();
  const commit = (file: string, content: string, subject: string) => {
    writeFileSync(join(repo, file), content);
    git('add', file);
    git('commit', '-q', '-m', subject);
  };
  /** Branch `ref` off `from`, add commits, merge into `into` as PR #n. */
  const pr = (n: number, ref: string, from: string, into: string, commits: [string, string, string][]) => {
    git('switch', '-q', '-c', ref, from);
    for (const c of commits) commit(...c);
    git('switch', '-q', into);
    git('merge', '-q', '--no-ff', ref, '-m', `Merge pull request #${n} from org/${ref}`);
  };

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'release-dashboard-'));
    git('init', '-q', '-b', 'main');
    commit('base.txt', 'base', 'initial');
    commit('shared.txt', 'shared', '[DEV-100] already released everywhere');
    for (const b of ['develop', 'staging', 'demo', 'main-uk', 'demo-uk']) git('branch', b);

    // DEV-1: released develop → staging → main, then main → main-uk.
    pr(1, 'DEV-1-feature', 'develop', 'develop', [['a.txt', 'a', '[DEV-1] a'], ['a2.txt', 'a2', '[DEV-1] a2']]);
    // Release PRs: head is an env branch.
    git('switch', '-q', 'staging');
    git('merge', '-q', '--no-ff', 'develop', '-m', 'Merge pull request #2 from org/develop');
    git('switch', '-q', 'main');
    git('merge', '-q', '--no-ff', 'staging', '-m', 'Merge pull request #3 from org/staging');
    git('switch', '-q', 'main-uk');
    git('merge', '-q', '--no-ff', 'main', '-m', 'Merge pull request #4 from org/main');

    // DEV-2: on develop only.
    pr(5, 'DEV-2-next', 'develop', 'develop', [['b.txt', 'b', '[DEV-2] b']]);

    // DEV-3: hotfix PR into main, cherry-picked cleanly onto develop.
    pr(6, 'DEV-3-hotfix-main', 'main', 'main', [['c.txt', 'c', '[DEV-3] hotfix']]);
    git('switch', '-q', 'develop');
    git('cherry-pick', git('rev-parse', 'DEV-3-hotfix-main'));

    // DEV-4: hotfix into main, re-applied on develop with a different diff (conflict-resolved pick).
    pr(7, 'DEV-4-hotfix-main', 'main', 'main', [['d.txt', 'main version', '[DEV-4] hotfix']]);
    git('switch', '-q', 'develop');
    commit('d.txt', 'develop version', '[DEV-4] hotfix');

    // Untracked PR into main.
    pr(8, 'seo-hotfix', 'main', 'main', [['robots.txt', 'x', 'tweak robots']]);

    // DEV-5: two commits on develop; only one cherry-picked onto staging.
    pr(9, 'DEV-5-two', 'develop', 'develop', [['e.txt', 'e', '[DEV-5] one'], ['f.txt', 'f', '[DEV-5] two']]);
    git('switch', '-q', 'staging');
    git('cherry-pick', git('rev-parse', 'DEV-5-two~1'));

    // Commit in a PR with no key in the ref, but a key in the subject.
    pr(10, 'specialaccessdemo', 'develop', 'develop', [['g.txt', 'g', '[DEV-6] feedback'], ['h.txt', 'h', 'demo tweak']]);

    const snapshot = readGit({
      path: repo,
      repo: 'app',
      remote: '',
    });
    items = new Map(snapshot.items.map(i => [i.id, i]));
    heads = snapshot.heads;
    syncedKeys = snapshot.syncedKeys;
  });

  afterAll(() => rmSync(repo, {
    recursive: true,
    force: true,
  }));

  const presence = (id: string) => Object.values(items.get(id)!.presence.app!).join(' ');
  // Branch order: develop staging main demo main-uk demo-uk

  it('reports a short head for every branch', () => {
    expect(Object.keys(heads)).toEqual(['develop', 'staging', 'main', 'demo', 'main-uk', 'demo-uk']);
    expect(items.get('DEV-1')!.prs[0]!.repo).toBe('app');
    expect(heads.main).toMatch(/^[0-9a-f]{7,}$/);
  });

  it('tracks a released ticket through every branch it was merged into', () => {
    expect(presence('DEV-1')).toBe('merged merged merged none merged none');
    expect(items.get('DEV-1')!.prs.map(p => p.number)).toEqual([1]);
    expect(items.get('DEV-1')!.hotfix).toBe(false);
  });

  it('ignores release PRs whose head is an env branch', () => {
    expect([...items.values()].flatMap(i => i.prs.map(p => p.number))).not.toContain(2);
    expect([...items.keys()]).not.toContain('app-pr-3');
  });

  it('shows work on develop only', () => {
    expect(presence('DEV-2')).toBe('merged none none none none none');
  });

  it('marks a clean cherry-pick as picked via patch-id and flags the hotfix', () => {
    expect(presence('DEV-3')).toBe('picked none merged none none none');
    expect(items.get('DEV-3')!.hotfix).toBe(true);
    expect(items.get('DEV-3')!.prs[0]!.base).toBe('main');
  });

  it('falls back to the keyed subject for a pick with a different diff', () => {
    expect(presence('DEV-4')).toBe('picked none merged none none none');
  });

  it('keeps untracked PRs as their own item', () => {
    const item = items.get('app-pr-8')!;
    expect(item.kind).toBe('untracked');
    expect(item.warnings).toEqual(['untracked']);
    expect(presence('app-pr-8')).toBe('none none merged none none none');
  });

  it('reports partial when only some commits reached a branch', () => {
    expect(presence('DEV-5')).toBe('merged partial none none none none');
  });

  it('uses the subject key when the PR ref has none, and the PR for the rest', () => {
    expect(presence('DEV-6')).toBe('merged none none none none none');
    expect(items.get('DEV-6')!.prs.map(p => p.number)).toEqual([10]);
    expect(items.get('app-pr-10')!.title).toBe('specialaccessdemo');
  });

  it('leaves out work that is on every branch, but reports its keys as synced', () => {
    expect([...items.keys()].some(id => id.includes('initial'))).toBe(false);
    expect(items.has('DEV-100')).toBe(false);
    expect(syncedKeys).toEqual(['DEV-100']);
  });
});

describe('combining items across repos', () => {
  const item = (presence: Item['presence'], prs: Item['prs'] = []): Item => ({
    id: 'DEV-1',
    kind: 'ticket',
    title: 't',
    prs,
    presence,
    hotfix: false,
    warnings: [],
  });

  it('keeps each repo\'s presence and both repos\' PRs, even with the same PR number', () => {
    const merged = mergeItems(
      item({
        app: {
          develop: 'merged',
          staging: 'none',
        },
      }, [{
        repo: 'app',
        number: 5,
        headRef: 'DEV-1-a',
        base: 'develop',
      }]),
      item({ api: { develop: 'merged' } }, [{
        repo: 'api',
        number: 5,
        headRef: 'DEV-1-b',
        base: 'develop',
      }]),
    );
    expect(merged.presence).toEqual({
      app: {
        develop: 'merged',
        staging: 'none',
      },
      api: { develop: 'merged' },
    });
    expect(merged.prs.map((p) => `${p.repo}#${p.number}`)).toEqual(['app#5', 'api#5']);
  });

  it('merges presence branch by branch within the same repo', () => {
    const merged = mergeItems(item({
      app: {
        develop: 'merged',
        staging: 'merged',
      },
    }), item({
      app: {
        develop: 'none',
        staging: 'merged',
      },
    }));
    expect(merged.presence.app).toEqual({
      develop: 'partial',
      staging: 'merged',
    });
  });

  it('marks a ticket merged everywhere in repos where its key is already in shared history', () => {
    const [jiraOnly, appOnly] = addSyncedPresence(
      [item({}), {
        ...item({ app: { develop: 'merged' } }),
        id: 'DEV-2',
      }],
      {
        app: ['DEV-1'],
        api: ['DEV-1', 'DEV-2'],
      },
    );
    expect(jiraOnly!.presence.app).toEqual({
      'develop': 'merged',
      'staging': 'merged',
      'main': 'merged',
      'demo': 'merged',
      'main-uk': 'merged',
      'demo-uk': 'merged',
    });
    expect(jiraOnly!.presence.api).toEqual({
      develop: 'merged',
      staging: 'merged',
      main: 'merged',
    });
    expect(appOnly!.presence.app).toEqual({ develop: 'merged' });
    expect(appOnly!.presence.api).toEqual({
      develop: 'merged',
      staging: 'merged',
      main: 'merged',
    });
  });
});
