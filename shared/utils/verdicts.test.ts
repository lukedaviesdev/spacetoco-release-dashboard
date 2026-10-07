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

describe('release hops: is a whole-branch merge safe?', () => {
  const notDone = { jira: { statusCategory: 'indeterminate' as const } };
  it.each([
    ['nothing ahead', [item('A', 'mmm...')], 'in-sync', [], []],
    ['everything ahead is wanted (in the release and Done)', [item('A', 'm.....')], 'safe', ['A'], []],
    ['in the release but not Done (not through QA on develop)', [item('A', 'm.....', notDone)], 'not-safe', [], ['A']],
    ['in another release', [item('A', 'm.....', { jira: { fixVersions: ['3.0.0'] } })], 'not-safe', [], ['A']],
    ['untracked work always blocks', [item('A', 'm.....', {
      jira: null,
      kind: 'untracked',
    })], 'not-safe', [], ['A']],
    ['Rolling Hotfixes and Done is wanted', [item('A', 'm.....', {
      jira: { fixVersions: ['Rolling Hotfixes'] },
    })], 'safe', ['A'], []],
    ['a follow-up behind on staging never decides', [item('A', 'mh....', {
      jira: { fixVersions: ['1.0.0'] },
    })], 'safe', [], []],
    ['a dependency bump never decides', [item('A', 'm.....', {
      jira: null,
      kind: 'dependency',
    })], 'safe', [], []],
    ['exempt work is left out entirely', [item('A', 'm.....', {
      exempt: 'released-on-develop',
      jira: { fixVersions: [] },
    })], 'in-sync', [], []],
    ['picked counts as present', [item('A', 'mp....')], 'in-sync', [], []],
  ] as const)('develop→staging: %s', (_, items, verdict, bringUp, blocking) => {
    const h = hop([...items], 'develop', 'staging');
    expect(h.verdict).toBe(verdict);
    expect(h.bringUpIds).toEqual(bringUp);
    expect(h.blockingIds).toEqual(blocking);
  });

  it('staging→main: holds back what is not wanted and lists what can go', () => {
    const h = hop([item('A', 'mm....'), item('B', 'mm....', { jira: { statusCategory: 'new' } })], 'staging', 'main');
    expect(h).toMatchObject({
      verdict: 'hold-back',
      bringUpIds: ['A'],
      blockingIds: ['B'],
    });
    expect(hop([item('A', 'mm....')], 'staging', 'main').verdict).toBe('safe');
  });

  it('judges nothing as wanted without a release', () => {
    expect(computeHops([item('A', 'm.....')], null)[0]!.verdict).toBe('not-safe');
  });
});

describe('sync hops (main→demo, main→main-uk, main-uk→demo-uk)', () => {
  it('reports pending syncs without judging the release', () => {
    const items = [item('A', 'mmm...', { jira: { statusCategory: 'new' } })];
    expect(hop(items, 'main', 'demo')).toMatchObject({
      verdict: 'sync',
      aheadIds: ['A'],
      bringUpIds: [],
      blockingIds: [],
    });
    expect(hop(items, 'main-uk', 'demo-uk').verdict).toBe('in-sync');
  });
});

describe('back-sync', () => {
  it('reports work downstream that upstream lacks, alongside the forward verdict', () => {
    const h = hop([item('HOTFIX', '..mmmm'), item('A', 'mm....')], 'staging', 'main');
    expect(h.verdict).toBe('safe');
    expect(h.backSyncIds).toEqual(['HOTFIX']);
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
      verdict: 'safe',
      bringUpIds: ['API'],
    });
    expect(hop([backend], 'develop', 'staging').verdict).toBe('in-sync');
    expect(computeHops([], R).map((h) => `${h.repo}:${h.from}→${h.to}`)).toEqual([
      'app:develop→staging', 'app:staging→main', 'app:main→demo', 'app:main→main-uk', 'app:main-uk→demo-uk',
      'api:develop→staging', 'api:staging→main',
    ]);
  });
});

