// Pure identity resolver for aura-strip artwork. Simulation effects can derive
// runtime aura IDs from an ability (`<ability>_ap`, `<ability>_buff_ap`, and so
// on), while the painted artwork remains keyed by the source ability ID.

export interface AuraIconIdentity {
  id: string;
  kind: string;
}

export type AuraIdentityProbe = (id: string) => boolean;

// Only suffixes the simulation actually derives from a source ability belong
// here. Arbitrary underscore-prefix walking can misattribute mob-authored IDs
// such as `blind_<template>` to the Rogue ability.
const GENERATED_AURA_SUFFIXES = [
  'buff_spellhaste',
  'buff_spellpower',
  'buff_spelldmg',
  'pet_spellhaste',
  'bleed_vuln',
  'cast_shield',
  'lockout',
  'silence',
  'instant',
  'absorb',
  'freeze',
  'incap',
  'vuln',
  'slow',
  'spell',
  'stun',
  'root',
  'crit',
  'daze',
  'buff_dr',
  'free',
  'rage',
  'cap',
  'pet',
  'dmg',
  'dr',
  'hp',
  'ap',
  'as',
] as const;

// Build these once. The resolver sits on the frame path, so a cache miss may
// scan constants but must not allocate a fresh `_${suffix}` marker per probe.
const GENERATED_AURA_SUFFIX_MARKERS = GENERATED_AURA_SUFFIXES.map((suffix) => `_${suffix}`);
const AURA_ICON_CACHE_MAX = 256;

// This shared control aura can come from player Fear, three area-fear spells,
// or a mob. The wire summary carries no source ability, so generic control art
// is more truthful than assigning every instance to the Priest spell.
const AMBIGUOUS_GENERATED_AURA_IDS: ReadonlySet<string> = new Set(['fear_incap']);

