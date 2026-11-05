// THE single list of borrowed placeholder bodies for the Smith's Heart raid
// (docs/design/raid/smith_heart.md, phase 1 blockout). Every creature of the
// raid wears an EXISTING visual from manifest.ts VISUALS here, chosen for its
// silhouette and element and re-coloured by its template's entity colour, so
// the blockout is playable and readable from day one. Phase 2 replaces each
// row with the raid's own original model (a new VISUALS key); nothing else
// in the renderer names these borrowings, so swapping a body is one row.
// No Ignivar key is borrowed, and no lava-cracked or volcanic body either
// (the Heat is white-gold smith fire, never the volcanic raid's look).
//
// manifest.ts spreads this into MOB_KEYS; tests/smith_heart_render_core.test.ts
// pins one row per SMITH_HEART_MOBS template, each naming a real VISUALS key.

export const SMITH_HEART_PLACEHOLDER_LOOKS: Record<string, string> = {
  // ---- trash ---------------------------------------------------------------
  // Final: a squat stone warder with an ochre vein-glow in its cracks.
  heart_hammer_warder: 'mob_elemental',
  // Final: a bronze-and-granite forge construct, the Ring's sentinel.
  heart_ring_warder: 'skel_golem',
  // Final: a wind-scoured stone warder trailing storm-blue gusts.
  heart_breath_warder: 'mob_elemental',
  // Final: a hovering storm caller of slate and lightning. (The hooded stone
  // cantor, tinted storm-blue: the Buried Hoard's storm caller is a Rift-lane
  // body, and borrowing it pulled it into the iOS entry stream.)
  heart_breath_caller: 'mob_reedbound_acolyte',
  // The Islands of the Wind's adds (encounters/smith_heart/breath_isles.ts).
  // Final: a storm-blue stone warden of a floating isle.
  heart_gale_sentinel: 'mob_elemental',
  // Final: a hovering wind caller who mends the guardian's shield.
  heart_gale_mender: 'mob_reedbound_acolyte',
  // Final: a rime-crusted warder of blue ice and frost-cracked stone. (The
  // stone goleling tinted ice-blue, like the other veins' warders; never a
  // Rift-lane hoard body, see the Breath caller.)
  heart_quench_warder: 'mob_elemental',
  // Final: a meltwater caller, ice-pale water held in a stone frame.
  heart_quench_caller: 'mob_water_elemental',
  // Final: a smith-fire warder of dark iron with a white-gold core. (The
  // stone goleling, tinted gold by its entity colour: the lava-cracked
  // brute read volcanic, which the Heat must never do.)
  heart_heat_warder: 'mob_elemental',
  // Final: a small white-gold ember spirit thrown off the Smith's forge. (A
  // drifting pale light; the fel-green emberkin read wrong.)
  heart_heat_caller: 'mob_glimmerwisp',
  // ---- the four guardians -----------------------------------------------------
  // Final: a stone titan half-fused with the Pit's floor, a great hammer arm.
  heart_hammer_guardian: 'skel_golem',
  // The Hammer Council's other member: a bodyless target; its provisional
  // body of the Heart kit's rock and crystal is drawn by
  // smith_heart_fx/council_bodies.ts (the Masterless Strength's pattern).
  // Final: its own model (the official pipeline), the same joints.
  heart_seam_singer: 'smith_heart_seam_singer',
  // The Guardian of the Breath: a bodyless target; its provisional body (a
  // living bellows of storm granite, crystal and lightning, its phase-2 storm
  // body too) is drawn by smith_heart_fx/breath_body.ts. Final: its own model
  // (the official pipeline), the same joints.
  heart_breath_guardian: 'smith_heart_breath_guardian',
  // The Guardian of the Quench: a bodyless target; its provisional body (an
  // ice guardian of frost granite and clear lake ice, the lake's cold light
  // in its heart) is drawn by smith_heart_fx/quench_body.ts. Final: its own
  // model (the official pipeline), the same joints.
  heart_quench_guardian: 'smith_heart_quench_guardian',
  // The Guardian of the Heat: a bodyless target; its provisional body (a
  // being of the first flame in columnar basalt and white-gold crystal, never
  // a forge) is drawn by smith_heart_fx/heat_body.ts. Final: its own model
  // (the official pipeline), the same joints.
  heart_heat_guardian: 'smith_heart_heat_guardian',
  // Its adds (encounters/smith_heart/heat*.ts). Final: their own models.
  // The Wellspawn: a child of the first flame, the stone goleling tinted
  // white-gold by its entity colour (its fire is heat_cinder_fx.ts's glow).
  heart_heat_wellspawn: 'mob_elemental',
  // The Wellkeeper: the same, bigger (scale 2.2), its fire the same glow.
  heart_heat_wellkeeper: 'mob_elemental',
  // The Seedflame: a small pale light hatched from a seed.
  heart_heat_seedflame: 'mob_glimmerwisp',
  // The Rolling Cinder: a bodyless target under the ball of the first flame
  // smith_heart_fx/heat_cinder_fx.ts draws.
  heart_heat_rolling_cinder: 'smith_heart_rolling_cinder',
  // ---- the final boss -----------------------------------------------------------
  // Its own model (phase 2O, smith_heart_boss_looks.ts): the Quadrant
  // Guardian, one rigged body in four element looks the quarter it stands in
  // picks (smith_heart_fx/final_body_fx.ts). The Heart kit's rock pieces
  // still fly in for the arrival (smith_heart_fx/final_fx.ts) and lock into
  // it under the shockwave.
  heart_masterless_strength: 'smith_heart_masterless_strength',
  // Its Splinters (part 2, encounters/smith_heart/final_adds.ts): the
  // nearest existing bodies of each element, tinted by their entity colour
  // and drawn two and a half times a player's size; their element's light is
  // smith_heart_fx/final_phase_fx.ts's. Final: their own models.
  heart_final_splinter_heat: 'mob_elemental',
  heart_final_splinter_quench: 'mob_water_elemental',
  heart_final_splinter_breath: 'mob_reedbound_acolyte',
  heart_final_splinter_hammer: 'skel_golem',
};
