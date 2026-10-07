// Usage: pnpm snapshot [--fetch] [--out public/snapshot.json]
// Reads each repo in REPOS from ~/Dev/<name>, or from <ID>_REPO_PATH (APP_REPO_PATH, API_REPO_PATH).
// Jira and GitHub enrichment run when their env vars are set (see .env.example); otherwise they're skipped.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Item, RepoId, Snapshot } from '../shared/types/snapshot.ts';
import { REPOS } from '../shared/utils/snapshot.ts';
import { judge, pickCurrentRelease } from '../shared/utils/verdicts.ts';
import { addSyncedPresence, buildItems, mergeItems, scanRepo, type PrDetail } from './lib/git.ts';
import { readPrs } from './lib/github.ts';
import { applyJira, dropDoneWithoutCode, readJira } from './lib/jira.ts';

const env = process.env;
const log = (line: string) => process.stdout.write(`${line}\n`);

const { values } = parseArgs({
  options: {
    out: {
      type: 'string',
      default: 'public/snapshot.json',
    },
    fetch: {
      type: 'boolean',
      default: false,
    },
  },
});

const projects = (env.JIRA_PROJECTS || 'DEV,BUG').split(',').map((p) => p.trim());
const pathOf = (repo: typeof REPOS[number]) => (env[`${repo.id.toUpperCase()}_REPO_PATH`] || join('~/Dev', repo.name))
  .replace(/^~(?=\/|$)/, homedir());

const heads: Snapshot['heads'] = {};
const syncedKeys: Partial<Record<RepoId, string[]>> = {};
const byId = new Map<string, Item>();
if (!env.GITHUB_TOKEN) log('GitHub: skipped (set GITHUB_TOKEN). PR titles and bases come from git only.');

for (const repo of REPOS) {
  const path = pathOf(repo);
  if (values.fetch) execFileSync('git', ['-C', path, 'fetch', '--quiet', 'origin', ...repo.branches], { stdio: 'inherit' });
  const scan = scanRepo({
    path,
    repo: repo.id,
    projects,
  });
  heads[repo.id] = scan.heads;
  syncedKeys[repo.id] = scan.syncedKeys;
  // PR titles and bases from GitHub: titles carry ticket keys (and the convention), bases say where a PR was aimed.
  const details = env.GITHUB_TOKEN
    ? await readPrs({
      token: env.GITHUB_TOKEN,
      github: repo.github,
      cachePath: `.cache/github-prs-${repo.id}.json`,
    }, scan.prs.map((pr) => pr.number))
    : new Map<number, PrDetail>();
  const repoItems = buildItems(scan, details, projects);
  for (const item of repoItems) byId.set(item.id, byId.has(item.id) ? mergeItems(byId.get(item.id)!, item) : item);
  const reverted = scan.prs.filter((pr) => pr.revertedOn.length).length;
  log(`${repo.name}: ${scan.prs.length} PRs in scope (${reverted} reverted somewhere), ${repoItems.length} items, `
    + `GitHub details for ${details.size}.`);
}
let items = [...byId.values()];
let releases: Snapshot['releases'] = [];
let currentRelease: Snapshot['currentRelease'] | undefined;
let currentSprint: string | undefined;

if (env.JIRA_EMAIL && env.JIRA_API_TOKEN) {
  const jira = await readJira({
    site: env.JIRA_SITE || 'spacetoco.atlassian.net',
    email: env.JIRA_EMAIL,
    token: env.JIRA_API_TOKEN,
    projects,
    cloudId: env.JIRA_CLOUD_ID || undefined,
  }, items.filter((i) => i.kind === 'ticket').map((i) => i.id));
  items = applyJira(items, jira);
  ({ releases, currentRelease, currentSprint } = jira);
  const unknown = jira.missingKeys.length ? ` (${jira.missingKeys.join(', ')})` : '';
  log(`Jira: ${jira.issues.size} issues, ${releases.length} versions, current release ${currentRelease ?? 'none'}, `
    + `${jira.missingKeys.length} unknown keys${unknown}.`);
}
else {
  log('Jira: skipped (set JIRA_EMAIL and JIRA_API_TOKEN).');
}

items = addSyncedPresence(items, syncedKeys);
const before = items.length;
items = dropDoneWithoutCode(items);
if (before > items.length) log(`Dropped ${before - items.length} Done tickets with no code in either repo.`);

// Jira's earliest unreleased version may have already gone out: skip any whose code is all on main.
const picked = pickCurrentRelease(items, releases);
if (picked.shippedUnmarked.length) {
  log(`Looks shipped but not marked released in Jira: ${picked.shippedUnmarked.join(', ')}. Using ${picked.current ?? 'none'}.`);
}
currentRelease = picked.current;

const judged = judge(items, currentRelease, releases, currentSprint, picked.shippedUnmarked);

const snapshot: Snapshot = {
  generatedAt: new Date().toISOString(),
  heads,
  releases,
  currentRelease,
  ...(picked.shippedUnmarked.length && { shippedUnmarked: picked.shippedUnmarked }),
  ...(currentSprint && { currentSprint }),
  items: judged.items,
  hops: judged.hops,
};

writeFileSync(values.out, `${JSON.stringify(snapshot, null, 2)}\n`);
for (const hop of judged.hops) {
  const back = hop.backSyncIds.length ? `, ${hop.backSyncIds.length} to back-sync` : '';
  log(`  ${hop.repo} ${hop.from}→${hop.to}: ${hop.verdict} (${hop.aheadIds.length} ahead, ${hop.blockingIds.length} blocking${back})`);
}
log(`Wrote ${items.length} items to ${values.out}, verdicts for ${currentRelease ?? 'no release'}.`);