// Some simulation IDs are semantic proc/state names rather than mechanical
// `<ability>_<suffix>` derivatives. Keep this CLOSED alias inventory explicit:
// choice-row coverage derives the surviving ProcDef producers in tests and the
// class-overhaul rows below name their exact owning ability or authored talent
// icon. Prefix guessing would misattribute unrelated mob and control auras.
export const RUNTIME_AURA_ICON_SOURCE_IDS: ReadonlyMap<string, string> = new Map([
  ['aegis_first_dawn_speed', 'aegis_first_dawn'],
  ['aether_surge_free', 'arcane_surge'],
  ['bloodhook_bleed', 'bloodhook'],
  ['bloodhook_pending', 'bloodhook'],
  ['dawns_wrath', 'hammer_of_wrath'],
  ['desolation', 'conflagrate'],
  ['divine_steed_burst', 'divine_ascension'],
  ['drain_life_fate_threads', 'drain_life'],
  ['dru_gripping_ambush', 'entangling_roots'],
  ['dru_ironhide_reflex', 'bear_form'],
  ['dusk_economy', 'stealth'],
  ['duskfire_claim', 'shadowburn'],
  ['elemental_mastery_vent', 'elemental_mastery'],
  ['feral_instinct_energy', 'feral_charge'],
  ['funeral_harvest_mark', 'funeral_harvest'],
  ['fury_enrage', 'enrage_passive'],
  ['gloam', 'veilstrike'],
  ['howling_rage_empower', 'bestial_wrath'],
  ['hunter_apex_instinct', 'bestial_wrath'],
  ['hunter_chain_reaction_uses', 'frostjaw_trap'],
  ['hunter_efficient_rhythm_progress', 'measured_shot'],
  ['hunter_efficient_rhythm_ready', 'measured_shot'],
  ['hunter_enduring_courser_burst', 'aspect_of_the_cheetah'],
  ['hunter_enduring_courser_icd', 'aspect_of_the_cheetah'],
  ['hunter_fang_chorus_counter', 'tame_beast'],
  ['hunter_guise_courser', 'aspect_of_the_cheetah'],
  ['hunter_guise_harrier', 'aspect_of_the_hawk'],
  ['hunter_guise_marten', 'aspect_of_the_monkey'],
  ['hunter_guise_mastery_icd', 'aspect_of_the_hawk'],
  ['hunter_overdraw_counter', 'arcane_shot'],
  ['hunter_pack_rally_haste', 'pack_rally'],
  ['hunter_pack_rally_speed', 'pack_rally'],
  ['hunter_pack_rally_spellhaste', 'pack_rally'],
  ['hunter_predators_pace', 'measured_shot'],
  ['hunter_predators_pace_icd', 'measured_shot'],
  ['ignite', 'ignition'],
  ['lich_form_army', 'metamorphosis'],
  ['lich_form_army_haste', 'metamorphosis'],
  ['loping_stride', 'cat_form'],
  ['marrowbreak_guard', 'marrowbreak'],
  ['natures_fury', 'hurricane'],
  ['oath_chain_pull', 'oath_chain'],
  ['pack_ferocity', 'pack_command'],
  ['perpetual_sun_generation', 'divine_ascension'],
  ['possess_evil_eye_sentence_echo', 'possess_evil_eye'],
  ['pri_inner_fire', 'martyrs_aegis'],
  ['pri_measured_faith', 'lesser_heal'],
  ['priest_doctrine', 'power_word_shield'],
  ['priest_effigy', 'mind_blast'],
  ['priest_gloomtithe', 'summon_tithefiend'],
  ['priest_lingering_dread', 'psychic_scream'],
  ['priest_living_covenant', 'power_word_shield'],
  ['priest_processional_grace', 'choir_of_deliverance'],
  ['priest_sheltering_step', 'power_word_shield'],
  ['priest_veil_unbound', 'veilstep'],
  ['pyre_guardian', 'summon_infernal'],
  ['radiant_resonance', 'radiant_chorus'],
  ['radiant_stride_speed', 'hammer_of_grace'],
  ['reaping_command_bone_mage', 'reaping_command'],
  ['reaping_command_graveguard', 'reaping_command'],
  ['reaping_command_gravewing', 'reaping_command'],
  ['reaping_command_warrior', 'reaping_command'],
  ['recurring_grace_absorb', 'hammer_of_grace'],
  ['redline', 'eviscerate'],
  ['rog_improved_evasion', 'evasion'],
  ['rog_slipstream', 'sinister_strike'],
  ['shaman_ancestral_bulwark', 'lightning_shield'],
  ['shaman_ancestral_bulwark_icd', 'lightning_shield'],
  ['shaman_echoing_elements_damage', 'chain_lightning'],
  ['shaman_echoing_elements_heal', 'chain_lightning'],
  ['shaman_echoing_elements_stormcast', 'chain_lightning'],
  ['shaman_flow_state_progress', 'healing_wave'],
  ['shaman_flow_state_ready', 'healing_wave'],
  ['shaman_flowing_elements', 'lightning_bolt'],
  ['shaman_galeheart_unleash_haste', 'unleash_weapon'],
  ['shaman_gathering_winds', 'galeheart_weapon'],
  ['shaman_gathering_winds_icd', 'galeheart_weapon'],
  ['shaman_living_weapon_absorb', 'rockbiter_weapon'],
  ['shaman_living_weapon_bolt', 'rockbiter_weapon'],
  ['shaman_primal_exaltation', 'elemental_mastery'],
  ['shaman_pyrebrand_mastery', 'rockbiter_weapon'],
  ['shaman_stonebound_armor', 'rockbiter_weapon'],
  ['shaman_stonebound_dr', 'rockbiter_weapon'],
  ['shaman_stonebound_unleash_guard', 'unleash_weapon'],
  ['shaman_stonebound_ward_smooth', 'lightning_shield'],
  ['shaman_stoneward', 'stoneward'],
  ['shaman_stormsurge_ready', 'stormstrike'],
  ['shaman_ward_cycle_icd', 'lightning_shield'],
  ['shaman_warded_elements', 'lightning_shield'],
  ['shaman_wayfarer_grace', 'ghost_wolf'],
  ['shaman_wayfarer_grace_icd', 'ghost_wolf'],
  ['shrapnel_wound', 'shrapnel_charge'],
  ['solar_reprisal', 'vowkeeper_strike'],
  ['solar_step_slow_immunity', 'solar_step'],
  ['stampede_ready', 'stampede'],
  ['steady_hands_hot', 'lay_on_hands'],
  ['unholy_command_haste', 'unholy_command'],
  ['valkyrs_calling_flight', 'valkyrs_calling'],
  ['veiled_edge', 'veilstrike'],
  ['veilbound_mark', 'veilbound_march'],
  ['veilbound_march_armor', 'veilbound_march'],
  ['venom_ritual', 'venomrend'],
  ['wlk_blacktide_speed', 'wlk_r5_improved_corruption'],
  ['wlk_curse_mastery', 'wlk_r17_demonic_resilience'],
  ['wlk_forbidden_reflection', 'wlk_r20_grimoire_of_haste'],
  ['wlk_forbidden_reflection_lock', 'wlk_r20_grimoire_of_haste'],
  ['wlk_leaden_hex_root', 'wlk_r8_curse_of_exhaustion'],
  ['wlk_leaden_hex_root_lock', 'wlk_r8_curse_of_exhaustion'],
  ['wlk_leaden_hex_slow', 'wlk_r8_curse_of_exhaustion'],
  ['wlk_shadow_credit', 'wlk_r14_shadow_mastery'],
]);

