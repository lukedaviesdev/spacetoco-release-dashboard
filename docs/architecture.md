# Architecture

Read-only dashboard showing which work (Jira tickets / PRs) sits on which environment branch of `spacetoco/spacetoco-app`, and whether each branch hop is a clean merge, needs cherry-picking, or needs a back-sync. It never merges, cherry-picks or writes to git or Jira. Interim tool until trunk-based development.

## Branch topology

```
develop ──▶ staging ──▶ main ──▶ demo
                          │
                          └──▶ main-uk ──▶ demo-uk
```

Forward hops (in order): `develop→staging`, `staging→main`, `main→demo`, `main→main-uk`, `main-uk→demo-uk`.

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
- **Locally:** `pnpm snapshot --repo ~/Dev/spacetoco-app` then `pnpm dev`. No server, no tokens needed for the git-only part.
- **Repo:** built in `lukedaviesdev/spacetoco-release-dashboard` (personal, private) through Phase 5, then moved to the `spacetoco` org before Phase 6, so the Action runs on the org's minutes and secrets.
- **Hosted:** a GitHub Action in *this* repo checks out the monorepo with a read-only PAT, runs the same script, runs `nuxt generate` and deploys to Cloudflare Pages. Cloudflare Access sits in front of it as the login. One code path for local and hosted.
- **No changes to the monorepo, ever.** Triggers are cron + manual `workflow_dispatch` only (a push trigger would need a workflow in the monorepo).
- Shared types and pure logic live in `shared/` (Nuxt 4 convention), so the script and the app import the same `Snapshot` types.

### Why not a server / VPS / live git

- Cloudflare (team standard) has no git binary at the edge; a VPS means building and owning auth + ops for a temporary tool.
- Snapshot data is up to ~30 min old in working hours. Acceptable for release planning; the header shows its age and turns amber after 2h.

## Sources and access

| Source | Used for | Auth |
|---|---|---|
| git (bare/partial clone or local checkout) | which commits/tickets are on which branch, releases vs hotfixes | local: none. Action: fine-grained PAT `MONOREPO_TOKEN` (spacetoco-app only; Contents, Metadata, Pull requests: read) |
| GitHub REST | PR title, author, merged date | same PAT |
| Jira Cloud REST v3 (`spacetoco.atlassian.net`) | fixVersion, status category, sprint, assignee, versions list | scoped read-only API token: `JIRA_EMAIL` + `JIRA_API_TOKEN` (`read:jira-work`) |

Secrets: local `.env` (gitignored), Action repo secrets. Nothing secret ever reaches the static bundle.

Confluence is **not** a source: the release sheet there is just a view of Jira data, which this dashboard replaces.

## Git engine rules

**Window.** Only commits reachable from at least one env branch but not from all six. Work synced everywhere never appears. This naturally covers "past sprints" (old work still stuck somewhere) without a date window. Legacy `EC-` work falls outside it.

**Ticket key extraction** (projects `DEV`, `BUG`; list read from Jira, not hard-coded):
1. PR head branch name from the merge commit subject: `Merge pull request #1162 from spacetoco/DEV-1314-…` gives PR `#1162` and key `DEV-1314`.
2. Fallback: commit subject `[DEV-1314] 🐛 …`.
3. No key found → **untracked** item, identified by PR number + branch name (e.g. `#1066 seo-hotfix`). Never dropped.
4. Key not found in Jira (typos like `DEV-11940`, wrong prefix) → item flagged `invalidKey`.

