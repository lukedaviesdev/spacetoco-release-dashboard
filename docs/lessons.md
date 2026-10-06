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

## Conventions

- **Match spacetoco-app's conventions from the start, and check the monorepo before inventing a pattern.** Layout, store naming, colocated tests and lint rules are in `CLAUDE.md`.
  **Why:** the user wants this to drop into the monorepo later; Phase 0/1 used Nuxt 4 defaults (`app/`, `test/`) and had to be moved. (Phase 1, user correction)
- **Use `srcDir: '.'` + `dir: { app: 'app' }` for root-level folders, not `future.compatibilityVersion: 3`.** The monorepo uses the latter, but Nuxt 4.6's types reject it. (Phase 1)
- **App `eslint.config.mjs` has no `// @ts-check`**, as in the monorepo; the a11y plugin's types don't fit `withNuxt`. (Phase 1)
- **`comma-dangle: always-multiline` is on**, because `object-property-newline` autofix otherwise leaves multiline objects without trailing commas. (Phase 1)
- **CLI output goes through `process.stdout.write`**, since `no-console` only allows warn/error. (Phase 1)

## Environment (for Claude)

- **The preview server config is `~/.claude/launch.json`** (the session root), not `.claude/launch.json` in this repo. The entry is `release-dashboard` (port 3000). (Phase 0)
- **The shell is zsh: unquoted `$var` does not word-split, and a bare `=====` is a command error.** Use arrays or `${a%%:*}` splitting, and `echo '---'` for separators. (Phase 0)
- **Commits in this repo use `lukedaviesweb@gmail.com`** (repo-local config). Don't reset it. (Phase 0)
- **No git auth switching is needed until Phase 6.** The snapshot reads the local monorepo clone with existing credentials; `gh` pushes as `lukedaviesdev`. (Phase 1)
- **Open a PR at the end of every phase, without being reminded.** (Phase 1, user correction)
