// Usage: pnpm snapshot --repo ~/Dev/spacetoco-app [--fetch] [--out public/snapshot.json]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import type { Snapshot } from '../shared/types/snapshot.ts';
import { BRANCHES } from '../shared/utils/snapshot.ts';
import { readGit } from './lib/git.ts';

const { values } = parseArgs({
  options: {
    repo: {
      type: 'string',
      default: process.env.MONOREPO_PATH,
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

if (values.fetch) execFileSync('git', ['-C', repo, 'fetch', '--quiet', 'origin', ...BRANCHES], { stdio: 'inherit' });

const { heads, items } = readGit({ repo });

const snapshot: Snapshot = {
  generatedAt: new Date().toISOString(),
  heads,
  releases: [],
  currentRelease: null,
  items,
  hops: [],
};

writeFileSync(values.out, `${JSON.stringify(snapshot, null, 2)}\n`);
process.stdout.write(`Wrote ${items.length} items to ${values.out} (Jira, GitHub and verdicts skipped: Phases 2-3).\n`);
