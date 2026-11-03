// The Smith's four blades of ice under the Guardian of the Quench (docs/
// design/raid/smith_heart.md section 7.3).
//
//   Sunk             four great swords sunk point first round the lake (claim
//                    objects, round combat walls).
//   The blades wake  the guardian raises its arms (a 4 s bar, planted): two of the
//                    blades as the fight begins, the other two at half health. They
//                    tear free, stand upright and float in place, a blue light in
//                    each; they cannot be targeted or harmed (objects, never
//                    bodies). What they do awake is quench_slash.ts.
//
// Zero rng here.

import { QUENCH_BLADE_SPOTS } from '../../content/smith_heart_layout';
import { syncCombatWallCollision } from '../../mob/trash_kit/combat_walls';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import {
  bladeStateOf,
  bladeTemplate,
  QUENCH_AURAS,
  QUENCH_CASTS,
  QUENCH_CUES,
  QUENCH_NAMES,
  QUENCH_OBJECTS,
  type QuenchBladeState,
  QUENCH_TUNING as T,
} from './quench_ids';
import { beginBar, dropAura, putMarker, type QuenchScope } from './quench_scope';
import type { QuenchBlade, QuenchFightState } from './quench_state';
import { quenchSay } from './quench_voice';

/** The two blades that wake as the fight begins (opposite sides of the lake). */
const FIRST_AWAKE: readonly number[] = [0, 2];

/** A blade's wall stands as long as the claim (it never runs out). */
const BLADE_WALL_LIFE = 1e9;

// ---- the claim's blades ---------------------------------------------------------------

/** The claim's four blade objects, by home (QUENCH_BLADE_SPOTS order); a
 *  missing one is null. */
export function claimBlades(ctx: SimContext, inst: InstanceSlot): (Entity | null)[] {
  const out: (Entity | null)[] = QUENCH_BLADE_SPOTS.map(() => null);
  const o = ctx.instanceOriginOf(inst);
  const loose: Entity[] = [];
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    if (!e || !e.templateId.startsWith(QUENCH_OBJECTS.bladePrefix)) continue;
    const i = QUENCH_BLADE_SPOTS.findIndex(
      (sp) => Math.hypot(sp.x - (e.pos.x - o.x), sp.z - (e.pos.z - o.z)) < 1,
    );
    if (i >= 0 && !out[i]) out[i] = e;
    else loose.push(e);
  }
  // A blade away from home (where its last slash left it) takes the
  // first empty home, in roster order.
  for (const e of loose) {
    const i = out.indexOf(null);
    if (i >= 0) out[i] = e;
  }
  return out;
}

/** How many of the claim's objects are combat walls (the publication's
 *  census: the shore ice and the blades). */
function wallCount(ctx: SimContext, inst: InstanceSlot): number {
  let n = 0;
  for (const id of inst.objectIds) if (ctx.entities.get(id)?.kitObject?.kind === 'wall') n++;
  return n;
}

/** Publish the claim's walls now (a read later this tick sees the change). */
export function syncQuenchWalls(ctx: SimContext, inst: InstanceSlot): void {
  syncCombatWallCollision(ctx, inst, wallCount(ctx, inst));
}

/** Set a blade object's state: its template (whether it walls) and its
 *  engine wall state with it. */
export function setBladeObject(e: Entity, state: QuenchBladeState): void {
  e.templateId = bladeTemplate(state);
  // Awake it moves, so it stands as no wall.
  if (state === 'fly' || state === 'float') e.kitObject = undefined;
  else e.kitObject ??= { kind: 'wall', remaining: BLADE_WALL_LIFE };
}

/** The blades the claim spawned with are plain objects: give each the
 *  engine's wall state once, so the trash engine publishes it every tick.
 *  Returns true when any was new. */
export function ensureBladeWalls(ctx: SimContext, inst: InstanceSlot): boolean {
  let fresh = false;
  claimBlades(ctx, inst).forEach((e, i) => {
    const state = e ? bladeStateOf(e.templateId) : null;
    if (!e || e.kitObject || state === 'fly' || state === 'float') return;
    e.kitObject = { kind: 'wall', remaining: BLADE_WALL_LIFE };
    // Faced as its home is (as a reset sinks it), from the claim's first tick.
    e.facing = QUENCH_BLADE_SPOTS[i].rot;
    fresh = true;
  });
  if (fresh) syncQuenchWalls(ctx, inst);
  return fresh;
}

