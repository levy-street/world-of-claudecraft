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
      readonly isPlayerTarget: boolean;
    }
  | { readonly type: 'absorb' }
  | { readonly type: 'heal'; readonly crit: boolean; readonly isPlayerTarget: boolean }
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
}

/**
 * Resolve the FCT spawn shape for an event, or null when nothing floats. The only null case
 * is a landed hit where the local player is neither the source nor the target (a mob hitting
 * another mob): the live hud.ts site spawned no floater there, so the byte-faithful result is
 * null. Every other case always floats. Pure: same input always yields the same shape.
 */
export function fctSpawnShape(src: FctSpawnSource): FctSpawnShape | null {
  switch (src.type) {
    case 'damage': {
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
      if (src.isPlayerSource && !src.isPlayerTarget)
        return {
          kind:
            src.damageKind === 'block'
              ? 'damage-done-block'
              : src.ability
                ? 'damage-done-ability'
                : 'damage-done-auto',
          isSelf: false,
          crit: src.crit,
        };
      if (src.isPlayerTarget)
        return {
          kind: src.damageKind === 'block' ? 'damage-taken-block' : 'damage-taken',
          isSelf: true,
          crit: src.crit,
        };
      return null;
    }
    case 'absorb':
      return { kind: 'absorb', isSelf: true, crit: false };
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
