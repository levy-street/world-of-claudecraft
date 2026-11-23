// Per-player environmental damage, the one tick step for the hazards the world
// itself deals: the breath/drown DEPTH clock (breath.ts) and damaging fluid
// pools (lava, acid, spectral; Studio 'fluid/<kind>' placements resolved by
// fluid_volumes.ts). Runs for every player, dead ones included (breath's own
// reset branch needs that; the fluid step skips the dead itself).
//
// Fluid pools are fully independent of the map-wide water level and of the
// swim system. The built-in world carries no fluid volumes, so the fluid step
// returns before any work there and the release tick (and its rng draw order)
// is unchanged; on a fluid map it only draws rng through dealDamage.

import { updateBreath } from './breath';
import { getActiveWorldContent } from './data';
import { damagingFluidAt } from './fluid_volumes';
import type { SimContext } from './sim_context';
import { DT, type Entity } from './types';
import { terrainHeight } from './world';

/** One shared cadence for every victim: whole seconds of sim time. */
const FLUID_PULSE_TICKS = Math.round(1 / DT);

/** Standing or swimming in a damaging fluid pool ticks its damage once per
 *  second, DoT-style (no rage, indirect): the flat DPS plus a fraction of the
 *  victim's max HP (lava = 10% max HP/s), so a pool is equally lethal to a
 *  fresh alt and a geared main. */
export function updateFluidDamage(ctx: SimContext, p: Entity): void {
  const fluids = getActiveWorldContent().fluids;
  if (!fluids || fluids.length === 0 || p.dead) return;
  if (ctx.tickCount % FLUID_PULSE_TICKS !== 0) return;
  const seed = ctx.cfg.seed;
  const v = damagingFluidAt(
    fluids,
    p.pos.x,
    p.pos.z,
    p.pos.y,
    (f) => terrainHeight(f.x, f.z, seed) + f.offsetY,
  );
  if (!v) return;
  const dmg = Math.max(1, Math.round(v.dps + v.dpsPct * Math.max(0, p.maxHp)));
  const name = v.kind === 'lava' ? 'Lava' : v.kind === 'acid' ? 'Acid' : 'Noxious Fluid';
  ctx.dealDamage(null, p, dmg, false, v.school, name, 'hit', true, undefined, false);
}

/** The per-player environmental damage step the tick coordinator calls:
 *  breath first (its drown pulse can kill), then the fluid pools. */
export function updateEnvironmentDamage(ctx: SimContext, p: Entity): void {
  updateBreath(ctx, p);
  updateFluidDamage(ctx, p);
}
