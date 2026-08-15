// What a PLAYER wears: the one rule that turns a stored/wire appearance into a
// composed ModularLook, for every surface that draws a character the player
// designed: the world, the char-select stage, the roster portrait chip, the
// redesign editor's turntable.
//
// It lives here rather than in the app coordinator because it is a rendering
// rule (which parts, over which kit, with the helm on or off), and because
// keeping it DOM-free and three-free makes it directly unit-testable
// (tests/player_look_core.test.ts). The coordinator's job shrinks to supplying the
// two things only it knows: which armour set to preview, and where the
// appearance came from.
//
// The armour set is a PARAMETER on purpose. The local player honours a
// per-class localStorage override (a dev knob) and peers must not: reading that
// store here would drag localStorage into a core that has no business touching
// it, and would silently dress every peer in whatever set this machine last
// picked.

import type { Entity, PlayerClass } from '../../sim/types';
import { sameAppearance } from '../../world_api/appearance';
import {
  type ArmorSetId,
  classArmorSet,
  fullSet,
  type ModularAppearance,
  type ModularLook,
  normalizeAppearance,
} from './modular';

/** The roster-row fields a look is composed from. Structural on purpose: the
 *  char-select `CharacterSummary` satisfies it without this render module
 *  importing the net layer. */
export interface RosterLookRow {
  class: PlayerClass;
  /** The character's stored look (its own DB column), null for a character
   *  authored before the modular creator. */
  appearance?: Record<string, unknown> | null;
  /** The character's standing helm-visibility preference. */
  helmHidden?: boolean;
  /** 'mech' is a REPLACEMENT body, never composed over. */
  skinCatalog?: 'class' | 'mech';
}

/**
 * Compose an authored look over a class kit, or null when there is nothing
 * authored (the caller then keeps the fixed class rig).
 *
 * `appearance` is untrusted (it arrives from the wire or from a JSONB column
 * that a previous client version wrote), so it always goes through
 * normalizeAppearance, which clamps every unknown style id and out-of-range
 * slider to something real. A hostile or merely stale payload can therefore
 * only ever produce a valid body, never break one.
 */
export function composedLook(
  appearance: Record<string, unknown> | null | undefined,
  armorSet: ArmorSetId,
  helmHidden: boolean,
): ModularLook | null {
  if (!appearance) return null;
  const app = normalizeAppearance(appearance as Partial<ModularAppearance>);
  const full = fullSet(armorSet);
  // The head piece is dropped rather than the kit swapped: the rest of the set
  // is unchanged, so hiding a helm never restyles the armour under it.
  return { app, worn: helmHidden ? { ...full, head: null } : full };
}

/**
 * The IN-WORLD look for a player entity: THEIR authored appearance (the `app`
 * identity wire field, i.e. the character's own DB column, never the
 * device-global creation draft, which used to restyle every character on the
 * account), worn over the class kit, with the head piece left off when the
 * entity's `helmHidden` wire bit says so (the paperdoll eye toggle).
 *
 * Null for a non-player or a player with no authored look: they keep the fixed
 * class rig. `armorSetFor` is how the caller expresses the local-player-only
 * armour-set override without this core reading a store.
 */
export function inWorldLookFor(
  e: Entity,
  armorSetFor: (cls: PlayerClass) => ArmorSetId,
): ModularLook | null {
  if (e.kind !== 'player' || !e.modularAppearance) return null;
  return composedLook(e.modularAppearance, armorSetFor(e.templateId as PlayerClass), e.helmHidden);
}

/**
 * Which armour-set source an entity's composed body reads from: the LOCAL
 * player honours the per-class localStorage override (a dev knob, supplied by
 * the caller), every peer wears the class's own kit.
 *
 * A two-line ternary, in the core rather than inline at the provider install
 * site, because it is the line that ENFORCES "a peer cannot wear this
 * machine's stored armour set", and inline in the coordinator no test could
 * reach it (nothing imports src/main.ts), so flipping it to always return the
 * override broke nothing. Here it sits beside the rules it serves, under the
 * same purity guard and test file.
 */
export function armorSetSourceFor(
  isSelf: boolean,
  localOverride: (cls: PlayerClass) => ArmorSetId,
  classKit: (cls: PlayerClass) => ArmorSetId,
): (cls: PlayerClass) => ArmorSetId {
  return isSelf ? localOverride : classKit;
}

/**
 * A roster character's composed pieces, or null when the row renders a fixed
 * rig: no authored look (a pre-creator character), or the Combat Mech
 * replacement body, which is never composed over. The worn kit mirrors the
 * in-world rule, with the class's own set (a roster row is not the local
 * player's dev override).
 */
export function charselectLook(c: RosterLookRow): ModularLook | null {
  if (c.skinCatalog === 'mech') return null;
  return composedLook(c.appearance, classArmorSet(c.class), c.helmHidden === true);
}

/**
 * Whether a live entity's authored look changed VALUE since the last frame it
 * was composed. This backs the renderer's per-entity per-frame diff that
 * decides whether a mounted body needs to recompose (the sibling of its
 * helmHidden diff): a redesign lands on a live session as a new `app` field
 * on the entity, and nothing else in the renderer looks at it.
 *
 * PERF (this runs once per entity, every frame, in the renderer's hot loop):
 * the check order below is load-bearing, not stylistic.
 *  1. Reference equality first, and it must return fast. The client mirror
 *     (src/net/online.ts) reassigns `e.modularAppearance` to a NEW object on
 *     every full identity record it applies (an equip, a level-up), even when
 *     the look itself is unchanged, so the common case has to resolve here
 *     without ever reaching a stringify.
 *  2. Null/undefined next, both read as "no look" so a pre-creator character
 *     (whose field is undefined, never explicitly null) does not spuriously
 *     compare unequal to itself.
 *  3. Only then a value comparison, delegated to `sameAppearance`
 *     (src/world_api/appearance.ts): its JSON.stringify shortcut is sound
 *     here because both sides are documents produced by the same sanitizer,
 *     which emits keys in a fixed order.
 */
export function modularLookChanged(
  prev: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): boolean {
  if (prev === next) return false;
  const prevLook = prev ?? null;
  const nextLook = next ?? null;
  if (prevLook === null && nextLook === null) return false;
  if (prevLook === null || nextLook === null) return true;
  return !sameAppearance(prevLook, nextLook);
}
