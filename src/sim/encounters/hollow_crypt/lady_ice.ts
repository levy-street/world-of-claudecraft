// The Lady of the Bonechill's ice (lady.ts): her Rime Path (a patch of slick
// rime wherever she drifts) and, from the Bridal Freeze at half health, the
// whole ravine floor frozen over. A player on her ice walks on slippery ground
// (src/sim/slippery_ground.ts): the shared motion kernel gives them momentum,
// harder to start, stop and turn. The patches and the frozen floor are
// encounter objects (scale = radius) every client draws; the slick itself is
// the aura, which both hosts read.
//
// Zero rng: patches are laid on her own path, players walked in id order.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { SLIPPERY_GROUND_AURA } from '../../slippery_ground';
import { DT, type Entity } from '../../types';
import type { LadyFightState } from './boss_state';
import {
  claimPlayers,
  dropAuraById,
  dropEncounterObject,
  localOf,
  spawnCryptObject,
} from './claim';
import {
  BONECHILL_RAVINE,
  LADY_FROZEN_FLOOR_TEMPLATE,
  LADY_RIME_PATCH_TEMPLATE,
  LADY_TUNING,
  onRavine,
} from './lady_ids';

const T = LADY_TUNING;

/** Lay a patch where she drifts (no patch over the frozen floor). */
export function stepRimePath(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: LadyFightState,
): void {
  for (const r of st.rime) r.remaining -= DT;
  for (const r of st.rime) if (r.remaining <= 0) dropEncounterObject(ctx, inst, r.objectId);
  st.rime = st.rime.filter((r) => r.remaining > 0);
  if (st.frozen || st.embrace) return;
  const at = localOf(ctx, inst, boss);
  if (!onRavine(at.x, at.z)) return;
  const last = st.lastRime;
  if (last && Math.hypot(at.x - last.x, at.z - last.z) < T.rimeSpacing) return;
  while (st.rime.length >= T.rimeCap) {
    const old = st.rime.shift();
    if (old) dropEncounterObject(ctx, inst, old.objectId);
  }
  const obj = spawnCryptObject(
    ctx,
    inst,
    LADY_RIME_PATCH_TEMPLATE,
    'Rime Path',
    at.x,
    at.z,
    boss.facing,
    T.rimeRadius,
  );
  st.rime.push({ objectId: obj.id, x: at.x, z: at.z, remaining: T.rimeSeconds });
  st.lastRime = { x: at.x, z: at.z };
}

/** Is (lx, lz) on her ice: a Rime Path patch, or the frozen ravine? */
export function onLadyIce(st: LadyFightState, lx: number, lz: number): boolean {
  if (st.frozen && onRavine(lx, lz)) return true;
  for (const r of st.rime) if (Math.hypot(lx - r.x, lz - r.z) <= T.rimeRadius) return true;
  return false;
}

/** Put the slick on whoever stands on her ice, take it off whoever left. */
export function stepSlick(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: LadyFightState,
): void {
  const o = ctx.instanceOriginOf(inst);
  for (const p of claimPlayers(ctx, inst)) {
    if (p.carriedBy !== undefined || !onLadyIce(st, p.pos.x - o.x, p.pos.z - o.z)) {
      dropAuraById(p, SLIPPERY_GROUND_AURA);
      continue;
    }
    // Topped up only every second or so (each top-up moves the aura's
    // deadline on the wire): the slick outlives a step off the ice by at most
    // that, and the removal above is immediate anyway.
    const a = p.auras.find((x) => x.id === SLIPPERY_GROUND_AURA);
    if (a) {
      if (a.remaining < 0.5) a.remaining = 1.5;
      continue;
    }
    p.auras.push({
      id: SLIPPERY_GROUND_AURA,
      name: 'Rime-Slick',
      kind: 'slow',
      remaining: 1.5,
      duration: 1.5,
      value: 1,
      value2: T.iceGrip,
      sourceId: boss.id,
      school: 'frost',
      undispellable: true,
    });
  }
}

/** The Bridal Freeze lands: the whole ravine floor turns to ice. */
export function freezeRavine(ctx: SimContext, inst: InstanceSlot, st: LadyFightState): void {
  if (st.frozen) return;
  st.frozen = true;
  for (const r of st.rime) dropEncounterObject(ctx, inst, r.objectId);
  st.rime = [];
  const floor = spawnCryptObject(
    ctx,
    inst,
    LADY_FROZEN_FLOOR_TEMPLATE,
    'Frozen Ravine',
    BONECHILL_RAVINE.x,
    BONECHILL_RAVINE.z,
    0,
    BONECHILL_RAVINE.r,
  );
  st.floorObjectId = floor.id;
}

/** Thaw: every patch and the frozen floor go, and the slick comes off. */
export function thawRavine(ctx: SimContext, inst: InstanceSlot, st: LadyFightState): void {
  for (const r of st.rime) dropEncounterObject(ctx, inst, r.objectId);
  st.rime = [];
  st.lastRime = null;
  if (st.floorObjectId !== null) dropEncounterObject(ctx, inst, st.floorObjectId);
  st.floorObjectId = null;
  st.frozen = false;
  for (const p of claimPlayers(ctx, inst)) dropAuraById(p, SLIPPERY_GROUND_AURA);
}
