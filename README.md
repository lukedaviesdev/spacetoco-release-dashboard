# @spacetoco-app/release-dashboard

## Description

Read-only dashboard showing which Jira tickets and PRs sit on which env branch of `spacetoco-app` (`develop → staging → main → demo`, `main → main-uk → demo-uk`) and `spacetoco-api` (`develop → staging → main`), and whether each hop is a clean merge, needs cherry-picking, or needs a back-sync. Built to follow spacetoco-app conventions so it can move into the monorepo as `apps/release-dashboard`.

See [`docs/architecture.md`](docs/architecture.md), [`docs/design.md`](docs/design.md) and [`docs/roadmap.md`](docs/roadmap.md).

## Getting Started

### Dependencies

* Node.js >= 24
* pnpm 10
* Local clones of `spacetoco-app` and `spacetoco-api` in `~/Dev/` (or set `APP_REPO_PATH` / `API_REPO_PATH`)

### Installing

```bash
pnpm install
cp .env.example .env   # optional until Phase 2
```

### Running

```bash
pnpm snapshot                              # real data → public/snapshot.json (gitignored)
pnpm fixture                               # or: the committed test fixture
pnpm dev
```

### Checks

```bash
pnpm test:unit
pnpm typecheck
pnpm lint
```
