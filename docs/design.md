# Design

Goal: answer three questions at a glance, before reading any ticket:
1. Are we good to merge `develop→staging` / `staging→main`?
2. Do we need to back-sync (hotfixes on staging/main missing from develop)?
3. Is there work on staging that shouldn't be in this release?

Users: devs, QA, PMs.

**The headline signal is work coming along when it shouldn't**: `merge-with-extras` on develop→staging (extras about to reach staging), `cherry-pick` on staging→main, and the per-ticket `extra-on-staging` warning (work already on staging that must not go to main). `status-mismatch` has two severities the UI should show differently: **Released but not on main** is serious (Jira says it shipped and it didn't; 8 on day one), while **on main but not Released** is quiet Jira housekeeping (27 on day one). The UI tells them apart from the status. The staging→main list should split "shouldn't be here" (`extra-on-staging`) from "still testing" (in the release, not Done). These get the most visual weight; in-sync and clean hops should recede.

## Direction: transit map header + well-plate detail

Chosen from three sketched directions (transit map, departure board, well plate). The user loved the **transit map as the header** and the **wells for the detail**.

### Header: transit map

The branch topology already *is* a rail network: a trunk `develop → staging → main → demo` with a branch line `main → main-uk → demo-uk`.

- **Two networks**: the `spacetoco-app` line (trunk + UK branch line) and a short `spacetoco-api` line (develop → staging → main) beneath it, aligned so the shared develop/staging/main stations line up.
- **Stations** = branches. Each shows its head SHA on hover.
- **Track segments** = hops, carrying the hop verdict as a signal: clear (`clean` / `in-sync`), ✂ cherry-pick (`n of N`), ➡ `N to sync`.
- **Back-sync** = a red track running backwards under the segment ("← 2 hotfixes back-sync").
- **Clicking a segment** filters the wells to the items behind that verdict (`aheadIds`, `blockingIds` or `backSyncIds`).
- **Staleness:** "Snapshot 12 min ago · main @ 7a177c9" (`useTimeAgo`), amber after 2h.
- Warning counts (untracked, invalid key, done without fixVersion, not on develop) as chips under the map.
- Must reflow on narrow screens: it's an SVG with a viewBox, laid out from the topology, not from hand-placed coordinates.

### What Phase 5 built

- **The map is the first thing on the page**, laid out from `REPOS` by `layoutTransit` (`utils/transit.ts`): column = hops from develop, and a branching hop starts a new row. Both repos stack, aligned by column.
- **Tracks carry the verdict** (`signalOf`): red "hold back N" (cherry-pick), amber "N extras" (merge-with-extras), green "clean · N", ink "N to sync", and a thin muted line for in-sync. Back-syncs are a fine dashed blue return line under the track, labelled "← N back".
- **Every track with something behind it is a button** (click, Enter or Space). It sets the `hop` URL filter so the board shows exactly those tickets; a "Showing … / Show all" caption clears it.
- **Header band:** the map on the left, the problem counts and legend in the right-hand gutter.
- **Phones:** below 700px the map turns vertical (`useMediaQuery`) and labels move to the side.
- **Warning chips under the map** were dropped. The summary counts already do that job.
- **Critique:** two rounds scored 5 → 6. The loop stopped there, given Phase 4's plateau.
- **Future option** (critic idea, not built): put the map's stations directly above the matrix columns, so the map becomes the table's header and the branch names appear once.

### Detail: well plate

- One row per item. Six app wells (`develop, staging, main, demo, main-uk, demo-uk`), then three api wells (`develop, staging, main`), visually grouped by repo. A repo the item has no work in shows no wells rather than empty ones, so a backend-only ticket reads differently from an unmerged one.
- Well fill encodes presence: `merged` filled, `picked` visibly different (e.g. ring or half-fill: "got there by cherry-pick"), `partial` partial, `none` empty.
- Well colour encodes readiness for the selected release: ready (in release + Done), not ready, not in release, hotfix. Problem shapes should be recognisable: a red row filled on the left = in staging but shouldn't be; a blue row filled on the right = hotfix that needs back-syncing.
- Built on `v-data-table` with grouping by **fixVersion**. Groups: selected release first, then other unreleased versions, then "no fixVersion", then "untracked".
- Row shows: key (links to Jira), title, **sprint chip**, status, assignee, PR numbers (link to GitHub), warning badges.
- Filters (Pinia store, synced to URL): release, hop, status category, assignee, sprint, "only problems".
- Action wording borrowed from the departure-board direction may label states: *offload* (cherry-pick out), *return* (back-sync).

## Process (runs inside Phases 4 and 5)

Following `/design-with-ai`:
1. Derive palette, type pairing and the transit visual language once, at the start of Phase 4, and write them below before building. Constraints filter that decision; they don't replace it.
   Then run `/design-system` to turn those choices into tokens (primitive → semantic → component), and map them onto the Vuetify theme (`colors`, `variables`) and component `defaults`. Semantic tokens needed: presence (`merged`/`picked`/`partial`/`none`), readiness (ready / not ready / not in release / hotfix), verdicts (clean / cherry-pick / sync / back-sync), staleness.
