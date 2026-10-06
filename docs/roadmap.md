# Roadmap

Source of truth for build phases. Status: `Not started` / `In progress` / `Done`.

Each phase: read `docs/lessons.md` and the listed docs first, build on branch `phase-N-<slug>` from `main` with atomic commits, update the docs as you go, open a PR once the user has checked the "Done when" items locally. Phase 0 goes straight to `main`.

The Phase 0 fixture `snapshot.json` is the contract between the data phases (1–3) and the UI phases (4–5).

---

## Phase 0: Scaffold + contract
**Status:** Done
**Docs:** Nuxt 4, Vuetify 4, vuetify-nuxt-module, Pinia (+ Nuxt), VueUse, Vitest, Nuxt testing

- Nuxt 4 app with pnpm 10 / Node 24, `vuetify-nuxt-module`, `@pinia/nuxt`, `@vueuse/nuxt`, `@vueuse/router`, Vitest + `@nuxt/test-utils`, ESLint (`@nuxt/eslint`).
- `shared/types/snapshot.ts` with the contract from `architecture.md`.
- `public/snapshot.json`: a hand-written fixture covering each presence value, each verdict, each warning, an untracked PR and a hotfix.
- Pinia store loads `/snapshot.json`; page lists items in a plain `v-table`.
- `.env.example` (Jira, GitHub and repo-path settings), `.gitignore`.

**Done when**
- [x] `pnpm dev` shows a Vuetify page listing the fixture's items
- [x] `pnpm test:unit` and `pnpm typecheck` pass (fixture conforms to the types)

**Notes:** the fixture test (`shared/fixtures/snapshot.test.ts`) also asserts the fixture covers every presence, verdict and warning, so the UI phases can't miss a state. Reuse its checks against real script output in Phase 1.

## Phase 1: Git engine
**Status:** Done
**Docs:** git `rev-list`, `log --cherry-mark`, `merge-base`, `patch-id`; Node `child_process`

- `scripts/snapshot.ts` (run with Node 24 native TS) taking `--fetch` (originally `--repo <path>`; repos now come from `REPOS`).
- Commit window (on some env branch but not all), PR number + head ref from merge commits, ticket key extraction, presence per branch (`merged`/`picked`/`partial`/`none`), release vs hotfix from `main` first-parent, untracked items.
- Pure functions and git reading in `scripts/lib/git.ts`; CLI in `scripts/snapshot.ts`.
- The fixture moved to `shared/fixtures/snapshot.json`. `public/snapshot.json` is gitignored: `pnpm fixture` copies the fixture there, `pnpm snapshot` writes real data there.

**Done when**
- [x] `pnpm snapshot` writes a snapshot with git-only data (41 items, ~1s)
- [ ] Spot-check: 5 items' presence matches `git log origin/<branch> --grep <KEY>`; recent hotfixes (e.g. `DEV-1200`) flagged
- [x] Unit tests: a temp git repo is built in the test with a feature merge, a cherry-picked hotfix, a conflict-resolved pick, an untracked PR and a partial ticket, and presence is asserted for each

## Phase 2: Jira + GitHub enrichment (+ spacetoco-api)
**Status:** In progress
**Docs:** Jira REST v3 issue search (`/search/jql`), project versions, scoped API tokens; GitHub REST pulls

- Fetch versions + issues in one JQL; map status category, fixVersions, sprint, assignee; resolve current release; flag invalid keys.
- Fetch PR title/author/mergedAt (cache by PR number in `.cache/`).
- Script works without tokens (git-only) and says what it skipped.
- Added during the phase:
  - **`spacetoco-api` as a second repo.** Same fixVersions; branches develop/staging/main. The contract became per repo.
  - **Released tickets:** `syncedKeys` marks tickets already on every branch, so released tickets aren't shown as missing.
  - **PR-title keys:** untracked PRs are re-keyed from their PR titles.
  - **Read-only guard** in the Jira client.

