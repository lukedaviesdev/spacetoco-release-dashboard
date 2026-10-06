// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Item } from '../../shared/types/snapshot';
import { applyPrs, readPrs, rekeyByPrTitle } from './github';

const item = (id: string, kind: Item['kind'], numbers: number[]): Item => ({
  id,
  kind,
  title: 'from git',
  prs: numbers.map((number) => ({
    number,
    headRef: `ref-${number}`,
    base: 'develop',
  })),
  presence: {
    'develop': 'merged',
    'staging': 'none',
    'main': 'none',
    'demo': 'none',
    'main-uk': 'none',
    'demo-uk': 'none',
  },
  hotfix: false,
  warnings: [],
});

describe('applyPrs', () => {
  const details = new Map([[1, {
    title: 'Add thing',
    author: 'alex',
  }], [2, {
    title: 'SEO tweak',
    author: 'sam',
  }]]);
  const [ticket, untracked] = applyPrs([item('DEV-1', 'ticket', [1]), item('pr-2', 'untracked', [2])], details);

  it('adds title and author to each PR', () => {
    expect(ticket!.prs[0]).toMatchObject({
      title: 'Add thing',
      author: 'alex',
    });
  });

  it('keeps ticket titles (Jira owns them) but titles untracked items from their PR', () => {
    expect(ticket!.title).toBe('from git');
    expect(untracked!.title).toBe('SEO tweak');
  });
});

describe('rekeyByPrTitle', () => {
  const titled = (id: string, kind: Item['kind'], number: number, title: string, develop: Item['presence']['develop']) => ({
    ...item(id, kind, [number]),
    prs: [{
      number,
      headRef: id,
      base: 'develop' as const,
      title,
    }],
    presence: {
      ...item(id, kind, []).presence,
      develop,
      staging: 'merged' as const,
    },
    warnings: kind === 'untracked' ? ['untracked' as const] : [],
  });

  it('turns an untracked PR whose title has a key into that ticket', () => {
    const [ticket] = rekeyByPrTitle([titled('pr-7', 'untracked', 7, '[DEV-9] ✨ Feature', 'merged')], ['DEV', 'BUG']);
    expect(ticket).toMatchObject({
      id: 'DEV-9',
      kind: 'ticket',
      warnings: [],
    });
  });

  it('joins an existing ticket, combining PRs and presence', () => {
    const items = rekeyByPrTitle([
      titled('DEV-9', 'ticket', 1, 'first part', 'merged'),
      titled('pr-7', 'untracked', 7, '[DEV-9] second part', 'none'),
    ], ['DEV']);
    expect(items).toHaveLength(1);
    expect(items[0]!.prs.map((p) => p.number)).toEqual([1, 7]);
    expect(items[0]!.presence.develop).toBe('partial');
    expect(items[0]!.presence.staging).toBe('merged');
  });

  it('leaves untracked PRs without a key alone', () => {
    expect(rekeyByPrTitle([titled('pr-8', 'untracked', 8, 'Bump axios', 'merged')], ['DEV'])[0]!.id).toBe('pr-8');
  });
});

describe('readPrs', () => {
  let dir: string | undefined;
  afterEach(() => dir && rmSync(dir, {
    recursive: true,
    force: true,
  }));

  it('fetches only uncached PRs and caches the result', async () => {
    dir = mkdtempSync(join(tmpdir(), 'release-dashboard-gh-'));
    const cachePath = join(dir, 'prs.json');
    const requested: string[] = [];
    const fakeFetch = (async (input: string | URL) => {
      requested.push(String(input));
      return new Response(JSON.stringify({
        title: `PR ${requested.length}`,
        user: { login: 'alex' },
      }));
    }) as typeof fetch;
    const config = {
      token: 't',
      repo: 'org/repo',
      cachePath,
    };

    await readPrs(config, [10, 11], fakeFetch);
    const second = await readPrs(config, [10, 11, 12], fakeFetch);

    expect(requested).toEqual([
      'https://api.github.com/repos/org/repo/pulls/10',
      'https://api.github.com/repos/org/repo/pulls/11',
      'https://api.github.com/repos/org/repo/pulls/12',
    ]);
    expect(second.get(12)).toEqual({
      title: 'PR 3',
      author: 'alex',
    });
    expect(Object.keys(JSON.parse(readFileSync(cachePath, 'utf8')))).toEqual(['10', '11', '12']);
  });
});
