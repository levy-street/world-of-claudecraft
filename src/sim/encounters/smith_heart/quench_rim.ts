// The shore ice the Guardian of the Quench raises round the Frozen Lake
// (docs/design/raid/smith_heart.md section 7.3): when it wakes, the lake's
// edge heaves up into a ring of jagged ice (2.5 s rising, its slabs on the
// floor first), then stands as a wall, so the whole fight stays on the lake's
// ice: the shelf's rock never cracks, and a raid could otherwise huddle on it
// for ever. A body still on the shelf when the ring closes is thrown onto the
// ice. The ring falls when the fight ends (a wipe, the kill).
//
// Each slab is a claim object; up, it is an oriented combat wall
// (instances/combat_wall_state.ts `sh_quench_rim`), published like the
// blades and mirrored by the online client from the same objects. Zero rng.

import { QUENCH_RIMEWALL } from '../../content/smith_heart_layout';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT } from '../../types';
import { syncQuenchWalls } from './quench_blades';
import { insideRimewall, insideRimewallSpot, rimewallSegments } from './quench_geometry';
import { QUENCH_CUES, QUENCH_NAMES, QUENCH_OBJECTS, QUENCH_TUNING as T } from './quench_ids';
import { at, dropFightObject, type QuenchScope, raidWarn, spawnFightObject } from './quench_scope';
import type { QuenchFightState } from './quench_state';

/** A slab's wall stands as long as the fight (it never runs out). */
const RIM_WALL_LIFE = 1e9;

/** The ring begins to rise (the pull). */
export function raiseRim(s: QuenchScope): void {
  const st = s.st;
  if (st.rim.ids.length > 0) return;
  for (const seg of rimewallSegments()) {
    const e = spawnFightObject(
      s.ctx,
      s.inst,
      QUENCH_OBJECTS.rimRise,
      QUENCH_NAMES.rim,
      seg.x,
      seg.z,
      1,
    );
    e.facing = seg.rot;
    st.rim.ids.push(e.id);
  }
  st.rim.rising = T.rimRise;
  s.ctx.emit({
    type: 'spellfx',
    sourceId: s.boss.id,
    targetId: s.boss.id,
    school: 'frost',
    fx: 'nova',
    ability: QUENCH_CUES.rim,
  });
  raidWarn(s, s.boss, 'rim', 'The shore ice heaves up! Get onto the lake!');
}

/** The ring rising; when it stands, it walls and whoever is still on the
 *  shelf is thrown onto the ice. */
export function stepRim(s: QuenchScope): void {
  const st = s.st;
  if (st.rim.rising <= 0 || st.rim.ids.length === 0) return;
  st.rim.rising -= DT;
  if (st.rim.rising > 1e-9) return;
  st.rim.rising = 0;
  for (const id of st.rim.ids) {
    const e = s.ctx.entities.get(id);
    if (!e) continue;
    e.templateId = QUENCH_OBJECTS.rim;
    e.kitObject = { kind: 'wall', remaining: RIM_WALL_LIFE };
  }
  const o = s.ctx.instanceOriginOf(s.inst);
  for (const p of s.players) {
    if (p.dead) continue;
    const here = at(s, p);
    if (insideRimewall(here.x, here.z, QUENCH_RIMEWALL.hd + 0.8)) continue;
    const spot = insideRimewallSpot(here.x, here.z);
    const pos = s.ctx.groundPos(o.x + spot.x, o.z + spot.z);
    p.pos = pos;
    p.prevPos = { ...pos };
    s.ctx.rebucket(p);
  }
  syncQuenchWalls(s.ctx, s.inst);
}

/** The ring falls (a wipe, the kill). */
export function dropRim(ctx: SimContext, inst: InstanceSlot, st: QuenchFightState): void {
  if (st.rim.ids.length === 0) return;
  for (const id of st.rim.ids) dropFightObject(ctx, inst, id);
  st.rim = { ids: [], rising: 0 };
  syncQuenchWalls(ctx, inst);
}
