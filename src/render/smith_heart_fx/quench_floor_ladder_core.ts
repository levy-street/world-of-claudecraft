// The Guardian of the Quench's floor ladder: the one table every floor mark of
// the fight on the Frozen Lake takes its encounter rung from (QuenchFightFx,
// QuenchFx, QuenchFrostFx, the blades, the wake, the throw, the strike's
// cracks and wind-up, the rime under the body, and every owner's particles),
// so no two of them ever tie. The Heat's ladder (heat_floor_ladder_core.ts)
// is the model; Jose's heroic run of 2026-11-17 saw the lake flicker as the
// camera turned.
//
// Why: every Quench floor mark is transparent with depth-write off, so the
// depth buffer cannot order two of them; only renderOrder can, and on a tie
// three.js falls back to bounding-sphere depth, which flips as the camera
// orbits. Before this table the lake's marks sat on five shared steps (the
// frost a breath leaves, the warmth, the throw's lines and the strike's cracks
// all on 6; the rime, the wake's foot, the throw's wave and the wind-up all on
// 5; every particle owner's smoke on 6 too). Two rules close it, as for the
// Heat:
//  - a RUNG per layer, unique (this table; the pin in
//    tests/smith_heart_quench_floor.test.ts);
//  - a POOL whose pieces can cross (the breath's frosts, the throw's lines,
//    the strike's cracks, the telegraphs) blends commutatively: a multiply
//    char under an additive glow (quench_floor_decal.ts, the Heat's split),
//    so the order its pieces draw in never changes the picture. A normal
//    blend is one draw (an instanced mesh) or pieces that never overlap.
// The entrance (quench_entrance_fx.ts) and the death (quench_death_fx.ts)
// play before and after the fight's marks exist; they keep their own steps.
//
// Three-free, DOM-free: the steps the painters pass to floorVfxRenderOrder.

import { FLOOR_VFX_LAYER_SPAN } from '../floor_vfx_layer_core';

/** How a layer's pieces blend: `normal` is the alpha blend (one draw, or
 *  pieces that never overlap), `multiply` and `additive` commute (a pool may
 *  share their rung). */
export type QuenchFloorBlend = 'normal' | 'multiply' | 'additive';

/** The module that owns the layer. */
export type QuenchFloorOwner =
  | 'quench_fight_fx'
  | 'quench_fx'
  | 'quench_frost_fx'
  | 'quench_blades_fx'
  | 'quench_wake_fx'
  | 'quench_wake_throw'
  | 'quench_strike_cracks'
  | 'quench_strike_windup_fx'
  | 'quench_rime_steps'
  | 'quench_body';

/** The modules that own a particle set (EngineParticles) in the fight. */
export type QuenchParticleOwner =
  | 'quench_fight_fx'
  | 'quench_fx'
  | 'quench_body'
  | 'quench_blades_fx';

export interface QuenchFloorRung {
  readonly step: number;
  readonly owner: QuenchFloorOwner;
  readonly blend: QuenchFloorBlend;
  /** More than one draw shares the rung (a slot pool, several owners). */
  readonly pooled: boolean;
}

const rung = (
  step: number,
  owner: QuenchFloorOwner,
  blend: QuenchFloorBlend,
  pooled: boolean,
): QuenchFloorRung => ({ step, owner, blend, pooled });

