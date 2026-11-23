// The Rite of the Unquiet's four Remembrance Candles (docs/design/dungeon-rework/
// hollow_crypt.md 5.4, act 2). When Morthen raises his ward the candles gutter
// out; the group breaks the Rite by RELIGHTING all four.
//
//   The relight   a candle's usable body stands at its pillar's foot (the
//                 `crypt_remembrance_candle` template: the trash engine's G3
//                 use, server-validated at the press, every tick and at the
//                 end). A player targets it and presses interact: a 4 s
//                 channel that a landed hit does NOT break (holdsThroughHits),
//                 while the Rite DRAINS the lighter's health every second of it
//                 (a share of their own maximum health, shadow from Morthen).
//                 The healer heals them through it. A step, a stun or death
//                 breaks it and nothing carries over: a broken relight starts
//                 again from the beginning, drains included.
//   Lit           the candle's object turns lit and its body leaves (nothing
//                 left to use there). The fourth shatters the ward (morthen.ts).
//   Heroic        Name the Dead: the Ledger names the order (the next candle's
//                 object is the named template, the one the renderer lights a
//                 beam from the Ledger to). Lighting any other candle snuffs
//                 the last one lit (it gutters again, its body back) and burns
//                 the lighter; the wrong candle stays dark.
//
// Cheese-proof by construction: the body exists only through the Rite; one
// player channels one candle at a time; reach, sight, the claim and the
// player's state are the G3 use's checks; a player the drain cannot touch
// (an Ice Block's stasis, an immunity) has the relight cancelled. An absorb
// shield on the lighter DOES pay the drain: a shield is the healer's answer,
// exactly like a heal (the owner's rule: the healer carries them through).
//
// Zero rng in every pick (the Name the Dead order is hashed); the only draws are
// the wrong candle's damage roll, in claim-player order.

import { MOBS } from '../../data';
import { createMob } from '../../entity';
import { kitHash } from '../../mob/trash_kit/targets';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import type { MorthenFightState } from './boss_state';
import {
  claimPlayers,
  dropEncounterBody,
  dropEncounterObject,
  mechanicDamage,
  spawnCryptObject,
} from './claim';
import {
  candleBodySpot,
  MORTHEN_CANDLE_ID,
  MORTHEN_CANDLE_LIT,
  MORTHEN_CANDLE_SNUFFED,
  MORTHEN_RELIGHT_CAST,
  MORTHEN_TUNING,
  RITE_CANDLE_DARK,
  RITE_CANDLE_LIT,
  RITE_CANDLE_NAMED,
  RITE_CANDLE_SPOTS,
} from './morthen_ids';

const T = MORTHEN_TUNING;

const heroicOf = (inst: InstanceSlot) => inst.difficulty === 'heroic';

/** The Ledger's order for a claim (a hashed permutation of the four candles,
 *  fixed for the boss: the same names every attempt of a run). Pure. */
export function nameTheDeadOrder(bossId: number, slot: number): number[] {
  const left = [0, 1, 2, 3];
  const out: number[] = [];
  let k = 0;
  while (left.length > 0) {
    const i = kitHash(bossId, slot * 31 + k * 7 + 3) % left.length;
    out.push(left[i]);
    left.splice(i, 1);
    k++;
  }
  return out;
}

/** The candle the Ledger names next (heroic), or -1 when the order is done. */
export function namedCandle(st: MorthenFightState): number {
  return st.order[st.litOrder.length] ?? -1;
}

/** Put a candle's usable body at its pillar's foot (held: never hostile,
 *  nothing can strike it). */
function spawnCandleBody(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  i: number,
): Entity | null {
  const template = MOBS[MORTHEN_CANDLE_ID];
  if (!template) return null;
  const o = ctx.instanceOriginOf(inst);
  const at = candleBodySpot(i);
  const body = createMob(
    ctx.nextId++,
    template,
    template.minLevel,
    ctx.groundPos(o.x + at.x, o.z + at.z),
  );
  const c = RITE_CANDLE_SPOTS[i];
  body.facing = Math.atan2(at.x - c.x, at.z - c.z);
  body.prevFacing = body.facing;
  body.encounterHeld = true;
  body.damageImmune = true;
  body.hostile = false;
  body.summonedAdd = true;
  body.tappedById = boss.tappedById;
  ctx.addEntity(body);
  inst.mobIds.push(body.id);
  return body;
}

/** The candle objects' looks: lit, the named one (heroic), or dark. */
function paintCandles(ctx: SimContext, inst: InstanceSlot, st: MorthenFightState): void {
  const named = heroicOf(inst) ? namedCandle(st) : -1;
  st.candles.forEach((c, i) => {
    const obj = ctx.entities.get(c.objectId);
    if (!obj) return;
    obj.templateId = c.lit ? RITE_CANDLE_LIT : i === named ? RITE_CANDLE_NAMED : RITE_CANDLE_DARK;
  });
}

/** The Rite begins: every candle gutters out and a usable body stands at each. */
export function gutterCandles(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: MorthenFightState,
): void {
  clearCandles(ctx, inst, st);
  st.order = heroicOf(inst) ? nameTheDeadOrder(boss.id, inst.slot) : [];
  st.litOrder = [];
  st.channels = [];
  for (let i = 0; i < RITE_CANDLE_SPOTS.length; i++) {
    const c = RITE_CANDLE_SPOTS[i];
    const obj = spawnCryptObject(ctx, inst, RITE_CANDLE_DARK, 'Remembrance Candle', c.x, c.z, 0, 1);
    const body = spawnCandleBody(ctx, inst, boss, i);
    st.candles.push({ objectId: obj.id, bodyId: body?.id ?? null, lit: false });
  }
  paintCandles(ctx, inst, st);
}

