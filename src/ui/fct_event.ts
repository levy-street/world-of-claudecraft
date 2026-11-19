// Pure discrimination for floating-combat-text spawns: the SimEvent -> FctEvent SHAPING
// half of the FCT split. The hud.ts spawn sites assemble the { kind, isSelf, crit }
// triple inline; this lifts that decision (which is the only non-trivial part: the damage
// source/target priority, the ability vs auto split, the miss/dodge self-vs-other colour
// flag) into one deterministic, testable function. Host-agnostic and DOM/clock/i18n-free
// (registered in UI_PURE_CORES): the localized text (the t() calls and the `${amount}` /
// `-${amount}` / `+${amount}` fragments) and the resolved target entity STAY at the call
// site and are spread onto this result, so the core never calls t() or reads an entity,
// consistent with fct_core emitting discriminators and the painter localizing.

import type { FctKind } from './fct_core';

/**
 * The normalized inputs each spawn occasion supplies: the raw SimEvent fields that drive
 * the discrimination plus the {isPlayerSource, isPlayerTarget} role flags. A discriminated
 * union, one arm per distinct spawn site in hud.ts's event switch + showSelfNote.
 */
export type FctSpawnSource =
  | {
      readonly type: 'damage';
      /**
       * The damage event's kind: an avoidance word (miss/dodge/parry/resist/evade), a
       * plain landed hit, or a shield block (also a landed hit, still dealing real
       * reduced damage, so it is NOT grouped with the avoidance words below).
       */
      readonly damageKind: 'miss' | 'dodge' | 'parry' | 'resist' | 'evade' | 'block' | 'hit';
      /** Whether an ability fired (a landed hit splits damage-done into -ability vs -auto). */
      readonly ability: boolean;
      readonly crit: boolean;
      readonly isPlayerSource: boolean;
      /** Whether a temporary guardian owned by the player caused the event. */
      readonly isPlayerOwnedSource?: boolean;
      readonly isPlayerTarget: boolean;
      /**
       * The whole hit landed inside an absorb shield: zero damage got through, and
       * an absorb floater is being spawned for it separately. The NUMBER is then
       * suppressed, because a bare "0" beside "Absorbed (240)" is the misleading
       * half of the pair: it reads as a broken attack rather than a soaked one.
       * Heals already work this way (their call site guards on `amount > 0`);
       * damage simply never got the same guard.
       */
      readonly fullyAbsorbed?: boolean;
      /**
       * The hit is a damage-over-time TICK (FctPeriodicTicks pairs it with the aura's
       * `spellfx` tick event), not a direct hit. A landed tick carries the periodic
       * flag, which only the vivid look reads.
       */
      readonly periodic?: boolean;
    }
  | {
      /**
       * A hit whose damage an absorb shield soaked (the damage event's `absorbed`
       * amount). BOTH sides of the swing get the floater: the defender reads it over
       * their own character, and the ATTACKER reads it over the target, which is the
       * only feedback saying their hit did not do nothing. The role flags carry the
       * same meaning as the damage arm's, so a hit between two other entities floats
       * nothing here exactly as it does there.
       */
      readonly type: 'absorb';
      readonly isPlayerSource: boolean;
      readonly isPlayerTarget: boolean;
    }
  | {
      readonly type: 'heal';
      readonly crit: boolean;
      readonly isPlayerTarget: boolean;
      /** A heal-over-time tick (the heal2 event's `hot` flag), floated like a DoT tick. */
      readonly periodic?: boolean;
    }
  | { readonly type: 'xp' }
  | { readonly type: 'rested-xp' }
  | { readonly type: 'honor' }
  | { readonly type: 'self-note' };

/** The discriminator the painter spawns with (the text + target are spread on at the call site). */
export interface FctSpawnShape {
  readonly kind: FctKind;
  /** Drives the miss/dodge colour token (self #bbb vs other #fff); ignored by every other kind. */
  readonly isSelf: boolean;
  readonly crit: boolean;
  /**
   * Seconds to hold this floater before it appears, for an ability whose authored
   * contacts land after the cast tick (Red Harvest's three blades). Never set by
   * fctSpawnShape, which is a pure discrimination: the painter stamps it from the beat
   * stager (fct_stage_core.ts) and honours it, and the spawn sites carry it onto the
   * FctEvent with the rest of the shape. Absent or 0 means spawn at once, which is
   * every other floater in the game.
   */
  readonly delaySec?: number;
  /** The raw amount of an outgoing hit (for the big-hit emphasis); outgoing hits only. */
  readonly amount?: number;
  /**
   * A pet or temporary guardian the player owns dealt this, not the player. The vivid
   * look sets these numbers apart (smaller, a dimmer tint, the far lanes first) so a
   * pet's swings never read as the player's own hits. Absent on everything else.
   */
  readonly pet?: boolean;
  /**
   * A damage-over-time tick, not a direct hit (outgoing or incoming). The vivid look sets
   * ticks in a smaller italic so a DoT never reads as a fresh hit, and a ticking crit
   * apart from a direct crit. Absent on everything else.
   */
  readonly periodic?: boolean;
}

