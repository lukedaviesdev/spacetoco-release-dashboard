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
- **Repo:** built in `lukedaviesdev/spacetoco-release-dashboard` (personal, private) through Phase 6, then moved to the `spacetoco` org before Phase 7 (hosting), so the Action runs on the org's minutes and secrets.
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

## Engine rules (Model v2, PR-based)

Decided 2026-10-06 after a GitHub × git × Jira audit and a grilling session (audit facts at the end of this section).

**How the team ships.** QA tests on **develop** (dev environment). **Staging is a second pass.** App staging is mostly built **per ticket** (PRs into staging, `release/*` branches); develop → staging rarely merges as a whole. api merges develop → staging regularly. Hotfixes go out as **one PR per env branch**. The dashboard doesn't assume a mechanism: it reports whether a whole-branch merge would be safe and what would need moving otherwise.

**Scope.** Per repo, every PR whose merge commit is on at least one env branch but not all of them (same idea as the old commit window, at PR level). Work already on every branch is "shipped history": ticket keys found there are `syncedKeys`.

**PRs are the unit of truth.**
- A PR (number, head branch, base, merged date, merge commit) is found from its `Merge pull request #N from org/<head>` commit; title (and base, when known) come from GitHub.
- A PR is **on a branch** if its merge commit is contained in that branch (`merge-base --is-ancestor`, done as one `rev-list --merges` per branch) **and it hasn't been reverted there**.
- **Reverts:** a commit on the branch whose message says `This reverts commit <sha>`, where `<sha>` is the PR's merge commit or one of its commits, or a GitHub revert PR (`revert-<N>-…`) merged into the branch, reverts PR N there. Reverting a revert reinstates it.
- **Commits without a PR** (direct pushes, cherry-picks, carrier branches): a branch also holds a ticket if it holds a commit whose message carries the ticket key and which isn't part of a reverted PR. Presence via such a copy only is `picked`.

**Ticket ↔ PR: many-to-many.** A PR's keys are every `DEV-`/`BUG-` key in its **title and head branch**. Commit messages are a fallback when a PR has neither. One PR can carry several tickets (api#104), and title and branch can disagree (#1111) — the PR counts for all of them.

**PR kinds** (by head branch):

| Kind | Head branch | Treatment |
|---|---|---|
| env → env | an env branch | release/sync PR: not an item, ancestry does its job |
| carrier | `release/*`, `mini-release`, `sync/*`, `chore/cherry-pick*` | not an item; its commits count for the tickets their messages name |
| conflict fix | contains `conflict` | not an item, never blocks |
| revert chore | `revert-*`, `chore/pull-*` | not an item; drives revert detection |
| dependabot | `dependabot/*` | item in Untracked, never blocks |
| ticket | has a key | ticket item |
| untracked | anything else | item, **blocks** (real work with no ticket, e.g. `seo-hotfix`) |

**Presence per ticket per branch.**
- `merged`: at least one of its PRs is on the branch (not reverted), and no **follow-up** is missing.
- `partial`: on the branch, but a **follow-up** is missing: a ticket PR merged *after* the ticket first reached the branch that hasn't followed it there. PRs into different bases within 24h of each other are **twins** (one change), so a missing twin isn't a follow-up. Shipped history (`syncedKeys`) counts as an early PR on every branch.
- `picked`: only via a commit copy (no PR of its own on the branch).
- `none`: nothing on the branch.
- Follow-ups are **low priority** (`follow-up` note), never a problem on their own.

**Off the release path.** A ticket whose PRs *all* change only these paths is `exempt` and left out of verdicts and status checks (convention notes still apply):

| Paths | `exempt` | Meaning |
|---|---|---|
| `deployments/**` | `released-on-develop` | infra applies from develop (`*-apply.yml`) |
| `packages/testing/**`, `.github/**`, `.cursor/**` | `never-ships` | tooling |

Root `package.json` and `pnpm-lock.yaml` are **neutral**: they change alongside any work, so they don't stop a ticket being exempt (DEV-874's Terraform PR also touched `package.json`).
| `packages/backend/**` | `not-live` | the new monorepo backend, not deployed yet |

If a ticket's files span several of these groups: `released-on-develop` wins, then `not-live`, then `never-ships`.

**Branch convention** (flagged as a low-priority `convention` note, never blocking):
- ticket branches: `<KEY>-<slug>`, optionally ending `-main`, `-staging` or `-develop` for a hotfix target;
- the key exists in Jira;
- the PR title starts with `[<KEY>]` and matches a branch key;
- non-ticket branches use `release/*`, `sync/*`, `chore/*`, `dependabot/*`, `revert-*`, or are env → env.

**Hotfix** = a ticket with a PR merged straight into a branch other than develop.

