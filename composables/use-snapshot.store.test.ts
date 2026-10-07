import { beforeEach, describe, expect, it } from 'vitest';
import { registerEndpoint } from '@nuxt/test-utils/runtime';
import { createPinia, setActivePinia } from 'pinia';
import fixture from '~~/shared/fixtures/snapshot.json';
import type { Hop, Item, Snapshot } from '~~/shared/types/snapshot';
import { ATTENTION, filterItems, groupOf, rowState, type Filters } from './use-snapshot.store';

let response: unknown;

registerEndpoint('/snapshot.json', () => {
  if (response instanceof Error) throw response;
  return response;
});

describe('snapshot store', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('loads items from /snapshot.json', async () => {
    response = { items: [{ id: 'DEV-1' }] };
    const store = useSnapshotStore();
    await store.load();
    expect(store.items.map(i => i.id)).toEqual(['DEV-1']);
    expect(store.error).toBeNull();
  });

  it('rejects an HTML page served in place of a missing snapshot', async () => {
    response = '<!doctype html><html></html>';
    const store = useSnapshotStore();
    await store.load();
    expect(store.snapshot).toBeNull();
    expect(store.error?.message).toMatch(/missing or not a snapshot/);
  });

  it('exposes an error when the snapshot fails to load', async () => {
    response = new Error('boom');
    const store = useSnapshotStore();
    await store.load();
    expect(store.items).toEqual([]);
    expect(store.error).not.toBeNull();
  });
});

const snap = fixture as unknown as Snapshot;
const item = (over: Partial<Item>): Item => ({
  id: 'DEV-1',
  kind: 'ticket',
  title: 't',
  prs: [],
  presence: { app: { develop: 'merged' } },
  hotfix: false,
  warnings: [],
  ...over,
});
const hop = (over: Partial<Hop>): Hop => ({
  repo: 'app',
  from: 'develop',
  to: 'staging',
  verdict: 'safe',
  aheadIds: [],
  bringUpIds: [],
  blockingIds: [],
  backSyncIds: [],
  ...over,
});

describe('rowState', () => {
  it('ranks danger over return over caution over ink', () => {
    expect(rowState(item({ warnings: ['extra-on-staging', 'not-on-develop'] }), [])).toBe('danger');
    expect(rowState(item({
      warnings: ['status-mismatch'],
      jira: {
        status: 'RELEASED',
        statusCategory: 'done',
        fixVersions: [],
      },
    }), []))
      .toBe('danger');
    expect(rowState(item({}), [hop({ backSyncIds: ['DEV-1'] })])).toBe('return');
    expect(rowState(item({}), [hop({ blockingIds: ['DEV-1'] })])).toBe('caution');
    expect(rowState(item({ warnings: ['missed-release'] }), [])).toBe('caution');
    expect(rowState(item({}), [hop({
      to: 'main',
      from: 'staging',
      blockingIds: ['DEV-1'],
    })])).toBe('ink');
  });

  it('splits Released-but-not-on-main: none of it on main is danger, partly on main (a shipped hotfix) is caution', () => {
    const released = {
      status: 'RELEASED',
      statusCategory: 'done' as const,
      fixVersions: [],
    };
    expect(rowState(item({
      warnings: ['status-mismatch'],
      jira: released,
      presence: {
        app: {
          develop: 'merged',
          main: 'none',
        },
      },
    }), []))
      .toBe('danger');
    expect(rowState(item({
      warnings: ['status-mismatch'],
      jira: released,
      presence: {
        app: {
          develop: 'merged',
          main: 'partial',
        },
      },
    }), []))
      .toBe('caution');
  });

  it('treats on-main-but-not-Released as housekeeping, not danger', () => {
    expect(rowState(item({
      warnings: ['status-mismatch'],
      jira: {
        status: '(7) Done',
        statusCategory: 'done',
        fixVersions: [],
      },
    }), []))
      .toBe('ink');
  });
});

describe('groupOf', () => {
  const releases = [
    {
      name: '1.0.0',
      released: true,
    },
    {
      name: '2.0.0',
      released: false,
    },
    {
      name: '3.0.0',
      released: false,
    },
    {
      name: 'Rolling Hotfixes',
      released: false,
    },
  ];
  const g = (fixVersions: string[], kind: Item['kind'] = 'ticket') => groupOf(
    item({
      kind,
      jira: {
        status: 'Done',
        statusCategory: 'done',
        fixVersions,
      },
    }),
    '2.0.0',
    releases,
  );

  it('orders: release, other unreleased, rolling, shipped, no fixVersion, untracked (attention leads all)', () => {
    const keys = [g(['2.0.0']), g(['3.0.0']), g(['Rolling Hotfixes']), g(['1.0.0']), g([]), g([], 'untracked')]
      .map((x) => x.key);
    expect(keys).toEqual([...keys].sort());
    expect([ATTENTION.key, ...keys]).toEqual([ATTENTION.key, ...keys].sort());
    expect(g(['1.0.0', '3.0.0']).label).toBe('3.0.0');
    expect(g(['1.0.0']).label).toBe('Shipped: 1.0.0');
  });
});

describe('filterItems', () => {
  const none: Filters = {
    status: [],
    assignee: [],
    sprint: [],
    problemsOnly: false,
    state: [],
    hop: null,
  };
  const rows = [
    {
      ...item({
        id: 'A',
        jira: {
          status: 'Done',
          statusCategory: 'done',
          fixVersions: [],
          assignee: 'Alex',
          sprint: 'S1',
        },
      }),
      state: 'danger' as const,
    },
    {
      ...item({
        id: 'B',
        jira: {
          status: 'Open',
          statusCategory: 'new',
          fixVersions: [],
          assignee: 'Sam',
          sprint: 'S2',
        },
      }),
      state: 'ink' as const,
    },
  ];
  const ids = (f: Partial<Filters>, hops: Hop[] = []) => filterItems(rows, hops, {
    ...none,
    ...f,
  }).map((r) => r.id);

  it('filters by status, assignee, sprint, problems and state', () => {
    expect(ids({})).toEqual(['A', 'B']);
    expect(ids({ status: ['new'] })).toEqual(['B']);
    expect(ids({ assignee: ['Alex'] })).toEqual(['A']);
    expect(ids({ sprint: ['S2'] })).toEqual(['B']);
    expect(ids({ problemsOnly: true })).toEqual(['A']);
    expect(ids({ state: ['ink'] })).toEqual(['B']);
  });

  it('filters to one list of one hop', () => {
    expect(ids({ hop: 'app:develop:staging:back' }, [hop({ backSyncIds: ['B'] })])).toEqual(['B']);
  });
});

describe('store with the fixture', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('re-judges when the release changes', async () => {
    response = snap;
    const store = useSnapshotStore();
    await store.load();
    expect(store.release).toBe(snap.currentRelease);
    const blockingNow = store.hops.find((h) => h.repo === 'app' && h.from === 'develop')!.blockingIds;
    store.release = '27.4.0';
    await nextTick();
    expect(store.hops.find((h) => h.repo === 'app' && h.from === 'develop')!.blockingIds).not.toEqual(blockingNow);
  });
});