/**
 * The damage-event `ability` labels the sim stamps on a plain ranged auto-attack: the
 * hunter's Auto Shot and the wand bolt (combat/auto_attack.ts AUTO_SHOT_LABEL and
 * WAND_SHOT_LABEL; tests/fct_event.test.ts pins the two against the sim). Both are white
 * hits exactly like a melee swing, which carries no label at all, so they float in the
 * auto-attack colour instead of reading as an ability.
 */
export const FCT_WHITE_HIT_LABELS: ReadonlySet<string> = new Set(['Auto Shot', 'Wand']);

/** Whether a damage event's `ability` label marks a real ability (not a white hit). */
export function fctIsAbilityHit(label: string | null | undefined): boolean {
  return !!label && !FCT_WHITE_HIT_LABELS.has(label);
}

/** The two entity ids a damage-over-time tick is keyed by (structural: a spellfx or damage event). */
export interface FctTickKey {
  readonly sourceId: number;
  readonly targetId: number;
}

/**
 * How many DoT ticks one event drain can hold unpaired. A bound, not a budget: the arrays
 * are preallocated and a tick past it is simply not marked (its number reads as a plain hit,
 * the pre-existing look), never a growing map.
 */
export const FCT_TICK_SLOTS = 32;

/**
 * Pairs each damage-over-time tick with the damage it deals. The sim emits an entity-anchored
 * `spellfx` with fx 'tick' immediately before every DoT tick's damage event (combat/auras.ts,
 * affliction.ts and the other periodic paths), and the damage event itself carries no
 * periodic flag (its shape is pinned by the parity recordings). So the HUD notes each tick
 * as it drains and the next damage event between the same source and target in the SAME
 * drain is that tick. ALLOCATION-FREE and CLOCK-FREE like FctBeatStager: fixed arrays, and
 * the drain is identified by the `now` the caller already stamps its batch with.
 */
export class FctPeriodicTicks {
  private readonly sources: number[] = [];
  private readonly targets: number[] = [];
  private used = 0;
  private frame = Number.NaN;

  constructor(private readonly slots: number = FCT_TICK_SLOTS) {
    for (let i = 0; i < slots; i++) {
      this.sources.push(0);
      this.targets.push(0);
    }
  }

  /** Record a DoT tick effect (a `spellfx` with fx 'tick') seen in the drain stamped `now`. */
  note(tick: FctTickKey, now: number): void {
    this.sync(now);
    if (this.used >= this.slots) return;
    this.sources[this.used] = tick.sourceId;
    this.targets[this.used] = tick.targetId;
    this.used++;
  }

  /**
   * Whether this damage event is a noted tick, consuming the note when it is, so one tick
   * effect marks exactly one damage number.
   */
  take(hit: FctTickKey, now: number): boolean {
    this.sync(now);
    for (let i = 0; i < this.used; i++) {
      if (this.sources[i] !== hit.sourceId || this.targets[i] !== hit.targetId) continue;
      this.used--;
      this.sources[i] = this.sources[this.used];
      this.targets[i] = this.targets[this.used];
      return true;
    }
    return false;
  }

  private sync(now: number): void {
    if (now === this.frame) return;
    this.frame = now;
    this.used = 0;
  }
}

/**
 * The damage-event field the vivid look reads beyond the discrimination: the hit's raw
 * amount. Structural, so the hud.ts spawn site hands in the damage SimEvent it already has
 * (both an offline Sim event and a ClientWorld-mirrored one carry `amount`).
 */
export interface FctDamageFlavorSource {
  readonly amount?: number;
}

/**
 * Stamp the amount of the local player's OWN outgoing hit onto its spawn shape, so the
 * painter can weigh the hit against the player's running average. `ownHit` says the local
 * player dealt it directly: a pet's or guardian's hit carries no amount, so it neither feeds
 * nor trips the big-hit emphasis.
 * Every other shape (an avoidance word, incoming damage, a heal, null) passes
 * through unchanged: incoming damage keeps its one hostile red on purpose, because "you are
 * being hurt" must read the same whatever hurt you. Pure: same input, same output.
 */
export function withDamageFlavor(
  shape: FctSpawnShape | null,
  ev: FctDamageFlavorSource,
  ownHit = true,
): FctSpawnShape | null {
  if (shape === null) return null;
  if (!ownHit) return shape;
  if (
    shape.kind !== 'damage-done-ability' &&
    shape.kind !== 'damage-done-auto' &&
    shape.kind !== 'damage-done-block'
  ) {
    return shape;
  }
  return { ...shape, amount: ev.amount };
}

