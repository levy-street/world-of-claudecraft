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

// Some simulation IDs are semantic proc names rather than mechanical
// `<ability>_<suffix>` derivatives. Keep this CLOSED alias inventory explicit:
// choice-row coverage derives it from the live ProcDef producers in tests, while
// the remaining entries are direct non-choice producer seams. Prefix guessing
// would misattribute unrelated mob and control auras.
export const RUNTIME_AURA_ICON_SOURCE_IDS: ReadonlyMap<string, string> = new Map([
  ['aether_surge_free', 'arcane_surge'],
  ['dru_briar_ambush', 'entangling_roots'],
  ['dru_empowered_touch', 'healing_touch'],
  ['dru_grove_covenant', 'mark_of_the_wild'],
  ['dru_improved_barkskin', 'barkskin'],
  ['dru_improved_wildbolt', 'wrath'],
  ['dru_moonspite', 'moonfire'],
  ['dru_natures_bounty', 'rejuvenation'],
  ['dru_redmaw', 'claw'],
  ['dru_savage_fury', 'ferocious_bite'],
  ['dru_survival_of_the_fittest', 'bear_form'],
  ['dru_wildsurge', 'bear_form'],
  ['feral_instinct_energy', 'feral_charge'],
  ['fury_enrage', 'enrage_passive'],
  ['hun_deathless_will', 'aspect_of_the_monkey'],
  ['ignite', 'ignition'],
  ['natures_fury', 'hurricane'],
  ['pal_divine_wisdom', 'flash_of_light'],
  ['pal_greater_blessing', 'blessing_of_might'],
  ['pri_blessed_recovery', 'flash_heal'],
  ['pri_heal_echo', 'heal'],
  ['pri_inner_fire', 'power_word_shield'],
  ['pri_lingering_ward', 'lesser_heal'],
  ['pri_nocturns', 'lesser_heal'],
  ['pri_searing_light', 'smite'],
  ['rog_blindside_opening', 'gouge'],
  ['rog_final_notice', 'eviscerate'],
  ['rog_improved_backstab', 'backstab'],
  ['rog_improved_cutthroat_tempo', 'slice_and_dice'],
  ['rog_improved_evasion', 'evasion'],
  ['rog_master_assassin', 'ambush'],
  ['sha_elemental_attunement', 'lightning_bolt'],
  ['sha_fault_line', 'lightning_bolt'],
  ['sha_guiding_spirits', 'healing_wave'],
  ['sha_storm_recall', 'lightning_bolt'],
  ['sha_undertow_promise', 'healing_wave'],
  ['sha_ward_surge', 'lightning_shield'],
  ['wlk_curse_mastery', 'curse_of_agony'],
  ['wlk_demon_armor', 'demon_skin'],
  ['wlk_grave_rhythm', 'shadow_bolt'],
  ['wlk_grimoire_of_carnage', 'summon_felhunter'],
  ['wlk_umbral_mastery', 'shadow_bolt'],
]);

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
  if (hasAbilityIconIdentity(aura.id) || hasAuraRecipe(aura.id)) return aura.id;

  const semanticSource = RUNTIME_AURA_ICON_SOURCE_IDS.get(aura.id);
  if (semanticSource && hasAbilityIconIdentity(semanticSource)) return semanticSource;

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
