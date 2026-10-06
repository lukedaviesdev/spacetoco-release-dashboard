# Design

Goal: answer three questions at a glance, before reading any ticket:
1. Are we good to merge `develop→staging` / `staging→main`?
2. Do we need to back-sync (hotfixes on staging/main missing from develop)?
3. Is there work on staging that shouldn't be in this release?

Users: devs, QA, PMs.

## Direction: transit map header + well-plate detail

Chosen from three sketched directions (transit map, departure board, well plate). The user loved the **transit map as the header** and the **wells for the detail**.

### Header: transit map

The branch topology already *is* a rail network: a trunk `develop → staging → main → demo` with a branch line `main → main-uk → demo-uk`.

- **Stations** = branches. Each shows its head SHA on hover.
- **Track segments** = hops, carrying the hop verdict as a signal: clear (`clean` / `in-sync`), ✂ cherry-pick (`n of N`), ➡ `N to sync`.
- **Back-sync** = a red track running backwards under the segment ("← 2 hotfixes back-sync").
- **Clicking a segment** filters the wells to the items behind that verdict (`aheadIds`, `blockingIds` or `backSyncIds`).
- **Staleness:** "Snapshot 12 min ago · main @ 7a177c9" (`useTimeAgo`), amber after 2h.
- Warning counts (untracked, invalid key, done without fixVersion, not on develop) as chips under the map.
- Must reflow on narrow screens: it's an SVG with a viewBox, laid out from the topology, not from hand-placed coordinates.

### Detail: well plate

- One row per item; six wells in branch order `develop, staging, main, demo, main-uk, demo-uk`.
- Well fill encodes presence: `merged` filled, `picked` visibly different (e.g. ring or half-fill: "got there by cherry-pick"), `partial` partial, `none` empty.
- Well colour encodes readiness for the selected release: ready (in release + Done), not ready, not in release, hotfix. Problem shapes should be recognisable: a red row filled on the left = in staging but shouldn't be; a blue row filled on the right = hotfix that needs back-syncing.
- Built on `v-data-table` with grouping by **fixVersion**. Groups: selected release first, then other unreleased versions, then "no fixVersion", then "untracked".
- Row shows: key (links to Jira), title, **sprint chip**, status, assignee, PR numbers (link to GitHub), warning badges.
- Filters (Pinia store, synced to URL): release, hop, status category, assignee, sprint, "only problems".
- Action wording borrowed from the departure-board direction may label states: *offload* (cherry-pick out), *return* (back-sync).

## Process (runs inside Phases 4 and 5)

Following `/design-with-ai`:
1. Derive palette, type pairing and the transit visual language once, at the start of Phase 4, and write them below before building. Constraints filter that decision; they don't replace it.
2. Build against the real snapshot, not just the fixture.
3. Screenshot it yourself after every substantive change.
4. **Critic loop:** a fresh critic subagent each round gets only a screenshot path and the same fixed prompt (name the aesthetic → how a top studio would do it → concrete gaps → score /10). Loop until it scores ≥9 or the score stops climbing after two rounds. Don't tell the critic the bar.
5. **AI-tell sweep** before calling a phase done: no top-nav-plus-hero skeleton, no unearned gradients/glows/shadows, no single default sans doing every job, no captions restating the visual, no bespoke controls where a Vuetify one exists.
6. **Craft floor:** light + dark theme, real contrast ratios, keyboard path through map segments and table, screen-reader labels on wells (e.g. "DEV-1314: on develop, on staging, not on main…"), states for empty / loading / failed load / 200+ items / long titles.

## Decisions (fill in at Phase 4 start)

- Palette: _TBD_
- Type: _TBD_
- Well presence encoding: _TBD_
