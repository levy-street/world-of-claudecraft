// Pure view-core for one aura track: which of the player's own beneficial auras
// this track shows, in what order, and what each row carries. DOM/Three/i18n
// free so it unit-tests directly. Registered in UI_PURE_CORES.
//
// ONE core, six tracks. The descriptor decides what a track accepts; everything
// else here is shared, so a fix lands in all six at once.
//
// SELECTION IS OWNERSHIP PLUS CATALOG PLUS POLARITY. An aura qualifies when the
// host's isOwn predicate says the local player cast it, the catalog places it in
// a category this track accepts, and the aura is not HARMFUL. No class list and
// no ability list: a heal added to any class joins its track the day it exists.
//
// The polarity check is not belt-and-braces. The catalog is keyed by aura id
// alone, and one id can carry both polarities: Hourglass of Suspension applies
// `stasis` to the caster or a group ally and `incapacitate` to an enemy under the
// same id, so admitting it by id put "Hourglass of Suspension on Forest Wolf" in
// the Friendly track, reading as a heal the mage was maintaining on a mob. Only
// the LIVE aura says which arm landed, and this family is the helpful side (the
// enemy side is src/ui/hud/target_dots/). Asked of the SAME classifier the aura
// strips use, never a local list of harmful kinds.
//
// ORDER IS STABLE ON PURPOSE. Self rows sort by aura id; ally rows group by
// entity (the player first when a track carries both) and then by aura id. Never
// by remaining time: a tracker that re-sorts as timers tick moves the row you
// are reaching for, which is the one thing a refresh readout must not do.
//
// Allocation-light: the state, its row array and every row record are owned by
// the core and reused across ticks, so a steady frame allocates nothing.

import { isDebuffDisplayAura } from '../../../sim/aura_classify';
import type { AuraKind } from '../../../sim/types';
import { isAuraExpiring } from '../../auras_view';
import { auraTrackEntry } from './aura_track_catalog';
import type { AuraTrackDescriptor } from './aura_track_descriptors';

/** Rows one track paints at most. Past this a bar stops being glanceable and
 *  starts covering the world; the aura strips remain the complete list. */
export const AURA_TRACK_ROW_CAP = 10;

/** Under this many seconds a countdown gains one decimal, the precision a
 *  refresh actually needs; above it, whole seconds. */
export const AURA_TRACK_DECIMAL_BELOW_SEC = 10;

/** The aura fields a track reads: a structural subset of the sim `Aura` that
 *  both worlds mirror, so `world.entities` values pass straight in. */
export interface AuraTrackAuraInput {
  id: string;
  name: string;
  remaining: number;
  duration?: number;
  permanent?: boolean;
  sourceId?: number;
  /** The sim's aura kind. Carried so the host can hand its own classifiers the
   *  same (id, kind) pair the aura strips give them, rather than the core
   *  keeping a second list of what counts as a toggle. */
  kind?: string;
  stacks?: number;
  /** An absorb's REMAINING SHIELD POINTS (sim types.ts: "absorb: remaining"),
   *  which is what a points row fills by. Meaningless on other kinds. */
  value?: number;
}

/** The entity fields a track reads (a structural subset of sim `Entity`). */
export interface AuraTrackEntityInput {
  id: number;
  name: string;
  dead: boolean;
  auras: readonly AuraTrackAuraInput[];
}

export interface AuraTrackRow {
  /** Stable pool key, `<entityId>:<auraId>` plus an occurrence index when one
   *  unit carries the same aura id twice. */
  key: string;
  entityId: number;
  /** The localized ability name. */
  auraName: string;
  /** The unit's localized name, '' when the row is on the player (a self track
   *  wastes no width repeating your own name). */
  unitName: string;
  iconKey: string;
  remaining: number;
  /** Fraction the bar fills by: time remaining for a timer row, POINTS
   *  remaining for a points row, always 1 for a mode. */
  fraction: number;
  decimals: 0 | 1;
  stacks: number;
  /** Absorb points still standing, 0 when this is not a points row. */
  points: number;
  /** No countdown: the sim's long duration is anti-expiry, not a timer. */
  mode: boolean;
  /** In its final seconds (the shared auras_view rule). */
  expiring: boolean;
}