/** Every Quench floor layer's rung on the encounter band, bottom to top. */
export const QUENCH_FLOOR = {
  // What lies in the ice: the rime under the guardian's skirt, the holes, the
  // blades' four sockets (apart round the lake: they never overlap).
  rimeSteps: rung(0, 'quench_rime_steps', 'normal', false),
  holes: rung(1, 'quench_fight_fx', 'normal', false),
  bladeSockets: rung(2, 'quench_blades_fx', 'normal', false),
  // The pools that can cross: their chars, then (below) their glows.
  frostChar: rung(3, 'quench_fx', 'multiply', true),
  throwChar: rung(4, 'quench_wake_throw', 'multiply', true),
  strikeCrackChar: rung(5, 'quench_strike_cracks', 'multiply', true),
  // One draw each.
  rimes: rung(6, 'quench_fight_fx', 'normal', false),
  wakeFoot: rung(7, 'quench_wake_fx', 'normal', false),
  throwWave: rung(8, 'quench_wake_throw', 'normal', false),
  windupRing: rung(9, 'quench_strike_windup_fx', 'normal', false),
  huddleRings: rung(10, 'quench_frost_fx', 'normal', false),
  frostGlow: rung(11, 'quench_fx', 'additive', true),
  throwGlow: rung(12, 'quench_wake_throw', 'additive', true),
  strikeCrackGlow: rung(13, 'quench_strike_cracks', 'additive', true),
  warmth: rung(14, 'quench_fight_fx', 'additive', false),
  crackWebs: rung(15, 'quench_fight_fx', 'additive', false),
  // The warnings over everything lying on the ice: every telegraph's char
  // (the crack's, the shatter's, Living Rime's, the slash's lane, the breath's
  // cone: one rung, they commute), then every telegraph's glow.
  telegraphChar: rung(16, 'quench_fight_fx', 'multiply', true),
  telegraphGlow: rung(17, 'quench_fight_fx', 'additive', true),
  // The particles over the floor: each owner's smoke (a normal blend, one
  // draw) on its own rung, then every owner's rings, flames and sparks
  // (additive) together.
  fightSmoke: rung(18, 'quench_fight_fx', 'normal', false),
  breathSmoke: rung(19, 'quench_fx', 'normal', false),
  bodySmoke: rung(20, 'quench_body', 'normal', false),
  bladesSmoke: rung(21, 'quench_blades_fx', 'normal', false),
  sparks: rung(22, 'quench_fight_fx', 'additive', true),
} as const satisfies Record<string, QuenchFloorRung>;

export type QuenchFloorLayer = keyof typeof QUENCH_FLOOR;

/** The rung's step (the value a painter passes to floorVfxRenderOrder). */
export function quenchFloorStep(layer: QuenchFloorLayer): number {
  return QUENCH_FLOOR[layer].step;
}

const SMOKE: Readonly<Record<QuenchParticleOwner, QuenchFloorLayer>> = {
  quench_fight_fx: 'fightSmoke',
  quench_fx: 'breathSmoke',
  quench_body: 'bodySmoke',
  quench_blades_fx: 'bladesSmoke',
};

/** A particle owner's pool steps (EngineParticles' `steps`): its smoke on
 *  its own rung, its rings, flames and sparks on the shared additive one. */
export function quenchParticleSteps(owner: QuenchParticleOwner): {
  ring: number;
  smoke: number;
  fire: number;
  glow: number;
} {
  const sparks = QUENCH_FLOOR.sparks.step;
  return { ring: sparks, smoke: QUENCH_FLOOR[SMOKE[owner]].step, fire: sparks, glow: sparks };
}

/**
 * What is wrong with a ladder (empty when sound): two layers on one step, a
 * step off the encounter band or on its top rung (kept free: anything that
 * clamps lands there), or a pooled normal blend (its pieces would sort by
 * the camera).
 */
export function quenchFloorFaults(
  ladder: Readonly<Record<string, QuenchFloorRung>> = QUENCH_FLOOR,
): string[] {
  const out: string[] = [];
  const seen = new Map<number, string>();
  const top = FLOOR_VFX_LAYER_SPAN.encounter - 1;
  for (const [name, r] of Object.entries(ladder)) {
    const other = seen.get(r.step);
    if (other !== undefined) out.push(`${name} ties ${other} on step ${r.step}`);
    else seen.set(r.step, name);
    if (!Number.isInteger(r.step) || r.step < 0 || r.step >= top)
      out.push(`${name} sits off the band's free rungs (step ${r.step})`);
    if (r.pooled && r.blend === 'normal') out.push(`${name} pools a normal blend`);
  }
  return out;
}