/** The fight's blades as the state holds them (at their homes, sunk). */
export function bladesAtHome(ctx: SimContext, inst: InstanceSlot): QuenchBlade[] {
  const out: QuenchBlade[] = [];
  claimBlades(ctx, inst).forEach((e, i) => {
    if (!e) return;
    const sp = QUENCH_BLADE_SPOTS[i];
    out.push({ objectId: e.id, home: i, x: sp.x, z: sp.z, awake: false });
  });
  return out;
}

/** Every blade back to its home, sunk (a reset, the fall). */
export function sinkBlades(ctx: SimContext, inst: InstanceSlot): void {
  const o = ctx.instanceOriginOf(inst);
  claimBlades(ctx, inst).forEach((e, i) => {
    if (!e) return;
    const sp = QUENCH_BLADE_SPOTS[i];
    if (Math.hypot(e.pos.x - o.x - sp.x, e.pos.z - o.z - sp.z) > 1e-6) {
      const p = ctx.groundPos(o.x + sp.x, o.z + sp.z);
      e.prevPos = { ...e.pos };
      e.pos = p;
      ctx.rebucket(e);
    }
    e.facing = sp.rot;
    setBladeObject(e, 'sunk');
  });
  syncQuenchWalls(ctx, inst);
}

// ---- the blades wake ------------------------------------------------------------------

/** Is the first awakening due (no blade awake yet, the guardian free)? */
export function firstWakeDue(s: QuenchScope, free: boolean): boolean {
  const { half, blades } = s.st;
  return half === 'lake' && blades.length > 0 && !blades.some((b) => b.awake) && free;
}

/** Is the second awakening due (half health, the guardian free)? */
export function wakeDue(s: QuenchScope, free: boolean): boolean {
  return s.st.half === 'lake' && s.boss.hp <= s.boss.maxHp * T.wakeAt && free;
}

function wakingBlades(s: QuenchScope): QuenchBlade[] {
  return s.st.blades.filter((b) => {
    const e = s.ctx.entities.get(b.objectId);
    return !!e && bladeStateOf(e.templateId) === 'wake';
  });
}

/** The guardian raises its arms: the first two blades, or the other two (the
 *  second half begins). Exported for the dev trigger. */
export function startWake(s: QuenchScope): boolean {
  const st = s.st;
  if (st.half !== 'lake' || wakingBlades(s).length > 0) return false;
  const first = !st.blades.some((b) => b.awake);
  if (!first) st.half = 'wake';
  beginBar(s, QUENCH_CASTS.wake, T.wakeCast, s.boss.facing);
  for (const b of st.blades) {
    if (b.awake || (first && !FIRST_AWAKE.includes(b.home))) continue;
    const e = s.ctx.entities.get(b.objectId);
    if (e) setBladeObject(e, 'wake');
  }
  quenchSay(s, s.boss, 'wake');
  return true;
}

/** The bar lands: the waking blades stand upright and float. */
export function landWake(s: QuenchScope): void {
  const st = s.st;
  const b = s.boss;
  for (const bl of wakingBlades(s)) {
    const e = s.ctx.entities.get(bl.objectId);
    if (!e) continue;
    setBladeObject(e, 'float');
    e.facing = b.facing;
    bl.awake = true;
  }
  s.ctx.emit({
    type: 'spellfx',
    sourceId: b.id,
    targetId: b.id,
    school: 'frost',
    fx: 'nova',
    ability: QUENCH_CUES.wake,
  });
  syncQuenchWalls(s.ctx, s.inst);
  if (st.half !== 'wake') {
    st.slashTimer = T.slashFirst;
    return;
  }
  st.half = 'awake';
  putMarker(b, QUENCH_AURAS.awake, QUENCH_NAMES.awake, 3600, b.id, {
    permanent: true,
    school: 'frost',
  });
  st.deepenTimer = T.deepenEvery;
  st.slashTimer = Math.min(st.slashTimer, T.slashAfterWake);
}

/** The blades sink home (a reset, the fall). */
export function clearBlades(ctx: SimContext, inst: InstanceSlot, st: QuenchFightState): void {
  sinkBlades(ctx, inst);
  st.blades = bladesAtHome(ctx, inst);
}

/** Off the guardian: the blades' marker (a reset, the fall). */
export function clearBladeMarks(boss: Entity): void {
  dropAura(boss, QUENCH_AURAS.awake);
}
