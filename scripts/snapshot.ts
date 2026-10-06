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
import { judge } from '../shared/utils/verdicts.ts';
import { addSyncedPresence, mergeItems, readGit } from './lib/git.ts';
import { applyPrs, readPrs, rekeyByPrTitle, type PrDetails } from './lib/github.ts';
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

for (const repo of REPOS) {
  const path = pathOf(repo);
  if (values.fetch) execFileSync('git', ['-C', path, 'fetch', '--quiet', 'origin', ...repo.branches], { stdio: 'inherit' });
  const git = readGit({
    path,
    repo: repo.id,
    projects,
  });
  heads[repo.id] = git.heads;
  syncedKeys[repo.id] = git.syncedKeys;
  for (const item of git.items) byId.set(item.id, byId.has(item.id) ? mergeItems(byId.get(item.id)!, item) : item);
  log(`git ${repo.name}: ${git.items.length} items not on every branch.`);
}
let items = [...byId.values()];
let releases: Snapshot['releases'] = [];
let currentRelease: Snapshot['currentRelease'] = null;

if (env.GITHUB_TOKEN) {
  const details = new Map<string, PrDetails>();
  for (const repo of REPOS) {
    const numbers = [...new Set(items.flatMap((i) => i.prs.filter((pr) => pr.repo === repo.id).map((pr) => pr.number)))];
    const found = await readPrs({
      token: env.GITHUB_TOKEN,
      github: repo.github,
      cachePath: `.cache/github-prs-${repo.id}.json`,
    }, repo.id, numbers);
    for (const [key, d] of found) details.set(key, d);
  }
  // Before Jira, so tickets found via PR titles get their Jira data too.
  items = rekeyByPrTitle(applyPrs(items, details), projects);
  log(`GitHub: details for ${details.size} PRs.`);
}
else {
  log('GitHub: skipped (set GITHUB_TOKEN).');
}

if (env.JIRA_EMAIL && env.JIRA_API_TOKEN) {
  const jira = await readJira({
    site: env.JIRA_SITE || 'spacetoco.atlassian.net',
    email: env.JIRA_EMAIL,
    token: env.JIRA_API_TOKEN,
    projects,
    cloudId: env.JIRA_CLOUD_ID || undefined,
  }, items.filter((i) => i.kind === 'ticket').map((i) => i.id));
  items = applyJira(items, jira);
  ({ releases, currentRelease } = jira);
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

const judged = judge(items, currentRelease);

const snapshot: Snapshot = {
  generatedAt: new Date().toISOString(),
  heads,
  releases,
  currentRelease,
  items: judged.items,
  hops: judged.hops,
};

writeFileSync(values.out, `${JSON.stringify(snapshot, null, 2)}\n`);
for (const hop of judged.hops) {
  const back = hop.backSyncIds.length ? `, ${hop.backSyncIds.length} to back-sync` : '';
  log(`  ${hop.repo} ${hop.from}→${hop.to}: ${hop.verdict} (${hop.aheadIds.length} ahead, ${hop.blockingIds.length} blocking${back})`);
}
log(`Wrote ${items.length} items to ${values.out}, verdicts for ${currentRelease ?? 'no release'}.`);
