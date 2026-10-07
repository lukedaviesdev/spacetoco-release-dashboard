<script setup lang="ts">
import type { Exempt, Item, Warning } from '~~/shared/types/snapshot';
import { REPOS } from '~~/shared/utils/snapshot';

const store = useSnapshotStore();
await callOnce(store.load);

const JIRA = 'https://spacetoco.atlassian.net/browse/';
const github = (repo: string) => REPOS.find((r) => r.id === repo)!.github;

/** Problems get a tinted chip; the rest are Jira housekeeping and collapse into a quiet note. */
const PROBLEMS: Partial<Record<Warning, { text: string, color: string }>> = {
  'extra-on-staging': {
    text: 'Extra on staging',
    color: 'signal-danger',
  },
  'not-tested': {
    text: 'Not tested on dev',
    color: 'signal-danger',
  },
  'not-on-develop': {
    text: 'Not on develop',
    color: 'signal-caution',
  },
  'missed-release': {
    text: 'Missed release',
    color: 'signal-caution',
  },
};
/** [label, tooltip] */
const NOTES: Partial<Record<Warning, [string, string]>> = {
  'status-mismatch': ['Jira status', 'Jira status disagrees with the branches'],
  'done-no-fixversion': ['No fixVersion', 'Done with no fixVersion'],
  'invalid-key': ['Unknown key', 'Key not found in Jira'],
  'untracked': ['No ticket', 'No ticket key on the branch, commits or PR title'],
  'follow-up': ['Follow-up behind', 'A later PR for this ticket hasn\'t reached every branch the ticket is on'],
};
/** Off the release path: [label, tooltip]. */
const EXEMPT_NOTES: Record<Exempt, [string, string]> = {
  'released-on-develop': ['Infra: live from develop', 'Only changes deployments/, which is applied from develop'],
  'never-ships': ['Tooling: never ships', 'Only changes tests or CI'],
  'not-live': ['Backend: not live yet', 'Only changes packages/backend, the new monorepo backend'],
};
type Flaggable = Pick<Item, 'warnings' | 'presence' | 'jira' | 'exempt' | 'conventionIssues'>;
const GAP_FLAGS = {
  none: {
    text: 'Released, not on main',
    color: 'signal-danger',
  },
  partial: {
    text: 'Released, partly on main',
    color: 'signal-caution',
  },
};
const problemsOf = (item: Flaggable) => {
  const gap = releasedGap(item);
  return [
    ...item.warnings.filter((w) => PROBLEMS[w]).map((w) => PROBLEMS[w]!),
    ...(gap ? [GAP_FLAGS[gap]] : []),
  ];
};
// On main but not Released is Jira housekeeping: counted in the group header and hinted on the status,
// not flagged per row.
const notMarkedReleased = (item: Flaggable) => item.warnings.includes('status-mismatch') && !releasedGap(item);
const notesOf = (item: Flaggable): [string, string][] => [
  ...(item.exempt ? [EXEMPT_NOTES[item.exempt]] : []),
  ...item.warnings.filter((w) => w !== 'status-mismatch' && NOTES[w]).map((w) => NOTES[w]!),
  ...(item.conventionIssues?.length ? [['Branch convention', item.conventionIssues.join('\n')] as [string, string]] : []),
];
/** Problems first (coloured), then housekeeping notes (muted). One shows; the rest are in the tooltip. */
const flagsOf = (item: Flaggable) => [
  ...problemsOf(item).map((p) => ({
    ...p,
    tip: p.text,
  })),
  ...notesOf(item).map(([text, tip]) => ({
    text,
    tip,
    color: 'muted',
  })),
];
const unreleasedCount = (groupItems: readonly { raw: Flaggable }[]) => groupItems
  .filter((i) => notMarkedReleased(i.raw)).length;

// Every column but Work shrinks to its content (width 1 + nowrap); Work takes the rest.
const fit = {
  sortable: false,
  width: 1,
  cellProps: { class: 'fit' },
};
const headers = [
  // Vuetify adds a group column when grouping; the group header row already shows it.
  {
    key: 'data-table-group',
    title: '',
    sortable: false,
    headerProps: { class: 'd-none' },
    cellProps: { class: 'd-none' },
  },
  {
    ...fit,
    title: 'Ticket',
    key: 'id',
    sortable: true,
  },
  {
    title: 'Work',
    key: 'title',
    sortable: false,
  },
  {
    ...fit,
    title: 'PRs',
    key: 'prs',
  },
  {
    ...fit,
    title: 'Branches',
    key: 'wells',
  },
  {
    ...fit,
    title: 'Status',
    key: 'jira.status',
    sortable: true,
  },
  {
    ...fit,
    title: 'Sprint',
    key: 'jira.sprint',
    sortable: true,
  },
  {
    ...fit,
    title: 'Assignee',
    key: 'jira.assignee',
    sortable: true,
  },
  {
    ...fit,
    title: 'Flags',
    key: 'warnings',
  },
];

