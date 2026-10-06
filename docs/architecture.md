# Architecture

Read-only dashboard showing which work (Jira tickets / PRs) sits on which environment branch of `spacetoco/spacetoco-app` (frontend monorepo) and `spacetoco/spacetoco-api` (backend), and whether each branch hop is a clean merge, needs cherry-picking, or needs a back-sync. Interim tool until trunk-based development.

**Read-only, for the app and for Claude building it.** Nothing ever writes to Jira or the `spacetoco` GitHub org: no merges, cherry-picks, pushes, comments or transitions. Git only fetches and reads; GitHub is GET only; Jira is GET plus the two read endpoints that take a body (`issue/bulkfetch`, `search/jql`), and `scripts/lib/jira.ts` refuses any other non-GET.

## Repos and branch topology

Both repos use the same Jira projects (DEV, BUG) and the **same fixVersions**, so one ticket can have work in either repo or both. Repos, branches and hops are defined once in `shared/utils/snapshot.ts` (`REPOS`).

```
spacetoco-app:  develop ──▶ staging ──▶ main ──▶ demo
                                          │
                                          └──▶ main-uk ──▶ demo-uk

spacetoco-api:  develop ──▶ staging ──▶ main
```

Forward hops: app `develop→staging`, `staging→main`, `main→demo`, `main→main-uk`, `main-uk→demo-uk`; api `develop→staging`, `staging→main`.

## Data flow: compute vs display

```
             ┌──────────────── snapshot script (Node, scripts/snapshot.ts) ───────────────┐
 git clone ─▶│ git engine ─▶ Jira + GitHub enrichment ─▶ verdict engine ─▶ snapshot.json │─▶ public/snapshot.json
             └─────────────────────────────────────────────────────────────────────────────┘
                                                                                   │
                                          Nuxt static app (nuxt generate) ◀────────┘
                                          Pinia store loads /snapshot.json
```

- **All logic runs in the snapshot script.** The frontend only renders `snapshot.json`.
- **Locally:** `pnpm snapshot` (reads `~/Dev/spacetoco-app` and `~/Dev/spacetoco-api`) then `pnpm dev`. No server, no tokens needed for the git-only part.
- **Repo:** built in `lukedaviesdev/spacetoco-release-dashboard` (personal, private) through Phase 5, then moved to the `spacetoco` org before Phase 6, so the Action runs on the org's minutes and secrets.
- **Hosted:** a GitHub Action in *this* repo checks out both repos with a read-only PAT, runs the same script, runs `nuxt generate` and deploys to Cloudflare Pages. Cloudflare Access sits in front of it as the login. One code path for local and hosted.
- **No changes to either repo, ever.** Triggers are cron + manual `workflow_dispatch` only (a push trigger would need a workflow in the monorepo).
- Shared types and pure logic live in `shared/` (Nuxt 4 convention), so the script and the app import the same `Snapshot` types.

### Why not a server / VPS / live git

- Cloudflare (team standard) has no git binary at the edge; a VPS means building and owning auth + ops for a temporary tool.
- Snapshot data is up to ~30 min old in working hours. Acceptable for release planning; the header shows its age and turns amber after 2h.

## Sources and access

| Source | Used for | Auth |
|---|---|---|
| git (bare/partial clone or local checkout) | which commits/tickets are on which branch, releases vs hotfixes | local: none. Action: fine-grained PAT `REPOS_TOKEN` (spacetoco-app and spacetoco-api only; Contents, Metadata, Pull requests: read) |
| GitHub REST | PR title, author (cached per repo in `.cache/`) | same PAT |
| Jira Cloud REST v3 (`spacetoco.atlassian.net`) | fixVersion, status category, sprint, assignee, versions list | scoped read-only API token: `JIRA_EMAIL` + `JIRA_API_TOKEN` (`read:jira-work`) |

Secrets: local `.env` (gitignored), Action repo secrets. Nothing secret ever reaches the static bundle.

Confluence is **not** a source: the release sheet there is just a view of Jira data, which this dashboard replaces.

## Git engine rules

**The git engine runs once per repo**, and items with the same ticket key are merged across repos (`mergeItems`). Untracked ids are prefixed with the repo (`app-pr-1066`), and every PR carries its `repo` because PR numbers repeat across repos.

