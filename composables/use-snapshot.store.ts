import { useRouteQuery } from '@vueuse/router';
import type { Hop, Item, Release, StatusCategory } from '~~/shared/types/snapshot';
import { ROLLING_VERSIONS } from '~~/shared/utils/snapshot';
import { judge } from '~~/shared/utils/verdicts';

/** Row colour, most serious first (docs/design.md "Well colour"). */
export type RowState = 'danger' | 'return' | 'caution' | 'ink';

export type HopList = 'ahead' | 'blocking' | 'back';

export interface Group {
  /** Sorts groups (letters, so the table's numeric-aware sort can't reorder them): attention, release, other unreleased, rolling, shipped, no fixVersion, untracked. */
  key: string;
  label: string;
}

const RELEASED_STATUS = /\breleased\b/i;

/**
 * - danger: on staging but outside the release, or Jira says Released and it isn't on main
 * - return: needs a back-sync (on a downstream branch, missing upstream)
 * - caution: would come along as an extra into staging, missed its release, or in the release but not on develop
 */
export const rowState = (item: Item, hops: Hop[]): RowState => {
  const w = item.warnings;
  const releasedNotOnMain = w.includes('status-mismatch') && RELEASED_STATUS.test(item.jira?.status ?? '');
  if (w.includes('extra-on-staging') || releasedNotOnMain) return 'danger';
  if (hops.some((h) => h.backSyncIds.includes(item.id))) return 'return';
  const extraIntoStaging = hops.some((h) => h.from === 'develop' && h.blockingIds.includes(item.id));
  if (extraIntoStaging || w.includes('missed-release') || w.includes('not-on-develop')) return 'caution';
  return 'ink';
};

/** Rows that need someone to act (shouldn't be on staging, or need a back-sync) lead the board, whatever their version. */
export const ATTENTION: Group = {
  key: 'a',
  label: 'Needs attention',
};

export const groupOf = (item: Item, release: string | null, releases: Release[]): Group => {
  const versions = item.jira?.fixVersions ?? [];
  if (item.kind === 'untracked') return {
    key: 'g',
    label: 'Untracked',
  };
  if (!versions.length) return {
    key: 'f',
    label: 'No fixVersion',
  };
  if (release && versions.includes(release)) return {
    key: 'b',
    label: release,
  };
  const order = new Map(releases.map((r, i) => [r.name, i]));
  const shown = [...versions].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
  const unreleased = shown.find((v) => !ROLLING_VERSIONS.includes(v) && !releases.find((r) => r.name === v)?.released);
  if (unreleased) return {
    key: `c-${String(order.get(unreleased) ?? 999).padStart(3, '0')}`,
    label: unreleased,
  };
  const rolling = shown.find((v) => ROLLING_VERSIONS.includes(v));
  if (rolling) return {
    key: 'd',
    label: rolling,
  };
  return {
    key: 'e',
    label: `Shipped: ${shown.join(', ')}`,
  };
};

export interface Filters {
  status: StatusCategory[];
  assignee: string[];
  sprint: string[];
  problemsOnly: boolean;
  /** Row states to show, e.g. only 'danger'. */
  state: RowState[];
  /** 'app:develop:staging:blocking' — set by the transit map (Phase 5). */
  hop: string | null;
}

export const filterItems = <T extends Item & { state: RowState }>(items: T[], hops: Hop[], f: Filters): T[] => {
  const hopIds = (() => {
    if (!f.hop) return null;
    const [repo, from, to, list] = f.hop.split(':') as [string, string, string, HopList];
    const hop = hops.find((h) => h.repo === repo && h.from === from && h.to === to);
    const ids = hop ? {
      ahead: hop.aheadIds,
      blocking: hop.blockingIds,
      back: hop.backSyncIds,
    }[list] : [];
    return new Set(ids ?? []);
  })();
  return items.filter((i) => (!hopIds || hopIds.has(i.id))
    && (!f.status.length || (i.jira && f.status.includes(i.jira.statusCategory)))
    && (!f.assignee.length || (i.jira?.assignee && f.assignee.includes(i.jira.assignee)))
    && (!f.sprint.length || (i.jira?.sprint && f.sprint.includes(i.jira.sprint)))
    && (!f.problemsOnly || i.state !== 'ink')
    && (!f.state.length || f.state.includes(i.state)));
};

