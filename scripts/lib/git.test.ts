// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Item } from '../../shared/types/snapshot';
import {
  addSyncedPresence, buildItems, conventionIssues, extractKey, extractKeys, mergeItems, mergePresence, parsePrMerge, prKind,
  scanRepo, titleFromRef, type PrDetail, type RepoScan,
} from './git';

describe('pure helpers', () => {
  it('extracts ticket keys from branch names, titles and subjects', () => {
    expect(extractKey('DEV-1314-Cannot-book')).toBe('DEV-1314');
    expect(extractKey('cursor/dev-1113-tasks-56f6')).toBe('DEV-1113');
    expect(extractKey('DEV-11940bugfix-submit')).toBe('DEV-11940');
    expect(extractKey('EC-2398')).toBeUndefined();
    expect(extractKey('MYDEV-12')).toBeUndefined();
    expect(extractKeys('[DEV-180][DEV-181] and DEV-185')).toEqual(['DEV-180', 'DEV-181', 'DEV-185']);
  });

  it('parses PR merge subjects', () => {
    expect(parsePrMerge('Merge pull request #1162 from spacetoco/DEV-1314-x')).toEqual({
      number: 1162,
      headRef: 'DEV-1314-x',
    });
    expect(parsePrMerge('Merge branch \'develop\' into DEV-1113')).toBeUndefined();
  });

  it('classifies PRs by head branch', () => {
    const env = ['develop', 'staging', 'main'];
    expect(prKind('staging', env, false)).toBe('env');
    expect(prKind('release/27.3.0', env, false)).toBe('carrier');
    expect(prKind('mini-release', env, false)).toBe('carrier');
    expect(prKind('sync/main-into-develop', env, false)).toBe('carrier');
    expect(prKind('chore/cherry-pick-27.1.0-hotfixes-to-develop', env, false)).toBe('carrier');
    expect(prKind('staging-main-conflicts', env, false)).toBe('conflict');
    expect(prKind('revert-1050-DEV-1115-fix', env, true)).toBe('revert-chore');
    expect(prKind('chore/pull-non-release-tickets-27.1.0', env, false)).toBe('revert-chore');
    expect(prKind('dependabot/npm_and_yarn/axios-1.20.0', env, false)).toBe('dependency');
    expect(prKind('DEV-1-x', env, true)).toBe('ticket');
    expect(prKind('seo-hotfix', env, false)).toBe('untracked');
  });

  it('explains branch-convention breaks', () => {
    expect(conventionIssues({
      head: 'DEV-1-thing',
      title: '[DEV-1] Thing',
      number: 1,
    }, 'ticket')).toEqual([]);
    expect(conventionIssues({
      head: 'DEV-1-thing-main',
      title: '[DEV-1] Thing',
      number: 1,
    }, 'ticket')).toEqual([]);
    expect(conventionIssues({
      head: 'DEV-11940bugfix-x',
      title: '[DEV-1194] x',
      number: 2,
    }, 'ticket')).toEqual([
      '#2 `DEV-11940bugfix-x`: branch should start <KEY>-<slug>',
      '#2 `DEV-11940bugfix-x`: title key DEV-1194 ≠ branch key DEV-11940',
    ]);
    expect(conventionIssues({
      head: 'DEV-574-hook',
      title: '[DEV-575] hook',
      number: 3,
    }, 'ticket')[0]).toMatch(/DEV-575 ≠ branch key DEV-574/);
    expect(conventionIssues({
      head: 'cursor/dev-1113-x',
      title: 'fix warnings',
      number: 4,
    }, 'ticket')).toHaveLength(2);
    expect(conventionIssues({
      head: 'seo-hotfix',
      number: 5,
    }, 'untracked')[0]).toMatch(/no ticket key/);
  });

  it('merges presence and repos', () => {
    expect(mergePresence('merged', 'merged')).toBe('merged');
    expect(mergePresence('merged', 'picked')).toBe('picked');
    expect(mergePresence('merged', 'none')).toBe('partial');
    expect(mergePresence('none', 'none')).toBe('none');
    const base = {
      id: 'DEV-1',
      kind: 'ticket' as const,
      title: 't',
      hotfix: false,
      warnings: [],
    };
    const merged = mergeItems(
      {
        ...base,
        prs: [{
          repo: 'app',
          number: 5,
          headRef: 'a',
          base: 'develop',
        }],
        presence: { app: { develop: 'merged' } },
        exempt: 'not-live',
      },
      {
        ...base,
        prs: [{
          repo: 'api',
          number: 5,
          headRef: 'b',
          base: 'develop',
        }],
        presence: { api: { develop: 'merged' } },
      },
    );
    expect(merged.prs.map((p) => `${p.repo}#${p.number}`)).toEqual(['app#5', 'api#5']);
    expect(merged.presence).toEqual({
      app: { develop: 'merged' },
      api: { develop: 'merged' },
    });
    expect(merged.exempt).toBeUndefined(); // only exempt when both repos' work is
  });

  it('fills repos where a ticket is already fully shipped', () => {
    const jiraOnly: Item = {
      id: 'DEV-1',
      kind: 'ticket',
      title: 't',
      prs: [],
      presence: {},
      hotfix: false,
      warnings: [],
    };
    const [filled] = addSyncedPresence([jiraOnly], { api: ['DEV-1'] });
    expect(filled!.presence).toEqual({
      api: {
        develop: 'merged',
        staging: 'merged',
        main: 'merged',
      },
    });
  });

  it('makes a readable placeholder title from a ref', () => {
    expect(titleFromRef('DEV-1314-Cannot-book-a-space')).toBe('Cannot book a space');
    expect(titleFromRef('seo-hotfix')).toBe('seo hotfix');
  });
});