2. Build against the real snapshot, not just the fixture.
3. Screenshot it yourself after every substantive change.
4. **Critic loop:** a fresh critic subagent each round gets only a screenshot path and the same fixed prompt (name the aesthetic → how a top studio would do it → concrete gaps → score /10). Loop until it scores ≥9 or the score stops climbing after two rounds. Don't tell the critic the bar.
5. **AI-tell sweep** before calling a phase done: no top-nav-plus-hero skeleton, no unearned gradients/glows/shadows, no single default sans doing every job, no captions restating the visual, no bespoke controls where a Vuetify one exists.
6. **Craft floor:** light + dark theme, real contrast ratios, keyboard path through map segments and table, screen-reader labels on wells (e.g. "DEV-1314: on develop, on staging, not on main…"), states for empty / loading / failed load / 200+ items / long titles.

## Decisions (Phase 4)

**Reference: a railway signal-box mimic panel.** It's an enamelled board showing the track layout, with lamps for each section's state, read at a glance by an operator. It isn't a consumer transit app. That means flat surfaces, hairline rules, colour only where it means something, and dense rows.

**Palette** (semantic first; exact values live in the tokens):

| Role | Light | Dark | Used for |
|---|---|---|---|
| Board | warm enamel `#F4F1EA` | panel `#12171C` | page background |
| Ink | `#16202A` | `#E8E4DA` | text, merged wells, track |
| Rule | `#D9D3C7` | `#2A333B` | hairlines, empty wells |
| Muted ink | `#5B6670` | `#98A2AA` | secondary text |
| Signal: clear | `#1F8A5B` | `#3FB27F` | clean / in-sync, ready |
| Signal: caution | `#B9790A` | `#E0A43A` | merge-with-extras, still testing |
| Signal: danger | `#C2362C` | `#EF6A5E` | cherry-pick, extra-on-staging, Released-not-on-main |
| Signal: return | `#2C6FB7` | `#6AA5E8` | back-sync, hotfix |
| Line: api | `#0E7C86` | `#3BB3BC` | the spacetoco-api line, repo label |

No gradients, no shadows beyond Vuetify's flat defaults. Colour appears only on problem rows and verdicts; healthy rows stay ink-on-enamel so problems stand out.

**Type:** **Barlow Condensed** (600) for signage: headings, group headers, branch names and verdict labels, like platform signs. **IBM Plex Sans** for body and table text. **IBM Plex Mono** for ticket keys, SHAs and PR numbers. Self-hosted via `@nuxt/fonts`.

**Well presence encoding** (borrowed from transit map station symbols):

| Presence | Well | Reads as |
|---|---|---|
| `merged` | solid disc | station: work is here |
| `picked` | ring with a dot in the middle (an interchange symbol) | here, but arrived by cherry-pick |
| `partial` | left half filled | some of it is here |
| `none` | faint hairline ring | not here |

**Tokens** (via `/design-system`): primitives are the hex values in `vuetify.config.ts`, the semantic layer is Vuetify's theme colour names (emitted as `--v-theme-*` and swapped per theme), and component tokens live in `assets/css/tokens.css` (wells, row states, verdicts, staleness). Every text colour clears WCAG AA on its background. Light-mode clear, caution and api were darkened for this.

**Well colour** = the row's state for the selected release, in this order: **danger** (extra-on-staging, or Released-not-on-main), **return** (hotfix that needs a back-sync), **caution** (in the release but still testing / not Done), otherwise **ink**. A red row filled on the left is work on staging that shouldn't be; a blue row filled on the right is a hotfix to bring back.

### What the Phase 4 critique rounds settled

Five fresh-critic rounds scored **5, 5, 6, 5, 5**. That's a plateau: the critics agreed on direction but contradicted each other on details (diagonal vs horizontal labels, PRs inline vs own column). The loop stopped there, as the process allows. Phase 5's map changes the composition, and it gets its own rounds. What held up across rounds:

- **A "Needs attention" group leads the board.** It holds every danger and return row (shouldn't be here, needs back-sync) whatever their version, so the headline numbers point at rows you can see.
- **Only danger and return rows get the left-edge rule.** "Would come along" (amber) tints the wells only. On real data 25 of 34 rows were amber, and ruling them all drowned the signal.
- **The summary is a row of filters.** Problems total, then shouldn't be here / needs back-sync / would come along, each toggling a `state` URL filter. The numerals carry the category colour and double as its key; zero counts go faint.
- **The legend** covers both the well symbols and the three state colours.
- **Housekeeping stays quiet.** "On main but not marked Released in Jira" is a count in the group header plus a dotted-underline hint on the status, not a per-row flag. A row shows one flag (problems first) plus "+N".
- **Rows stay on one line.** Titles truncate with a tooltip; one PR plus "+N".
- **Branch labels** are full names set diagonally over a fixed-pitch grid (`--well-pitch`). Repos are separated by space, not a rule.
- **Statuses** are shown in sentence case (Jira mixes `(9) RELEASED` and `Done`); Done and Released are muted.
- **Dark mode** has its own warm background (`#201D18`) and a lower-chroma amber, so red stays the loudest colour.
- **Screenshots** are taken with headless Chrome against a production build (`nuxt generate`), forcing the colour scheme with `--blink-settings=preferredColorScheme=0|1`.