const groupBy = [{
  key: 'groupKey',
  order: 'asc' as const,
}];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const groupLabel = (key: string) => key.split('|').slice(1).join('|');
/** '(9) RELEASED' → 'Released': Jira mixes numbering and case. Only shouting is recased, so 'In QA' survives. */
const statusText = (status?: string) => {
  const s = status?.replace(/^\(\d+\)\s*/, '');
  if (!s) return '–';
  return s === s.toUpperCase() ? s[0]! + s.slice(1).toLowerCase() : s;
};
const shortName = (name?: string) => {
  const [first, ...rest] = (name ?? '').split(' ');
  return rest.length ? `${first} ${rest.at(-1)![0]}.` : first;
};
const rowProps = ({ item }: { item: { state: string } }) => ({ class: `row row--${item.state}` });
</script>

<template>
  <v-container class="board" fluid>
    <v-alert
      v-if="store.error"
      :text="`Couldn't load snapshot.json: ${store.error.message}. Run pnpm snapshot or pnpm fixture.`"
      type="error"
      variant="tonal"
    />
    <template v-else-if="store.snapshot">
      <board-toolbar />
      <div class="board__header">
        <transit-map />
        <board-summary />
      </div>

      <v-data-table
        :group-by="groupBy"
        :headers="headers"
        :items="store.visibleRows"
        :items-per-page="-1"
        :row-props="rowProps"
        class="board__table"
        item-value="id"
        no-data-text="Nothing matches these filters."
        hide-default-footer
        open-all
      >
        <template #[`header.wells`]>
          <span class="matrix-head">
            <span v-for="repo in REPOS" :key="repo.id" :class="['matrix-head__repo', `matrix-head__repo--${repo.id}`]">
              <span :title="repo.name" class="signage">{{ repo.id }}</span>
              <span class="matrix-head__branches">
                <span v-for="b in repo.branches" :key="b" class="matrix-head__branch"><span>{{ b }}</span></span>
              </span>
            </span>
          </span>
        </template>

        <template #group-header="{ item, columns, toggleGroup, isGroupOpen }">
          <tr class="group-row">
            <td :colspan="columns.length">
              <button
                :aria-expanded="isGroupOpen(item)"
                class="group-row__toggle"
                type="button"
                @click="toggleGroup(item)"
              >
                <v-icon :icon="isGroupOpen(item) ? '$expand' : '$next'" size="small" />
                <span>{{ groupLabel(item.value) }}</span>
                <span class="group-row__count">
                  {{ plural(item.items.length, 'ticket') }}<template v-if="unreleasedCount(item.items)">
                    · {{ unreleasedCount(item.items) }} not marked Released in Jira</template>
                </span>
              </button>
            </td>
          </tr>
        </template>

        <template #[`item.id`]="{ item }">
          <a
            v-if="item.kind === 'ticket'"
            :class="['key', { 'key--invalid': item.invalidKey }]"
            :href="`${JIRA}${item.id}`"
            rel="noopener"
            target="_blank"
          >{{ item.id }}</a>
          <span v-else class="key key--untracked">–</span>
        </template>

        <template #[`item.title`]="{ item }">
          <span :title="item.title" class="work">{{ item.title }}</span>
        </template>

        <template #[`item.prs`]="{ item }">
          <span v-if="!item.prs.length" class="pr">–</span>
          <a
            v-for="pr in item.prs.slice(0, 1)"
            :key="`${pr.repo}#${pr.number}`"
            :href="`https://github.com/${github(pr.repo)}/pull/${pr.number}`"
            :title="pr.title"
            class="pr"
            rel="noopener"
            target="_blank"
          >{{ pr.repo }}#{{ pr.number }}<template v-if="pr.base !== 'develop'">→{{ pr.base }}</template></a>
          <span
            v-if="item.prs.length > 1"
            :title="item.prs.slice(1).map((p) => `${p.repo}#${p.number} ${p.title ?? ''}`).join('\n')"
            class="pr pr--more"
          >+{{ item.prs.length - 1 }}</span>
        </template>

        <template #[`item.wells`]="{ item }">
          <span class="matrix">
            <release-wells
              v-for="repo in REPOS"
              :key="repo.id"
              :branches="repo.branches"
              :label="`${item.id} in ${repo.name}`"
              :presence="item.presence[repo.id]"
              :state="item.state"
              class="matrix__repo"
            />
          </span>
        </template>

        <template #[`item.jira.status`]="{ item }">
          <span
            :class="['status', {
              'status--done': item.jira?.statusCategory === 'done',
              'status--stale': notMarkedReleased(item),
            }]"
            :title="notMarkedReleased(item) ? 'On main, but not marked Released in Jira' : undefined"
          >
            {{ statusText(item.jira?.status) }}
          </span>
        </template>

        <template #[`item.jira.sprint`]="{ item }">
          <span class="sprint">
            {{ item.jira?.sprint?.replace(/^Sprint\s*/i, '') }}
          </span>
        </template>

        <template #[`item.jira.assignee`]="{ item }">
          <span :title="item.jira?.assignee" class="assignee">{{ shortName(item.jira?.assignee) }}</span>
        </template>

        <template #[`item.warnings`]="{ item }">
          <span v-if="flagsOf(item).length" :title="flagsOf(item).map((f) => f.tip).join('\n')" class="flags">
            <span :class="['flag', `text-${flagsOf(item)[0]!.color}`]">{{ flagsOf(item)[0]!.text }}</span>
            <span v-if="flagsOf(item).length > 1" class="note">+{{ flagsOf(item).length - 1 }}</span>
          </span>
        </template>
      </v-data-table>
    </template>
    <v-skeleton-loader v-else type="table" />
  </v-container>
