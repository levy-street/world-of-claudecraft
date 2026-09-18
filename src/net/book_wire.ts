// The Book of Deeds, Reliquary, and account-ledger self-decode, moved whole
// out of ClientWorld.applySnapshot (the monolith ratchet; the
// applyMaterialInventoryWire precedent). Every key is delta-omitted: a missing
// key keeps the prior mirror. The wire carries plain objects/arrays (Maps and
// Sets do not survive JSON.stringify), so the earned Map, both stat Sets, the
// sparse Reliquary state, and the ledger's two Maps rebuild here. The
// `deedUnlocked`, `reliquaryUnlock`, and `relicRecorded` events are NOT
// mirrors: snapshot state is the single authority, so reconnects and missed
// event frames cannot drift these.
import { type AccountLedger, restoreAccountLedger } from '../sim/account_ledger';
import { freshDeedStats } from '../sim/deeds';
import { restoreReliquaryState, type SavedReliquaryState } from '../sim/reliquary';
import type { DeedStats } from '../sim/types';
import type { ReliquaryFirstFindView } from '../world_api';

/** The ClientWorld fields this decode writes. */
export interface BookOfDeedsMirror {
  deedsEarned: Map<string, string>;
  deedStats: DeedStats;
  renown: number;
  activeTitle: string | null;
  activeBorder: string | null;
  reliquaryFirstFind: Record<string, ReliquaryFirstFindView>;
  reliquaryMarks: Set<string>;
  reliquaryRecent: string[];
  reliquaryObtainCounts: Record<string, number>;
  accountLedger: AccountLedger;
}

/** The snapshot self keys this decode reads (`deeds`/`dstats`/`reliq`/`acct`
 *  heavy-gated; `renown`/`atitle`/`aborder` per-tick diffed). */
export interface BookOfDeedsSelfWire {
  deeds?: Record<string, string> | null;
  dstats?: {
    counters?: Partial<DeedStats['counters']>;
    itemsDiscovered?: string[];
    visited?: string[];
    dungeonClears?: Record<string, number>;
  } | null;
  renown?: number | null;
  atitle?: string | null;
  aborder?: string | null;
  reliq?: unknown;
  acct?: unknown;
}

export function applyBookOfDeedsWire(mirror: BookOfDeedsMirror, s: BookOfDeedsSelfWire): void {
  if (s.deeds !== undefined) mirror.deedsEarned = new Map(Object.entries(s.deeds ?? {}));
  if (s.dstats !== undefined && s.dstats) {
    mirror.deedStats = {
      counters: { ...freshDeedStats().counters, ...(s.dstats.counters ?? {}) },
      itemsDiscovered: new Set(s.dstats.itemsDiscovered ?? []),
      visited: new Set(s.dstats.visited ?? []),
      dungeonClears: s.dstats.dungeonClears ?? {},
    };
  }
  if (s.renown !== undefined) mirror.renown = s.renown ?? 0;
  if (s.atitle !== undefined) mirror.activeTitle = s.atitle ?? null;
  if (s.aborder !== undefined) mirror.activeBorder = s.aborder ?? null;
  // `reliq` is the omit-empty SavedReliquaryState shape; never a second full
  // itemsDiscovered array. The obtain tally rides folded into the firstFind
  // entries and restore splits it back out, so the mirror reads it the same
  // way the offline Sim reads the live state. restored.illuminatedPages is
  // DELIBERATELY not mirrored: the sticky illumination record is
  // sim/server-authoritative with no IWorld consumer (banner and marquee key
  // off events); it rides the blob only because wire shape is save shape.
  if (s.reliq !== undefined) {
    const restored = restoreReliquaryState((s.reliq ?? {}) as SavedReliquaryState | undefined);
    mirror.reliquaryFirstFind = restored.firstFind;
    mirror.reliquaryMarks = restored.marks;
    mirror.reliquaryRecent = restored.recent;
    mirror.reliquaryObtainCounts = restored.counts;
  }
  // `acct`: restoreAccountLedger rebuilds both Maps from the tuple wire and
  // degrades malformed input to an empty ledger.
  if (s.acct !== undefined) mirror.accountLedger = restoreAccountLedger(s.acct);
}
