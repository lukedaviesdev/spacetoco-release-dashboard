import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Item, PullRequest, RepoId } from '../../shared/types/snapshot.ts';
import { extractKey, mergeItems } from './git.ts';

export interface PrDetails {
  title: string;
  author: string;
}

export interface GitHubConfig {
  token: string;
  /** owner/name */
  github: string;
  /** Merged PRs never change, so details are cached here across runs. */
  cachePath: string;
}

/** Key for PR details: PR numbers repeat across repos. */
export const prKey = (pr: Pick<PullRequest, 'repo' | 'number'>) => `${pr.repo}#${pr.number}`;

/** PR title and author for each PR; untracked items take their PR's title. */
export const applyPrs = (items: Item[], details: Map<string, PrDetails>): Item[] => items.map((item) => {
  const prs = item.prs.map((pr) => {
    const d = details.get(prKey(pr));
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

/**
 * Untracked items whose PR title names a ticket ('[DEV-1127] ✨ Special Access Spaces') join that ticket,
 * or become it if git found no other work for the key.
 */
export const rekeyByPrTitle = (items: Item[], projects: string[]): Item[] => {
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const item of items) {
    const key = item.kind === 'untracked' && item.prs[0]?.title ? extractKey(item.prs[0].title, projects) : undefined;
    if (!key) continue;
    byId.delete(item.id);
    const asTicket: Item = {
      ...item,
      id: key,
      kind: 'ticket',
      warnings: item.warnings.filter((w) => w !== 'untracked'),
    };
    const ticket = byId.get(key);
    byId.set(key, ticket ? mergeItems(ticket, asTicket) : asTicket);
  }
  return [...byId.values()];
};

export const readPrs = async (
  config: GitHubConfig,
  repo: RepoId,
  numbers: number[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, PrDetails>> => {
  const cache: Record<string, PrDetails> = existsSync(config.cachePath)
    ? JSON.parse(readFileSync(config.cachePath, 'utf8'))
    : {};

  for (const n of numbers.filter((n) => !cache[n])) {
    const res = await fetchImpl(`https://api.github.com/repos/${config.github}/pulls/${n}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) throw new Error(`GitHub GET ${config.github} pulls/${n} failed: ${res.status} ${await res.text()}`);
    const pr = await res.json() as { title: string, user: { login: string } };
    cache[n] = {
      title: pr.title,
      author: pr.user.login,
    };
  }

  mkdirSync(dirname(config.cachePath), { recursive: true });
  writeFileSync(config.cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  return new Map(numbers.filter((n) => cache[n]).map((n) => [prKey({
    repo,
    number: n,
  }), cache[n]!]));
};
