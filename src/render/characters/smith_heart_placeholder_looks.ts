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
  // Final: a hovering storm caller of slate and lightning.
  heart_breath_caller: 'mob_hoard_storm_caller',
  // Final: a rime-crusted warder of blue ice and frost-cracked stone.
  heart_quench_warder: 'mob_hoard_rime_elemental',
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
  // The Hammer Council's other two: bodyless targets; their provisional
  // bodies of the Heart kit's rock and crystal are drawn by
  // smith_heart_fx/council_bodies.ts (the Masterless Strength's pattern).
  // Final: their own models (the official pipeline), the same joints.
  heart_slabwright: 'smith_heart_slabwright',
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
  // ---- the final boss -----------------------------------------------------------
  // Phase 2J: the Masterless Strength is a bodyless target; its body (the
  // colossus of the Heart kit's rock pieces round the crystal heart) is drawn
  // by smith_heart_fx/final_fx.ts. Final: its own model (the official
  // pipeline), the same joints and timeline.
  heart_masterless_strength: 'smith_heart_colossus',
};
