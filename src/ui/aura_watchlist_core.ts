// Pure core for the aura-overlay WATCHLIST: the player-chosen extra spells that
// get their own aura vision on top of the curated class/talent proc list in
// aura_overlay_view.ts.
//
// Why a second list at all: availableAuraProcDefs answers "which procs did we
// author an overlay for", a curated set. This core answers the customization
// question the curated set cannot: "which of MY OWN spells do I want to see
// light up when they land on me". It derives, from the player's known abilities,
// every spell that puts an aura on the caster, and turns the ones the player
// picked into ordinary AuraOverlayProcDefs. Downstream (the controller, the
// painter, the config store, the settings panel) sees no difference between a
// curated def and a watched one, so the whole customization surface (icon,
// crescents, ground ring, color, opacity, size, order, placement) comes for free.
//
// DOM-free, i18n-free, storage-free: the signature derivation and the id round
// trip are the load-bearing rules and are unit-tested directly. The controller
// owns persistence and the panel owns the picker.

import { isToggleAura } from '../sim/aura_classify';
import type { AbilityDef, PlayerClass } from '../sim/types';
import type { AuraOverlayProcDef, AuraOverlayProcId } from './aura_overlay_view';

/** Namespace prefix that keeps a watched proc id from ever colliding with an
 *  authored proc id (`revenge_free`, `hot_streak`, a talent proc id). It is also
 *  what the per-proc config store keys on, so a watched spell's placement and
 *  colors persist independently of everything else. */
export const WATCHED_PROC_PREFIX = 'watch:';

/** The proc id a watched ability owns. */
export function watchedProcId(abilityId: string): AuraOverlayProcId {
  return `${WATCHED_PROC_PREFIX}${abilityId}`;
}

/** The ability id behind a watched proc id, or null when the id is an authored
 *  (curated or talent) proc rather than a watched one. */
export function watchedProcAbilityId(procId: AuraOverlayProcId): string | null {
  return procId.startsWith(WATCHED_PROC_PREFIX)
    ? procId.slice(WATCHED_PROC_PREFIX.length) || null
    : null;
}

/** Which aura an ability parks on its caster: the pair the overlay matches on
 *  (auraOverlayProcAura compares kind, then id). */
export interface AuraWatchSignature {
  auraKind: string;
  auraId: string;
}

/** The ability fields this core reads. A structural subset of AbilityDef. */
export type WatchableAbilityDef = Pick<AbilityDef, 'id' | 'effects'>;

/**
 * The aura an ability applies to the player, or null when it applies none.
 *
 * The id/kind rules MIRROR the sim's own apply sites in
 * `src/sim/combat/effect_dispatch.ts` (that is the contract this core has to
 * hold, or the overlay would watch an aura the sim never creates):
 * - `selfBuff`: the PRIMARY self-buff (the first `selfBuff` on the def) keeps the
 *   bare ability id; an explicit `auraId` on the effect always wins.
 * - `absorb`: the shield rides the ability id, unless the ability ALSO carries a
 *   `stasis` self-buff (Ice Block), where the shield is suffixed `_absorb`.
 * - `imbue`: the weapon imbue rides the ability id.
 *
 * Only the first matching family is reported: an ability that both buffs and
 * shields is watched through its primary self-buff, which is the aura the player
 * reads as "it procced".
 *
 * A TOGGLE aura (a stance, a form, stealth, Ghost Wolf) reports nothing. It is not
 * a proc in the first place, and the overlay prints a countdown from the aura's
 * remaining time, which for a toggle is 3600s of scaffolding the buff bar
 * deliberately never shows: watching one put a ticking "3,599" on screen.
 *
 * The families below the first three were added after an audit found real procs
 * the picker was silently omitting: Slice and Dice (finisherHaste) is a rogue
 * staple, and Greater Invisibility never appeared at all because its aura comes
 * from its own effect type rather than a selfBuff. The rule the audit settled on
 * is the one this function now implements: EVERY effect family that parks an aura
 * on the caster is derivable, and the only omissions are deliberate (toggles).
 */
