// The three grave lanterns of the Lady of the Bonechill's ravine (lady.ts): the
// only shelter from her Bride's Lament. A lit lantern's light shelters two
// players at most (nearest first); every lantern that sheltered anyone goes
// dark for `lanternDark` seconds (it misses the next Lament), kindling over its
// last few; on heroic a lit lantern also burns out on its own after a while.
//
// Each lantern's state rides its encounter object's template id (lit, dark,
// kindling: LADY_LANTERN_TEMPLATES), so every client draws the flame, the
// light pool and the relight from the entity alone; the countdowns live on the
// fight. Zero rng: the lanterns are walked in their fixed order, players in
// entity-id order.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import type { LadyFightState } from './boss_state';
import { claimObjectAt } from './claim';
import {
  GRAVE_LANTERNS,
  LADY_LANTERN_SHELTER,
  LADY_LANTERN_TEMPLATES,
  LADY_TUNING,
  type LanternState,
  lanternShelters,
  lanternStateFor,
  lanternStateOf,
} from './lady_ids';

const T = LADY_TUNING;

/** Every lantern lit: the countdowns of a fresh fight. */
export function freshLanternDark(): number[] {
  return GRAVE_LANTERNS.map(() => 0);
}

/** The claim's object for lantern `i`, or null. */
function lanternObject(ctx: SimContext, inst: InstanceSlot, i: number): Entity | null {
  const spot = GRAVE_LANTERNS[i];
  const e = claimObjectAt(ctx, inst, spot.x, spot.z);
  return e && lanternStateOf(e.templateId) !== null ? e : null;
}

/** Show lantern `i` in `state` (written only on a change). */
function showLantern(ctx: SimContext, inst: InstanceSlot, i: number, state: LanternState): void {
  const e = lanternObject(ctx, inst, i);
  if (e && e.templateId !== LADY_LANTERN_TEMPLATES[state])
    e.templateId = LADY_LANTERN_TEMPLATES[state];
}

/** One tick of the lanterns: the dark countdowns and kindling, and on heroic
 *  the burn clock of every lit lantern. */
export function stepLanterns(ctx: SimContext, inst: InstanceSlot, st: LadyFightState): void {
  const heroic = inst.difficulty === 'heroic';
  for (let i = 0; i < st.lanternDark.length; i++) {
    if (st.lanternDark[i] > 0) {
      st.lanternDark[i] = Math.max(0, st.lanternDark[i] - DT);
      if (st.lanternDark[i] <= 0) st.lanternLit[i] = 0;
      showLantern(ctx, inst, i, lanternStateFor(st.lanternDark[i]));
      continue;
    }
    if (!heroic) continue;
    st.lanternLit[i] += DT;
    if (st.lanternLit[i] >= T.lanternLitHeroic - 1e-6) {
      st.lanternLit[i] = 0;
      st.lanternDark[i] = T.lanternGutter;
      showLantern(ctx, inst, i, lanternStateFor(st.lanternDark[i]));
    }
  }
}

/** Who the lit lanterns would shelter right now: lanterns in their fixed
 *  order, each taking its nearest two among those not yet sheltered. */
export function shelteredIds(
  st: LadyFightState,
  players: readonly { id: number; x: number; z: number }[],
): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < GRAVE_LANTERNS.length; i++) {
    if (st.lanternDark[i] > 0) continue;
    const l = GRAVE_LANTERNS[i];
    const free = players.filter((p) => !out.has(p.id));
    for (const p of lanternShelters(l.x, l.z, free, T.lanternRadius, T.lanternCap)) out.add(p.id);
  }
  return out;
}

/** A Lament lands: the lanterns shelter who they can, and every lantern that
 *  sheltered anyone goes dark. Returns the sheltered player ids. */
export function shelterLament(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: LadyFightState,
  players: readonly Entity[],
): Set<number> {
  const o = ctx.instanceOriginOf(inst);
  const local = players.map((p) => ({ id: p.id, x: p.pos.x - o.x, z: p.pos.z - o.z }));
  const out = new Set<number>();
  for (let i = 0; i < GRAVE_LANTERNS.length; i++) {
    if (st.lanternDark[i] > 0) continue;
    const l = GRAVE_LANTERNS[i];
    const free = local.filter((p) => !out.has(p.id));
    const took = lanternShelters(l.x, l.z, free, T.lanternRadius, T.lanternCap);
    if (took.length === 0) continue;
    for (const p of took) out.add(p.id);
    st.lanternDark[i] = T.lanternDark;
    st.lanternLit[i] = 0;
    showLantern(ctx, inst, i, lanternStateFor(st.lanternDark[i]));
    const obj = lanternObject(ctx, inst, i);
    if (obj)
      ctx.emit({
        type: 'spellfx',
        sourceId: obj.id,
        targetId: boss.id,
        school: 'holy',
        fx: 'nova',
        ability: LADY_LANTERN_SHELTER,
      });
  }
  return out;
}

/** Relight every lantern (a fresh fight, a reset). */
export function relightLanterns(ctx: SimContext, inst: InstanceSlot): void {
  for (let i = 0; i < GRAVE_LANTERNS.length; i++) showLantern(ctx, inst, i, 'lit');
}
