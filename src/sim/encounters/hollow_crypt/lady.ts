// The Lady of the Bonechill on the frost ravine floor: the ghost of a bride
// buried in the ravine's ice (the second Hollow Crypt boss; the id stays
// `rimeweb`). The fight's coordinator; tuning and the kit's summary in
// lady_ids.ts.
//
//   Bride's Lament   every 22 s (first at 14 s) a 3 s wail; when it ends, 60 to
//                    75 frost on everyone not sheltered by a lit grave lantern
//                    (two to a lantern, lady_lanterns.ts), half again per
//                    Lingering Lament stack they carry, and one more stack.
//                    Each lantern that sheltered anyone goes dark for 28 s.
//   Frozen Embrace   every 30 s (first at 24 s) a 1.2 s bar on a non-tank (two
//                    on heroic); she rises 5 yd with them for up to 8 s
//                    (lady_embrace.ts). 6 percent of her health dealt while she
//                    hangs there breaks it; otherwise she drops them (150 to
//                    180 when they hit the ice).
//   Rime Path        slick rime wherever she drifts (lady_ice.ts).
//   Bridal Freeze    at half health a 2.5 s wail, and the whole ravine floor
//                    freezes over for the rest of the fight.
//   Heroic           the lanterns burn out on their own; the Embrace takes two.
//
// Zero rng in every pick (pickMarkTargets); the only draws are damage rolls,
// in claim-player order.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { SLIPPERY_GROUND_AURA } from '../../slippery_ground';
import { DT, type Entity } from '../../types';
import type { LadyFightState } from './boss_state';
import {
  claimPlayers,
  clearCastIf,
  dropAuraById,
  grantClaimDeed,
  localOf,
  mechanicDamage,
  pickMarkTargets,
  startBar,
} from './claim';
import { endEmbrace, seizeVictims, stepEmbrace, stepFalling } from './lady_embrace';
import { freezeRavine, stepRimePath, stepSlick, thawRavine } from './lady_ice';
import {
  LADY_BRIDAL_FREEZE,
  LADY_BRIDES_LAMENT,
  LADY_EMBRACED,
  LADY_FROZEN_EMBRACE,
  LADY_LAMENT_DREAD,
  LADY_LINGERING_LAMENT,
  LADY_TUNING,
} from './lady_ids';
import {
  freshLanternDark,
  relightLanterns,
  shelteredIds,
  shelterLament,
  stepLanterns,
} from './lady_lanterns';

const T = LADY_TUNING;
export const LADY_DEED = 'dgn_lady_nobody_hanging';

type LadyBar = 'lament' | 'embrace' | 'freeze';
const BAR_ID: Record<LadyBar, string> = {
  lament: LADY_BRIDES_LAMENT,
  embrace: LADY_FROZEN_EMBRACE,
  freeze: LADY_BRIDAL_FREEZE,
};
const BAR_SECONDS: Record<LadyBar, number> = {
  lament: T.lamentCast,
  embrace: T.embraceCast,
  freeze: T.freezeCast,
};

function freshState(): LadyFightState {
  return {
    kind: 'lady',
    lamentTimer: T.lamentFirst,
    embraceTimer: T.embraceFirst,
    casts: 0,
    bar: null,
    lanternDark: freshLanternDark(),
    lanternLit: freshLanternDark(),
    embrace: null,
    falling: [],
    rime: [],
    lastRime: null,
    frozen: false,
    floorObjectId: null,
    dropped: false,
  };
}

/** Start one of her bars (the cadence and the dev triggers). */
export function startLadyBar(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: LadyFightState,
  what: LadyBar,
): boolean {
  if (st.bar || st.embrace) return false;
  let targetIds: number[] = [];
  if (what === 'embrace') {
    const n = inst.difficulty === 'heroic' ? T.embraceVictimsHeroic : T.embraceVictims;
    const busy = new Set(st.falling.map((f) => f.playerId));
    targetIds = pickMarkTargets(boss, claimPlayers(ctx, inst), n, st.casts * 3 + 1, busy).map(
      (p) => p.id,
    );
    if (targetIds.length === 0) return false;
    const first = ctx.entities.get(targetIds[0]);
    if (first) boss.facing = Math.atan2(first.pos.x - boss.pos.x, first.pos.z - boss.pos.z);
  }
  st.casts++;
  st.bar = { what, targetIds };
  startBar(boss, BAR_ID[what], BAR_SECONDS[what], targetIds[0] ?? null);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: targetIds[0] ?? boss.id,
    school: 'frost',
    fx: 'windup',
    ability: BAR_ID[what],
  });
  if (what === 'lament') st.lamentTimer = T.lamentEvery;
  else if (what === 'embrace') st.embraceTimer = T.embraceEvery;
  return true;
}