**Audit facts behind this** (2026-10-06, 264 merged PRs since 1 Aug): develop → staging merged as a whole once in app (#1008, 19 Aug); 20 ticket PRs went straight to staging; DEV-1200 had 12 PRs; 7 PRs had different title and branch keys; 6 PRs were reverted on staging on 3 Aug; 8 tickets reached main while Jira said untested.

## Jira rules

- One JQL search (`/rest/api/3/search/jql`, the old `/search` is deprecated):
  `project in (DEV, BUG) AND (fixVersion in unreleasedVersions() OR key in (<keys found in git window>))`
- Versions via `/rest/api/3/project/{key}/versions`.
- **Current release** = the earliest unreleased fixVersion (by `releaseDate`, then name) **that hasn't already shipped**. A version counts as shipped, whatever Jira says, when most of its tickets with code are fully on main (27.3.0 went out on 1 Oct but wasn't marked released). Skipped versions go in `shippedUnmarked`, the board shows a banner, and their stragglers get `missed-release`. Selectable in the UI; Rolling Hotfixes is never current. **A release is defined by fixVersion** (confirmed 2026-10-07): Jira should be kept up to date, and the dashboard flags the gaps.
- **Done** = status category `done`, not status names.
- **Release workflow** (confirmed 2026-10-08): a release is judged **only by Done status and fixVersion**; **sprint has nothing to do with it** (shown as a label and filter only). The **fixVersion is added when a ticket moves to Done**, and **before a release the tickets are moved to READY TO RELEASE** (also in the `done` category, shown as information, not a gate).
- **Status lifecycle vs branches** (the team's workflow): **In testing** while the work is on staging being tested manually → **Done** once testing passes (ready for main) → **Released** once merged to main. Done and Released are both in the `done` category, which is what staging→main requires. Real statuses are numbered, e.g. `(5) Ready for Testing`, `(6) In testing`, `(7) Done`, `(8) READY TO RELEASE`, `RELEASED`.
- Items are **grouped by fixVersion**; sprint is shown as a chip on each row for readability, and is a filter.
- Tickets in unreleased fixVersions that aren't on any branch yet still appear (rows of empty wells) **unless they're Done**. A Done ticket with no work in either repo is a legacy ticket or work committed under other keys, and is dropped (`dropDoneWithoutCode`). This covers "future sprints" without flooding a release with old tickets.

## Verdict rules

Implemented in `shared/utils/verdicts.ts`, so the app can re-judge when another release is picked.

**Wanted** for a release = its fixVersions include the release (the Confluence release page's list is a live Jira query `fixversion = "<release>"`) **or** a rolling version ("Rolling Hotfixes"), **and** status category `done` (QA passed on develop). Exempt tickets and follow-up-only differences never count against a merge.

**Ahead / back-sync.** Presence ranks `none` < `partial` < `merged` = `picked`. *Ahead* on `A→B`: A ranks higher than B. *Back-sync*: B ranks higher than A.

| Hop | Verdict | Lists |
|---|---|---|
| `develop→staging` (each repo) | `in-sync` · `safe` · `not-safe` | `bringUpIds`: wanted and ahead (needs to go up); `blockingIds`: ahead but not wanted (would wrongly come along with a whole merge). `safe` = nothing blocking. |
| `staging→main` (each repo) | `in-sync` · `safe` · `hold-back` | `bringUpIds`: wanted and ahead; `blockingIds`: on staging but not wanted, to hold back |
| app `main→demo`, `main→main-uk`, `main-uk→demo-uk` | `in-sync` · `sync` | `aheadIds` |
| every hop | | `backSyncIds` alongside the forward verdict |

Dependabot items and exempt tickets never land in `blockingIds`. Untracked real work always does.

**READY TO RELEASE** means "passed the second pass on staging", but the team often sets it late, so on staging it's shown as ✓ and "Done, awaiting second pass" is informational only.

**Warnings** (`computeWarnings` is their only owner):

| Warning | Priority | When |
|---|---|---|
| `extra-on-staging` | high | on staging ahead of main, not in the release |
| `not-tested` | high | on staging ahead of main, in the release, not Done (skipped QA on dev) |
| `not-on-develop` | medium | in the release, but not fully on develop |
| `missed-release` | medium | every non-rolling fixVersion shipped, not fully on main |
| `status-mismatch` | split by UI | Released but not fully on main (none → high, partly → medium), or fully on main but not Released (housekeeping) |
| `follow-up` | low | a later PR hasn't followed the ticket onto some branch it's on |
| `convention` | low | the ticket's PRs break the branch convention (reasons on the item) |
| `needs-fixversion` | medium | Done (or later) with code but no fixVersion, and not yet fully on main: the fixVersion should have been set when it moved to Done, and until it is the ticket can't be wanted |
| `invalid-key` | low | key not found in Jira |
| `untracked` | low (but blocks merges) | no ticket key |

## Snapshot contract

The source of truth is `shared/types/snapshot.ts`, with enums and the `REPOS` topology in `shared/utils/snapshot.ts`. In short:
- `heads[repo][branch]`: short SHAs.
- `releases`, `currentRelease`: from Jira versions; `shippedUnmarked`: versions skipped because they've already shipped.
- `items[]`: one per ticket key, untracked PR or dependency bump (`kind`).
  - `presence[repo][branch]` lists only repos with work for the item.
  - `exempt` marks tickets off the release path.
  - `conventionIssues` lists branch-convention breaks.
  - Each PR carries `repo`, `base`, `on` (branches it's on) and `revertedOn`.
- `hops[]`: one per repo hop, with `verdict`, `aheadIds`, `bringUpIds`, `blockingIds`, `backSyncIds`.

## Stack

Matches the monorepo's versions: pnpm 10, Node 24, Nuxt 4, Vue 3, Vuetify 4 via `vuetify-nuxt-module`, Pinia via `@pinia/nuxt`, VueUse (+ `@vueuse/router`), Vitest + `@nuxt/test-utils`, TypeScript 6 (pinned: `vue-tsc` does not support TS 7 yet). Rendering: `ssr: false` static SPA, so the app shell never embeds snapshot data and a new snapshot needs no app rebuild. Deploy: `cloudflare/wrangler-action@v4` with `pages deploy`, same pattern as the monorepo's `ci.yaml`.

Use the packages before writing anything custom: Vuetify components for every table, chip, badge, filter and tooltip; VueUse for time-ago, URL sync and similar; native git commands for anything a git command can answer.

UI state: a Pinia setup store holds the snapshot and derived views. Selected release, selected hop and filters are `useRouteQuery` refs inside the store, so every view is a shareable link.
