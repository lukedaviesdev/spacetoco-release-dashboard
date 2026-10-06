import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Item } from '../../shared/types/snapshot.ts';

export interface PrDetails {
  title: string;
  author: string;
}

export interface GitHubConfig {
  token: string;
  /** owner/name */
  repo: string;
  /** Merged PRs never change, so details are cached here across runs. */
  cachePath: string;
}

/** PR title and author for each PR; untracked items take their PR's title. */
export const applyPrs = (items: Item[], details: Map<number, PrDetails>): Item[] => items.map((item) => {
  const prs = item.prs.map((pr) => {
    const d = details.get(pr.number);
    return d ? {
      ...pr,
      title: d.title,
      author: d.author,
    } : pr;
  });
  const untrackedTitle = item.kind === 'untracked' && prs[0]?.title;
  return {
    ...item,
    prs,
    ...(untrackedTitle && { title: untrackedTitle }),
  };
});

export const readPrs = async (
  config: GitHubConfig,
  numbers: number[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<number, PrDetails>> => {
  const cache: Record<string, PrDetails> = existsSync(config.cachePath)
    ? JSON.parse(readFileSync(config.cachePath, 'utf8'))
    : {};

  for (const n of numbers.filter((n) => !cache[n])) {
    const res = await fetchImpl(`https://api.github.com/repos/${config.repo}/pulls/${n}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) throw new Error(`GitHub GET pulls/${n} failed: ${res.status} ${await res.text()}`);
    const pr = await res.json() as { title: string, user: { login: string } };
    cache[n] = {
      title: pr.title,
      author: pr.user.login,
    };
  }

  mkdirSync(dirname(config.cachePath), { recursive: true });
  writeFileSync(config.cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  return new Map(numbers.filter((n) => cache[n]).map((n) => [n, cache[n]!]));
};
