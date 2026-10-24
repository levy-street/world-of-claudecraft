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
// A second, ACTIVE-ONLY tier rides the same row: an offensive or defensive buff
// lasting at most MAJOR_BUFF_MAX_SEC from a class ability with no tracked
// cooldown (a rotation attack's rider such as Red Harvest's Enrage, a short
// shield or dodge window). It shows while the buff is up and never as spent:
// its cooldown is a rotation timer, not a decision. majorBuffTable() holds it;
// the wire (majorCooldownGroup) never sees it.
//
// Custom effect types the kind tables cannot read are listed explicitly in
// EFFECT_TYPE_GROUP; abilities whose effects say nothing (an empty effect list
// resolved in a bespoke handler) or that read as protective but are mostly
// something else sit in ABILITY_OVERRIDES. tests/major_cooldowns.test.ts pins the
// full resulting roster, so a content change that moves an ability in or out of
// the row is a visible diff.

import { ABILITIES } from './content/classes';
import { MEDALLION_USE_COOLDOWN_KEY, trinketCooldownKey } from './content/trinkets';
import type { AbilityDef } from './types';

export type MajorCooldownGroup = 'medallion' | 'defensive' | 'offensive';

/** A base cooldown below this is a rotation button, never a tracked cooldown. */
export const MAJOR_COOLDOWN_MIN_SEC = 30;

/** The longest buff the active-only tier admits: a longer one is a maintenance
 *  buff (an aspect, a shout, a form) that would sit on every plate. */
export const MAJOR_BUFF_MAX_SEC = 30;

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
  'buff_dr_phys',
  'buff_block',
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

// Aura-leaving effect types the active-only tier reads by type: the absorbs.
// Instant heals and summons leave no buff to show.
const BUFF_EFFECT_TYPE_GROUP: Readonly<Record<string, 'defensive'>> = {
  absorb: 'defensive',
  selfAbsorbPctMax: 'defensive',
  aoeAllyAbsorb: 'defensive',
  absorbSpentResource: 'defensive',
};

// Active-only buffs with no ability of their own: the Enrage that Bloodletting,
// Red Harvest and the Bloodmarch 4pc all apply (one `fury_enrage` aura), keyed by
// the Fury passive that documents it, so it has its art and one slot.
const BUFF_EXTRA: Readonly<Record<string, 'defensive' | 'offensive'>> = {
  enrage_passive: 'offensive',
};

function buffGroupFromEffects(def: AbilityDef): 'defensive' | 'offensive' | null {
  let defensive = false;
  let offensive = false;
  for (const eff of def.effects) {
    const duration = (eff as { duration?: number }).duration ?? 0;
    if (!(duration > 0 && duration <= MAJOR_BUFF_MAX_SEC)) continue;
    const kind = (eff as { kind?: string }).kind;
    if (eff.type === 'selfBuff' || eff.type === 'buffTarget') {
      if (kind !== undefined && DEFENSIVE_KINDS.has(kind)) defensive = true;
      if (kind !== undefined && OFFENSIVE_KINDS.has(kind)) offensive = true;
    } else if (BUFF_EFFECT_TYPE_GROUP[eff.type] === 'defensive') {
      defensive = true;
    }
  }
  if (defensive) return 'defensive';
  return offensive ? 'offensive' : null;
}

function classifyBuff(def: AbilityDef): 'defensive' | 'offensive' | null {
  if (!def.class || def.passive || (def.cooldown ?? 0) >= MAJOR_COOLDOWN_MIN_SEC) return null;
  return buffGroupFromEffects(def);
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

let buffTable: ReadonlyMap<string, MajorCooldownGroup> | null = null;

/** Every active-only buff key with its group: shown while the buff is up, never
 *  as a spent cooldown. Disjoint from majorCooldownTable(). */
export function majorBuffTable(): ReadonlyMap<string, MajorCooldownGroup> {
  if (!buffTable) {
    const out = new Map<string, MajorCooldownGroup>();
    for (const def of Object.values(ABILITIES)) {
      const group = classifyBuff(def);
      if (group) out.set(def.id, group);
    }
    for (const [key, group] of Object.entries(BUFF_EXTRA)) out.set(key, group);
    buffTable = out;
  }
  return buffTable;
}

/** The group of a key an AURA resolved to (majorCooldownKeyForAura): a tracked
 *  cooldown or an active-only buff. Never use it for the cooldown map. */
export function majorAuraGroup(key: string): MajorCooldownGroup | null {
  return majorCooldownTable().get(key) ?? majorBuffTable().get(key) ?? null;
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
  fury_enrage: 'enrage_passive', // Enrage (effect_dispatch enrageChance)
};

const isAuraKey = (key: string): boolean =>
  majorCooldownTable().has(key) || majorBuffTable().has(key);

/**
 * The tracked cooldown or active-only buff key an aura belongs to, or null. Most tracked buffs carry
 * the bare ability id; the rest are a companion `<ability>_<suffix>` (Valor
 * Roar's `rallying_cry_hp`, a second selfBuff kind), a per-caster
 * `<id>:<casterId>` stamp (Aegis of the First Dawn's `aegis_first_dawn_dr:<id>`),
 * or a handler constant listed in AURA_ALIASES. Pinned against every tracked
 * buff's real aura id by tests/major_cooldowns.test.ts.
 */
export function majorCooldownKeyForAura(auraId: string): string | null {
  // Resolve against finite content keys without retaining caller-controlled ids.
  // Dynamic caster suffixes and unknown/null answers never grow a session memo.
  if (isAuraKey(auraId)) return auraId;
  if (Object.hasOwn(AURA_ALIASES, auraId)) return AURA_ALIASES[auraId];
  const colon = auraId.indexOf(':');
  let id = colon >= 0 ? auraId.slice(0, colon) : auraId;
  if (isAuraKey(id)) return id;
  // Companion: strip trailing `_<suffix>` segments until a tracked key remains.
  for (let cut = id.lastIndexOf('_'); cut > 0; cut = id.lastIndexOf('_')) {
    id = id.slice(0, cut);
    if (isAuraKey(id)) return id;
  }
  return null;
}

/** The actual successful-use cooldown, never an equip or inherited lockout.
 * The factual medallion timer shares the existing cooldown engine/save/reset
 * lifecycle; a different trinket may extend its gate without extending this fact. */
export function majorCooldownRemaining(
  key: string,
  remaining: number,
  cooldowns: ReadonlyMap<string, number>,
): number {
  return key === PVP_MEDALLION_COOLDOWN_KEY
    ? (cooldowns.get(MEDALLION_USE_COOLDOWN_KEY) ?? 0)
    : remaining;
}
