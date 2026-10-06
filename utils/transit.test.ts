// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Hop } from '../shared/types/snapshot';
import { backSignalOf, hopFilter, layoutTransit, signalOf } from './transit';

const hop = (over: Partial<Hop>): Hop => ({
  repo: 'app',
  from: 'develop',
  to: 'staging',
  verdict: 'in-sync',
  aheadIds: [],
  blockingIds: [],
  backSyncIds: [],
  ...over,
});

describe('layoutTransit', () => {
  const { stations, tracks, rows, cols } = layoutTransit();
  const at = (repo: string, branch: string) => {
    const s = stations.find((x) => x.repo === repo && x.branch === branch)!;
    return [s.col, s.row];
  };

  it('puts the app trunk on one row, the UK line below it, and api underneath, aligned by column', () => {
    expect(at('app', 'develop')).toEqual([0, 0]);
    expect(at('app', 'staging')).toEqual([1, 0]);
    expect(at('app', 'main')).toEqual([2, 0]);
    expect(at('app', 'demo')).toEqual([3, 0]);
    expect(at('app', 'main-uk')).toEqual([3, 1]);
    expect(at('app', 'demo-uk')).toEqual([4, 1]);
    expect(at('api', 'develop')).toEqual([0, 2]);
    expect(at('api', 'main')).toEqual([2, 2]);
    expect([rows, cols]).toEqual([3, 5]);
  });

  it('has one track per hop', () => {
    expect(tracks.map((t) => `${t.repo}:${t.from}→${t.to}`)).toEqual([
      'app:develop→staging', 'app:staging→main', 'app:main→demo', 'app:main→main-uk', 'app:main-uk→demo-uk',
      'api:develop→staging', 'api:staging→main',
    ]);
  });
});

describe('signalOf', () => {
  it.each([
    ['cherry-pick', {
      verdict: 'cherry-pick',
      aheadIds: ['A', 'B'],
      blockingIds: ['B'],
    }, 'danger', 'hold back 1', 'blocking', 1],
    ['merge-with-extras', {
      verdict: 'merge-with-extras',
      aheadIds: ['A', 'B'],
      blockingIds: ['A', 'B'],
    }, 'caution', '2 extras', 'blocking', 2],
    ['clean', {
      verdict: 'clean',
      aheadIds: ['A'],
    }, 'clear', 'clean · 1', 'ahead', 1],
    ['sync', {
      verdict: 'sync',
      aheadIds: ['A', 'B', 'C'],
    }, 'neutral', '3 to sync', 'ahead', 3],
    ['in-sync', { verdict: 'in-sync' }, 'quiet', '', null, 0],
  ] as const)('%s', (_, over, tone, label, list, count) => {
    expect(signalOf(hop(over as Partial<Hop>))).toMatchObject({
      tone,
      label,
      list,
      count,
    });
  });

  it('describes the hop in a sentence', () => {
    expect(signalOf(hop({
      verdict: 'cherry-pick',
      from: 'staging',
      to: 'main',
      aheadIds: ['A'],
      blockingIds: ['A'],
    })).description)
      .toBe('app staging → main: cherry-pick. 1 ticket on staging must not go to main.');
  });
});

describe('backSignalOf', () => {
  it('only exists when something needs bringing back', () => {
    expect(backSignalOf(hop({}))).toBeNull();
    expect(backSignalOf(hop({ backSyncIds: ['H1', 'H2'] }))).toMatchObject({
      label: '← 2 back',
      list: 'back',
      count: 2,
    });
  });
});

it('builds the store hop filter value', () => {
  expect(hopFilter({
    repo: 'api',
    from: 'staging',
    to: 'main',
  }, 'blocking')).toBe('api:staging:main:blocking');
});
