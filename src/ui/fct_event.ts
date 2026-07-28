// Pure discrimination for floating-combat-text spawns: the SimEvent -> FctEvent SHAPING
// half of the FCT split. The hud.ts spawn sites assemble the { kind, isSelf, crit }
// triple inline; this lifts that decision (which is the only non-trivial part: the damage
// source/target priority, the ability vs auto split, the avoidance self-vs-other colour
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
      /** The damage event's kind: an avoidance word, a partial block, or a landed hit. */
      readonly damageKind: 'miss' | 'dodge' | 'resist' | 'parry' | 'block' | 'hit';
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
 * is landed damage where the local player is neither the source nor the target (a mob hitting
 * another mob): the live hud.ts site spawns no floater there, so the byte-faithful result is
 * null. Avoidance words always float. Pure: same input always yields the same shape.
 */
export function fctSpawnShape(src: FctSpawnSource): FctSpawnShape | null {
  switch (src.type) {
    case 'damage': {
      // Avoidance words always float; self vs other only flips the colour token.
      if (
        src.damageKind === 'miss' ||
        src.damageKind === 'dodge' ||
        src.damageKind === 'resist' ||
        src.damageKind === 'parry'
      )
        return { kind: src.damageKind, isSelf: src.isPlayerTarget, crit: false };
      // Landed damage: a partial block keeps its reduced amount but gets a distinct token;
      // ordinary hits split damage-done by ability vs auto. A hit between two non-player
      // entities floats nothing (the live site's `if (isPlayerSource && !isPlayerTarget) ...
      // else if (isPlayerTarget)` with no else).
      if (src.isPlayerSource && !src.isPlayerTarget)
        return {
          kind:
            src.damageKind === 'block'
              ? src.ability
                ? 'block-done-ability'
                : 'block-done-auto'
              : src.ability
                ? 'damage-done-ability'
                : 'damage-done-auto',
          isSelf: false,
          crit: src.crit,
        };
      if (src.isPlayerTarget)
        return {
          kind: src.damageKind === 'block' ? 'block-taken' : 'damage-taken',
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
