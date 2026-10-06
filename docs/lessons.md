# Lessons

Rules learned while building this project. Read this at the start of every phase. When a mistake happens, a check catches something late, or the user corrects an approach, add a rule here in the same commit as the fix.

Format: the rule, then **Why** (what happened) and the phase it came from.

## Dependencies and tooling

- **Check peer and runtime compatibility before pinning to `latest`.** Run `npm view <pkg> peerDependencies` for every tool that wraps another (e.g. `vue-tsc` → `typescript`), and run `pnpm typecheck` straight after installing.
  **Why:** `latest` TypeScript was 7 (native Go); `vue-tsc` 3 only resolves the TS 5/6 JS API, so typecheck crashed. Pinned to `typescript@^6`. (Phase 0)
- **Re-check the TypeScript pin when bumping `vue-tsc`.** Remove the pin only once `pnpm typecheck` passes on TS 7. (Phase 0)
- **Whitelist build scripts in `package.json` → `pnpm.onlyBuiltDependencies`**, not by running `pnpm approve-builds` (interactive). (Phase 0)
- **Watch for auto-import collisions between modules.** Treat `[NUXT_B6002] … already auto-imported` warnings as errors and fix them in config.
  **Why:** Vuetify's `useLayout` shadowed Nuxt's; fixed with `vuetify.moduleOptions.prefixComposables: ['useLayout']`. (Phase 0)
- **Docs live where the version lives.** vuetify-nuxt-module docs are at `nuxt.vuetifyjs.com`; Pinia's docs source is the `v4` branch of `vuejs/pinia`. Confirm a docs URL matches the installed major version before following it. (Phase 0)

## Data and tests

- **Fixtures must prove their own coverage.** Every fixture gets a test asserting it contains every enum value (presence, verdict, warning) it's meant to exercise, not just that it's well-formed.
  **Why:** the first fixture had no `clean` hop; only the coverage assertion caught it. (Phase 0)
- **Keep enums as `as const` arrays in `shared/utils/` and derive types from them**, so tests and runtime checks iterate the same source the types come from. (Phase 0)
- **Fixture data must be internally consistent with the verdict rules in `architecture.md`.** When editing presence, recompute the affected hops' `aheadIds` / `blockingIds` / `backSyncIds` by hand. (Phase 0)
- **A cherry-picked copy belongs to the same ticket as its original, so compare *changes*, not commits.** Group copies (patch-id / keyed subject) and decide presence from which copy a branch holds.
  **Why:** the first engine marked DEV-5's own develop commit as "picked" because the staging copy matched it; the temp-repo test caught it. (Phase 1)
- **Build git scenarios in a temp repo inside the test** (`mkdtemp` + scripted commits/merges/cherry-picks) rather than mocking git output. It's what caught the copy bug. (Phase 1)
- **Real snapshots contain internal ticket data: never commit them.** `public/snapshot.json` is gitignored; the committed fixture lives in `shared/fixtures/`. Doubly important while the repo is on a personal account. (Phase 1)
- **Check every new directory is in a typecheck context.** Nuxt only typechecks its own dirs (`pages/`, `composables/`, `server/`, `shared/`…) by default; `scripts/` is added via `typescript.nodeTsConfig.include`. (Phase 1)

- **A ticket isn't "missing" just because it's outside the git window.** Work already on every branch never enters the window, so check each repo's shared history for the key (`syncedKeys`).
  **Why:** the first real Jira run showed 65 Done tickets in 27.3.0 as "on no branch" when they were already released. (Phase 2)
- **Find keys anywhere a human puts them: branch name, commit subject, PR title.** (Phase 2, `#1173 specialaccessdemo` was titled `[DEV-1127] …`)
- **Ask what else ships under the same Jira keys before trusting "not merged" signals.** DEV tickets also land in `spacetoco-api`; without that repo they'd all read as missing. (Phase 2, user correction)
- **External API facts come from current docs, not memory.** Scoped Atlassian tokens only work via `api.atlassian.com/ex/jira/{cloudId}`, and `bulkfetch` silently drops unknown keys. Both were found by reading the docs first. (Phase 2)