/** Candles lit so far. */
export function candlesLit(st: MorthenFightState): number {
  let n = 0;
  for (const c of st.candles) if (c.lit) n++;
  return n;
}

/** Light candle `i` for `by` (a completed relight). Returns true when it caught. */
export function lightCandle(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: MorthenFightState,
  i: number,
  by: Entity | null,
): boolean {
  const c = st.candles[i];
  if (!c || c.lit) return false;
  if (heroicOf(inst) && namedCandle(st) !== i) {
    nameTheDeadWrong(ctx, inst, boss, st, by);
    return false;
  }
  c.lit = true;
  if (c.bodyId !== null) dropEncounterBody(ctx, inst, null, c.bodyId);
  c.bodyId = null;
  st.litOrder.push(i);
  paintCandles(ctx, inst, st);
  ctx.emit({
    type: 'spellfx',
    sourceId: by?.id ?? boss.id,
    targetId: c.objectId,
    school: 'holy',
    fx: 'nova',
    ability: MORTHEN_CANDLE_LIT,
  });
  return true;
}

/** Heroic Name the Dead: the wrong candle. The last one lit gutters again
 *  (its body back at its foot) and the lighter burns. */
function nameTheDeadWrong(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: MorthenFightState,
  by: Entity | null,
): void {
  const last = st.litOrder.pop();
  if (last !== undefined) {
    const c = st.candles[last];
    c.lit = false;
    c.bodyId = spawnCandleBody(ctx, inst, boss, last)?.id ?? null;
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: c.objectId,
      school: 'shadow',
      fx: 'detonate',
      ability: MORTHEN_CANDLE_SNUFFED,
    });
  }
  paintCandles(ctx, inst, st);
  if (by && !by.dead) {
    ctx.dealDamage(
      boss,
      by,
      mechanicDamage(ctx, boss, T.wrongCandleMin, T.wrongCandleMax),
      false,
      'shadow',
      'Name the Dead',
      'hit',
      true,
    );
  }
}

/** Is `p` channelling a relight on one of this Rite's candles? The candle's index, else -1. */
function relighting(st: MorthenFightState, p: Entity): number {
  if (p.castingAbility !== MORTHEN_RELIGHT_CAST || p.castTargetId === null) return -1;
  return st.candles.findIndex((c) => c.bodyId === p.castTargetId);
}

/** One tick of the candles through the Rite: the relights that completed, and
 *  the drain on everyone channelling one. */
export function stepCandles(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: MorthenFightState,
): void {
  // Completed relights (the G3 use records who finished it), candle order.
  for (let i = 0; i < st.candles.length; i++) {
    const c = st.candles[i];
    if (c.bodyId === null) continue;
    const body = ctx.entities.get(c.bodyId);
    if (!body || body.kitUseCompletedBy === undefined) continue;
    const by = ctx.entities.get(body.kitUseCompletedBy) ?? null;
    body.kitUseCompletedBy = undefined;
    lightCandle(ctx, inst, boss, st, i, by);
  }
  // The drain: a bite at every half-second mark past each whole second of the
  // bar (0.5, 1.5, 2.5, 3.5 s: four bites in the 4 s channel).
  const pct = heroicOf(inst) ? T.relightDrainPctHeroic : T.relightDrainPct;
  const keep: MorthenFightState['channels'] = [];
  for (const p of claimPlayers(ctx, inst)) {
    if (relighting(st, p) < 0) continue;
    // The drain is the price: a body it cannot touch lights nothing.
    if (p.damageImmune || p.auras.some((a) => a.kind === 'stasis')) {
      ctx.cancelCast(p);
      continue;
    }
    const elapsed = Math.max(0, p.castTotal - p.castRemaining);
    let ch = st.channels.find((x) => x.playerId === p.id);
    // A bar that shows less than last time is a new channel: the price again.
    if (!ch || elapsed + 1e-6 < ch.seen) ch = { playerId: p.id, drains: 0, seen: elapsed };
    ch.seen = elapsed;
    const due = Math.min(T.relightChannel, Math.floor(elapsed + 0.5 + 1e-6));
    while (ch.drains < due && !p.dead) {
      ch.drains++;
      ctx.dealDamage(
        boss,
        p,
        Math.max(1, Math.round(p.maxHp * pct)),
        false,
        'shadow',
        "Candle's Price",
        'hit',
        true,
      );
    }
    keep.push(ch);
  }
  st.channels = keep;
}

/** Take every candle object and body away (a reset, the kill). */
export function clearCandles(ctx: SimContext, inst: InstanceSlot, st: MorthenFightState): void {
  for (const c of st.candles) {
    if (c.bodyId !== null) dropEncounterBody(ctx, inst, null, c.bodyId);
    dropEncounterObject(ctx, inst, c.objectId);
  }
  st.candles = [];
  st.channels = [];
}

/** The Rite is broken: the bodies leave, the lit candles burn on. */
export function retireCandleBodies(
  ctx: SimContext,
  inst: InstanceSlot,
  st: MorthenFightState,
): void {
  for (const c of st.candles) {
    if (c.bodyId !== null) dropEncounterBody(ctx, inst, null, c.bodyId);
    c.bodyId = null;
  }
  st.channels = [];
}