/** The Lament lands: shelter, then the wail on everyone left in the open. */
function landLament(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: LadyFightState): void {
  const players = claimPlayers(ctx, inst).filter((p) => p.carriedBy === undefined);
  const sheltered = shelterLament(ctx, inst, boss, st, players);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'frost',
    fx: 'nova',
    ability: LADY_BRIDES_LAMENT,
  });
  for (const p of claimPlayers(ctx, inst)) {
    dropAuraById(p, LADY_LAMENT_DREAD);
    // Sheltered by a lantern, or held to her breast (her own wail spares the
    // one she embraces).
    if (sheltered.has(p.id) || p.carriedBy === boss.id) continue;
    const prev = p.auras.find((a) => a.id === LADY_LINGERING_LAMENT);
    const stacks = prev?.stacks ?? 0;
    const amount = Math.round(
      mechanicDamage(ctx, boss, T.lamentMin, T.lamentMax) * (1 + T.lingerPerStack * stacks),
    );
    ctx.dealDamage(boss, p, amount, false, 'frost', "Bride's Lament", 'hit', true);
    if (p.dead) continue;
    const next = Math.min(T.lingerMaxStacks, stacks + 1);
    dropAuraById(p, LADY_LINGERING_LAMENT);
    ctx.applyAura(p, {
      id: LADY_LINGERING_LAMENT,
      name: 'Lingering Lament',
      kind: 'slow',
      remaining: T.lingerSeconds,
      duration: T.lingerSeconds,
      value: 1,
      value2: T.lingerPerStack * next,
      stacks: next,
      sourceId: boss.id,
      school: 'frost',
      undispellable: true,
    });
  }
}

/** While the Lament is wailed: everyone wears the dread (it runs out as the
 *  Lament lands), its hint saying whether a lantern has room for them now. */
function stepDread(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: LadyFightState): void {
  const o = ctx.instanceOriginOf(inst);
  const players = claimPlayers(ctx, inst);
  const local = players
    .filter((p) => p.carriedBy === undefined)
    .map((p) => ({ id: p.id, x: p.pos.x - o.x, z: p.pos.z - o.z }));
  const safe = shelteredIds(st, local);
  const left = Math.max(0, boss.castRemaining);
  for (const p of players) {
    const hint = safe.has(p.id) ? 1 : 0;
    const a = p.auras.find((x) => x.id === LADY_LAMENT_DREAD);
    if (a) {
      a.remaining = left;
      a.value2 = hint;
      continue;
    }
    p.auras.push({
      id: LADY_LAMENT_DREAD,
      name: "Bride's Lament",
      kind: 'slow',
      remaining: left,
      duration: T.lamentCast,
      value: 1,
      value2: hint,
      sourceId: boss.id,
      school: 'frost',
      undispellable: true,
    });
  }
}

/** A bar lands. */
function landBar(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: LadyFightState): void {
  const bar = st.bar;
  if (!bar) return;
  st.bar = null;
  clearCastIf(boss, BAR_ID[bar.what]);
  if (bar.what === 'lament') {
    landLament(ctx, inst, boss, st);
    return;
  }
  if (bar.what === 'freeze') {
    freezeRavine(ctx, inst, st);
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'frost',
      fx: 'nova',
      ability: LADY_BRIDAL_FREEZE,
    });
    return;
  }
  seizeVictims(ctx, inst, boss, st, bar.targetIds);
}

/** At half health: the Bridal Freeze (dev trigger too). */
export function beginBridalFreeze(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: LadyFightState,
): boolean {
  if (st.frozen || st.bar?.what === 'freeze' || st.embrace) return false;
  if (st.bar) {
    clearCastIf(boss, BAR_ID[st.bar.what]);
    if (st.bar.what === 'lament')
      for (const p of claimPlayers(ctx, inst)) dropAuraById(p, LADY_LAMENT_DREAD);
    st.bar = null;
  }
  return startLadyBar(ctx, inst, boss, st, 'freeze');
}

function clearPlayers(ctx: SimContext, inst: InstanceSlot): void {
  for (const p of claimPlayers(ctx, inst)) {
    dropAuraById(p, LADY_LAMENT_DREAD);
    dropAuraById(p, LADY_LINGERING_LAMENT);
    dropAuraById(p, LADY_EMBRACED);
    dropAuraById(p, SLIPPERY_GROUND_AURA);
  }
}