- **Done tickets with no code anywhere are noise, not missing work.** Drop them; only warn about release tickets that aren't Done yet. The user doesn't track legacy tickets.
  **Why:** 27.3.0 carried ~60 legacy Casual Bookings tickets with no commits under their keys. (Phase 2, user decision)

- **Generate fixture verdicts from the engine, and test that they agree.** Hand-computed hops were wrong twice (Phase 0's fixture missed a `partial` being ahead). `shared/utils/verdicts.test.ts` now fails if fixture and engine disagree.
  **Why:** Phase 3's first run flagged main→demo as `sync`, not the fixture's `in-sync`. (Phase 3)
- **Anything the snapshot CLI imports must use explicit `.ts` import paths, `shared/` included.** Vitest resolves extensionless imports and plain Node doesn't, so tests passed while the CLI would crash. `scripts/node-imports.test.ts` guards it. (Phase 3)
- **Warnings have one owner: `computeWarnings`.** Earlier phases set some warnings inline, which would have drifted from the release-dependent ones. (Phase 3)

- **Readiness differs per hop.** develop→staging only needs the ticket in the release (staging is where it gets tested); staging→main also needs it Done. A single "ready" rule for both hops was wrong. (Phase 3, user correction)

## Conventions

- **Match spacetoco-app's conventions from the start, and check the monorepo before inventing a pattern.** Layout, store naming, colocated tests and lint rules are in `CLAUDE.md`.
  **Why:** the user wants this to drop into the monorepo later; Phase 0/1 used Nuxt 4 defaults (`app/`, `test/`) and had to be moved. (Phase 1, user correction)
- **Use `srcDir: '.'` + `dir: { app: 'app' }` for root-level folders, not `future.compatibilityVersion: 3`.** The monorepo uses the latter, but Nuxt 4.6's types reject it. (Phase 1)
- **App `eslint.config.mjs` has no `// @ts-check`**, as in the monorepo; the a11y plugin's types don't fit `withNuxt`. (Phase 1)
- **`comma-dangle: always-multiline` is on**, because `object-property-newline` autofix otherwise leaves multiline objects without trailing commas. (Phase 1)
- **CLI output goes through `process.stdout.write`**, since `no-console` only allows warn/error. (Phase 1)

## Safety

- **Read-only towards SpacetoCo, for the app and for Claude.** Never write to Jira or the `spacetoco` GitHub org/repos: no issues, comments, PRs, transitions, pushes. The Jira client refuses non-read requests in code. If a SpacetoCo repo needs a change, hand the user the diff. (Phase 2, user rule)
- **Never handle the user's tokens.** They create them and put them in `.env`; Claude doesn't paste, print or create them. (Phase 2)

## Environment (for Claude)

- **The preview server config is `~/.claude/launch.json`** (the session root), not `.claude/launch.json` in this repo. The entry is `release-dashboard` (port 3000). (Phase 0)
- **The shell is zsh: unquoted `$var` does not word-split, and a bare `=====` is a command error.** Use arrays or `${a%%:*}` splitting, and `echo '---'` for separators. (Phase 0)
- **Commits in this repo use `lukedaviesweb@gmail.com`** (repo-local config). Don't reset it. (Phase 0)
- **No git auth switching is needed until Phase 6.** The snapshot reads the local monorepo clone with existing credentials; `gh` pushes as `lukedaviesdev`. (Phase 1)
- **Open a PR at the end of every phase, without being reminded.** (Phase 1, user correction)
- **Don't use `git stash` for quick experiments.** `git stash -- <untracked file>` stashes nothing, and a following `stash drop` would drop someone else's stash. Edit and revert the file directly. (Phase 3)
