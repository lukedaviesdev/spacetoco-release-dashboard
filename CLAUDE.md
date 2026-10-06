# spacetoco-release-dashboard

Read-only release dashboard for the `spacetoco/spacetoco-app` monorepo (local clone `~/Dev/spacetoco-app`). Shows which Jira tickets / PRs are on which env branch and whether each hop merges cleanly, needs cherry-picking, or needs a back-sync.

## Start here

1. `docs/roadmap.md`: which phase is in progress, what "done" means.
2. `docs/architecture.md`: data flow, matching rules, verdict rules, snapshot contract.
3. `docs/design.md`: transit-map header + well-plate detail, critic-loop process.
4. `docs/lessons.md`: rules learned so far. **Follow them, and add one whenever a mistake or correction happens** (in the same commit as the fix).

## Working rules

- **Read the relevant docs before starting each phase** (list below and per phase in the roadmap). Prefer `llms.txt` where available.
- **Use the packages before writing anything custom**: Vuetify components, VueUse composables, native git commands.
- All git/Jira/verdict logic lives in the snapshot script and `shared/`; the app only renders `snapshot.json`.
- Never write to the monorepo, git remotes or Jira. Read-only, always.
- Secrets only in `.env` (gitignored) / Action secrets. Never in the static bundle.
- Git workflow: Phase 0 straight to `main`; after that, branch `phase-N-<slug>`, atomic commits, PR once the user has checked the phase's "Done when" items. Don't start the next phase until the PR merges.
- Update the docs as each phase is built; mark roadmap status.

## Docs

| Tech | Reference |
|---|---|
| Vue 3 | https://vuejs.org/llms.txt |
| Nuxt 4 | https://nuxt.com/llms.txt · testing: https://nuxt.com/docs/4.x/getting-started/testing |
| Vuetify 4 | https://vuetifyjs.com/llms.txt |
| vuetify-nuxt-module | https://nuxt.vuetifyjs.com/ |
| Pinia | https://pinia.vuejs.org/core-concepts/ · Nuxt: https://pinia.vuejs.org/ssr/nuxt.html |
| VueUse | https://vueuse.org/llms.txt (`useRouteQuery` is in `@vueuse/router`) |
| Vitest | https://vitest.dev/llms.txt |
| git | https://git-scm.com/docs/git-log (`--cherry-mark`, `--first-parent`) · https://git-scm.com/docs/git-patch-id |
| Jira REST v3 | https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/ (`/search/jql`) · versions: `/rest/api/3/project/{key}/versions` |
| GitHub REST | https://docs.github.com/en/rest/pulls/pulls |
| Cloudflare Pages | https://developers.cloudflare.com/pages/llms.txt |
| Cloudflare Access | https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/ |

## Commands (from Phase 0)

- `pnpm dev`: app against `public/snapshot.json`
- `pnpm snapshot --repo ~/Dev/spacetoco-app [--fetch]`: regenerate the snapshot
- `pnpm test` / `pnpm typecheck`