const asList = <T extends string>(value: string | string[] | null | undefined) => (
  [value ?? []].flat().filter(Boolean) as T[]
);

export const useSnapshotStore = defineStore('snapshot', () => {
  const snapshot = ref<Snapshot | null>(null);
  const error = ref<Error | null>(null);

  // Every view is a link: release and filters live in the URL. Nuxt's route/router are passed explicitly so the store
  // also works outside component setup (tests, other stores).
  const routing = {
    route: useRoute(),
    router: useRouter(),
  };
  const releaseQuery = useRouteQuery<string | null>('release', null, routing);
  const statusQuery = useRouteQuery<string | string[] | null>('status', null, routing);
  const assigneeQuery = useRouteQuery<string | string[] | null>('assignee', null, routing);
  const sprintQuery = useRouteQuery<string | string[] | null>('sprint', null, routing);
  const problemsQuery = useRouteQuery<string | null>('problems', null, routing);
  const stateQuery = useRouteQuery<string | string[] | null>('state', null, routing);
  const hopQuery = useRouteQuery<string | null>('hop', null, routing);

  const release = computed({
    get: () => releaseQuery.value ?? snapshot.value?.currentRelease ?? null,
    set: (v) => { releaseQuery.value = v === snapshot.value?.currentRelease ? null : v; },
  });
  const filters = computed<Filters>(() => ({
    status: asList<StatusCategory>(statusQuery.value),
    assignee: asList(assigneeQuery.value),
    sprint: asList(sprintQuery.value),
    problemsOnly: problemsQuery.value === '1',
    state: asList<RowState>(stateQuery.value),
    hop: hopQuery.value,
  }));
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    const query = {
      status: statusQuery,
      assignee: assigneeQuery,
      sprint: sprintQuery,
      problemsOnly: problemsQuery,
      state: stateQuery,
      hop: hopQuery,
    }[key];
    query.value = typeof value === 'boolean'
      ? (value ? '1' : null)
      : Array.isArray(value) ? (value.length ? value : null) : value;
  };

  /** Verdicts and warnings re-judged for the selected release. */
  const judged = computed(() => (snapshot.value
    ? judge(snapshot.value.items, release.value, snapshot.value.releases)
    : {
      items: [] as Item[],
      hops: [] as Hop[],
    }));
  const hops = computed(() => judged.value.hops);
  const rows = computed(() => judged.value.items.map((item) => {
    const state = rowState(item, hops.value);
    const group = state === 'danger' || state === 'return'
      ? ATTENTION
      : groupOf(item, release.value, snapshot.value?.releases ?? []);
    return {
      ...item,
      state,
      groupKey: `${group.key}|${group.label}`,
    };
  }));
  const visibleRows = computed(() => filterItems(rows.value, hops.value, filters.value));
  const items = computed(() => snapshot.value?.items ?? []);

  const options = computed(() => ({
    releases: (snapshot.value?.releases ?? []).filter((r) => !r.released).map((r) => r.name),
    assignees: [...new Set(items.value.map((i) => i.jira?.assignee).filter(Boolean) as string[])].sort(),
    sprints: [...new Set(items.value.map((i) => i.jira?.sprint).filter(Boolean) as string[])].sort().reverse(),
  }));

  async function load() {
    try {
      // A missing file on a dev server or SPA host comes back as the app's HTML with a 200, not a 404.
      const data = await $fetch<Snapshot>('/snapshot.json', { responseType: 'json' });
      if (!data || typeof data !== 'object' || !Array.isArray(data.items)) {
        throw new Error('snapshot.json is missing or not a snapshot');
      }
      snapshot.value = data;
      error.value = null;
    }
    catch (e) {
      error.value = e as Error;
    }
  }

  return {
    snapshot,
    error,
    items,
    release,
    filters,
    setFilter,
    hops,
    rows,
    visibleRows,
    options,
    load,
  };
});
