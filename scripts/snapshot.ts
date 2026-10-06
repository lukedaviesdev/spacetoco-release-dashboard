// Usage: pnpm snapshot --repo ~/Dev/spacetoco-app [--fetch] [--out public/snapshot.json]
// Jira and GitHub enrichment run when their env vars are set (see .env.example); otherwise they're skipped.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import type { Snapshot } from '../shared/types/snapshot.ts';
import { BRANCHES } from '../shared/utils/snapshot.ts';
import { readGit } from './lib/git.ts';
import { applyPrs, readPrs } from './lib/github.ts';
import { applyJira, readJira } from './lib/jira.ts';

const env = process.env;
const log = (line: string) => process.stdout.write(`${line}\n`);

const { values } = parseArgs({
  options: {
    repo: {
      type: 'string',
      default: env.MONOREPO_PATH,
    },
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

if (!values.repo) {
  console.error('Pass --repo <path to spacetoco-app> or set MONOREPO_PATH.');
  process.exit(1);
}
const repo = values.repo.replace(/^~(?=\/|$)/, homedir());
const projects = (env.JIRA_PROJECTS ?? 'DEV,BUG').split(',').map((p) => p.trim());

if (values.fetch) execFileSync('git', ['-C', repo, 'fetch', '--quiet', 'origin', ...BRANCHES], { stdio: 'inherit' });

const { heads, items: gitItems } = readGit({
  repo,
  projects,
});
let items = gitItems;
let releases: Snapshot['releases'] = [];
let currentRelease: Snapshot['currentRelease'] = null;

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

if (env.GITHUB_TOKEN) {
  const numbers = [...new Set(items.flatMap((i) => i.prs.map((pr) => pr.number)))];
  const details = await readPrs({
    token: env.GITHUB_TOKEN,
    repo: env.GITHUB_REPO || 'spacetoco/spacetoco-app',
    cachePath: '.cache/github-prs.json',
  }, numbers);
  items = applyPrs(items, details);
  log(`GitHub: details for ${details.size} PRs.`);
}
else {
  log('GitHub: skipped (set GITHUB_TOKEN).');
}

const snapshot: Snapshot = {
  generatedAt: new Date().toISOString(),
  heads,
  releases,
  currentRelease,
  items,
  hops: [],
};

writeFileSync(values.out, `${JSON.stringify(snapshot, null, 2)}\n`);
log(`Wrote ${items.length} items to ${values.out} (verdicts: Phase 3).`);
