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
  // Its own model now, the first row phase 2 replaced (manifest.ts).
  heart_hammer_warder: 'smith_heart_hammer_warder',
  // Its own model now: a golem of pale granite blocks bound in bronze (smith_heart_trash_looks.ts).
  heart_ring_warder: 'smith_heart_ring_warder',
  // Its own model now: storm slate split by lightning (smith_heart_trash_looks.ts).
  heart_breath_warder: 'smith_heart_breath_warder',
  // Its own model now: a hovering hooded storm caller (smith_heart_trash_looks.ts).
  heart_breath_caller: 'smith_heart_breath_caller',
  // The Islands of the Wind's adds (encounters/smith_heart/breath_isles.ts).
  // Its own model now: a slate isle warden with a shield of island rock (smith_heart_trash_looks.ts).
  heart_gale_sentinel: 'smith_heart_gale_sentinel',
  // Its own model now: a floating wind caller of pale storm feathers (smith_heart_trash_looks.ts).
  heart_gale_mender: 'smith_heart_gale_mender',
  // Its own model now: a golem of bright glacier ice over slate joints (manifest.ts).
  heart_quench_warder: 'smith_heart_quench_warder',
  // Its own model now: a floating hooded frost caster with an orb over each palm (manifest.ts).
  heart_quench_caller: 'smith_heart_quench_caller',
  // Its own model now: sooted basalt over molten seams, a white-gold crown (smith_heart_trash_looks.ts).
  heart_heat_warder: 'smith_heart_heat_warder',
  // Its own model now: a hovering caster of cracked basalt and fire (smith_heart_trash_looks.ts).
  heart_heat_caller: 'smith_heart_heat_caller',
  // ---- the four guardians -----------------------------------------------------
  // The Guardian of the Hammer, the Hammer Council's main boss: its own model now, the one first
  // built for the Slabwright (smith_heart_boss_looks.ts smith_heart_hammer_guardian).
  heart_hammer_guardian: 'smith_heart_hammer_guardian',
  // The Hammer Council's other member, the Seam Singer: its own model now
  // (manifest.ts); smith_heart_fx/council_bodies.ts keeps only its dust and
  // rings.
  heart_seam_singer: 'smith_heart_seam_singer',
  // The Guardian of the Breath: its own model (smith_heart_boss_looks.ts),
  // floating pieces of ancient armor held together by living wind; the wind
  // (and its phase-2 storm) is drawn by smith_heart_fx/breath_body.ts.
  heart_breath_guardian: 'smith_heart_breath_guardian',
  // The Guardian of the Quench: her own model (smith_heart_boss_looks.ts),
  // an ice queen of blue-slate stone in a gown of ice; her cold (the mist off
  // her hem, her heart's light, the breath, the wake's column, the statue's
  // frost) is drawn by smith_heart_fx/quench_body.ts.
  heart_quench_guardian: 'smith_heart_quench_guardian',
  // The Guardian of the Heat: its own model (smith_heart_boss_looks.ts), a
  // giant of basalt and lava in the first wellspring; its fire is drawn by
  // smith_heart_fx/heat_body.ts.
  heart_heat_guardian: 'smith_heart_heat_guardian',
  // Its adds (encounters/smith_heart/heat*.ts), their own models now (smith_heart_trash_looks.ts):
  // the Wellspawn, a squat basalt imp climbing over the Hearth's rim (its fire is also
  // heat_cinder_fx.ts's glow);
  heart_heat_wellspawn: 'smith_heart_wellspawn',
  // the Wellkeeper, a hulking basalt brute with a burning belly, clawing up by the wellspring;
  heart_heat_wellkeeper: 'smith_heart_wellkeeper',
  // the Seedflame, a white-gold flame cracking out of its basalt seed.
  heart_heat_seedflame: 'smith_heart_seedflame',
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
  // Its Splinters (part 2, encounters/smith_heart/final_adds.ts): their own models now
  // (smith_heart_trash_looks.ts), one hunched shard-brute in each vein's stone and crystal,
  // climbing out of its quarter; their element's light is still smith_heart_fx/final_phase_fx.ts's.
  heart_final_splinter_heat: 'smith_heart_splinter_heat',
  heart_final_splinter_quench: 'smith_heart_splinter_quench',
  heart_final_splinter_breath: 'smith_heart_splinter_breath',
  heart_final_splinter_hammer: 'smith_heart_splinter_hammer',
};
