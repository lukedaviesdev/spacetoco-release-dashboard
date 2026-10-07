<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core';
import type { Hop } from '~~/shared/types/snapshot';
import { REPOS } from '~~/shared/utils/snapshot';

const store = useSnapshotStore();
const { stations, tracks, rows, cols } = layoutTransit();

// Horizontal on wide screens; on phones the map turns vertical so labels stay legible.
const vertical = useMediaQuery('(max-width: 700px)');
const STEP = 210;
const ROW = 62;
const PAD = 70;
/** Extra air between the two repos' networks. */
const REPO_GAP = 12;

const repoRowStart = REPOS.map((r) => Math.min(...stations.filter((s) => s.repo === r.id).map((s) => s.row)));
const rowOffset = (row: number) => repoRowStart.filter((start, i) => i > 0 && row >= start).length * REPO_GAP;

const pos = (repo: string, branch: string) => {
  const s = stations.find((x) => x.repo === repo && x.branch === branch)!;
  const along = PAD + s.col * STEP;
  const across = 48 + s.row * ROW + rowOffset(s.row);
  return vertical.value ? {
    x: across + 40,
    y: along - 20,
  } : {
    x: along,
    y: across,
  };
};

const size = computed(() => {
  const along = PAD * 2 + (cols - 1) * STEP;
  const across = 40 + (rows - 1) * ROW + rowOffset(rows - 1) + 56;
  return vertical.value ? {
    w: across + 160,
    h: along,
  } : {
    w: along,
    h: across,
  };
});

/** Straight on one row; otherwise a short run, a 45° drop, then on to the station (transit-map style). */
const pathOf = (a: { x: number, y: number }, b: { x: number, y: number }) => {
  if (vertical.value) {
    if (a.x === b.x) return `M${a.x} ${a.y} V${b.y}`;
    const ya = a.y + 18;
    return `M${a.x} ${a.y} V${ya} L${b.x} ${ya + (b.x - a.x)} V${b.y}`;
  }
  if (a.y === b.y) return `M${a.x} ${a.y} H${b.x}`;
  const xa = a.x + 18;
  return `M${a.x} ${a.y} H${xa} L${xa + (b.y - a.y)} ${b.y} H${b.x}`;
};

const hopOf = (t: { repo: string, from: string, to: string }) => store.hops
  .find((h) => h.repo === t.repo && h.from === t.from && h.to === t.to);

const items = computed(() => tracks.map((t) => {
  const a = pos(t.repo, t.from);
  const b = pos(t.repo, t.to);
  const hop = hopOf(t);
  const signal = hop ? signalOf(hop) : null;
  const back = hop ? backSignalOf(hop) : null;
  // Straight tracks label their midpoint; bending (branch-line) tracks label beside the diagonal, where there's room.
  const bends = vertical.value ? a.x !== b.x : a.y !== b.y;
  const label = vertical.value
    ? {
      x: b.x + 14,
      y: bends ? a.y + 18 + Math.abs(b.x - a.x) / 2 : (a.y + b.y) / 2,
      anchor: 'start',
    }
    : bends
      ? {
        x: a.x + 18 + Math.abs(b.y - a.y) / 2 - 14,
        y: (a.y + b.y) / 2 + 6,
        anchor: 'end',
      }
      : {
        x: (a.x + b.x) / 2,
        y: b.y - 14,
        anchor: 'middle',
      };
  return {
    ...t,
    key: `${t.repo}:${t.from}:${t.to}`,
    d: pathOf(a, b),
    hop,
    signal,
    back,
    label,
  };
}));

const offset = computed(() => (vertical.value ? 'translate(14 0)' : 'translate(0 14)'));

const activeHop = computed(() => store.filters.hop);
const choose = (hop: Hop | undefined, list: HopList | null | undefined) => {
  if (!hop || !list) return;
  const value = hopFilter(hop, list);
  store.setFilter('hop', activeHop.value === value ? null : value);
};
const activeLabel = computed(() => {
  const [repo, from, to, list] = activeHop.value?.split(':') ?? [];
  if (!repo) return null;
  const words: Record<HopList, string> = {
    ahead: 'ahead',
    bringUp: 'to bring up',
    blocking: from === 'staging' ? 'to hold back' : 'not ready, would come along',
    back: 'to back-sync',
  };
  return `${repo} ${from} → ${to}: ${words[list as HopList]}`;
});

type Heads = NonNullable<typeof store.snapshot>['heads'];
const headOf = (repo: string, branch: string) => store.snapshot?.heads[repo as keyof Heads]?.[branch as never];
</script>