export function abilitySelfAuraSignature(def: WatchableAbilityDef): AuraWatchSignature | null {
  for (const effect of def.effects) {
    if (effect.type === 'selfBuff') {
      const auraId = effect.auraId ?? def.id;
      return isToggleAura(effect.kind, auraId) ? null : { auraKind: effect.kind, auraId };
    }
    if (effect.type === 'absorb') {
      const stasis = def.effects.some((e) => e.type === 'selfBuff' && e.kind === 'stasis');
      return { auraKind: 'absorb', auraId: stasis ? `${def.id}_absorb` : def.id };
    }
    if (effect.type === 'imbue') {
      return { auraKind: 'imbue', auraId: def.id };
    }
    // Slice and Dice: a self haste buff riding the ability id.
    if (effect.type === 'finisherHaste') {
      return { auraKind: 'buff_haste', auraId: def.id };
    }
    // Iron Resolve: the spend-all shield, a second absorb path.
    if (effect.type === 'absorbSpentResource') {
      return { auraKind: 'absorb', auraId: def.id };
    }
    // Greater Invisibility: rides the stealth KIND but is a fixed timed buff, and
    // has its own effect type rather than a selfBuff, so it reached neither arm
    // above. isToggleAura's timed-id override is what keeps it watchable.
    if (effect.type === 'greaterInvisibility') {
      return isToggleAura('stealth', def.id) ? null : { auraKind: 'stealth', auraId: def.id };
    }
    // Sanguine Aura: a party melee buff the caster also carries.
    if (effect.type === 'partyMeleeBuff') {
      return { auraKind: 'sanguine', auraId: def.id };
    }
    // Bloodthirst / Red Harvest: the enrage PROC, on its own fixed aura id rather
    // than the ability's. Warrior already authors an id-less `enrage` def, which
    // swallows this by kind, so today it is filtered as covered rather than
    // offered twice; deriving it keeps the rule complete for any future class.
    if (effect.type === 'enrageChance') {
      return { auraKind: 'enrage', auraId: 'fury_enrage' };
    }
  }
  return null;
}

/** One row of the settings picker: a known spell the player may put vision on. */
export interface AuraWatchOption extends AuraWatchSignature {
  procId: AuraOverlayProcId;
  abilityId: string;
  watched: boolean;
}

interface KnownAbilityLike {
  def: WatchableAbilityDef;
}

/**
 * Whether a curated def already lights up on this signature. `auraId: undefined`
 * on a curated def means "any aura of that kind", which is exactly how
 * auraOverlayProcAura matches, so it swallows every watchable of that kind.
 */
function coveredByAuthored(
  signature: AuraWatchSignature,
  authored: readonly Pick<AuraOverlayProcDef, 'auraKind' | 'auraId'>[],
): boolean {
  return authored.some(
    (def) =>
      def.auraKind === signature.auraKind &&
      (def.auraId === undefined || def.auraId === signature.auraId),
  );
}

/**
 * The picker rows for this loadout: every known ability that parks an aura on the
 * player and is not already covered by an authored proc def, in the order the
 * known list supplies (learn order), deduped by ability id.
 *
 * `watchedIds` only decides the `watched` flag; a stored id whose ability is not
 * currently known simply produces no row, and is NOT dropped from storage, so a
 * respec or an unlearn never silently forgets a player's choice.
 */
export function auraWatchOptions(
  known: readonly KnownAbilityLike[],
  authored: readonly Pick<AuraOverlayProcDef, 'auraKind' | 'auraId'>[],
  watchedIds: readonly string[],
): AuraWatchOption[] {
  const watched = new Set(watchedIds);
  const seen = new Set<string>();
  const out: AuraWatchOption[] = [];
  for (const ability of known) {
    const { id } = ability.def;
    if (seen.has(id)) continue;
    seen.add(id);
    const signature = abilitySelfAuraSignature(ability.def);
    if (!signature || coveredByAuthored(signature, authored)) continue;
    const procId = watchedProcId(id);
    out.push({
      procId,
      abilityId: id,
      auraKind: signature.auraKind,
      auraId: signature.auraId,
      watched: watched.has(procId),
    });
  }
  return out;
}

/** The overlay defs for the picked rows. Themed on the player's class, so a
 *  watched spell inherits its class palette instead of a curated proc theme. */
export function watchedAuraProcDefs(
  playerClass: PlayerClass,
  options: readonly AuraWatchOption[],
): AuraOverlayProcDef[] {
  const out: AuraOverlayProcDef[] = [];
  for (const option of options) {
    if (!option.watched) continue;
    out.push({
      id: option.procId,
      auraKind: option.auraKind,
      auraId: option.auraId,
      iconAbilityId: option.abilityId,
      theme: playerClass,
      labelKey: null,
    });
  }
  return out;
}

/** Read a persisted watchlist back: strings only, watched-prefixed only, deduped,
 *  order preserved. Anything else in storage degrades to an empty list rather
 *  than throwing at boot. */
export function sanitizeWatchedIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    if (watchedProcAbilityId(value) === null) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Add or remove one id, returning a NEW list (or the same reference when the
 *  call is a no-op, so a caller can skip a redundant write). */
export function toggleWatchedId(
  ids: readonly string[],
  procId: AuraOverlayProcId,
  on: boolean,
): readonly string[] {
  const present = ids.includes(procId);
  if (present === on) return ids;
  return on ? [...ids, procId] : ids.filter((id) => id !== procId);
}
