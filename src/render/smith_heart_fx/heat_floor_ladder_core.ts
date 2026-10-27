// The Guardian of the Heat's floor ladder: the one table every floor piece of
// the fight in the Hearth takes its encounter rung from (HeatFx, HeatFightFx
// and its parts, the particles of those two and of the body), so no two of
// them ever tie.
//
// Why it exists: every Heat floor mark is transparent with depth-write off,
// so the depth buffer cannot order two of them; only renderOrder can, and on
// a tie three.js falls back to bounding-sphere depth, which flips as the
// camera orbits (the flicker a player saw turning the camera over a crossing
// of two marks). Two rules close it:
//  - a RUNG per layer, unique across the four modules (this table; the pin in
//    tests/smith_heart_heat_floor.test.ts), bottom to top: the wellspring and
//    the floor's lasting scorch, the molten surfaces (craters, wakes, rivers,
//    Wakefire), the warnings (every telegraph a player must react to, over
//    the fire it warns of), then the particles over everything on the floor,
//    then the wellspring's shimmer standing in the air over its lip;
//  - a POOL that shares one rung (six lanes, three craters...)
//    blends commutatively, so the order its pieces are drawn in cannot change
//    the picture: a multiply (the char that darkens the basalt) or an
//    additive (the glow), split from one source so a lone piece still looks
//    exactly as a normal blend would (heat_molten_decal.ts). A normal-blended
//    layer is either one draw (an instanced mesh: its instances paint in their
//    own order, never the camera's) or alone on its rung.
// Every char rung sits under every glow rung of its group, so a crossing of
// marks of any kinds composes the same from every angle.
//
// Three-free, DOM-free: the steps the painters pass to floorVfxRenderOrder.

import { FLOOR_VFX_LAYER_SPAN } from '../floor_vfx_layer_core';

/** How a layer's pieces blend: `opaque` writes depth (order is moot),
 *  `normal` is the alpha blend (one draw, or alone), `multiply` and
 *  `additive` commute (a pool may share their rung). */
export type HeatFloorBlend = 'opaque' | 'normal' | 'multiply' | 'additive';

/** The module that owns the layer. */
export type HeatFloorOwner =
  | 'heat_fx'
  | 'heat_fight_fx'
  | 'heat_well_fx'
  | 'heat_cinder_fx'
  | 'heat_body';

/** The modules that own a particle set (EngineParticles) in the Hearth. */
export type HeatParticleOwner = 'heat_fx' | 'heat_fight_fx' | 'heat_body';

export interface HeatFloorRung {
  readonly step: number;
  readonly owner: HeatFloorOwner;
  readonly blend: HeatFloorBlend;
  /** More than one draw shares the rung (a slot pool, two particle ramps). */
  readonly pooled: boolean;
}

const rung = (
  step: number,
  owner: HeatFloorOwner,
  blend: HeatFloorBlend,
  pooled: boolean,
): HeatFloorRung => ({ step, owner, blend, pooled });

/** Every Heat floor layer's rung on the encounter band, bottom to top. */
export const HEAT_FLOOR = {
  // The wellspring and what the fight leaves lying on the floor.
  wellPool: rung(0, 'heat_well_fx', 'opaque', false),
  wellRim: rung(1, 'heat_well_fx', 'additive', false),
  cinderTrack: rung(2, 'heat_cinder_fx', 'normal', false),
  patches: rung(3, 'heat_fight_fx', 'normal', false),
  // The molten surfaces: every char, then every glow.
  craterChar: rung(4, 'heat_fx', 'multiply', true),
  wakeChar: rung(5, 'heat_fx', 'multiply', true),
  riverChar: rung(6, 'heat_well_fx', 'multiply', true),
  zoneChar: rung(7, 'heat_fight_fx', 'multiply', true),
  craterGlow: rung(8, 'heat_fx', 'additive', true),
  wakeGlow: rung(9, 'heat_fx', 'additive', true),
  riverGlow: rung(10, 'heat_well_fx', 'additive', true),
  zoneGlow: rung(11, 'heat_fight_fx', 'additive', true),
  // The warnings over the fire: HeatFx's (the fist's spot, the swells'
  // lanes) and the fight's (seeds, river lanes, falls, a cinder's reach, the
  // hunted's rings; one kit lent to the well and the cinder parts).
  fistTelegraphChar: rung(12, 'heat_fx', 'multiply', true),
  fightTelegraphChar: rung(13, 'heat_fight_fx', 'multiply', true),
  fistTelegraphGlow: rung(14, 'heat_fx', 'additive', true),
  fightTelegraphGlow: rung(15, 'heat_fight_fx', 'additive', true),
  fistTelegraphCurtain: rung(16, 'heat_fx', 'additive', true),
  fightTelegraphCurtain: rung(17, 'heat_fight_fx', 'additive', true),
  // The particles over everything on the floor, each module's own: its smoke
  // (one draw, a normal blend), then its shock rings, flames and sparks (all
  // additive, sharing one rung).
  fistSmoke: rung(18, 'heat_fx', 'normal', false),
  fightSmoke: rung(19, 'heat_fight_fx', 'normal', false),
  bodySmoke: rung(20, 'heat_body', 'normal', false),
  fistSparks: rung(21, 'heat_fx', 'additive', true),
  fightSparks: rung(22, 'heat_fight_fx', 'additive', true),
  bodySparks: rung(23, 'heat_body', 'additive', true),
  // The wellspring's heat shimmer standing over its lip (a sleeve of air,
  // additive, one draw): over the floor's marks and the particles' smoke.
  wellShimmer: rung(24, 'heat_well_fx', 'additive', false),
} as const satisfies Record<string, HeatFloorRung>;

export type HeatFloorLayer = keyof typeof HEAT_FLOOR;

/** The rung's step (the value a painter passes to floorVfxRenderOrder). */
export function heatFloorStep(layer: HeatFloorLayer): number {
  return HEAT_FLOOR[layer].step;
}

const PARTICLE_RUNGS: Readonly<
  Record<HeatParticleOwner, { smoke: HeatFloorLayer; sparks: HeatFloorLayer }>
> = {
  heat_fx: { smoke: 'fistSmoke', sparks: 'fistSparks' },
  heat_fight_fx: { smoke: 'fightSmoke', sparks: 'fightSparks' },
  heat_body: { smoke: 'bodySmoke', sparks: 'bodySparks' },
};

/** A particle owner's pool steps (EngineParticles' `steps`): its smoke on
 *  its own rung, its rings, flames and sparks together on its additive one. */
export function heatParticleSteps(owner: HeatParticleOwner): {
  ring: number;
  smoke: number;
  fire: number;
  glow: number;
} {
  const r = PARTICLE_RUNGS[owner];
  const sparks = HEAT_FLOOR[r.sparks].step;
  return { ring: sparks, smoke: HEAT_FLOOR[r.smoke].step, fire: sparks, glow: sparks };
}

/**
 * What is wrong with a ladder (empty when sound): two layers on one step, a
 * step off the encounter band or on its top rung (kept free: anything that
 * clamps lands there), or a pooled normal blend (its pieces would sort by
 * the camera).
 */
export function heatFloorFaults(
  ladder: Readonly<Record<string, HeatFloorRung>> = HEAT_FLOOR,
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
