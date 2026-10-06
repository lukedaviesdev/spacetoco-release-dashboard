<script setup lang="ts">
import { useTimeAgo } from '@vueuse/core';

const store = useSnapshotStore();
const generatedAt = computed(() => store.snapshot?.generatedAt ?? new Date().toISOString());
const age = useTimeAgo(generatedAt);
const stale = computed(() => Date.now() - Date.parse(generatedAt.value) > 2 * 3600_000);

const STATUS_OPTIONS = [
  {
    title: 'To do',
    value: 'new',
  },
  {
    title: 'In progress',
    value: 'indeterminate',
  },
  {
    title: 'Done',
    value: 'done',
  },
];

const filterProps = {
  'chips': true,
  'clearable': true,
  'density': 'compact',
  'hide-details': true,
  'multiple': true,
  'variant': 'plain',
  'class': 'toolbar__filter',
} as const;
</script>

<template>
  <header class="toolbar">
    <div class="toolbar__title">
      <v-select
        :items="store.options.releases"
        :model-value="store.release"
        :style="{ width: `${(store.release?.length ?? 8) * 0.95 + 3}rem` }"
        aria-label="Release"
        class="toolbar__release"
        density="compact"
        variant="plain"
        hide-details
        @update:model-value="store.release = $event"
      />
    </div>
    <div class="toolbar__filters">
      <v-select
        v-bind="filterProps"
        :items="STATUS_OPTIONS"
        :model-value="store.filters.status"
        label="Status"
        @update:model-value="store.setFilter('status', $event)"
      />
      <v-autocomplete
        v-bind="filterProps"
        :items="store.options.assignees"
        :model-value="store.filters.assignee"
        label="Assignee"
        @update:model-value="store.setFilter('assignee', $event)"
      />
      <v-autocomplete
        v-bind="filterProps"
        :items="store.options.sprints"
        :model-value="store.filters.sprint"
        label="Sprint"
        @update:model-value="store.setFilter('sprint', $event)"
      />
    </div>
    <p :class="['toolbar__age', { 'toolbar__age--stale': stale }]">
      Snapshot {{ age }}
    </p>
  </header>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 24px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--rule);
}

.toolbar__title { display: flex; flex-direction: column; }
.toolbar__release :deep(.v-field__append-inner) { padding-top: 6px; margin-left: -4px; }

.toolbar__release :deep(.v-field__input),
.toolbar__release :deep(.v-select__selection-text) {
  font-family: var(--font-signage);
  font-weight: 600;
  font-size: 2rem;
  line-height: 1.1;
  padding-top: 0;
}

.toolbar__filters { display: flex; flex-wrap: wrap; gap: 8px; flex: 1 1 360px; }
.toolbar__filter { flex: 0 0 auto; width: 130px; }
.toolbar__filter :deep(.v-field__input) { padding-top: 0; min-height: 0; }
.toolbar__age { margin: 0 0 6px; color: var(--muted); font-size: 0.8rem; white-space: nowrap; }
.toolbar__age--stale { color: var(--staleness-old); }
</style>
