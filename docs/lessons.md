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

## Environment (for Claude)

- **The preview server config is `~/.claude/launch.json`** (the session root), not `.claude/launch.json` in this repo. The entry is `release-dashboard` (port 3000). (Phase 0)
- **The shell is zsh: unquoted `$var` does not word-split, and a bare `=====` is a command error.** Use arrays or `${a%%:*}` splitting, and `echo '---'` for separators. (Phase 0)
- **Commits in this repo use `lukedaviesweb@gmail.com`** (repo-local config). Don't reset it. (Phase 0)
