// The Smith's Heart's painted boss ability art. Every ability the Adventure
// Journal lists for the raid's five fights wears a painting that shows what it
// does, in place of its procedural glyph: the journal's ability rows, the death
// recap's hit rows (through the journal hit index) and the boss cast bar (through
// the journal cast index) all read it through iconDataUrl('ability', iconId), whose
// static-art arm asks bossAbilityImageUrl. A journal icon id either owns a painting
// under public/ui/boss-abilities/<id>.webp (provenance:
// public/ui/boss-abilities/mapping.json and the accepted manifest under
// docs/achievements/boss-ability-art-2026-11-28/), or wears the raid aura painting
// of the very same mechanic (the mark, the debuff or the boss aura it puts out).
// Only the Smith's Heart: every other journal id keeps its procedural recipe.
// Pure data, no DOM. Pinned by tests/boss_ability_art.test.ts.

const BOSS_ABILITY_ICON_DIR = '/ui/boss-abilities';
const AURA_ICON_DIR = '/ui/auras';

/** Journal icon ids with a painting of their own (public/ui/boss-abilities/<id>.webp). */
export const BOSS_ABILITY_IMAGE_IDS: readonly string[] = [
  'dgn_heart_avalanche',
  'dgn_heart_basalt_fist',
  'dgn_heart_cinder_grip',
  'dgn_heart_closing_storm',
  'dgn_heart_cursed_pillar',
  'dgn_heart_dust_devil',
  'dgn_heart_elemental_strike',
  'dgn_heart_every_star',
  'dgn_heart_falling_cinder',
  'dgn_heart_fire_whirl',
  'dgn_heart_firestorm',
  'dgn_heart_forge_fist',
  'dgn_heart_forge_fury',
  'dgn_heart_fusion',
  'dgn_heart_grieving_fury',
  'dgn_heart_hail',
  'dgn_heart_hammerfall',
  'dgn_heart_hearthseed',
  'dgn_heart_inherit',
  'dgn_heart_isle_lightning',
  'dgn_heart_leaping_bolt',
  'dgn_heart_live_coal',
  'dgn_heart_loose_gale',
  'dgn_heart_magma',
  'dgn_heart_mending_gale',
  'dgn_heart_mounting_weight',
  'dgn_heart_opposing',
  'dgn_heart_overflow',
  'dgn_heart_overload',
  'dgn_heart_quench_cold',
  'dgn_heart_quenching_breath',
  'dgn_heart_restless_stone',
  'dgn_heart_rime_toll',
  'dgn_heart_riven_squall',
  'dgn_heart_seam_bolt',
  'dgn_heart_shearing_blow',
  'dgn_heart_shoving_gale',
  'dgn_heart_skyrend_nova',
  'dgn_heart_soft_enrage',
  'dgn_heart_soft_enrage_heat',
  'dgn_heart_song',
  'dgn_heart_spires',
  'dgn_heart_splinter_heat',
  'dgn_heart_splintered',
  'dgn_heart_squall_ward',
  'dgn_heart_steam',
  'dgn_heart_stillstone',
  'dgn_heart_stone_thrum',
  'dgn_heart_storm_breaks',
  'dgn_heart_storm_charged',
  'dgn_heart_storm_gust',
  'dgn_heart_storm_lance',
  'dgn_heart_storm_orb',
  'dgn_heart_tremor',
  'dgn_heart_wakefire',
  'dgn_heart_wellkeeper',
  'dgn_heart_wellspawn',
  'dgn_heart_wellspring_brand',
  'dgn_heart_wheel',
];

/** Journal icon id -> the raid aura painting (public/ui/auras/<file>.webp) of the
 *  same mechanic, worn as is. */
export const BOSS_ABILITY_REUSED_ART: Readonly<Record<string, string>> = {
  dgn_heart_anvil: 'heart_final_anvil_mark',
  dgn_heart_bellows_wind: 'wind_drift',
  dgn_heart_blades_wake: 'heart_quench_blades_awake',
  dgn_heart_call: 'heart_final_shield',
  dgn_heart_calm: 'heart_breath_anchor',
  dgn_heart_cradle: 'heart_breath_cradled',
  dgn_heart_crossing_blade: 'heart_quench_slash_mark',
  dgn_heart_deepening_cold: 'heart_quench_deepening',
  dgn_heart_drawn_lightning: 'heart_breath_drawn_lightning',
  dgn_heart_ember_mark: 'heart_final_ember_mark',
  dgn_heart_encased: 'heart_quench_frozen',
  dgn_heart_falling_rock: 'heart_falling_rock_mark',
  dgn_heart_gale_pounce: 'heart_final_tethered',
  dgn_heart_groaning_ice: 'heart_quench_trapped',
  dgn_heart_hammers_weight: 'heart_hammers_weight',
  dgn_heart_heart_unbound: 'heart_final_unbound',
  dgn_heart_hearth_flare: 'heart_heat_scorched',
  dgn_heart_inhale: 'wind_draw',
  dgn_heart_knotted_gale: 'heart_breath_laden',
  dgn_heart_masterless_fury: 'heart_final_fury',
  dgn_heart_quenching_ring: 'heart_final_ring_chill',
  dgn_heart_resonance: 'heart_resonance',
  dgn_heart_rolling_cinder: 'heart_heat_hunted',
  dgn_heart_rush: 'heart_mountains_rush_mark',
  dgn_heart_sky_strike: 'heart_breath_sky_mark',
  dgn_heart_stone_shell: 'heart_final_shell',
  dgn_heart_summit_roar: 'wind_blast',
  dgn_heart_swelling_storm: 'heart_breath_swelling_storm',
  dgn_heart_vein_shock: 'heart_final_shaken',
  dgn_heart_wake_stone: 'heart_wake_mark',
  dgn_heart_wrath: 'heart_narrow_shelter',
  heart_breath_blow_mark: 'heart_breath_blow_mark',
  heart_breath_thunder_laden: 'heart_breath_thunder_laden',
  heart_quench_rime: 'heart_quench_rime',
  heart_quench_tempered: 'heart_quench_tempered',
};

const PAINTED: ReadonlySet<string> = new Set(BOSS_ABILITY_IMAGE_IDS);

/** The static painting a journal icon id wears, or null when it keeps its
 *  procedural recipe. */
export function bossAbilityImageUrl(iconId: string): string | null {
  if (PAINTED.has(iconId)) return `${BOSS_ABILITY_ICON_DIR}/${iconId}.webp`;
  const reused = Object.hasOwn(BOSS_ABILITY_REUSED_ART, iconId)
    ? BOSS_ABILITY_REUSED_ART[iconId]
    : undefined;
  return reused ? `${AURA_ICON_DIR}/${reused}.webp` : null;
}