export interface AuraTrackState {
  rows: AuraTrackRow[];
  count: number;
  overflow: number;
}

export interface AuraTrackDeps {
  /** Did the LOCAL player cast this aura? Injected so every track shares the
   *  host's one ownership predicate with the aura strips. */
  isOwn(aura: AuraTrackAuraInput): boolean;
  /** Is this aura a MODE rather than a timed effect? Injected so the tracks
   *  share the classifier the aura strips already use rather than keeping a
   *  second list of toggles. */
  isMode(aura: AuraTrackAuraInput): boolean;
  auraName(aura: AuraTrackAuraInput): string;
  unitName(entity: AuraTrackEntityInput): string;
  iconKey(aura: AuraTrackAuraInput): string;
}

export interface AuraTrackInput<TEntity extends AuraTrackEntityInput = AuraTrackEntityInput> {
  /** The player, always scanned first so their rows lead a mixed track. */
  player: TEntity | null;
  /** Everyone else worth scanning. The Hud passes every entity in interest
   *  scope (party, raid, pets AND mobs), since an own HoT or shield can sit on
   *  any friendly unit and the family has no roster of its own; a unit with no
   *  auras costs one length check, and the scan is bounded by the interest
   *  radius the world already enforces. */
  allies: Iterable<TEntity>;
  enabled: boolean;
  /** Whether MODE rows (stealth, travel form) are wanted. Its own sub-option:
   *  a player who wants Dash timed does not necessarily want a permanent
   *  stealth row parked in the bar, and a mode has no countdown to justify the
   *  space it takes. Only the utility track has any. */
  includeModes: boolean;
  cap?: number;
}

export interface AuraTrackViewCore<TEntity extends AuraTrackEntityInput = AuraTrackEntityInput> {
  tick(input: AuraTrackInput<TEntity>): AuraTrackState;
}

function newRow(): AuraTrackRow {
  return {
    key: '',
    entityId: 0,
    auraName: '',
    unitName: '',
    iconKey: '',
    remaining: 0,
    fraction: 1,
    decimals: 0,
    stacks: 0,
    points: 0,
    mode: false,
    expiring: false,
  };
}

/** A permanent or duration-less aura reads full rather than empty: it is not
 *  running out. */
function timeFraction(aura: AuraTrackAuraInput): number {
  if (aura.permanent === true) return 1;
  const duration = aura.duration;
  if (duration === undefined || !Number.isFinite(duration) || duration <= 0) return 1;
  return Math.min(1, Math.max(0, aura.remaining / duration));
}

/**
 * Create one track's derivation. One instance per track (the Hud owns them), so
 * the returned state and its rows are the SAME objects every tick: read them
 * before the next call, never retain them.
 */