**Window.** Only commits reachable from at least one env branch but not from all six. Work synced everywhere never appears. This naturally covers "past sprints" (old work still stuck somewhere) without a date window. Legacy `EC-` work falls outside it.

**Ticket key extraction** (projects `DEV`, `BUG`; list read from Jira, not hard-coded):
1. PR head branch name from the merge commit subject: `Merge pull request #1162 from spacetoco/DEV-1314-…` gives PR `#1162` and key `DEV-1314`.
2. Fallback: commit subject `[DEV-1314] 🐛 …`.
3. No key found → **untracked** item, identified by PR number + branch name (e.g. `#1066 seo-hotfix`). Never dropped.
4. Key not found in Jira (typos like `DEV-11940`, wrong prefix) → item flagged `invalidKey`.

**Item grouping** (per non-merge commit in the window):
1. It came through a PR whose head ref has a key → that ticket (a commit can belong to several keyed PRs).
2. Else its subject has a key → that ticket.
3. Else the oldest PR it came through → untracked item `<repo>-pr-<n>`.
4. Else (pushed directly) → untracked item `<repo>-commit-<sha7>`.
5. After GitHub enrichment: an untracked PR whose **PR title** has a key (`[DEV-1127] ✨ Special Access Spaces`) joins that ticket.

PRs whose head ref *is* an env branch (`Merge pull request #1165 from spacetoco/staging`) are release/sync PRs carrying other PRs' commits, so they are skipped. A PR's commits are `M^1..M^2` of its merge commit.

**Changes and copies.** Commits that are copies of the same change are grouped: same `git patch-id --stable`, or the same subject *when that subject has a ticket key* (catches picks whose diff changed in conflict resolution; generic subjects like "fix lint" would join unrelated commits). The change's **original** is its oldest copy that came through a PR, else its oldest copy.

**Presence per item per branch**, combined over the item's changes:

| Presence | Meaning |
|---|---|
| `merged` | the branch holds the original of every change |
| `picked` | every change present, at least one only as a copy (cherry-picked / hotfixed across) |
| `partial` | some changes present, some missing |
| `none` | none present |

**Already released everywhere.** Work on every branch of a repo is outside the window, so the engine also lists ticket keys found in each repo's shared history (`syncedKeys`). A ticket with a synced key and no window work in that repo is marked `merged` on all of that repo's branches. Without this, a released ticket in an unreleased fixVersion would look like it's on no branch.

**Releases vs hotfixes.** No git tags exist. A PR's base is the most upstream env branch whose first-parent history contains its merge commit. An item is a **hotfix** if any of its PRs merged straight into a branch other than `develop` (e.g. `DEV-1314` → staging, `DEV-1200-space-loading-bug-main` → main).

## Jira rules

- One JQL search (`/rest/api/3/search/jql`, the old `/search` is deprecated):
  `project in (DEV, BUG) AND (fixVersion in unreleasedVersions() OR key in (<keys found in git window>))`
