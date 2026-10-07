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

- **Model the team's actual release process, not a generic one.** develop always merges into staging whole and gets tested there; the only cherry-picking is out of staging before main. So develop→staging needs only release membership and reports `merge-with-extras`, never `cherry-pick`; staging→main needs release + Done. (Phase 3, user correction ×2)

- **A static or dev server answers a missing file with the app's HTML and a 200.** Validate fetched JSON's shape before trusting it; the first missing-snapshot test showed Nuxt's 500 page. (Phase 4)
- **Pass Nuxt's `useRoute()` / `useRouter()` to `useRouteQuery` inside Pinia stores**, otherwise the store throws outside component setup (tests). (Phase 4)
- **Vuetify sorts group keys numerically, so "0" and "00" tie.** Use letters for group order keys. (Phase 4)
- **One huge cell can wreck an auto-layout table.** DEV-1189's 7 PR links set the PRs column to 475px. Cap lists in cells (first item plus "+N"). (Phase 4)

- **A ticket can ship once and then get another PR.** Its shipped commits sit outside the window, so only the new PR is visible, and the ticket looked as if it had never left develop. Fold synced keys in as `partial` on branches missing the new work. (Phase 5, DEV-1237, spotted by the user)
- **When the user questions a flag, check it against raw git before answering.** Five of six "Released, not on main" were true, but one exposed a modelling gap. (Phase 5)

- **"Released, not on main" needs a degree.** A hotfix that shipped and then got follow-up commits on develop isn't the same as work that never shipped. Split none vs partial (DEV-1194: #1107 hotfix to main, #1111 follow-ups on develop). (Phase 5, user question)

- **Audit the model against every data source before trusting it, and early.** The commit-level engine was built on the *described* process ("develop merges into staging"); one read-only pass over GitHub PRs × git ancestry × Jira showed staging is assembled per ticket, hotfixes fan out as PRs, and some paths never ride the branches. Do this audit in Phase 1 next time. (Phase 5, user prompt)
- **Ask where testing happens before modelling statuses.** "Done" meant "tested on dev", not "on staging". (Phase 5)
- **Read the source behind a referenced document before modelling it.** The Confluence "release sheet" turned out to be a live Jira query on fixVersion. (Phase 5)

- **"Every file is exempt" needs neutral files.** Root `package.json` and lockfiles ride along with any change; without ignoring them DEV-874 (Terraform) and DEV-1336 (tests) weren't exempt. Check classification rules against real PRs, not just the scripted repo. (Phase 6)
- **Untested work reaching main matters more than untested work on staging.** `not-tested` first only looked at staging, which missed BUG-554 already on main. (Phase 6)
- **Split engines into a git scan and a pure build step.** The scripted-repo test drives the scan once, and every rule in `buildItems` is checked without I/O. (Phase 6)

- **"Current release = earliest unreleased version" trusts Jira housekeeping that lags.** 27.3.0 shipped on 1 Oct but wasn't marked released, so every verdict was judged against the previous release. Detect "looks shipped" from the branches and say so. A strict "all on main" rule never fires, because releases leave stragglers (DEV-1159), so use a majority. (Phase 6, user correction)
- **When the user says the data is wrong, show them the data before changing rules.** "None of these have fixVersions" turned out to be 11 of 29; the real problem was the stale current release. (Phase 6)

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

## Design process

- **Stop the critic loop when the score plateaus and the critics contradict each other.** Act only on points that recur across rounds. Five rounds went 5, 5, 6, 5, 5. (Phase 4)
- **Check the real-data distribution before choosing emphasis.** Ruling every amber row looked fine on the fixture, but on real data 25 of 34 rows were amber. (Phase 4)
- **Check text colours against WCAG with a script, not by eye.** Three light-mode signal colours were below 4.5:1 on the warm background. (Phase 4)

## Environment (for Claude)

- **The preview server config is `~/.claude/launch.json`** (the session root), not `.claude/launch.json` in this repo. The entry is `release-dashboard` (port 3000). (Phase 0)
- **The shell is zsh: unquoted `$var` does not word-split, and a bare `=====` is a command error.** Use arrays or `${a%%:*}` splitting, and `echo '---'` for separators. (Phase 0)
- **Commits in this repo use `lukedaviesweb@gmail.com`** (repo-local config). Don't reset it. (Phase 0)
- **No git auth switching is needed until Phase 7 (hosting).** The snapshot reads the local monorepo clone with existing credentials; `gh` pushes as `lukedaviesdev`. (Phase 1)
- **Open a PR at the end of every phase, without being reminded.** (Phase 1, user correction)
- **The browser pane may be hidden, so screenshots time out.** Use headless Chrome against `nuxt generate` + `python3 -m http.server`; force the theme with `--blink-settings=preferredColorScheme=0` (dark) or `=1` (light). (Phase 4)
- **`gh pr edit` can fail on a Projects (classic) GraphQL error.** Update PR bodies with `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -F body=@file` instead. (Phase 3)
- **Gate commits on the checks with `&&` (`pnpm -s lint && pnpm -s typecheck && pnpm -s test:unit && git commit …`).** A `;` let a lint error through into a commit. (Phase 4)
- **Don't use `git stash` for quick experiments.** `git stash -- <untracked file>` stashes nothing, and a following `stash drop` would drop someone else's stash. Edit and revert the file directly. (Phase 3)
