// The Smith's Heart's painted aura art. Every debuff the raid puts on players and
// every aura its bosses and adds wear shows a painting from public/ui/auras/<id>.webp
// (provenance: public/ui/auras/mapping.json and the accepted manifest under
// docs/achievements/smith-heart-aura-art-2026-11-19/). Auras that show the same
// thing share one painting: each alias below wears its source's art through the
// semantic map in aura_icon_view.ts (RUNTIME_AURA_ICON_SOURCE_IDS), and icons.ts
// folds the painted ids into its exact aura art registry, so the buff bar, target
// frame, party strips and nameplates all paint the same icon. Pure data, no DOM.
// Pinned by tests/smith_heart_aura_art.test.ts.

/** Raid aura ids with a painting of their own (public/ui/auras/<id>.webp). */
export const SMITH_HEART_AURA_IMAGE_IDS: readonly string[] = [
  'heart_bond_of_the_stone',
  'heart_breath_anchor',
  'heart_breath_blow_mark',
  'heart_breath_calm_spent',
  'heart_breath_cradled',
  'heart_breath_drawn_lightning',
  'heart_breath_laden',
  'heart_breath_pinned',
  'heart_breath_portal_a',
  'heart_breath_riding_gale',
  'heart_breath_roar_thrown',
  'heart_breath_sky_mark',
  'heart_breath_storm_unbound',
  'heart_breath_swelling_storm',
  'heart_breath_thunder_laden',
  'heart_breath_wind_battered',
  'heart_council_enraged',
  'heart_council_intro',
  'heart_falling_rock_mark',
  'heart_final_coal',
  'heart_final_crushed',
  'heart_final_ember_mark',
  'heart_final_fury',
  'heart_final_hidden',
  'heart_final_numbing',
  'heart_final_overload_breath',
  'heart_final_overload_hammer',
  'heart_final_overload_heat',
  'heart_final_overload_quench',
  'heart_final_plunge',
  'heart_final_poured_breath',
  'heart_final_poured_hammer',
  'heart_final_poured_heat',
  'heart_final_poured_quench',
  'heart_final_ring_chill',
  'heart_final_shaken',
  'heart_final_shell',
  'heart_final_shield',
  'heart_final_state',
  'heart_final_tethered',
  'heart_final_unbound',
  'heart_hammers_weight',
  'heart_heat_crust',
  'heart_heat_hunted',
  'heart_heat_kindling',
  'heart_heat_scorched',
  'heart_heat_state',
  'heart_heat_trailing',
  'heart_memory_of_stone',
  'heart_mountains_rush_mark',
  'heart_narrow_shelter',
  'heart_quarry_collapse',
  'heart_quench_blades_awake',
  'heart_quench_brittle',
  'heart_quench_cold',
  'heart_quench_deepening',
  'heart_quench_frozen',
  'heart_quench_rime',
  'heart_quench_slash_mark',
  'heart_quench_splashed',
  'heart_quench_tempered',
  'heart_quench_trapped',
  'heart_quench_warmth',
  'heart_resonance',
  'heart_rush_shattered',
  'heart_wake_mark',
  'wind_blast',
  'wind_draw',
  'wind_drift',
];

/**
 * Raid aura ids that wear another raid aura's painting: [alias, painted source].
 * The four gale portals are one portal; every wind throw is one throw; the final
 * fight's ice and lightning repeat the Quench's and the Breath's, and its three
 * marks wear the paintings they echo (Sky Strike the Breath's, Crossing Blade the
 * Quench's, Weight of the Anvil the Crushed anvil overhead); the
 * guardians' slumbers are one Dormant, and that includes `mob_dormant`, the
 * dormant ward that only the raid's Hammer Vein Warders wear. The Breath's isle
 * phase reuses its fight's art: the Gale Cocoon (and its root) is the storm
 * gathering for Skyrend Nova, the Shieldbearer's Squall Ward is the shield in
 * the wind, and a Stillstone's shared charge is Thessaly's calm stilling it.
 */
export const SMITH_HEART_AURA_ICON_SOURCES: readonly (readonly [string, string])[] = [
  ['heart_breath_blow_thrown', 'heart_breath_roar_thrown'],
  ['heart_breath_cocoon_hold', 'heart_breath_swelling_storm'],
  ['heart_breath_gale_cocoon', 'heart_breath_swelling_storm'],
  ['heart_breath_gale_tossed', 'heart_breath_roar_thrown'],
  ['heart_breath_intro', 'heart_council_intro'],
  ['heart_breath_portal_b', 'heart_breath_portal_a'],
  ['heart_breath_portal_c', 'heart_breath_portal_a'],
  ['heart_breath_portal_d', 'heart_breath_portal_a'],
  ['heart_breath_squall_ward', 'heart_breath_wind_battered'],
  ['heart_breath_stone_charge', 'heart_breath_anchor'],
  ['heart_final_anvil_mark', 'heart_final_crushed'],
  ['heart_final_blade_mark', 'heart_quench_slash_mark'],
  ['heart_final_drawn', 'heart_breath_drawn_lightning'],
  ['heart_final_phase', 'heart_final_state'],
  ['heart_final_rising', 'heart_final_shield'],
  ['heart_final_sky_mark', 'heart_breath_sky_mark'],
  ['heart_final_under_ice', 'heart_quench_trapped'],
  ['heart_heat_intro', 'heart_council_intro'],
  ['heart_quench_intro', 'heart_council_intro'],
  ['heart_quench_rime_slow', 'heart_quench_rime'],
  ['heart_rush_exposed', 'heart_rush_shattered'],
  ['mob_dormant', 'heart_council_intro'],
];