**Done when**
- [ ] 5 tickets spot-checked against Jira: fixVersion, status, sprint, assignee match
- [ ] Current release = earliest unreleased version
- [ ] Unit tests: recorded Jira/GitHub responses → mapped items; missing key → `invalidKey`

## Phase 3: Verdict engine
**Status:** Not started
**Docs:** `architecture.md` verdict rules

- Pure `computeHops(items, release)` + `computeWarnings(item, release)`.

**Done when**
- [ ] On today's real branches, the verdicts match the user's own judgement
- [ ] Unit tests: table-driven, one case per verdict and warning rule, including `partial` counting as missing

## Phase 4: Wells view (+ design direction, critic loop)
**Status:** Not started
**Docs:** Vuetify data-table (grouping, slots), theming; Pinia setup stores; `@vueuse/router` `useRouteQuery`; `design.md`

- Fill in palette / type / well encoding in `design.md` first, then run `/design-system` to produce tokens and map them onto the Vuetify theme.
- `v-data-table` grouped by fixVersion, wells column, sprint chip, status, assignee, PR links, warning badges.
- Store: filters as `useRouteQuery` refs; getters for filtered/grouped items.
- Critic rounds + AI-tell sweep + craft floor from `design.md`.

**Done when**
- [ ] Looking at real data, the user can spot "in staging but not in release" rows and hotfix rows without reading text
- [ ] Filters round-trip through the URL (copy the link, open it in a new tab, same view)
- [ ] Light/dark, keyboard and screen-reader wells checked; empty/error/200-item states handled
- [ ] Critic ≥9/10 (or plateau noted)
- [ ] Unit tests: store getters (filtering, grouping order)

## Phase 5: Transit map header (+ critic loop)
**Status:** Not started
**Docs:** VueUse `useTimeAgo`; SVG `viewBox`; Vuetify tooltips/chips; `design.md`

- SVG map built from the topology; segment verdict signals; back-sync tracks; click segment to set store hop filter; staleness label; warning chips.
- Critic rounds on the full page.

**Done when**
- [ ] From the header alone the user can say whether `staging→main` is mergeable and whether a back-sync is needed
- [ ] Clicking a segment filters the wells; works by keyboard
- [ ] Reflows at phone width
- [ ] Critic ≥9/10 (or plateau noted)
- [ ] Unit tests: verdict → segment state mapping

## Phase 6: Hosting
**Status:** Not started
**Docs:** GitHub Actions `schedule` + `workflow_dispatch`, `actions/checkout` (other repo + token), `cloudflare/wrangler-action@v4`, Cloudflare Pages, Cloudflare Access self-hosted app

- Workflow: cron `*/30 0-11 * * 1-5` (7am–6pm ICT weekdays) + manual; checkout this repo, `spacetoco/spacetoco-app` and `spacetoco/spacetoco-api` (`REPOS_TOKEN`, `fetch-depth: 0`, paths via `APP_REPO_PATH` / `API_REPO_PATH`) → `pnpm snapshot` → `nuxt generate` → `wrangler pages deploy`.
- First: move the repo from `lukedaviesdev` to the `spacetoco` org (needs `lukedavies-spacetoco` / an org admin). Update `origin` and `CLAUDE.md`.
- Secrets: `REPOS_TOKEN` (also used as `GITHUB_TOKEN` for PR details), `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_CLOUD_ID`, `CLOUDFLARE_API_TOKEN`.
- Decide here, not earlier: static + Action (planned) vs a VPS running Nuxt server routes behind a Cloudflare Tunnel + Access (live data, refresh button; costs ops and ties the tool to a personal box). The snapshot functions work for either.
- Cloudflare Access policy for the Pages domain (and `*.pages.dev` preview URLs).

**Done when**
- [ ] A manual workflow run deploys a fresh snapshot
- [ ] Incognito visit hits the Access login; allowed user gets through
- [ ] The header's snapshot age matches the run time
