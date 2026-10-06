<script setup lang="ts">
import type { Presence } from '~~/shared/types/snapshot';
import type { RowState } from '~/composables/use-snapshot.store';

const store = useSnapshotStore();

const count = (state: RowState) => store.rows.filter((r) => r.state === state).length;
const problems = computed(() => store.rows.filter((r) => r.state !== 'ink').length);

const FIGURES: { state: RowState, label: string }[] = [
  {
    state: 'danger',
    label: 'Shouldn\'t be here',
  },
  {
    state: 'return',
    label: 'Needs back-sync',
  },
  {
    state: 'caution',
    label: 'Would come along',
  },
];

const isOn = (state: RowState) => store.filters.state.includes(state);
const toggle = (state: RowState) => store.setFilter('state', isOn(state) ? [] : [state]);
const showAll = () => {
  store.setFilter('state', []);
  store.setFilter('problemsOnly', !store.filters.problemsOnly);
};

const SYMBOLS: { presence: Presence, text: string }[] = [
  {
    presence: 'merged',
    text: 'on branch',
  },
  {
    presence: 'picked',
    text: 'cherry-picked',
  },
  {
    presence: 'partial',
    text: 'partly',
  },
  {
    presence: 'none',
    text: 'not there',
  },
];
</script>

<template>
  <section class="summary" aria-label="Summary">
    <div class="summary__figures" role="group" aria-label="Filter by problem">
      <button
        :aria-pressed="store.filters.problemsOnly && !store.filters.state.length"
        class="figure figure--total"
        type="button"
        @click="showAll"
      >
        <span class="figure__n">{{ problems }}</span>
        <span class="figure__label">Problems</span>
      </button>
      <button
        v-for="f in FIGURES"
        :key="f.state"
        :aria-pressed="isOn(f.state)"
        :class="['figure', `figure--${f.state}`, { 'figure--zero': !count(f.state) }]"
        type="button"
        @click="toggle(f.state)"
      >
        <span class="figure__n">{{ count(f.state) }}</span>
        <span class="figure__label">{{ f.label }}</span>
      </button>
    </div>
    <ul class="summary__legend" aria-label="Legend">
      <li v-for="s in SYMBOLS" :key="s.presence">
        <well-symbol :presence="s.presence" />{{ s.text }}
      </li>
      <li v-for="f in FIGURES" :key="f.state" :class="`legend--${f.state}`">
        <well-symbol presence="merged" />{{ f.label.toLowerCase() }}
      </li>
    </ul>
  </section>
</template>

<style scoped>
.summary {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.summary__figures { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; }

.figure {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 0 6px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
}

.figure__n {
  font-family: var(--font-signage);
  font-weight: 600;
  font-size: 2.4rem;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.figure__label { font-size: 0.78rem; color: var(--muted); }

/* The numeral carries its category colour, which doubles as the colour key for the wells and row edges. */
.figure--danger .figure__n { color: var(--state-danger); }
.figure--return .figure__n { color: var(--state-return); }
.figure--caution .figure__n { color: var(--state-caution); }
.figure--zero .figure__n { color: var(--well-empty); }
.figure--total { grid-column: 1 / -1; padding-bottom: 10px; border-bottom: 1px solid var(--rule); }

.figure--total .figure__n { color: var(--ink); }
.figure:hover .figure__label { color: var(--ink); }
.figure[aria-pressed='true'] { border-bottom-color: var(--ink); }

.summary__legend {
  display: flex;
  gap: 16px;
  margin: 0;
  padding: 0 0 8px;
  list-style: none;
  font-size: 0.75rem;
  color: var(--muted);
}

.summary__legend li { display: inline-flex; align-items: center; gap: 6px; }
.summary__legend :deep(.well) { color: var(--well-ink); }
.summary__legend .legend--danger :deep(.well) { color: var(--state-danger); }
.summary__legend .legend--return :deep(.well) { color: var(--state-return); }
.summary__legend .legend--caution :deep(.well) { color: var(--state-caution); }
.summary__legend { flex-wrap: wrap; row-gap: 6px; }
</style>
