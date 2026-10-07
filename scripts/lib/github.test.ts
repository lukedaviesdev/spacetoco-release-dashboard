// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readPrs } from './github';

describe('readPrs', () => {
  let dir: string | undefined;
  afterEach(() => dir && rmSync(dir, {
    recursive: true,
    force: true,
  }));

  const setup = () => {
    dir = mkdtempSync(join(tmpdir(), 'release-dashboard-gh-'));
    const requested: string[] = [];
    const fakeFetch = (async (input: string | URL) => {
      requested.push(String(input));
      return new Response(JSON.stringify({
        title: `PR ${requested.length}`,
        user: { login: 'alex' },
        base: { ref: 'staging' },
      }));
    }) as typeof fetch;
    return {
      requested,
      fakeFetch,
      config: {
        token: 't',
        github: 'org/repo',
        cachePath: join(dir, 'prs.json'),
      },
    };
  };

  it('fetches title, author and base for uncached PRs only, and caches them', async () => {
    const { requested, fakeFetch, config } = setup();
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
      base: 'staging',
    });
    expect(Object.keys(JSON.parse(readFileSync(config.cachePath, 'utf8')))).toEqual(['10', '11', '12']);
  });

  it('refetches cache entries written before the base branch was recorded', async () => {
    const { requested, fakeFetch, config } = setup();
    writeFileSync(config.cachePath, JSON.stringify({
      10: {
        title: 'old',
        author: 'sam',
      },
    }));
    const details = await readPrs(config, [10], fakeFetch);
    expect(requested).toHaveLength(1);
    expect(details.get(10)!.base).toBe('staging');
  });

  it('throws with the status when GitHub refuses', async () => {
    const { config } = setup();
    const refuse = (async () => new Response('Not Found', { status: 404 })) as typeof fetch;
    await expect(readPrs(config, [1], refuse)).rejects.toThrow('404');
  });
});