describe('PR engine on a scripted repo', () => {
  let repo: string;
  let scan: RepoScan;
  let items: Map<string, Item>;

  const day = (d: number, h = 10) => `2026-09-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00Z`;
  let now = day(1);
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
      GIT_AUTHOR_DATE: now,
      GIT_COMMITTER_DATE: now,
    },
  }).trim();
  const commit = (file: string, subject: string) => {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), `${subject}\n`);
    git('add', file);
    git('commit', '-q', '-m', subject);
  };
  /** Branch `head` off `into`, run `work`, then merge it into `into` as PR #n on `date`. */
  const pr = (n: number, head: string, into: string, date: string, work: () => void) => {
    now = date;
    git('switch', '-q', '-c', head, into);
    work();
    git('switch', '-q', into);
    git('merge', '-q', '--no-ff', head, '-m', `Merge pull request #${n} from org/${head}`);
  };
  const envMerge = (n: number, from: string, into: string, date: string) => {
    now = date;
    git('switch', '-q', into);
    git('merge', '-q', '--no-ff', from, '-m', `Merge pull request #${n} from org/${from}`);
  };

  const titles: Record<number, string> = {
    1: '[DEV-1] Feature',
    4: '[DEV-2] Thing',
    5: '[DEV-2] Thing for staging',
    6: '[DEV-3] Fix',
    7: '[DEV-3] Fix',
    8: '[DEV-3] Fix',
    9: '[DEV-3] More tests',
    10: '[DEV-4] Thing',
    11: '[DEV-4] Thing',
    12: '[DEV-5] Thing',
    13: '[DEV-6] X',
    14: 'Cherry-pick hotfixes',
    15: '[DEV-8] B',
    16: '[DEV-9] Infra',
    17: 'SEO tweak',
    18: 'Bump x',
    19: 'Fix conflicts',
    20: '[DEV-10] More',
  };

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'release-dashboard-'));
    git('init', '-q', '-b', 'main');
    commit('base.txt', 'initial');
    commit('shipped.txt', '[DEV-10] shipped long ago'); // shared history: DEV-10 is synced
    for (const b of ['develop', 'staging', 'demo', 'main-uk', 'demo-uk']) git('branch', b);

    // DEV-1: through the train develop → staging → main by whole-branch merges.
    pr(1, 'DEV-1-feature', 'develop', day(1), () => commit('a.txt', '[DEV-1] feature'));
    envMerge(2, 'develop', 'staging', day(2));
    envMerge(3, 'staging', 'main', day(3));

    // DEV-2: twin PRs into develop and staging on the same day.
    pr(4, 'DEV-2-thing', 'develop', day(4), () => commit('b.txt', '[DEV-2] thing'));
    pr(5, 'DEV-2-thing-staging', 'staging', day(4, 14), () => commit('b.txt', '[DEV-2] thing'));

    // DEV-3: fan-out hotfix into main, staging and develop, then a follow-up on develop days later.
    pr(6, 'DEV-3-fix-main', 'main', day(5), () => commit('c-main.txt', '[DEV-3] fix'));
    pr(7, 'DEV-3-fix-staging', 'staging', day(5, 11), () => commit('c-staging.txt', '[DEV-3] fix'));
    pr(8, 'DEV-3-fix-develop', 'develop', day(5, 12), () => commit('c-develop.txt', '[DEV-3] fix'));
    pr(9, 'DEV-3-more-tests', 'develop', day(8), () => commit('c-tests.txt', '[DEV-3] more tests'));

    // DEV-4: on develop and staging, then reverted on staging.
    pr(10, 'DEV-4-thing-staging', 'staging', day(6), () => commit('d.txt', '[DEV-4] thing'));
    pr(11, 'DEV-4-thing', 'develop', day(6, 11), () => commit('d.txt', '[DEV-4] thing'));
    now = day(7);
    git('switch', '-q', 'staging');
    git('revert', '--no-edit', '-m', '1', 'HEAD~0^{/Merge pull request #10 }');

    // DEV-5: reverted on develop, then the revert reverted: back on develop.
    pr(12, 'DEV-5-thing', 'develop', day(6, 13), () => commit('e.txt', '[DEV-5] thing'));
    now = day(7, 11);
    git('switch', '-q', 'develop');
    git('revert', '--no-edit', '-m', '1', 'HEAD');
    now = day(7, 12);
    git('revert', '--no-edit', 'HEAD');

    // DEV-6: on develop by its PR; reaches staging only as a cherry-pick carried by a chore branch.
    pr(13, 'DEV-6-x', 'develop', day(6, 14), () => commit('f.txt', '[DEV-6] x'));
    const picked = git('rev-parse', 'DEV-6-x');
    pr(14, 'chore/cherry-pick-hotfixes', 'staging', day(7, 13), () => { git('cherry-pick', picked); });

    // PR whose title names a different ticket from its branch: it counts for both.
    pr(15, 'DEV-7-a', 'develop', day(8, 11), () => commit('g.txt', 'tweak'));

    // DEV-9 only touches infra: off the release path.
    pr(16, 'DEV-9-infra', 'develop', day(8, 12), () => commit('deployments/main.tf', '[DEV-9] infra'));

    // Untracked hotfix into main, a dependabot bump, and a conflict-fix PR.
    pr(17, 'seo-hotfix', 'main', day(8, 13), () => commit('seo.txt', 'add price to seo'));
    pr(18, 'dependabot/npm/x-1.2', 'develop', day(8, 14), () => commit('package.json', 'bump x'));
    pr(19, 'staging-main-conflicts', 'staging', day(8, 15), () => commit('conflict.txt', 'fix conflicts'));

    // DEV-10 shipped long ago, and now has more work on develop.
    pr(20, 'DEV-10-more', 'develop', day(9), () => commit('h.txt', '[DEV-10] more'));

    // A commit pushed straight to main with no PR and no key.
    now = day(9, 11);
    git('switch', '-q', 'main');
    commit('direct.txt', 'quick tweak on prod');

    scan = scanRepo({
      path: repo,
      repo: 'app',
      remote: '',
    });
    const details = new Map<number, PrDetail>(Object.entries(titles).map(([n, title]) => [Number(n), { title }]));
    items = new Map(buildItems(scan, details).map((i) => [i.id, i]));
  });

  afterAll(() => rmSync(repo, {
    recursive: true,
    force: true,
  }));

  // Branch order: develop staging main demo main-uk demo-uk
  const presence = (id: string) => Object.values(items.get(id)!.presence.app!).join(' ');
  const prNumbers = (id: string) => items.get(id)!.prs.map((p) => p.number).sort((a, b) => a - b);

  it('finds shipped keys and every PR in scope', () => {
    expect(scan.syncedKeys).toContain('DEV-10');
    expect(scan.prs.map((p) => p.number)).toEqual(expect.arrayContaining([1, 4, 5, 6, 10, 14, 17, 19, 20]));
  });

  it('follows a ticket through whole-branch merges by ancestry', () => {
    expect(presence('DEV-1')).toBe('merged merged merged none none none');
    expect(items.get('DEV-1')!.hotfix).toBe(false);
  });

  it('treats same-day twin PRs as one change', () => {
    expect(presence('DEV-2')).toBe('merged merged none none none none');
    expect(prNumbers('DEV-2')).toEqual([4, 5]);
    expect(items.get('DEV-2')!.hotfix).toBe(true);
  });

  it('shows a fan-out hotfix as shipped, and a later follow-up as partial where it is missing', () => {
    expect(presence('DEV-3')).toBe('merged partial partial none none none');
    expect(prNumbers('DEV-3')).toEqual([6, 7, 8, 9]);
  });

  it('removes a PR from a branch where it was reverted', () => {
    expect(presence('DEV-4')).toBe('merged none none none none none');
    expect(items.get('DEV-4')!.prs.find((p) => p.number === 10)!.revertedOn).toEqual(['staging']);
  });

  it('puts a PR back when its revert is reverted', () => {
    expect(presence('DEV-5')).toBe('merged none none none none none');
  });

  it('shows work carried by a cherry-pick as picked, and hides the carrier PR', () => {
    expect(presence('DEV-6')).toBe('merged picked none none none none');
    expect(items.has('app-pr-14')).toBe(false);
  });

  it('counts a PR for every key in its title and branch, and flags the mismatch', () => {
    expect(prNumbers('DEV-7')).toEqual([15]);
    expect(prNumbers('DEV-8')).toEqual([15]);
    expect(items.get('DEV-8')!.conventionIssues).toEqual(['#15 `DEV-7-a`: title key DEV-8 ≠ branch key DEV-7']);
  });

  it('marks infra-only tickets as off the release path', () => {
    expect(items.get('DEV-9')!.exempt).toBe('released-on-develop');
    expect(items.get('DEV-1')!.exempt).toBeUndefined();
  });

  it('keeps untracked work and dependency bumps as items, and hides conflict fixes', () => {
    expect(items.get('app-pr-17')).toMatchObject({
      kind: 'untracked',
      hotfix: true,
    });
    expect(items.get('app-pr-17')!.conventionIssues![0]).toMatch(/no ticket key/);
    expect(presence('app-pr-17')).toBe('none none merged none none none');
    expect(items.get('app-pr-18')!.kind).toBe('dependency');
    expect(items.has('app-pr-19')).toBe(false);
  });

  it('shows a shipped ticket with new work as partial where the new work is missing', () => {
    expect(presence('DEV-10')).toBe('merged partial partial partial partial partial');
  });

  it('lists a commit pushed with no PR and no key as untracked', () => {
    const direct = [...items.values()].find((i) => i.title === 'quick tweak on prod');
    expect(direct).toMatchObject({
      kind: 'untracked',
      prs: [],
    });
    expect(Object.values(direct!.presence.app!).join(' ')).toBe('none none merged none none none');
  });

  it('records which branches each PR is on', () => {
    expect(items.get('DEV-1')!.prs[0]!.on).toEqual(['develop', 'staging', 'main']);
  });
});