**Presence per ticket per branch** (the ticket's non-merge commits):

| Presence | Meaning |
|---|---|
| `merged` | all commits reachable from the branch |
| `picked` | all present, at least one only via patch-equivalence (`git log --cherry-mark`), i.e. cherry-picked / hotfixed across |
| `partial` | some commits present, some missing |
| `none` | none present |

Known gap: a cherry-pick with conflict resolution changes its patch-id. Fallback: if the branch has a commit carrying the same ticket key, treat the commit as `picked`.

**Releases vs hotfixes.** No git tags exist. On `main`'s first-parent history, a merge from `staging` is a release; a merge from anything else (e.g. `DEV-1200-space-loading-bug-main`, `seo-hotfix`) is a hotfix.

## Jira rules

- One JQL search (`/rest/api/3/search/jql`, the old `/search` is deprecated):
  `project in (DEV, BUG) AND (fixVersion in unreleasedVersions() OR key in (<keys found in git window>))`
- Versions via `/rest/api/3/project/{key}/versions`.
- **Current release** = earliest unreleased fixVersion (by `releaseDate`, then name). Selectable in the UI. Versions are marked released in Jira when they ship.
- **Done** = status category `done`, not status names.
- Items are **grouped by fixVersion**; sprint is shown as a chip on each row for readability, and is a filter.
- Tickets in unreleased fixVersions that aren't on any branch yet still appear (rows of empty wells). This covers "future sprints".

## Verdict rules

Computed per hop `A→B` over the git window.

| Hop | Verdict | Condition |
|---|---|---|
| `develop→staging`, `staging→main` | `in-sync` | nothing on A missing from B |
| | `clean` | every item ahead on A is in the selected release **and** Done |
| | `cherry-pick` | some items ahead on A are not in the release or not Done (listed) |
| `main→demo`, `main→main-uk`, `main-uk→demo-uk` | `in-sync` / `sync` | `sync` = N items on A not yet on B |
| any hop, reverse | `back-sync` | items on B missing from A, e.g. hotfixes on main not on develop. Reported alongside the forward verdict, not instead of it |

Warnings (item-level, shown as badges and counted in the header):
- In the selected release but not on `develop` yet.
- Done with no fixVersion.
- Invalid ticket key.
- Untracked change (no ticket key).

`partial` presence counts as "missing" for verdicts.

## Snapshot contract (sketch, finalised as TS types in `shared/` in Phase 0)

```ts
type Branch = 'develop' | 'staging' | 'main' | 'demo' | 'main-uk' | 'demo-uk'
type Presence = 'merged' | 'picked' | 'partial' | 'none'

interface Snapshot {
  generatedAt: string                     // ISO
  heads: Record<Branch, string>           // short SHAs
  releases: { name: string; released: boolean; releaseDate?: string }[]
  currentRelease: string | null
  items: Item[]
  hops: Hop[]
}

interface Item {
  id: string                              // 'DEV-1314' or 'pr-1066'
  kind: 'ticket' | 'untracked'
  title: string
  jira?: {
    status: string
    statusCategory: 'new' | 'indeterminate' | 'done'
    fixVersions: string[]
    sprint?: string
    assignee?: string
  }
  invalidKey?: boolean
  prs: { number: number; title?: string; author?: string; headRef: string; mergedAt?: string; base: Branch }[]
  presence: Record<Branch, Presence>
  hotfix: boolean                         // reached main outside a staging release
  warnings: ('not-on-develop' | 'done-no-fixversion' | 'invalid-key' | 'untracked')[]
}

interface Hop {
  from: Branch
  to: Branch
  verdict: 'in-sync' | 'clean' | 'cherry-pick' | 'sync'
  aheadIds: string[]                      // on `from`, missing on `to`
  blockingIds: string[]                   // subset of aheadIds causing 'cherry-pick'
  backSyncIds: string[]                   // on `to`, missing on `from`
}
```

## Stack

Matches the monorepo's versions: pnpm 10, Node 24, Nuxt 4, Vue 3, Vuetify 3 via `vuetify-nuxt-module`, Pinia via `@pinia/nuxt`, VueUse (+ `@vueuse/router`), Vitest + `@nuxt/test-utils`. Deploy: `cloudflare/wrangler-action@v4` with `pages deploy`, same pattern as the monorepo's `ci.yaml`.

Use the packages before writing anything custom: Vuetify components for every table, chip, badge, filter and tooltip; VueUse for time-ago, URL sync and similar; native git commands for anything a git command can answer.

UI state: a Pinia setup store holds the snapshot and derived views. Selected release, selected hop and filters are `useRouteQuery` refs inside the store, so every view is a shareable link.
