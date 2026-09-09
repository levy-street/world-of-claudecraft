// Pure view-core for the Target dots frame (#target-dots): the multi-target
// tracker for every debuff the LOCAL player currently has out, one row per
// (enemy, aura) pair. DOM/Three/i18n-free so it unit-tests directly; the painter
// turns these rows into pooled DOM and localizes the names. Registered in
// UI_PURE_CORES; tested in tests/target_dots_view.test.ts.
//
// CLASS-AGNOSTIC BY CONSTRUCTION. The selection rule is ownership plus harm, never
// an ability list: an aura qualifies when the host's isOwn predicate says the local
// player cast it AND isDebuffAura (src/sim/aura_classify.ts, the same classifier the
// target strip uses) says it is harmful. So a warlock's Blackrot, a druid's Lunar
// Tempest, a rogue's poisons, a hunter's Venom Barb and a warrior's bleeds all land
// here on the same code path, and a debuff added to any class later needs no change
// in this file. It deliberately shows only the player's OWN debuffs: the group's are
// already on the target frame strip, and mixing them back in is the clutter this
// frame exists to escape.
//
// ORDER IS STABLE ON PURPOSE. Rows group by enemy (the current target first, then by
// entity id) and sort by aura id inside a group, never by remaining time. Sorting by
// urgency would re-order the list under the player's eyes every tick, which is the
// one thing a refresh tracker must not do: the row you are reaching for has to stay
// where it was. Urgency is carried by the fill, the countdown, and the `expiring`
// flag instead.
//
// Allocation-light: the state, its row array and every row record are owned by the
// core and reused across ticks (rows grow only to their high-water mark), the
// auras_view idiom, so a steady frame allocates nothing.

import { isDebuffAura } from '../../../sim/aura_classify';
import type { AuraKind } from '../../../sim/types';
import { isAuraExpiring } from '../../auras_view';

/** Rows the frame will paint at most. Past this the list stops reading as a
 *  glanceable stack and starts covering the world; the target frame strip
 *  remains the complete list. */
export const TARGET_DOTS_ROW_CAP = 12;

/** Under this many seconds the countdown gains one decimal, the precision a
 *  refresh actually needs; above it, whole seconds. */
export const TARGET_DOTS_DECIMAL_BELOW_SEC = 10;

/** The aura fields this core reads: a structural subset of the sim `Aura` that
 *  both worlds mirror, so `world.entities` values pass straight in. */
export interface TargetDotsAuraInput {
  id: string;
  name: string;
  kind: AuraKind;
  value: number;
  remaining: number;
  duration?: number;
  permanent?: boolean;
  sourceId?: number;
  school?: string;
  stacks?: number;
}

/** The entity fields this core reads (a structural subset of sim `Entity`). */
export interface TargetDotsEntityInput {
  id: number;
  kind: string;
  name: string;
  dead: boolean;
  auras: readonly TargetDotsAuraInput[];
}

/** One painted row: an aura the local player has out on one enemy. */
export interface TargetDotRow {
  /** Stable pool key, `<entityId>:<auraId>` plus an occurrence index when one
   *  enemy carries the same aura id twice. */
  key: string;
  entityId: number;
  targetName: string;
  auraName: string;
  /** Artwork identity the painter resolves to a URL (the aura id today). */
  iconKey: string;
  /** Magic school, for the bar tint; '' when the mirror omitted it. */
  school: string;
  remaining: number;
  /** Fraction of the aura's full duration still to run, 0..1. A permanent or
   *  duration-less aura reads as a full bar. */
  fraction: number;
  /** Decimals the countdown prints (see TARGET_DOTS_DECIMAL_BELOW_SEC). */
  decimals: 0 | 1;
  /** Stack count above 1, else 0 (the painter hides the badge at 0). */
  stacks: number;
  /** This row's enemy is the player's current target. */
  onCurrentTarget: boolean;
  /** In its final seconds (auras_view isAuraExpiring): the row blinks. */
  expiring: boolean;
}

export interface TargetDotsState {
  rows: TargetDotRow[];
  /** Rows to paint; `rows` beyond this index are stale scratch. */
  count: number;
  /** Rows the cap dropped, so the painter can say the list is truncated. */
  overflow: number;
}

export interface TargetDotsDeps<TEntity extends TargetDotsEntityInput = TargetDotsEntityInput> {
  /** Did the LOCAL player cast this aura? Injected so the frame shares the host's
   *  one ownership predicate with the target strip rather than re-deriving it. */
  isOwn(aura: TargetDotsAuraInput): boolean;
  /** Localized aura name. */
  auraName(aura: TargetDotsAuraInput): string;
  /** Localized enemy name. Typed on the HOST's entity rather than this core's
   *  narrower structural subset: the one real consumer resolves names from the
   *  sim Entity, and narrowing here only bought a double cast at the call site.
   *  The core still reads nothing but the subset above. */
  targetName(entity: TEntity): string;
  /** Artwork identity for this aura. */
  iconKey(aura: TargetDotsAuraInput): string;
}

export interface TargetDotsInput<TEntity extends TargetDotsEntityInput = TargetDotsEntityInput> {
  entities: Iterable<TEntity>;
  /** The player's current target id, or null. Its rows lead the list. */
  targetId: number | null;
  /** The showTargetDots setting. False empties the state without scanning. */
  enabled: boolean;
  /** Row cap override (tests); defaults to TARGET_DOTS_ROW_CAP. */
  cap?: number;
}