/**
 * Resolve the FCT spawn shape for an event, or null when nothing floats. Both null cases are
 * the same rule: a hit (landed damage, or damage an absorb shield soaked) where the local
 * player is neither the source nor the target, e.g. a mob hitting another mob. The live
 * hud.ts sites spawned no floater there, so the byte-faithful result is null. Every other
 * case always floats. Pure: same input always yields the same shape.
 */
export function fctSpawnShape(src: FctSpawnSource): FctSpawnShape | null {
  const shape = baseSpawnShape(src);
  // A landed DoT tick (dealt or taken) and a HoT tick carry the periodic flag; nothing else
  // does, so every other shape keeps its exact pre-existing form.
  if (shape !== null && src.type === 'damage' && src.periodic && isLandedHitKind(shape.kind))
    return { ...shape, periodic: true };
  if (shape !== null && src.type === 'heal' && src.periodic) return { ...shape, periodic: true };
  return shape;
}

function isLandedHitKind(kind: FctKind): boolean {
  return (
    kind === 'damage-done-ability' ||
    kind === 'damage-done-auto' ||
    kind === 'damage-done-block' ||
    kind === 'damage-taken' ||
    kind === 'damage-taken-block'
  );
}

function baseSpawnShape(src: FctSpawnSource): FctSpawnShape | null {
  switch (src.type) {
    case 'damage': {
      // A fully soaked hit floats no number on EITHER side: the absorb floater is
      // the honest report, and the zero beside it says the opposite of the truth.
      // Checked before the avoidance words on purpose, since those carry no amount
      // and can never be fully absorbed.
      if (src.fullyAbsorbed) return null;
      // Avoidance words always float; self vs other only flips the colour token.
      // Parry reuses the dodge colour token (its own word is spread on at the call site).
      if (
        src.damageKind === 'miss' ||
        src.damageKind === 'dodge' ||
        src.damageKind === 'parry' ||
        src.damageKind === 'resist' ||
        src.damageKind === 'evade'
      )
        return {
          kind: src.damageKind === 'parry' ? 'dodge' : src.damageKind,
          isSelf: src.isPlayerTarget,
          crit: false,
        };
      // A landed hit: the player dealing it (and not to itself) floats damage-done; the
      // player taking it floats damage-taken; a hit between two non-player entities floats
      // nothing (the live site's `if (isPlayerSource && !isPlayerTarget) ... else if
      // (isPlayerTarget)` with no else). A shield block takes the SAME role split (it is
      // still a landed hit, just reduced by blockValue) but its own -block kind, so it
      // reads with its own colour/word instead of a plain hit's.
      if ((src.isPlayerSource || src.isPlayerOwnedSource) && !src.isPlayerTarget) {
        const kind =
          src.damageKind === 'block'
            ? 'damage-done-block'
            : src.ability
              ? 'damage-done-ability'
              : 'damage-done-auto';
        // A pet's or guardian's hit keeps the player's kind (so Classic Combat Text is
        // unchanged) and adds the pet flag, which only the vivid look reads.
        return src.isPlayerSource
          ? { kind, isSelf: false, crit: src.crit }
          : { kind, isSelf: false, crit: src.crit, pet: true };
      }
      if (src.isPlayerTarget)
        return {
          kind: src.damageKind === 'block' ? 'damage-taken-block' : 'damage-taken',
          isSelf: true,
          crit: src.crit,
        };
      return null;
    }
    case 'absorb':
      // Same role split as a landed hit, and for the same reason: the floater is
      // anchored on the entity that ATE the damage, so `isSelf` records whether that
      // entity is the local player (true when you are shielded, false when you are the
      // attacker watching a shielded target soak your hit). A shielded exchange between
      // two other entities is not the local player's feedback and floats nothing, which
      // is the second null case. The absorb colour token does not branch on isSelf (both
      // sides read the same .fct-absorb style), so the flag is carried for the anchor's
      // honesty rather than for a colour swap.
      if (!src.isPlayerSource && !src.isPlayerTarget) return null;
      return { kind: 'absorb', isSelf: src.isPlayerTarget, crit: false };
    case 'heal':
      return { kind: 'heal', isSelf: src.isPlayerTarget, crit: src.crit };
    case 'xp':
      return { kind: 'xp', isSelf: true, crit: false };
    case 'rested-xp':
      return { kind: 'rested-xp', isSelf: true, crit: false };
    case 'honor':
      return { kind: 'honor', isSelf: true, crit: false };
    case 'self-note':
      return { kind: 'self-note', isSelf: true, crit: false };
  }
}