/** The fight ended (a wipe, an evade, a reset): she sets down whoever she
 *  holds, the ravine thaws, the lanterns relight, the marks clear. */
export function resetLady(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  const st = boss.cryptBossFight;
  if (st?.kind === 'lady') {
    endEmbrace(ctx, boss, st);
    thawRavine(ctx, inst, st);
    if (st.bar) clearCastIf(boss, BAR_ID[st.bar.what]);
  }
  relightLanterns(ctx, inst);
  clearPlayers(ctx, inst);
  boss.cryptBossFight = undefined;
}

/** She was laid to rest: the deed, then the tidy-up. */
function concludeLady(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: LadyFightState): void {
  endEmbrace(ctx, boss, st);
  if (!st.dropped) grantClaimDeed(ctx, inst, LADY_DEED);
  thawRavine(ctx, inst, st);
  relightLanterns(ctx, inst);
  clearPlayers(ctx, inst);
  boss.cryptBossFight = undefined;
}

/** One tick of the Lady of the Bonechill's fight. */
export function tickLady(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  engaged: boolean,
): void {
  let st = boss.cryptBossFight?.kind === 'lady' ? boss.cryptBossFight : null;
  if (boss.dead) {
    if (st) concludeLady(ctx, inst, boss, st);
    return;
  }
  // An evade or a wipe ends everything, a hold in the air included: she sets
  // her victims down gently (endEmbrace in resetLady), never drops them.
  if (!engaged) {
    if (st) resetLady(ctx, inst, boss);
    return;
  }
  if (!st) {
    st = freshState();
    boss.cryptBossFight = st;
    relightLanterns(ctx, inst);
  }
  stepLanterns(ctx, inst, st);
  stepFalling(ctx, boss, st);
  const holding = stepEmbrace(ctx, inst, boss, st, embracePulse(st));
  stepRimePath(ctx, inst, boss, st);
  stepSlick(ctx, inst, boss, st);
  if (holding) return;
  // Her timers run under her bars; one due mid-bar waits for it to end.
  st.lamentTimer -= DT;
  st.embraceTimer -= DT;
  const share = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
  if (!st.frozen && st.bar?.what !== 'freeze' && share <= T.freezeAt) {
    if (beginBridalFreeze(ctx, inst, boss, st)) return;
  }
  if (st.bar) {
    const bar = st.bar;
    if (boss.castingAbility !== BAR_ID[bar.what]) {
      // A bar gone before it landed (nothing but a reset clears hers): no
      // dread may outlive its Lament.
      if (bar.what === 'lament')
        for (const p of claimPlayers(ctx, inst)) dropAuraById(p, LADY_LAMENT_DREAD);
      st.bar = null;
      return;
    }
    const at = localOf(ctx, inst, boss);
    const o = ctx.instanceOriginOf(inst);
    const g = ctx.groundPos(o.x + at.x, o.z + at.z);
    boss.pos.x = g.x;
    boss.pos.y = g.y;
    boss.pos.z = g.z;
    boss.swingTimer = Math.max(boss.swingTimer, 0.6);
    ctx.grid.update(boss);
    if (bar.what === 'embrace') {
      const t = ctx.entities.get(bar.targetIds[0]);
      if (t) boss.facing = Math.atan2(t.pos.x - boss.pos.x, t.pos.z - boss.pos.z);
    }
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    if (bar.what === 'lament') stepDread(ctx, inst, boss, st);
    if (boss.castRemaining <= 1e-6) landBar(ctx, inst, boss, st);
    return;
  }
  if (ctx.isStunned(boss) || boss.castingAbility !== null) return;
  // One bar at a time: the Embrace first (the group's damage check), then the Lament.
  if (st.embraceTimer <= 0 && startLadyBar(ctx, inst, boss, st, 'embrace')) return;
  if (st.lamentTimer <= 0) startLadyBar(ctx, inst, boss, st, 'lament');
}

/** The Embrace's cold lands once a second of the embrace's own clock. */
function embracePulse(st: LadyFightState): boolean {
  const e = st.embrace;
  if (!e || e.phase === 'descend') return false;
  const elapsed = e.phase === 'rise' ? e.t : T.embraceRise + e.t;
  const next = elapsed + DT;
  return Math.floor(next + 1e-6) > Math.floor(elapsed + 1e-6);
}
