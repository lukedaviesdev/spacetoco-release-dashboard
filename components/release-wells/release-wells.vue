<script setup lang="ts">
import type { RepoPresence } from '~~/shared/types/snapshot';
import type { RowState } from '~/composables/use-snapshot.store';

const props = defineProps<{
  presence: RepoPresence | undefined;
  branches: readonly string[];
  state: RowState;
  /** For the screen-reader summary, e.g. 'DEV-1314 in spacetoco-app'. */
  label: string;
}>();

const WORDS = {
  merged: 'on',
  picked: 'cherry-picked onto',
  partial: 'partly on',
  none: 'not on',
} as const;

const at = (branch: string) => props.presence?.[branch as keyof RepoPresence] ?? 'none';
const summary = computed(() => (props.presence
  ? `${props.label}: ${props.branches.map((b) => `${WORDS[at(b)]} ${b}`).join(', ')}`
  : `${props.label}: no work in this repo`));
</script>

<template>
  <span :aria-label="summary" :class="['wells', `wells--${state}`]" role="img">
    <template v-if="presence">
      <span v-for="branch in branches" :key="branch" class="wells__cell">
        <well-symbol :presence="at(branch)" />
      </span>
    </template>
    <span v-else :style="{ width: `calc(var(--well-pitch) * ${branches.length})` }" />
  </span>
</template>

<style scoped>
.wells {
  display: inline-flex;
  color: var(--state-ink);
}

.wells--danger { color: var(--state-danger); }
.wells--return { color: var(--state-return); }
.wells--caution { color: var(--state-caution); }

.wells__cell {
  display: inline-flex;
  justify-content: center;
  width: var(--well-pitch);
}

</style>
