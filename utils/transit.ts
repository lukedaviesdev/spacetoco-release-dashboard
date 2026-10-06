// Transit map maths: station layout from the REPOS topology, and hop verdict → track signal. Pure, for the
// transit-map component and its tests.
import type { Branch, Hop, RepoId } from '~~/shared/types/snapshot';
import { REPOS } from '~~/shared/utils/snapshot';
import type { HopList } from '~/composables/use-snapshot.store';

export interface Station {
  repo: RepoId;
  branch: Branch;
  col: number;
  row: number;
}

export interface Track {
  repo: RepoId;
  from: Branch;
  to: Branch;
}

/**
 * Column = hops from develop. A branch's first onward hop continues its row; any further hop from the same branch
 * starts a new row below (main → demo stays on the trunk, main → main-uk drops to a branch line). Repos stack.
 */
export interface TransitLayout {
  stations: Station[];
  tracks: Track[];
  rows: number;
  cols: number;
}

export const layoutTransit = (repos: typeof REPOS = REPOS): TransitLayout => {
  const stations: Station[] = [];
  const tracks: Track[] = [];
  let nextRow = 0;
  for (const repo of repos) {
    const place = (branch: Branch, col: number, row: number) => {
      stations.push({
        repo: repo.id,
        branch,
        col,
        row,
      });
      repo.hops.filter(([from]) => from === branch).forEach(([, to], i) => {
        tracks.push({
          repo: repo.id,
          from: branch,
          to,
        });
        place(to, col + 1, i === 0 ? row : ++nextRow);
      });
    };
    place(repo.branches[0], 0, nextRow);
    nextRow++;
  }
  return {
    stations,
    tracks,
    rows: nextRow,
    cols: Math.max(...stations.map((s) => s.col)) + 1,
  };
};

export type Tone = 'quiet' | 'clear' | 'caution' | 'danger' | 'neutral';

export interface Signal {
  tone: Tone;
  /** Short label on the track, e.g. '33 extras'. Empty when there's nothing to say. */
  label: string;
  /** Which hop list a click filters to; null when there's nothing behind the verdict. */
  list: HopList | null;
  count: number;
  /** Full sentence for screen readers and tooltips. */
  description: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Hop verdict → how its track reads. Problems are loud; in-sync recedes. */
export const signalOf = (hop: Hop): Signal => {
  const where = `${hop.repo} ${hop.from} → ${hop.to}`;
  const ahead = hop.aheadIds.length;
  const blocking = hop.blockingIds.length;
  switch (hop.verdict) {
    case 'cherry-pick':
      return {
        tone: 'danger',
        label: `hold back ${blocking}`,
        list: 'blocking',
        count: blocking,
        description: `${where}: cherry-pick. ${plural(blocking, 'ticket')} on ${hop.from} must not go to ${hop.to}.`,
      };
    case 'merge-with-extras':
      return {
        tone: 'caution',
        label: `${blocking} extra${blocking === 1 ? '' : 's'}`,
        list: 'blocking',
        count: blocking,
        description: `${where}: merging brings ${plural(blocking, 'ticket')} outside the release onto ${hop.to}.`,
      };
    case 'clean':
      return {
        tone: 'clear',
        label: `clean · ${ahead}`,
        list: 'ahead',
        count: ahead,
        description: `${where}: clean merge, ${plural(ahead, 'ticket')} ready.`,
      };
    case 'sync':
      return {
        tone: 'neutral',
        label: `${ahead} to sync`,
        list: 'ahead',
        count: ahead,
        description: `${where}: ${plural(ahead, 'ticket')} waiting to sync.`,
      };
    default:
      return {
        tone: 'quiet',
        label: '',
        list: null,
        count: 0,
        description: `${where}: in sync.`,
      };
  }
};

/** Back-sync along the same track, drawn as a return line under it. */
export const backSignalOf = (hop: Hop): Signal | null => (hop.backSyncIds.length
  ? {
    tone: 'neutral',
    label: `← ${hop.backSyncIds.length} back`,
    list: 'back',
    count: hop.backSyncIds.length,
    description: `${hop.to} has ${plural(hop.backSyncIds.length, 'ticket')} missing from ${hop.from}: back-sync needed.`,
  }
  : null);

/** The store's hop filter value: 'app:develop:staging:blocking'. */
export const hopFilter = (hop: Pick<Hop, 'repo' | 'from' | 'to'>, list: HopList) => `${hop.repo}:${hop.from}:${hop.to}:${list}`;
