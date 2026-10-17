// Which cooldowns an enemy player's nameplate tracks, and in which group. One
// classifier both hosts share: the server uses it to choose which of a player's
// cooldowns ride the peer wire (server/major_cooldown_wire.ts), and the
// nameplate row uses it to group and order what it draws
// (src/render/nameplate_cooldowns_core.ts). Host-agnostic and DOM-free, like
// aura_classify.ts beside it.
//
// The rule, decided per ability from what it DOES rather than from a hand list:
// a class ability with a base cooldown of at least MAJOR_COOLDOWN_MIN_SEC that
// either protects the caster (damage reduction, dodge, armor, absorb, immunity,
// and the emergency self-heals: a spent one means no defensive left) or raises
// their damage (damage, attack or spell power, crit, haste, attack speed, energy
// regen rate). Group cooldowns count when the caster is one of the people
// buffed, buffs cast on an ally count (they show on that ally), and damage
// summons count as offensive. Resource grants, crowd control, mobility and
// direct damage never count. The PvP medallion is its own group.
//
// Custom effect types the kind tables cannot read are listed explicitly in
// EFFECT_TYPE_GROUP; abilities whose effects say nothing (an empty effect list
// resolved in a bespoke handler) or that read as protective but are mostly
// something else sit in ABILITY_OVERRIDES. tests/major_cooldowns.test.ts pins the
// full resulting roster, so a content change that moves an ability in or out of
// the row is a visible diff.

import { ABILITIES } from './content/classes';
import { TRINKET_SPECS, trinketCooldownKey } from './content/trinkets';
import type { AbilityDef } from './types';

export type MajorCooldownGroup = 'medallion' | 'defensive' | 'offensive';

/** A base cooldown below this is a rotation button, never a tracked cooldown. */
export const MAJOR_COOLDOWN_MIN_SEC = 30;

/** The PvP medallion's item id: tracked for every class once it has been used. */
export const PVP_MEDALLION_ITEM_ID = 'medallion_of_defiance';
export const PVP_MEDALLION_COOLDOWN_KEY = trinketCooldownKey(PVP_MEDALLION_ITEM_ID);

/** Draw order of the groups, left to right on the plate. */
export const MAJOR_COOLDOWN_GROUP_ORDER: Readonly<Record<MajorCooldownGroup, number>> = {
  medallion: 0,
  defensive: 1,
  offensive: 2,
};

// Aura kinds a selfBuff or buffTarget applies that lower the damage the holder
// takes.
const DEFENSIVE_KINDS: ReadonlySet<string> = new Set([
  'buff_armor_pct',
  'buff_dodge',
  'buff_dr',
  'shield_wall',
  'stasis',
  'die_by_sword',
  'guardian_ward',
  'paladin_debt_of_light',
]);

// Aura kinds that raise the holder's damage output, haste and attack speed
// included.
const OFFENSIVE_KINDS: ReadonlySet<string> = new Set([
  'buff_ap',
  'buff_spelldmg',
  'buff_spellpower',
  'buff_dmg_done',
  'buff_spellhaste',
  'buff_haste',
  'buff_reckless',
  'buff_avatar',
  'combustion',
  'next_attack_crit',
  'form_lich',
  'overload',
  'power_echo',
  'hunter_bloodtrail',
]);

// Effect types whose meaning is the type itself (no aura kind to read).
const EFFECT_TYPE_GROUP: Readonly<Record<string, 'defensive' | 'offensive'>> = {
  absorb: 'defensive',
  selfAbsorbPctMax: 'defensive',
  aoeAllyAbsorb: 'defensive',
  aoeAllyMaxHp: 'defensive',
  paladinAegis: 'defensive',
  // Emergency self-heals (Last Prayer, Wildheart; Sacrifice Undead's own type).
  selfHealPctMax: 'defensive',
  sacrificeUndead: 'defensive',
  aoeAllyHaste: 'offensive',
  aoeAllySureCrit: 'offensive',
  partyMeleeBuff: 'offensive',
  howlingRage: 'offensive',
  perfectMoment: 'offensive',
  commandUndead: 'offensive',
  // Cat Form: energy regeneration doubled for 10 sec.
  feralCharge: 'offensive',
  hunterStampede: 'offensive',
  armyOfDead: 'offensive',
  summonPyreColossus: 'offensive',
};

// Decisions the effect list cannot make on its own. `null` removes an ability
// the tables would otherwise admit.
const ABILITY_OVERRIDES: Readonly<Record<string, MajorCooldownGroup | null>> = {
  // Empty effect lists resolved by bespoke handlers.
  summon_tithefiend: 'offensive',
  primal_exaltation: 'offensive',
  elemental_mastery: 'offensive',
  // Emergency heals whose effect type is shared with ordinary heals: Savage
  // Mending (a self heal-over-time) and Last Rite (a full-health heal).
  frenzied_regeneration: 'defensive',
  lay_on_hands: 'defensive',
  // An 18-point shield riding a gap closer: mobility, not a defensive.
  intervene: null,
};