</template>

<style scoped>
.board { max-width: 1680px; }

.board :deep(.signage) {
  font-family: var(--font-signage);
  font-weight: 600;
  letter-spacing: 0.02em;
}

.board__table { background: transparent; }

/* One header band: the map, with the problem counts and legend in the right-hand gutter. */
.board__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 380px);
  gap: 16px 40px;
  align-items: start;
  padding: 16px 0 8px;
}

@media (max-width: 1100px) {
  .board__header { grid-template-columns: minmax(0, 1fr); }
}
.board__table :deep(td.fit) { white-space: nowrap; }
.board__table :deep(th) { white-space: nowrap; }

.matrix-head, .matrix { display: inline-flex; }
.matrix-head__repo { display: inline-flex; flex-direction: column; }
.matrix-head__repo + .matrix-head__repo, .matrix :deep(.matrix__repo + .matrix__repo) { margin-left: 18px; }
.matrix-head__repo .signage {
  padding: 0 0 2px 6px;
  border-bottom: 1px solid var(--rule);
  font-family: var(--font-body);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.matrix-head__branches { display: inline-flex; }

/* Diagonal labels, the classic matrix header: full branch names fit without widening the grid. */
.matrix-head__branch {
  position: relative;
  width: var(--well-pitch);
  height: 52px;
}

.matrix-head__branch span {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: rotate(-50deg);
  transform-origin: 0 50%;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  white-space: nowrap;
}

.board__table :deep(tr.row--danger td:nth-child(2)) { box-shadow: inset 3px 0 0 var(--state-danger); }
.board__table :deep(tr.row--return td:nth-child(2)) { box-shadow: inset 3px 0 0 var(--state-return); }

.group-row td { border-top: 1px solid var(--rule) !important; }
.board__table :deep(thead th) {
  font-size: 0.68rem !important;
  font-weight: 600 !important;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted) !important;
  border-bottom: 1px solid var(--rule) !important;
  vertical-align: bottom;
}

.group-row__toggle {
  display: inline-flex;
  align-items: baseline;
  gap: 10px;
  padding: 8px 0;
  border: 0;
  background: none;
  color: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
}

.group-row__count { font-weight: 400; font-size: 0.8rem; color: var(--muted); font-variant-numeric: tabular-nums; }

.key { font-family: var(--font-mono); font-size: 0.82rem; color: var(--ink); text-decoration: none; }
.key:hover, .pr:hover { text-decoration: underline; }
.key--invalid { text-decoration: line-through; color: var(--muted); }
.key--untracked { color: var(--muted); }

.work {
  display: block;
  max-width: 420px;
  min-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pr {
  margin-right: 8px;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--muted);
  text-decoration: none;
  white-space: nowrap;
}

.status { white-space: nowrap; font-weight: 500; }
.status--stale { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
.status--done { color: var(--muted); font-weight: 400; }
.sprint { font-family: var(--font-mono); font-size: 0.82rem; color: var(--muted); }
.assignee { white-space: nowrap; }

.flags { display: inline-flex; align-items: baseline; gap: 6px; cursor: help; }
.flag { font-size: 0.8rem; font-weight: 600; }
.note { font-size: 0.75rem; color: var(--muted); cursor: help; }
</style>