// `pack_frenzy` is also a mob-authored haste buff. Wire id alone cannot assign
// Hunter art truthfully, so the player-only kind is the whole alias key.
const RUNTIME_AURA_ICON_SOURCE_IDS_BY_KIND: ReadonlyMap<
  string,
  ReadonlyMap<string, string>
> = new Map([['pack_frenzy', new Map([['hunter_frenzy', 'unleash_beast']])]]);

interface DecimalAuraSourceFamily {
  prefix: string;
  segments: number;
  source: string;
}

// Each dynamic producer owns a closed numeric grammar. Validating the complete
// suffix avoids the old blind-prefix failure mode (`blind_<mob>`, arbitrary
// server labels) while keeping cache misses allocation-free.
const DECIMAL_RUNTIME_AURA_SOURCE_FAMILIES: readonly DecimalAuraSourceFamily[] = [
  { prefix: 'aegis_first_dawn_dr:', segments: 1, source: 'aegis_first_dawn' },
  { prefix: 'binding_psalm_', segments: 1, source: 'power_word_shield' },
  { prefix: 'hunter_chain_mark_', segments: 1, source: 'frostjaw_trap' },
  { prefix: 'hunter_crippling_pursuit_', segments: 1, source: 'concussive_shot' },
  { prefix: 'hunter_crippling_root_', segments: 1, source: 'concussive_shot' },
  { prefix: 'hunter_shared_recovery_', segments: 1, source: 'wildheart' },
  { prefix: 'priest_second_verse_effigy_', segments: 2, source: 'smite' },
  { prefix: 'priest_second_verse_holy_nova_', segments: 1, source: 'smite' },
  { prefix: 'priest_second_verse_prayer_of_healing_', segments: 1, source: 'smite' },
  { prefix: 'priest_second_verse_scouring_mercy_', segments: 1, source: 'smite' },
];

const NECROMANCY_DEATH_ECHO_PREFIX = 'necromancy_death_echo_';
const NECROMANCY_DEATH_ECHO_LAST_SLOT = 2;