function groupFromEffects(def: AbilityDef): 'defensive' | 'offensive' | null {
  let defensive = false;
  let offensive = false;
  for (const eff of def.effects) {
    const kind = (eff as { kind?: string }).kind;
    if (eff.type === 'selfBuff' || eff.type === 'buffTarget') {
      if (kind !== undefined && DEFENSIVE_KINDS.has(kind)) defensive = true;
      if (kind !== undefined && OFFENSIVE_KINDS.has(kind)) offensive = true;
      continue;
    }
    const byType = EFFECT_TYPE_GROUP[eff.type];
    if (byType === 'defensive') defensive = true;
    if (byType === 'offensive') offensive = true;
  }
  // An ability that does both (none ship today) reads as defensive: it is the
  // one a player must not burst into.
  if (defensive) return 'defensive';
  return offensive ? 'offensive' : null;
}

function classifyAbility(def: AbilityDef): MajorCooldownGroup | null {
  if (!def.class || (def.cooldown ?? 0) < MAJOR_COOLDOWN_MIN_SEC) return null;
  if (Object.hasOwn(ABILITY_OVERRIDES, def.id)) return ABILITY_OVERRIDES[def.id];
  return groupFromEffects(def);
}

let table: ReadonlyMap<string, MajorCooldownGroup> | null = null;

function buildTable(): ReadonlyMap<string, MajorCooldownGroup> {
  const out = new Map<string, MajorCooldownGroup>();
  for (const def of Object.values(ABILITIES)) {
    const group = classifyAbility(def);
    if (group) out.set(def.id, group);
  }
  out.set(PVP_MEDALLION_COOLDOWN_KEY, 'medallion');
  return out;
}

/** Every tracked cooldown key with its group. Built once, on first use. */
export function majorCooldownTable(): ReadonlyMap<string, MajorCooldownGroup> {
  if (!table) table = buildTable();
  return table;
}

/** The group of a cooldown key (an ability id, or the medallion's trinket key),
 *  or null when the key is not tracked. Also answers for an aura id: a selfBuff
 *  or buffTarget aura carries the bare ability id that applied it. */
export function majorCooldownGroup(key: string): MajorCooldownGroup | null {
  return majorCooldownTable().get(key) ?? null;
}

// Handler-specific aura ids that name neither the ability nor an `<id>_<suffix>`
// companion of it: each is written by the ability's own effect handler.
const AURA_ALIASES: Readonly<Record<string, string>> = {
  feral_instinct_energy: 'feral_charge', // Primal Surge, Cat Form energy regen
  howling_rage_empower: 'bestial_wrath', // Howling Rage (hunter_packlord.ts)
  shaman_primal_exaltation: 'primal_exaltation', // PRIMAL_EXALTATION_ID
};

/**
 * The tracked cooldown key an aura belongs to, or null. Most tracked buffs carry
 * the bare ability id; the rest are a companion `<ability>_<suffix>` (Valor
 * Roar's `rallying_cry_hp`, a second selfBuff kind), a per-caster
 * `<id>:<casterId>` stamp (Aegis of the First Dawn's `aegis_first_dawn_dr:<id>`),
 * or a handler constant listed in AURA_ALIASES. Pinned against every tracked
 * buff's real aura id by tests/major_cooldowns.test.ts.
 */
export function majorCooldownKeyForAura(auraId: string): string | null {
  // Memoized: the row asks per aura per frame, and the id space is content-bounded.
  const memo = auraKeyMemo.get(auraId);
  if (memo !== undefined) return memo;
  const key = resolveAuraKey(auraId);
  auraKeyMemo.set(auraId, key);
  return key;
}

const auraKeyMemo = new Map<string, string | null>();

function resolveAuraKey(auraId: string): string | null {
  const table = majorCooldownTable();
  if (table.has(auraId)) return auraId;
  const alias = AURA_ALIASES[auraId];
  if (alias !== undefined) return alias;
  const colon = auraId.indexOf(':');
  let id = colon >= 0 ? auraId.slice(0, colon) : auraId;
  if (table.has(id)) return id;
  // Companion: strip trailing `_<suffix>` segments until a tracked key remains.
  for (let cut = id.lastIndexOf('_'); cut > 0; cut = id.lastIndexOf('_')) {
    id = id.slice(0, cut);
    if (table.has(id)) return id;
  }
  return null;
}

/** The full base cooldown of a tracked key in seconds, for the swipe fraction.
 *  Talent reductions are not visible to other players, so a talented cooldown
 *  simply starts its swipe part-way; the countdown itself is always exact. */
export function majorCooldownBaseSec(key: string): number {
  if (key === PVP_MEDALLION_COOLDOWN_KEY)
    return TRINKET_SPECS[PVP_MEDALLION_ITEM_ID]?.cooldown ?? 0;
  return ABILITIES[key]?.cooldown ?? 0;
}
