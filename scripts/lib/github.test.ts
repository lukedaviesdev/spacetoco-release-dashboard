// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Item, PullRequest } from '../../shared/types/snapshot';
import { applyPrs, readPrs, rekeyByPrTitle } from './github';

const pr = (number: number, over: Partial<PullRequest> = {}): PullRequest => ({
  repo: 'app',
  number,
  headRef: `ref-${number}`,
  base: 'develop',
  ...over,
});

const item = (
  id: string,
  kind: Item['kind'],
  prs: PullRequest[],
  presence: Item['presence'] = { app: { develop: 'merged' } },
): Item => ({
  id,
  kind,
  title: 'from git',
  prs,
  presence,
  hotfix: false,
  warnings: kind === 'untracked' ? ['untracked'] : [],
});

describe('applyPrs', () => {
  const details = new Map([
    ['app#1', {
      title: 'Add thing',
      author: 'alex',
    }],
    ['app#2', {
      title: 'SEO tweak',
      author: 'sam',
    }],
    ['api#1', {
      title: 'API thing',
      author: 'jo',
    }],
  ]);
  const [ticket, untracked] = applyPrs([
    item('DEV-1', 'ticket', [pr(1), pr(1, { repo: 'api' })]),
    item('app-pr-2', 'untracked', [pr(2)]),
  ], details);

  it('adds title and author to each PR, by repo', () => {
    expect(ticket!.prs.map((p) => p.title)).toEqual(['Add thing', 'API thing']);
  });

  it('keeps ticket titles (Jira owns them) but titles untracked items from their PR', () => {
    expect(ticket!.title).toBe('from git');
    expect(untracked!.title).toBe('SEO tweak');
  });
});

describe('rekeyByPrTitle', () => {
  it('turns an untracked PR whose title has a key into that ticket', () => {
    const [ticket] = rekeyByPrTitle([item('app-pr-7', 'untracked', [pr(7, { title: '[DEV-9] ✨ Feature' })])], ['DEV', 'BUG']);
    expect(ticket).toMatchObject({
      id: 'DEV-9',
      kind: 'ticket',
      warnings: [],
    });
  });

  it('joins an existing ticket, combining PRs and presence', () => {
    const items = rekeyByPrTitle([
      item('DEV-9', 'ticket', [pr(1)], {
        app: {
          develop: 'merged',
          staging: 'merged',
        },
      }),
      item('app-pr-7', 'untracked', [pr(7, { title: '[DEV-9] second part' })], {
        app: {
          develop: 'none',
          staging: 'merged',
        },
      }),
    ], ['DEV']);
    expect(items).toHaveLength(1);
    expect(items[0]!.prs.map((p) => p.number)).toEqual([1, 7]);
    expect(items[0]!.presence.app).toEqual({
      develop: 'partial',
      staging: 'merged',
    });
  });

  it('leaves untracked PRs without a key alone', () => {
    expect(rekeyByPrTitle([item('app-pr-8', 'untracked', [pr(8, { title: 'Bump axios' })])], ['DEV'])[0]!.id).toBe('app-pr-8');
  });
});

describe('readPrs', () => {
  let dir: string | undefined;
  afterEach(() => dir && rmSync(dir, {
    recursive: true,
    force: true,
  }));

  it('fetches only uncached PRs, caches them, and keys results by repo', async () => {
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
      github: 'org/repo',
      cachePath,
    };

    await readPrs(config, 'api', [10, 11], fakeFetch);
    const second = await readPrs(config, 'api', [10, 11, 12], fakeFetch);

    expect(requested).toEqual([
      'https://api.github.com/repos/org/repo/pulls/10',
      'https://api.github.com/repos/org/repo/pulls/11',
      'https://api.github.com/repos/org/repo/pulls/12',
    ]);
    expect(second.get('api#12')).toEqual({
      title: 'PR 3',
      author: 'alex',
    });
    expect(Object.keys(JSON.parse(readFileSync(cachePath, 'utf8')))).toEqual(['10', '11', '12']);
  });
});