describe('computeWarnings', () => {
  it.each([
    ['in the release and on develop', item('A', 'm.....'), []],
    ['in the release, not merged anywhere', item('A', ''), ['not-on-develop']],
    ['in the release, only on main (hotfix)', item('A', '..m...', { jira: { status: 'RELEASED' } }), ['not-on-develop']],
    ['in the release, partial on develop', item('A', 'h.....'), ['not-on-develop', 'follow-up']],
    ['exempt work only gets convention notes', item('A', '', {
      exempt: 'not-live',
      conventionIssues: ['x'],
    }), ['convention']],
    ['dependency bump', item('A', 'm.....', {
      jira: null,
      kind: 'dependency',
    }), []],
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

  describe('extra-on-staging', () => {
    it.each([
      ['another release, on staging not main', item('A', 'mm....', { jira: { fixVersions: ['3.0.0'] } }), ['extra-on-staging']],
      ['no fixVersion, open, on staging', item('A', 'mm....', {
        jira: {
          fixVersions: [],
          statusCategory: 'new',
        },
      }), ['extra-on-staging']],
      ['untracked on staging', item('A', 'mm....', {
        jira: null,
        kind: 'untracked',
      }), ['extra-on-staging', 'untracked']],
      ['not tested on dev but already partly on main', item('A', 'mmh...', {
        jira: {
          fixVersions: ['3.0.0'],
          statusCategory: 'indeterminate',
        },
      }), ['extra-on-staging', 'not-tested', 'follow-up']],
      ['in the release but not tested on dev', item('A', 'mm....', {
        jira: { statusCategory: 'indeterminate' },
      }), ['not-tested']],
      ['rolling hotfix on staging', item('A', 'mm....', { jira: { fixVersions: ['Rolling Hotfixes'] } }), []],
      ['another release, but already on main too', item('A', 'mmm...', {
        jira: {
          fixVersions: ['3.0.0'],
          status: 'RELEASED',
        },
      }), []],
      ['another release, only on develop', item('A', 'm.....', { jira: { fixVersions: ['3.0.0'] } }), []],
    ] as const)('%s', (_, i, warnings) => {
      expect(computeWarnings(i, R)).toEqual(warnings);
    });
  });

  describe('status-mismatch', () => {
    const status = (app: string, name: string) => computeWarnings(item('A', app, {
      jira: {
        status: name,
        fixVersions: ['1.0.0'],
      },
    }), R);

    it('flags Released work that is not fully on main', () => {
      expect(status('m.....', 'RELEASED')).toEqual(['status-mismatch']);
      expect(status('mmh...', '(9) Released')).toEqual(['extra-on-staging', 'status-mismatch', 'follow-up']);
    });

    it('flags work fully on main whose status is not Released', () => {
      expect(status('mmm...', '(7) Done')).toEqual(['status-mismatch']);
      expect(status('mmm...', '(8) READY TO RELEASE')).toEqual(['status-mismatch']);
    });

    it('is quiet when status and branches agree, or there is no code yet', () => {
      expect(status('mmm...', 'RELEASED')).toEqual([]);
      expect(status('mm....', '(6) In testing')).toEqual(['extra-on-staging']);
      expect(status('', 'RELEASED')).toEqual([]);
    });
  });

  describe('missed-release', () => {
    const releases = [{
      name: '1.0.0',
      released: true,
    }, {
      name: R,
      released: false,
    }];
    const warn = (app: string, fixVersions: string[]) => (
      computeWarnings(item('A', app, { jira: { fixVersions } }), R, releases)
    );

    it('flags work whose versions have all shipped but that isn\'t on main', () => {
      expect(warn('m.....', ['1.0.0'])).toEqual(['missed-release']);
      // On staging too, and not in the current release, so also an extra on staging.
      expect(warn('mmh...', ['1.0.0'])).toEqual(['extra-on-staging', 'missed-release', 'follow-up']);
    });

    it('stays quiet once it is on main, when it was carried into an unreleased version, or for rolling versions', () => {
      expect(warn('mmm...', ['1.0.0'])).not.toContain('missed-release');
      expect(warn('m.....', ['1.0.0', R])).toEqual([]);
      expect(warn('m.....', ['Rolling Hotfixes'])).toEqual([]);
    });
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
    const judged = judge(fixture.items, fixture.currentRelease, fixture.releases);
    expect(judged.hops).toEqual(fixture.hops);
    expect(judged.items.map((i) => [i.id, i.warnings])).toEqual(fixture.items.map((i) => [i.id, i.warnings]));
  });
});
