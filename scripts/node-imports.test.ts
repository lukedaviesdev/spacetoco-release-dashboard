// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// Vitest resolves extensionless imports, plain Node does not. The snapshot CLI runs on plain Node, so every module it
// loads (including shared/) must import with explicit `.ts` extensions. This loads them the way the CLI does.
it('loads every module the snapshot CLI uses under plain Node', () => {
  const modules = ['./scripts/lib/git.ts', './scripts/lib/github.ts', './scripts/lib/jira.ts', './shared/utils/verdicts.ts'];
  const root = fileURLToPath(new URL('..', import.meta.url));
  const script = `${modules.map((m) => `await import('${m}');`).join(' ')} console.log('ok');`;
  expect(execFileSync('node', ['--input-type=module', '-e', script], {
    cwd: root,
    encoding: 'utf8',
  }).trim()).toBe('ok');
});
