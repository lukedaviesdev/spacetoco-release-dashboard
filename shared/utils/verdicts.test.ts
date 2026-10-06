// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Item, JiraInfo, Snapshot } from '../types/snapshot';
import { computeHops, computeWarnings, judge } from './verdicts';

const R = '2.0.0';

const item = (id: string, app: string, over: Omit<Partial<Item>, 'jira'> & { jira?: Partial<JiraInfo> | null } = {}): Item => {
  // `app` is presence on develop/staging/main/demo/main-uk/demo-uk as letters: m=merged p=picked h=partial .=none
  const code = {
    m: 'merged',
    p: 'picked',
    h: 'partial',
    '.': 'none',
  } as const;
  const branches = ['develop', 'staging', 'main', 'demo', 'main-uk', 'demo-uk'] as const;
  const { jira, ...rest } = over;
  return {
    id,
    kind: 'ticket',
    title: id,
    prs: [],
    presence: app ? { app: Object.fromEntries(branches.map((b, i) => [b, code[app[i] as keyof typeof code]])) } : {},
    hotfix: false,
    warnings: [],
    ...(jira !== null && {
      jira: {
        status: 'Done',
        statusCategory: 'done',
        fixVersions: [R],
        ...jira,
      },
    }),
    ...rest,
  };
};

const hop = (items: Item[], from: string, to: string, repo = 'app') => computeHops(items, R)
  .find((h) => h.repo === repo && h.from === from && h.to === to)!;

describe('release hops (develop→staging, staging→main)', () => {
  it.each([
    ['nothing ahead', [item('A', 'mmm...')], 'in-sync', [], []],
    ['ahead and ready', [item('A', 'm.....')], 'clean', ['A'], []],
    ['ahead but not Done', [item('A', 'm.....', { jira: { statusCategory: 'indeterminate' } })], 'cherry-pick', ['A'], ['A']],
    ['ahead but in another release', [item('A', 'm.....', { jira: { fixVersions: ['3.0.0'] } })], 'cherry-pick', ['A'], ['A']],
    ['ahead with no Jira (untracked)', [item('A', 'm.....', {
      kind: 'untracked',
      jira: null,
    })], 'cherry-pick', ['A'], ['A']],
    ['partial on develop is still ahead of none', [item('A', 'h.....')], 'clean', ['A'], []],
    ['full on develop is ahead of partial on staging', [item('A', 'mh....')], 'clean', ['A'], []],
    ['two partials are not ahead', [item('A', 'hh....')], 'in-sync', [], []],
    ['picked counts as present', [item('A', 'mp....')], 'in-sync', [], []],
  ] as const)('%s', (_, items, verdict, ahead, blocking) => {
    const h = hop([...items], 'develop', 'staging');
    expect(h.verdict).toBe(verdict);
    expect(h.aheadIds).toEqual(ahead);
    expect(h.blockingIds).toEqual(blocking);
  });

  it('lists ready and blocking items together when mixed', () => {
    const h = hop([item('A', 'mm....'), item('B', 'mm....', { jira: { statusCategory: 'new' } })], 'staging', 'main');
    expect(h).toMatchObject({
      verdict: 'cherry-pick',
      aheadIds: ['A', 'B'],
      blockingIds: ['B'],
    });
  });
});

describe('sync hops (main→demo, main→main-uk, main-uk→demo-uk)', () => {
  it('reports pending syncs without judging the release', () => {
    const items = [item('A', 'mmm...', { jira: { statusCategory: 'new' } })];
    expect(hop(items, 'main', 'demo')).toMatchObject({
      verdict: 'sync',
      aheadIds: ['A'],
      blockingIds: [],
    });
    expect(hop(items, 'main-uk', 'demo-uk').verdict).toBe('in-sync');
  });
});

describe('back-sync', () => {
  it('reports work downstream that upstream lacks, alongside the forward verdict', () => {
    const h = hop([item('HOTFIX', '..mmmm'), item('A', 'mm....')], 'staging', 'main');
    expect(h.verdict).toBe('clean');
    expect(h.backSyncIds).toEqual(['HOTFIX']);
    expect(hop([item('HOTFIX', '..mmmm')], 'develop', 'staging').backSyncIds).toEqual([]);
  });
});

describe('repos', () => {
  it('judges each repo on its own branches, ignoring items with no work there', () => {
    const backend = {
      ...item('API', ''),
      presence: {
        api: {
          develop: 'merged' as const,
          staging: 'none' as const,
          main: 'none' as const,
        },
      },
    };
    expect(hop([backend, item('APP', 'mmm...')], 'develop', 'staging', 'api')).toMatchObject({
      verdict: 'clean',
      aheadIds: ['API'],
    });
    expect(hop([backend], 'develop', 'staging').verdict).toBe('in-sync');
    expect(computeHops([], R).map((h) => `${h.repo}:${h.from}→${h.to}`)).toEqual([
      'app:develop→staging', 'app:staging→main', 'app:main→demo', 'app:main→main-uk', 'app:main-uk→demo-uk',
      'api:develop→staging', 'api:staging→main',
    ]);
  });

  it('gives no release verdicts without a release', () => {
    expect(computeHops([item('A', 'm.....')], null)[0]!.verdict).toBe('cherry-pick');
  });
});

describe('computeWarnings', () => {
  it.each([
    ['in the release and on develop', item('A', 'm.....'), []],
    ['in the release, not merged anywhere', item('A', ''), ['not-on-develop']],
    ['in the release, only on main (hotfix)', item('A', '..m...'), ['not-on-develop']],
    ['in the release, partial on develop', item('A', 'h.....'), ['not-on-develop']],
    ['another release, not merged anywhere', item('A', '', { jira: { fixVersions: ['3.0.0'] } }), []],
    ['Done with no fixVersion', item('A', 'm.....', { jira: { fixVersions: [] } }), ['done-no-fixversion']],
    ['open with no fixVersion', item('A', 'm.....', {
      jira: {
        fixVersions: [],
        statusCategory: 'new',
      },
    }), []],
    ['invalid key', item('A', 'm.....', {
      jira: null,
      invalidKey: true,
    }), ['invalid-key']],
    ['untracked', item('A', 'm.....', {
      jira: null,
      kind: 'untracked',
    }), ['untracked']],
  ] as const)('%s', (_, i, warnings) => {
    expect(computeWarnings(i, R)).toEqual(warnings);
  });

  it('needs every repo with work to have it on develop', () => {
    const both = {
      ...item('A', 'm.....'),
      presence: {
        app: { develop: 'merged' as const },
        api: { develop: 'none' as const },
      },
    };
    expect(computeWarnings(both, R)).toEqual(['not-on-develop']);
  });
});

describe('the committed fixture', () => {
  const fixture: Snapshot = JSON.parse(readFileSync(new URL('../fixtures/snapshot.json', import.meta.url), 'utf8'));

  it('matches what the engine computes, so the UI is built against real verdicts', () => {
    const judged = judge(fixture.items, fixture.currentRelease);
    expect(judged.hops).toEqual(fixture.hops);
    expect(judged.items.map((i) => [i.id, i.warnings])).toEqual(fixture.items.map((i) => [i.id, i.warnings]));
  });
});