- Versions via `/rest/api/3/project/{key}/versions`.
- **Current release** = earliest unreleased fixVersion (by `releaseDate`, then name). Selectable in the UI. Versions are marked released in Jira when they ship.
- **Done** = status category `done`, not status names.
- **Status lifecycle vs branches** (the team's workflow): **In testing** while the work is on staging being tested manually → **Done** once testing passes (ready for main) → **Released** once merged to main. Done and Released are both in the `done` category, which is what staging→main requires. Real statuses are numbered, e.g. `(5) Ready for Testing`, `(6) In testing`, `(7) Done`, `(8) READY TO RELEASE`, `RELEASED`.
- Items are **grouped by fixVersion**; sprint is shown as a chip on each row for readability, and is a filter.
- Tickets in unreleased fixVersions that aren't on any branch yet still appear (rows of empty wells) **unless they're Done**. A Done ticket with no work in either repo is a legacy ticket or work committed under other keys, and is dropped (`dropDoneWithoutCode`). This covers "future sprints" without flooding a release with old tickets.

## Verdict rules

Implemented in `shared/utils/verdicts.ts` (`computeHops`, `computeWarnings`, `judge`). It lives in `shared/` so the snapshot precomputes verdicts for the current release, and the app can recompute them when another release is picked. Computed per repo, per hop `A→B`.

**Ahead / back-sync.** Each item's presence on a branch ranks `none` < `partial` < `merged` = `picked`. The item is *ahead* on `A→B` when A ranks higher than B, and needs a *back-sync* when B ranks higher than A. Two `partial`s can't be compared, so they're neither. Items with no work in the repo are ignored for its hops.

**Ready** = its fixVersions include the selected release **or a rolling version** (`ROLLING_VERSIONS`: "Rolling Hotfixes", which ships with whatever release is next and is never the current release). Going to main also needs it **Done**:
- `develop→staging`: in the release, any status. Staging is where release work gets tested.
- `staging→main`: in the release **and Done**. Anything else on staging is what gets cherry-picked out before main. This is the gate that matters.

| Hop | Verdict | Condition |
|---|---|---|
| `develop→staging` (each repo) | `in-sync` | nothing ahead |
| | `clean` | everything coming over is in the release |
| | `merge-with-extras` | develop still merges whole, but work outside the release comes along (`blockingIds`). It'll show as cherry-pick-outs at staging→main. Untracked work always counts as extra. |
| `staging→main` (each repo) | `in-sync` / `clean` | nothing ahead / everything ahead is in the release and Done |
| | `cherry-pick` | items on staging that aren't in the release and Done (`blockingIds`): cherry-pick the rest to main, or hold these back |
| app `main→demo`, `main→main-uk`, `main-uk→demo-uk` | `in-sync` / `sync` | `sync` = N items ahead |
| every hop | `backSyncIds` | reported alongside the forward verdict |

**Warnings** (`computeWarnings` is their only owner):

| Warning | When |
|---|---|
| `extra-on-staging` | on staging ahead of main but not in the selected release (or a rolling version), whatever its status. It must not go to main. Unlike staging→main's `blockingIds`, this excludes release work that's only still being tested. |
| `not-on-develop` | in the selected release, but not fully on develop in every repo it has work in (or no work anywhere yet) |
| `missed-release` | every non-rolling fixVersion has shipped, but the work isn't fully on main. Either the fixVersion is stale or the work missed its release. It still blocks, so nothing goes out without being re-approved. |
| `status-mismatch` | Jira's lifecycle disagrees with the code: status is Released (matched by name, `/\breleased\b/i`, because Done and Released share the `done` category) but the work isn't fully on main, **or** it's fully on main but not Released |
| `done-no-fixversion` | Done with no fixVersion |
| `invalid-key` | key not found in Jira |
| `untracked` | no ticket key |

## Snapshot contract

The source of truth is `shared/types/snapshot.ts`, with enums and the `REPOS` topology in `shared/utils/snapshot.ts`. In short:
- `heads[repo][branch]`: short SHAs.
- `releases`, `currentRelease`: from Jira versions.
- `items[]`: one per ticket key or untracked PR/commit. `presence[repo][branch]` only lists repos with work for the item, and is empty for a ticket not merged anywhere yet. Each PR has a `repo`.
- `hops[]`: one per repo hop, with `verdict`, `aheadIds`, `blockingIds`, `backSyncIds`.

## Stack

Matches the monorepo's versions: pnpm 10, Node 24, Nuxt 4, Vue 3, Vuetify 4 via `vuetify-nuxt-module`, Pinia via `@pinia/nuxt`, VueUse (+ `@vueuse/router`), Vitest + `@nuxt/test-utils`, TypeScript 6 (pinned: `vue-tsc` does not support TS 7 yet). Rendering: `ssr: false` static SPA, so the app shell never embeds snapshot data and a new snapshot needs no app rebuild. Deploy: `cloudflare/wrangler-action@v4` with `pages deploy`, same pattern as the monorepo's `ci.yaml`.

Use the packages before writing anything custom: Vuetify components for every table, chip, badge, filter and tooltip; VueUse for time-ago, URL sync and similar; native git commands for anything a git command can answer.

UI state: a Pinia setup store holds the snapshot and derived views. Selected release, selected hop and filters are `useRouteQuery` refs inside the store, so every view is a shareable link.