<template>
  <figure class="transit">
    <svg
      :viewBox="`0 0 ${size.w} ${size.h}`"
      :class="['transit__map', { 'transit__map--vertical': vertical }]"
      role="group"
      aria-label="Branch map: each track is a merge between branches. Activate a track to list its tickets."
    >
      <text
        v-for="repo in REPOS"
        :key="repo.id"
        :x="vertical ? pos(repo.id, repo.branches[0]).x - 8 : 8"
        :y="vertical ? 14 : pos(repo.id, repo.branches[0]).y + 4"
        :class="['transit__repo', `transit__repo--${repo.id}`]"
      >{{ repo.id }}</text>

      <g
        v-for="t in items"
        :key="t.key"
        :aria-disabled="!t.signal?.list"
        :aria-label="t.signal?.description"
        :aria-pressed="t.hop && t.signal?.list ? activeHop === hopFilter(t.hop, t.signal.list) : undefined"
        :class="['track', `track--${t.signal?.tone ?? 'quiet'}`, `track--${t.repo}`]"
        :tabindex="t.signal?.list ? 0 : -1"
        role="button"
        @click="choose(t.hop, t.signal?.list)"
        @keydown.enter.prevent="choose(t.hop, t.signal?.list)"
        @keydown.space.prevent="choose(t.hop, t.signal?.list)"
      >
        <path :d="t.d" class="track__hit" />
        <path :d="t.d" class="track__line" />
        <text
          v-if="t.signal?.label"
          :x="t.label.x"
          :y="t.label.y"
          :text-anchor="t.label.anchor"
          class="track__label"
        >
          {{ t.signal.label }}
        </text>
      </g>

      <g
        v-for="t in items.filter((x) => x.back)"
        :key="`${t.key}:back`"
        :aria-label="t.back!.description"
        :aria-pressed="activeHop === hopFilter(t.hop!, 'back')"
        :transform="offset"
        class="track track--return"
        role="button"
        tabindex="0"
        @click="choose(t.hop, 'back')"
        @keydown.enter.prevent="choose(t.hop, 'back')"
        @keydown.space.prevent="choose(t.hop, 'back')"
      >
        <path :d="t.d" class="track__hit" />
        <path :d="t.d" class="track__line track__line--return" />
        <text
          :x="t.label.x"
          :y="t.label.y + (vertical ? 16 : 46)"
          :text-anchor="vertical ? 'start' : 'middle'"
          class="track__label"
        >
          {{ t.back!.label }}
        </text>
      </g>

      <g v-for="s in stations" :key="`${s.repo}:${s.branch}`" class="station">
        <title>{{ s.branch }} @ {{ headOf(s.repo, s.branch) ?? '?' }}</title>
        <circle :cx="pos(s.repo, s.branch).x" :cy="pos(s.repo, s.branch).y" r="8" />
        <text
          :x="pos(s.repo, s.branch).x + (vertical ? (s.row === repoRowStart[0] || s.repo !== 'app' ? -14 : 14) : 0)"
          :y="pos(s.repo, s.branch).y + (vertical ? 4 : -16)"
          :text-anchor="vertical ? (s.row === repoRowStart[0] || s.repo !== 'app' ? 'end' : 'start') : 'middle'"
        >{{ s.branch }}</text>
      </g>
    </svg>
    <figcaption v-if="activeLabel" class="transit__filter">
      Showing {{ activeLabel }}
      <button type="button" @click="store.setFilter('hop', null)">Show all</button>
    </figcaption>
  </figure>
</template>

<style scoped>
.transit { margin: 0; min-width: 0; }

.transit__map {
  display: block;
  width: 100%;
  max-width: 1040px;
  height: auto;
  overflow: visible;
}

.transit__map--vertical { max-width: 420px; }

.transit__repo {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  fill: var(--muted);
}

.track { cursor: pointer; outline: none; }
.track[aria-disabled='true'] { cursor: default; }
.track__hit { fill: none; stroke: transparent; stroke-width: 26; }

.track__line {
  fill: none;
  stroke: var(--track-colour);
  stroke-width: 6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.track--quiet { --track-colour: var(--rule); }
.track--quiet .track__line { stroke-width: 4; }
.track--clear { --track-colour: var(--verdict-clean); }
.track--neutral { --track-colour: var(--ink); }
.track--caution { --track-colour: var(--verdict-merge-with-extras); }
.track--danger { --track-colour: var(--verdict-cherry-pick); }
.track--return { --track-colour: var(--verdict-back-sync); }
.track--api.track--quiet { --track-colour: rgb(var(--v-theme-line-api), 0.35); }

.track__line--return { stroke-width: 2.5; stroke-dasharray: 2 4; }

.track__label {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  fill: var(--track-colour);
  font-variant-numeric: tabular-nums;
}

.track:hover .track__line,
.track:focus-visible .track__line { stroke-width: 9; }
.track:focus-visible .track__hit { stroke: rgb(var(--v-theme-on-background), 0.12); }
.track[aria-pressed='true'] .track__hit { stroke: rgb(var(--v-theme-on-background), 0.1); }

.station circle {
  fill: rgb(var(--v-theme-background));
  stroke: var(--ink);
  stroke-width: 3;
}

.station text {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  fill: var(--ink);
}

.transit__filter {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.85rem;
}

.transit__filter button {
  border: 0;
  background: none;
  color: var(--ink);
  text-decoration: underline;
  cursor: pointer;
}
</style>