export interface TargetDotsViewCore<TEntity extends TargetDotsEntityInput = TargetDotsEntityInput> {
  tick(input: TargetDotsInput<TEntity>): TargetDotsState;
}

/** Is this entity something the player can have a debuff out on? Players are
 *  excluded: a duel or a battleground debuff belongs to the unit frames, and a
 *  world-PvP tracker is a separate decision nobody has asked for. */
function isTrackableTarget(entity: TargetDotsEntityInput): boolean {
  return entity.kind === 'mob' && !entity.dead && entity.auras.length > 0;
}

function newRow(): TargetDotRow {
  return {
    key: '',
    entityId: 0,
    targetName: '',
    auraName: '',
    iconKey: '',
    school: '',
    remaining: 0,
    fraction: 1,
    decimals: 0,
    stacks: 0,
    onCurrentTarget: false,
    expiring: false,
  };
}

/** Remaining fraction of the full duration, clamped; a permanent or duration-less
 *  aura reads full rather than empty (it is not running out). */
function remainingFraction(aura: TargetDotsAuraInput): number {
  const duration = aura.duration;
  if (aura.permanent === true) return 1;
  if (duration === undefined || !Number.isFinite(duration) || duration <= 0) return 1;
  return Math.min(1, Math.max(0, aura.remaining / duration));
}

/**
 * Create the tracker's derivation. One instance per frame (the Hud owns it), so
 * the returned state and its rows are the SAME objects every tick: read them
 * before the next call, never retain them.
 */
export function createTargetDotsView<TEntity extends TargetDotsEntityInput>(
  deps: TargetDotsDeps<TEntity>,
): TargetDotsViewCore<TEntity> {
  const rows: TargetDotRow[] = [];
  const state: TargetDotsState = { rows, count: 0, overflow: 0 };
  // Scratch for the two-pass gather (current target first, then the rest). Both
  // hold entity references only, and both keep their high-water capacity.
  const primary: TEntity[] = [];
  const others: TEntity[] = [];
  // Qualifying auras of ONE entity, refilled and sorted in place per entity so
  // the per-frame path never mints a filtered array.
  const auraScratch: TargetDotsAuraInput[] = [];

  const writeRow = (
    index: number,
    entity: TEntity,
    aura: TargetDotsAuraInput,
    onCurrentTarget: boolean,
    occurrence: number,
  ): void => {
    const row = rows[index] ?? newRow();
    rows[index] = row;
    // One enemy can legitimately carry the same aura id twice (the sim dedups by
    // id + source, so two casters stack; only OUR copy reaches here, but a
    // charge-split effect can still repeat). The scratch is sorted by id, so
    // duplicates are adjacent and the occurrence index alone keys them apart.
    row.key =
      occurrence === 0 ? `${entity.id}:${aura.id}` : `${entity.id}:${aura.id}#${occurrence}`;
    row.entityId = entity.id;
    row.targetName = deps.targetName(entity);
    row.auraName = deps.auraName(aura);
    row.iconKey = deps.iconKey(aura);
    row.school = aura.school ?? '';
    row.remaining = Math.max(0, aura.remaining);
    row.fraction = remainingFraction(aura);
    row.decimals = row.remaining < TARGET_DOTS_DECIMAL_BELOW_SEC ? 1 : 0;
    row.stacks = aura.stacks !== undefined && aura.stacks > 1 ? aura.stacks : 0;
    row.onCurrentTarget = onCurrentTarget;
    row.expiring = isAuraExpiring(aura.remaining, aura.duration);
  };

  return {
    tick(input): TargetDotsState {
      state.count = 0;
      state.overflow = 0;
      if (!input.enabled) return state;

      primary.length = 0;
      others.length = 0;
      for (const entity of input.entities) {
        if (!isTrackableTarget(entity)) continue;
        if (input.targetId !== null && entity.id === input.targetId) primary.push(entity);
        else others.push(entity);
      }
      // Entity id is the sim's stable spawn order, so this ordering never
      // depends on Map iteration order or on where the player is standing.
      others.sort((a, b) => a.id - b.id);

      const cap = input.cap ?? TARGET_DOTS_ROW_CAP;
      let count = 0;
      let overflow = 0;
      for (let pass = 0; pass < 2; pass++) {
        const group = pass === 0 ? primary : others;
        for (const entity of group) {
          // Refill the shared scratch rather than minting a filtered array, then
          // sort by aura id so the row order never depends on the order the sim
          // happened to apply them in.
          auraScratch.length = 0;
          for (const aura of entity.auras) {
            if (!deps.isOwn(aura)) continue;
            if (!isDebuffAura(aura.kind, aura.value)) continue;
            if (aura.remaining <= 0) continue;
            auraScratch.push(aura);
          }
          auraScratch.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
          let previousId = '';
          let occurrence = 0;
          for (const aura of auraScratch) {
            occurrence = aura.id === previousId ? occurrence + 1 : 0;
            previousId = aura.id;
            if (count >= cap) {
              overflow++;
              continue;
            }
            writeRow(count, entity, aura, pass === 0, occurrence);
            count++;
          }
        }
      }
      state.count = count;
      state.overflow = overflow;
      return state;
    },
  };
}
