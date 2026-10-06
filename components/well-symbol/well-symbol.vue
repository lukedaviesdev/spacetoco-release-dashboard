<script setup lang="ts">
import type { Presence } from '~~/shared/types/snapshot';

// Transit-map station symbols: solid = here, interchange ring = cherry-picked here, half = partly here, hairline = not here.
defineProps<{ presence: Presence }>();
</script>

<template>
  <svg class="well" viewBox="0 0 14 14" aria-hidden="true">
    <circle v-if="presence === 'merged'" cx="7" cy="7" r="5" class="well__fill" />
    <template v-else-if="presence === 'picked'">
      <circle cx="7" cy="7" r="4.5" class="well__ring" />
      <circle cx="7" cy="7" r="2" class="well__fill" />
    </template>
    <template v-else-if="presence === 'partial'">
      <circle cx="7" cy="7" r="4.5" class="well__ring" />
      <path d="M7 2.5 A4.5 4.5 0 0 0 7 11.5 Z" class="well__fill" />
    </template>
    <circle v-else cx="7" cy="7" r="4.5" class="well__empty" />
  </svg>
</template>

<style scoped>
.well {
  width: var(--well-size);
  height: var(--well-size);
  flex: none;
  vertical-align: middle;
}

.well__fill { fill: currentColor; }
.well__ring { fill: none; stroke: currentColor; stroke-width: var(--well-stroke); }
.well__empty { fill: none; stroke: var(--well-empty); stroke-width: 1px; }
</style>
