import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PrDetail } from './git.ts';

export interface GitHubConfig {
  token: string;
  /** owner/name */
  github: string;
  /** Merged PRs never change, so details are cached here across runs. */
  cachePath: string;
}

/** Title, author and base branch for each PR number (read-only GETs; cached on disk). */
export const readPrs = async (
  config: GitHubConfig,
  numbers: number[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<number, PrDetail>> => {
  const cache: Record<string, PrDetail> = existsSync(config.cachePath)
    ? JSON.parse(readFileSync(config.cachePath, 'utf8'))
    : {};

  // Entries cached before the base branch was recorded are fetched again.
  for (const n of numbers.filter((n) => !cache[n]?.base)) {
    const res = await fetchImpl(`https://api.github.com/repos/${config.github}/pulls/${n}`, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${config.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) throw new Error(`GitHub GET ${config.github} pulls/${n} failed: ${res.status} ${await res.text()}`);
    const pr = await res.json() as { title: string, user: { login: string }, base: { ref: string } };
    cache[n] = {
      title: pr.title,
      author: pr.user.login,
      base: pr.base.ref,
    };
  }

  mkdirSync(dirname(config.cachePath), { recursive: true });
  writeFileSync(config.cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  return new Map(numbers.filter((n) => cache[n]).map((n) => [n, cache[n]!]));
};