export function createAuraTrackView<TEntity extends AuraTrackEntityInput>(
  descriptor: AuraTrackDescriptor,
  deps: AuraTrackDeps,
): AuraTrackViewCore<TEntity> {
  const rows: AuraTrackRow[] = [];
  const state: AuraTrackState = { rows, count: 0, overflow: 0 };
  // Qualifying auras of ONE unit, refilled and sorted in place so the per-frame
  // path never mints a filtered array.
  const scratch: AuraTrackAuraInput[] = [];
  // The high-water peak absorb per aura key, so a points bar has something to
  // fill against: the sim stores what is LEFT, never what it started with.
  const peakPoints = new Map<string, number>();
  // The keys still standing this tick, reused so the prune below allocates
  // nothing on the frame path.
  const liveKeys = new Set<string>();

  let count = 0;
  let overflow = 0;
  let cap = AURA_TRACK_ROW_CAP;
  let includeModes = true;

  function scanUnit(entity: TEntity, onSelf: boolean): void {
    if (entity.dead || entity.auras.length === 0) return;
    scratch.length = 0;
    for (const aura of entity.auras) {
      if (!deps.isOwn(aura)) continue;
      const entry = auraTrackEntry(aura.id);
      if (!entry) continue;
      if (!descriptor.accepts(entry, onSelf)) continue;
      if (aura.remaining <= 0 && aura.permanent !== true) continue;
      // See the header: one aura id, two polarities. LAST of the four filters on
      // purpose. Six views each scan every unit, so an aura this track was never
      // going to take (a self-buff reaching the Friendly track) would otherwise
      // be polarity-classified six times a frame to be dropped by the next line
      // anyway; here it is only asked of auras this track would actually paint.
      if (isDebuffDisplayAura((aura.kind ?? '') as AuraKind, aura.value ?? 1, aura.id)) continue;
      scratch.push(aura);
    }
    scratch.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    let previousId = '';
    let occurrence = 0;
    for (const aura of scratch) {
      occurrence = aura.id === previousId ? occurrence + 1 : 0;
      previousId = aura.id;
      const mode = deps.isMode(aura);
      if (mode && !includeModes) continue;
      if (count >= cap) {
        overflow++;
        continue;
      }
      const row = rows[count] ?? newRow();
      rows[count] = row;
      const baseKey = `${entity.id}:${aura.id}`;
      row.key = occurrence === 0 ? baseKey : `${baseKey}#${occurrence}`;
      row.entityId = entity.id;
      row.auraName = deps.auraName(aura);
      row.unitName = onSelf ? '' : deps.unitName(entity);
      row.iconKey = deps.iconKey(aura);
      row.remaining = Math.max(0, aura.remaining);
      row.stacks = aura.stacks !== undefined && aura.stacks > 1 ? aura.stacks : 0;
      row.mode = mode;

      if (descriptor.shape === 'points') {
        // The sim decrements the aura's value as damage lands, so the value on
        // its own cannot say how full the shield is. Remember the highest value
        // seen for this row and fill against that, which is the cast amount for
        // as long as the row lives and resets when a fresh cast raises it.
        const points = Math.max(0, aura.value ?? 0);
        const peak = Math.max(peakPoints.get(row.key) ?? 0, points);
        peakPoints.set(row.key, peak);
        row.points = points;
        row.fraction = peak > 0 ? Math.min(1, points / peak) : 1;
      } else {
        row.points = 0;
        row.fraction = row.mode ? 1 : timeFraction(aura);
      }
      row.decimals = row.remaining < AURA_TRACK_DECIMAL_BELOW_SEC ? 1 : 0;
      row.expiring = !row.mode && isAuraExpiring(aura.remaining, aura.duration);
      count++;
    }
  }

  return {
    tick(input): AuraTrackState {
      count = 0;
      overflow = 0;
      state.count = 0;
      state.overflow = 0;
      if (!input.enabled) return state;
      cap = input.cap ?? AURA_TRACK_ROW_CAP;
      includeModes = input.includeModes;

      if (input.player) scanUnit(input.player, true);
      for (const ally of input.allies) {
        if (input.player && ally.id === input.player.id) continue;
        scanUnit(ally, false);
      }

      // Forget the peak of any row that is gone THIS tick, so a recast starts
      // fresh. Not once the map has grown past some size: a solo player's own
      // shield key would never have been evicted by a size rule, so a fresh,
      // smaller shield read against the peak of one that had already expired
      // (cast 800, let it lapse, recast 600, and the bar sat at 75%). The map
      // holds at most `count` live keys, so the sweep is a handful of lookups,
      // and it only runs when a key has actually gone stale.
      if (peakPoints.size > count) {
        liveKeys.clear();
        for (let i = 0; i < count; i++) liveKeys.add(rows[i].key);
        for (const key of peakPoints.keys()) if (!liveKeys.has(key)) peakPoints.delete(key);
      }

      state.count = count;
      state.overflow = overflow;
      return state;
    },
  };
}