function isCanonicalUnsignedDecimal(id: string, start: number, end: number): boolean {
  if (start >= end) return false;
  const first = id.charCodeAt(start);
  if (first === 48) return end === start + 1;
  if (first < 49 || first > 57) return false;
  for (let index = start + 1; index < end; index++) {
    const code = id.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function matchesDecimalFamily(id: string, family: DecimalAuraSourceFamily): boolean {
  if (!id.startsWith(family.prefix)) return false;
  let start = family.prefix.length;
  for (let segment = 0; segment < family.segments; segment++) {
    const finalSegment = segment === family.segments - 1;
    const end = finalSegment ? id.length : id.indexOf('_', start);
    if (end < 0 || !isCanonicalUnsignedDecimal(id, start, end)) return false;
    start = end + 1;
  }
  return true;
}

function runtimeAuraFamilySource(id: string): string | null {
  if (
    id.startsWith(NECROMANCY_DEATH_ECHO_PREFIX) &&
    id.length === NECROMANCY_DEATH_ECHO_PREFIX.length + 1
  ) {
    const slot = id.charCodeAt(NECROMANCY_DEATH_ECHO_PREFIX.length) - 48;
    if (slot >= 0 && slot <= NECROMANCY_DEATH_ECHO_LAST_SLOT) return 'ossuary_mark';
  }
  for (const family of DECIMAL_RUNTIME_AURA_SOURCE_FAMILIES) {
    if (matchesDecimalFamily(id, family)) return family.source;
  }
  return null;
}

function stripGeneratedSuffix(id: string): string | null {
  for (const marker of GENERATED_AURA_SUFFIX_MARKERS) {
    if (id.endsWith(marker)) return id.slice(0, -marker.length);
  }
  return null;
}

/**
 * Choose the stable icon identity for a runtime aura.
 *
 * Exact abilities and dedicated aura recipes keep their own identity. For a
 * generated ID, peel only simulation-authored suffix shapes so the closest
 * known source identity supplies its painted art. Unknown or ambiguous auras
 * retain the established generic `aura_<kind>` fallback.
 */
export function resolveAuraIconId(
  aura: AuraIconIdentity,
  hasAbilityIconIdentity: AuraIdentityProbe,
  hasAuraRecipe: AuraIdentityProbe,
): string {
  const kindSources = RUNTIME_AURA_ICON_SOURCE_IDS_BY_KIND.get(aura.id);
  if (kindSources) {
    const source = kindSources.get(aura.kind);
    return source && hasAbilityIconIdentity(source) ? source : `aura_${aura.kind}`;
  }

  if (hasAbilityIconIdentity(aura.id) || hasAuraRecipe(aura.id)) return aura.id;

  const semanticSource = RUNTIME_AURA_ICON_SOURCE_IDS.get(aura.id);
  if (semanticSource && hasAbilityIconIdentity(semanticSource)) return semanticSource;

  const familySource = runtimeAuraFamilySource(aura.id);
  if (familySource && hasAbilityIconIdentity(familySource)) return familySource;

  if (AMBIGUOUS_GENERATED_AURA_IDS.has(aura.id)) return `aura_${aura.kind}`;

  let candidate = aura.id;
  for (;;) {
    const stripped = stripGeneratedSuffix(candidate);
    if (!stripped) break;
    candidate = stripped;
    if (hasAbilityIconIdentity(candidate)) return candidate;
  }

  return `aura_${aura.kind}`;
}

/**
 * Build the frame-path resolver used by the HUD. Aura identities are stable for
 * the life of an aura, so cache the result by the wire id and kind. The capped
 * FIFO keeps hostile or future server-authored identities from growing the HUD
 * forever while steady-state frames do no suffix scanning or string creation.
 */
export function createAuraIconResolver(
  hasAbilityIconIdentity: AuraIdentityProbe,
  hasAuraRecipe: AuraIdentityProbe,
): (aura: AuraIconIdentity) => string {
  const cache = new Map<string, { kind: string; iconId: string }>();
  return (aura) => {
    const cached = cache.get(aura.id);
    if (cached?.kind === aura.kind) return cached.iconId;

    const iconId = resolveAuraIconId(aura, hasAbilityIconIdentity, hasAuraRecipe);
    if (!cached && cache.size >= AURA_ICON_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(aura.id, { kind: aura.kind, iconId });
    return iconId;
  };
}

/**
 * CSS layers paint an already-warmed procedural icon underneath a static WebP.
 * A painted identity must never synchronously encode its fallback on the aura
 * frame path: cold caches use a precommitted painted safety layer, while
 * worker-warmed identity fallbacks replace it when available. Procedural-only
 * identities still compose on demand because they have no static source to
 * display.
 */
export function auraIconCssBackground(
  iconId: string,
  staticImageUrl: (id: string) => string | null,
  cachedProceduralDataUrl: (id: string) => string | null,
  staticFallbackUrl: string,
  demandProceduralDataUrl: (id: string) => string,
): string {
  const image = staticImageUrl(iconId);
  const cachedFallback = cachedProceduralDataUrl(iconId);
  if (image) {
    return `url(${image}), url(${cachedFallback ?? staticFallbackUrl})`;
  }
  return `url(${cachedFallback ?? demandProceduralDataUrl(iconId)})`;
}
