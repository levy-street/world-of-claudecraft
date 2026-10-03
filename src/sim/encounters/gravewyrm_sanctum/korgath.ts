// Korgath the Bound (docs/design/dungeon-rework/gravewyrm_sanctum.md section
// 6.1, G23 restraint parts): the Smith's foreman, the living lock on the seal,
// chained to the four seal pillars of the Lock Terrace. Every chain the group
// strikes off makes him easier to hurt and frees one more part of him.
//
//   Lockbound          each intact chain cuts the damage he takes by 20 percent
//                      (a `buff_dr` aura whose value tracks the chains).
//   Seal Shackles      one attackable stationary part at each pillar's foot
//                      (about 1,500 health); its death breaks that chain.
//   Hammer chain       frees Maul Arc: every 10 s a 1.2 s bar, then a frontal
//                      180 degree cleave 8 yd deep at 1.3 times his swing.
//   Tongs chain        frees Chain Flail: every 14 s a 2 s bar paints a lane
//                      25 yd at a player (the farthest from him who is not the
//                      tank), then the whip lands on everyone in it: 200 to 240.
//   Anvil chain        until it breaks he cannot leave 10 yd of the terrace's
//                      middle; broken, it frees Threshold Charge: every 18 s a
//                      2 s bar paints a lane at the farthest player, then he
//                      charges down it: 180 to 220 and a knockback.
//   Bellows chain      frees Foreman's Bellow: every 20 s a 2 s bar, then 100
//                      to 120 on everyone and a 6 yd shove away from him.
//   Strain             always while a chain holds: every 20 s a 2 s bar, then
//                      a ring 8 yd round each INTACT pillar: 180 to 220 and a
//                      knockback.
//   Shuddering Stomp   kept, now telegraphed: every 12 s a 1.5 s bar, then a
//                      10 yd ring round him: 190 to 285.
//   Enrage             kept (the template's), shown with a marker aura.
//   Heroic Re-rivet    25 s after a chain breaks a Broodsworn Goadsmith climbs
//                      over the rim behind its pillar, walks to the shackle and
//                      channels 6 s (interrupt or kill him); a re-riveted chain
//                      brings back a living shackle and its 20 percent, but the
//                      freed ability stays.
//   Heroic Last Link   while exactly one chain remains, Strain every 10 s.
//
// Each chain broken raises the Calving Face's crack step (story.ts reads
// korgathChainsBroken). His deeds: A Kinder End (all four broken at his death)
// and, on heroic, The Lock Holds (two chains never broken).
//
// Deterministic: no pick is rolled (the lanes go to the farthest player, ties
// to the lower id; the rings and cones take everyone inside); the only rng
// draws are the damage rolls, in claim-player order. Every visible state rides
// existing entity fields (cast bars with castTargetId and a locked facing, the
// Lockbound and enrage auras, the chain objects' template ids, `nova` spellfx
// at a break or a rivet), so the online client mirrors it with no wire change.

import { KORGATH_SPOT, LOCK_TERRACE, SEAL_PILLARS } from '../../content/gravewyrm_sanctum_layout';
import { applyKnockback } from '../../knockback';
import { inLane } from '../../mob/trash_kit/lane';
import { spawnKitAdd } from '../../mob/trash_kit/spawn';
import { inCone } from '../../mob/trash_kit/targets';
import { emitMobYell } from '../../mob/yells';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { armorReduction, DT, dist2d, type Entity } from '../../types';
import { walkEncounterActorTo } from '../scripted_walk';
import { dropEncounterBody } from '../sunken_bastion/claim';
import {
  claimPlayers,
  clearCastIf,
  dropAuraById,
  dropEncounterObject,
  grantClaimDeed,
  holdPlanted,
  mechanicDamage,
  spawnSanctumObject,
  startBar,
} from './claim';
import {
  GOADSMITH_ID,
  GOADSMITH_RERIVET,
  KORGATH_BELLOW,
  KORGATH_CHAIN_BREAK,
  KORGATH_CHAIN_FLAIL,
  KORGATH_ENRAGE,
  KORGATH_LOCKBOUND,
  KORGATH_MAUL_ARC,
  KORGATH_RERIVETED,
  KORGATH_STOMP,
  KORGATH_STRAIN,
  KORGATH_THRESHOLD_CHARGE,
  SANCTUM_DEED_IDS,
  SEAL_SHACKLE_IDS,
  SEAL_TOOLS,
  type SealTool,
  sealChainTemplate,
  KORGATH_TUNING as T,
} from './ids';
import type { KorgathChain, KorgathFightState } from './korgath_state';

/** Korgath's lines (re-localized by src/ui/sim_i18n.ts): he rages at the pull
 *  and grows more lucid with each chain struck off. */
export const KORGATH_LINES = {
  pull: 'The lock holds! No one passes the foreman!',
  chain1: 'Who... who holds the line?',
  chain2: 'The quench. Does it hold?',
  chain3: 'I remember the forge... I remember the seal...',
  free: 'The lock is open. Maker, forgive your foreman.',
} as const;
export type KorgathLine = keyof typeof KORGATH_LINES;

/** The broken-chain lines, by how many chains are down. */
const CHAIN_LINES: Readonly<Record<number, KorgathLine>> = {
  1: 'chain1',
  2: 'chain2',
  3: 'chain3',
  4: 'free',
};

/** His drawn body radius: the cleave and the stomp reach from his edge. */
const BODY = 2.5;
/** The bar ids he runs himself. */
const BARS: readonly string[] = [
  KORGATH_MAUL_ARC,
  KORGATH_CHAIN_FLAIL,
  KORGATH_THRESHOLD_CHARGE,
  KORGATH_BELLOW,
  KORGATH_STRAIN,
  KORGATH_STOMP,
];
const SHACKLE_TEMPLATES: ReadonlySet<string> = new Set(Object.values(SEAL_SHACKLE_IDS));

/** The pillar of a tool (SEAL_PILLARS order). */
function pillarOf(tool: SealTool): (typeof SEAL_PILLARS)[number] {
  return SEAL_PILLARS[SEAL_TOOLS.indexOf(tool)];
}

function freshState(): KorgathFightState {
  return {
    kind: 'korgath',
    engaged: false,
    finished: false,
    chains: SEAL_TOOLS.map((tool) => ({
      tool,
      broken: false,
      everBroken: false,
      shackleId: null,
      objectId: null,
      rivetIn: null,
      rivet: null,
    })),
    maulTimer: 99,
    flailTimer: 99,
    chargeTimer: 99,
    bellowTimer: 99,
    strainTimer: T.strainFirst,
    stompTimer: T.stompFirst,
    maulYaw: null,
    lane: null,
    charge: null,
    plantedAt: null,
    lines: [],
    enraged: false,
    casts: 0,
  };
}

/** Korgath's state when it exists (null for any other body). */
export function korgathState(boss: Entity): KorgathFightState | null {
  return boss.sanctumFight?.kind === 'korgath' ? boss.sanctumFight : null;
}

/** How many of his chains are broken right now. */
export function chainsDown(st: KorgathFightState): number {
  return st.chains.filter((c) => c.broken).length;
}

/** How many of his chains the run has broken this pull (the Calving Face's
 *  steps 2 to 5 read it), 0 with no Korgath state in the claim. */
export function korgathChainsBroken(ctx: SimContext, inst: InstanceSlot): number {
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (e?.kind !== 'mob') continue;
    const st = korgathState(e);
    if (st) return st.chains.filter((c) => c.everBroken).length;
  }
  return 0;
}

/** The deeds his death earns (pure): A Kinder End with all four broken, The
 *  Lock Holds on heroic with at least two chains never broken. */
export function korgathDeeds(st: KorgathFightState, heroic: boolean): string[] {
  const out: string[] = [];
  if (st.chains.every((c) => c.broken)) out.push(SANCTUM_DEED_IDS.korgathAllChains);
  if (heroic && st.chains.filter((c) => !c.everBroken).length >= 2)
    out.push(SANCTUM_DEED_IDS.korgathStillBound);
  return out;
}

/** Is the ability a chain frees loose? */
function freed(st: KorgathFightState, tool: SealTool): boolean {
  return st.chains[SEAL_TOOLS.indexOf(tool)].everBroken;
}

function heroicClaim(inst: InstanceSlot): boolean {
  return inst.difficulty === 'heroic';
}

function say(ctx: SimContext, boss: Entity, st: KorgathFightState, key: KorgathLine): void {
  if (st.lines.includes(key)) return;
  st.lines.push(key);
  emitMobYell(ctx, boss, KORGATH_LINES[key], 120);
}

// ---- the shackles and the chain objects ----------------------------------------

/** Pin a shackle body in place: held inert (not attackable) outside his fight,
 *  hostile and locked onto the fight while it runs. */
function holdShackle(shackle: Entity, boss: Entity, live: boolean): void {
  if (!live || boss.aggroTargetId === null) {
    shackle.encounterHeld = true;
    return;
  }
  shackle.encounterHeld = false;
  shackle.hostile = true;
  shackle.inCombat = true;
  shackle.aiState = 'attack';
  shackle.aggroTargetId = boss.aggroTargetId;
  shackle.swingTimer = 999;
  shackle.chaseStall = 0;
  shackle.evadeStall = 0;
}

/** Raise a fresh Seal Shackle at its pillar's shackle spot. */
function raiseShackle(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  chain: KorgathChain,
): Entity | null {
  const o = ctx.instanceOriginOf(inst);
  const spot = pillarOf(chain.tool).shackle;
  const shackle = spawnKitAdd(
    ctx,
    inst,
    boss,
    SEAL_SHACKLE_IDS[chain.tool],
    o.x + spot.x,
    o.z + spot.z,
    null,
  );
  if (!shackle) return null;
  const yaw = Math.atan2(KORGATH_SPOT.x - spot.x, KORGATH_SPOT.z - spot.z);
  shackle.facing = yaw;
  shackle.prevFacing = yaw;
  shackle.spawnPos = { ...shackle.pos };
  shackle.idleStationary = true;
  holdShackle(shackle, boss, false);
  chain.shackleId = shackle.id;
  return shackle;
}

/** Lay out the chains for a pull: four shackles, four intact chain objects. */
function setupChains(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorgathFightState,
): void {
  const o = ctx.instanceOriginOf(inst);
  for (const chain of st.chains) {
    const spot = pillarOf(chain.tool).shackle;
    const obj = spawnSanctumObject(
      ctx,
      inst,
      sealChainTemplate(chain.tool, 'intact'),
      'Seal Chain',
      o.x + spot.x,
      o.z + spot.z,
      1,
    );
    obj.facing = Math.atan2(KORGATH_SPOT.x - spot.x, KORGATH_SPOT.z - spot.z);
    obj.prevFacing = obj.facing;
    chain.objectId = obj.id;
    raiseShackle(ctx, inst, boss, chain);
  }
}

/** Keep the Lockbound aura's value on the intact chains (gone at none). */
function syncLockbound(ctx: SimContext, boss: Entity, st: KorgathFightState): void {
  const intact = st.chains.length - chainsDown(st);
  const value = intact * T.lockboundPerChain;
  const aura = boss.auras.find((a) => a.id === KORGATH_LOCKBOUND);
  if (intact === 0 || !st.engaged) {
    if (aura) dropAuraById(boss, KORGATH_LOCKBOUND);
    return;
  }
  if (aura) {
    aura.value = value;
    aura.stacks = intact;
    return;
  }
  ctx.applyAura(boss, {
    id: KORGATH_LOCKBOUND,
    name: 'Lockbound',
    kind: 'buff_dr',
    remaining: 3600,
    duration: 3600,
    permanent: true,
    value,
    stacks: intact,
    sourceId: boss.id,
    school: 'physical',
    undispellable: true,
  });
}

/** A chain breaks: its object goes slack, his Lockbound drops a share, and he
 *  speaks (exported for the dev trigger). */
export function breakChain(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorgathFightState,
  tool: SealTool,
): boolean {
  const chain = st.chains[SEAL_TOOLS.indexOf(tool)];
  if (chain.broken) return false;
  const shackle = chain.shackleId !== null ? ctx.entities.get(chain.shackleId) : undefined;
  // The dev trigger breaks a standing shackle: it goes with its chain.
  if (shackle && !shackle.dead) dropEncounterBody(ctx, inst, boss, shackle.id);
  chain.shackleId = null;
  const fresh = !chain.everBroken;
  chain.broken = true;
  chain.everBroken = true;
  if (fresh) {
    // A freed ability starts its clock when its chain first comes off.
    if (tool === 'hammer') st.maulTimer = T.maulFirst;
    if (tool === 'tongs') st.flailTimer = T.flailFirst;
    if (tool === 'anvil') st.chargeTimer = T.chargeFirst;
    if (tool === 'bellows') st.bellowTimer = T.bellowFirst;
  }
  if (heroicClaim(inst)) chain.rivetIn = T.rerivetDelay;
  const obj = chain.objectId !== null ? ctx.entities.get(chain.objectId) : undefined;
  if (obj) {
    obj.templateId = sealChainTemplate(tool, 'broken');
    ctx.emit({
      type: 'spellfx',
      sourceId: obj.id,
      targetId: obj.id,
      school: 'frost',
      fx: 'nova',
      ability: KORGATH_CHAIN_BREAK,
    });
  }
  syncLockbound(ctx, boss, st);
  const line = CHAIN_LINES[chainsDown(st)];
  if (line) say(ctx, boss, st, line);
  return true;
}

/** A Re-rivet lands: a living shackle again, and its 20 percent is back. */
function rerivet(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorgathFightState,
  chain: KorgathChain,
): void {
  chain.broken = false;
  chain.rivetIn = null;
  const shackle = raiseShackle(ctx, inst, boss, chain);
  if (shackle) holdShackle(shackle, boss, st.engaged);
  const obj = chain.objectId !== null ? ctx.entities.get(chain.objectId) : undefined;
  if (obj) {
    obj.templateId = sealChainTemplate(chain.tool, 'intact');
    ctx.emit({
      type: 'spellfx',
      sourceId: obj.id,
      targetId: obj.id,
      school: 'fire',
      fx: 'nova',
      ability: KORGATH_RERIVETED,
    });
  }
  syncLockbound(ctx, boss, st);
}

/** Heroic Re-rivet: a Goadsmith climbs over the rim behind the pillar and walks
 *  to its shackle (exported for the dev trigger). */
export function sendGoadsmith(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorgathFightState,
  tool: SealTool,
): boolean {
  const chain = st.chains[SEAL_TOOLS.indexOf(tool)];
  if (!chain.broken || chain.rivet) return false;
  chain.rivetIn = null;
  const o = ctx.instanceOriginOf(inst);
  const p = pillarOf(tool);
  // The rim: 3 yd past the pillar, away from the middle (still on the terrace).
  const len = Math.hypot(p.x - LOCK_TERRACE.x, p.z - LOCK_TERRACE.z);
  const ux = (p.x - LOCK_TERRACE.x) / len;
  const uz = (p.z - LOCK_TERRACE.z) / len;
  const g = spawnKitAdd(
    ctx,
    inst,
    boss,
    GOADSMITH_ID,
    o.x + p.x + ux * 3,
    o.z + p.z + uz * 3,
    null,
  );
  if (!g) return false;
  g.hostile = true;
  g.inCombat = true;
  g.aiState = 'chase';
  g.aggroTargetId = boss.aggroTargetId;
  chain.rivet = { goadsmithId: g.id, at: { ...g.pos }, phase: 'run' };
  return true;
}

/** One tick of a Re-rivet in progress: walk, channel, land; an interrupt, a
 *  stun or his death spoils it, and he joins the fight. */
function stepRivet(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorgathFightState,
  chain: KorgathChain,
): void {
  const r = chain.rivet;
  if (!r) return;
  const g = ctx.entities.get(r.goadsmithId);
  if (!g || g.dead || !chain.broken) {
    chain.rivet = null;
    return;
  }
  const o = ctx.instanceOriginOf(inst);
  const spot = pillarOf(chain.tool).shackle;
  if (r.phase === 'run') {
    // Hold him on his own line (the mob AI would chase a player instead).
    holdPlanted(ctx, g, r.at);
    if (g.castingAbility !== null) clearCastIf(g, g.castingAbility);
    const dest = ctx.groundPos(o.x + spot.x, o.z + spot.z);
    const arrived = walkEncounterActorTo(ctx, g, dest) || dist2d(g.pos, dest) < 1.2;
    r.at = { ...g.pos };
    g.swingTimer = Math.max(g.swingTimer, 0.5);
    if (!arrived) return;
    r.phase = 'channel';
    const obj = chain.objectId !== null ? ctx.entities.get(chain.objectId) : undefined;
    startBar(g, GOADSMITH_RERIVET, T.rerivetChannel, obj?.id ?? null, true);
    g.facing = Math.atan2(KORGATH_SPOT.x - spot.x, KORGATH_SPOT.z - spot.z);
    return;
  }
  // Channelling: an interrupt (cancelCast) or a stun ends it.
  if (g.castingAbility !== GOADSMITH_RERIVET || ctx.isStunned(g)) {
    clearCastIf(g, GOADSMITH_RERIVET);
    chain.rivet = null;
    return;
  }
  holdPlanted(ctx, g, r.at);
  g.swingTimer = Math.max(g.swingTimer, 0.5);
  g.castRemaining = Math.max(0, g.castRemaining - DT);
  if (g.castRemaining > 0) return;
  clearCastIf(g, GOADSMITH_RERIVET);
  chain.rivet = null;
  rerivet(ctx, inst, boss, st, chain);
}

// ---- the mechanics ---------------------------------------------------------------

/** The living player standing farthest from `from` (ties to the lower id),
 *  never `not` while anyone else stands. */
function farthest(players: readonly Entity[], from: Entity, not: number | null): Entity | null {
  let best: Entity | null = null;
  let bestD = -1;
  for (const p of players) {
    if (p.dead || p.id === not) continue;
    const d = dist2d(p.pos, from.pos);
    if (d > bestD + 1e-9) {
      best = p;
      bestD = d;
    }
  }
  return best ?? players.find((p) => !p.dead) ?? null;
}

function begin(
  boss: Entity,
  st: KorgathFightState,
  castId: string,
  seconds: number,
  target: number | null,
): void {
  st.casts++;
  st.plantedAt = { ...boss.pos };
  startBar(boss, castId, seconds, target);
}

function busy(boss: Entity, st: KorgathFightState): boolean {
  return boss.castingAbility !== null || st.charge !== null;
}

export function startMaulArc(boss: Entity, st: KorgathFightState): boolean {
  if (busy(boss, st)) return false;
  st.maulYaw = boss.facing;
  st.maulTimer = T.maulEvery;
  begin(boss, st, KORGATH_MAUL_ARC, T.maulCast, null);
  return true;
}

/** A lane bar (Chain Flail or Threshold Charge) at `victim`. */
function startLane(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorgathFightState,
  castId: string,
  victim: Entity,
): void {
  const o = ctx.instanceOriginOf(inst);
  const flail = castId === KORGATH_CHAIN_FLAIL;
  const yaw = Math.atan2(victim.pos.x - boss.pos.x, victim.pos.z - boss.pos.z);
  st.lane = {
    x: boss.pos.x - o.x,
    z: boss.pos.z - o.z,
    yaw,
    length: flail ? T.flailLength : T.chargeLength,
    halfWidth: flail ? T.flailHalfWidth : T.chargeHalfWidth,
  };
  boss.facing = yaw;
  begin(boss, st, castId, flail ? T.flailCast : T.chargeCast, victim.id);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: victim.id,
    school: 'physical',
    fx: 'windup',
    ability: castId,
  });
}

export function startChainFlail(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorgathFightState,
): boolean {
  if (busy(boss, st)) return false;
  const victim = farthest(claimPlayers(ctx, inst), boss, boss.aggroTargetId);
  if (!victim) return false;
  st.flailTimer = T.flailEvery;
  startLane(ctx, inst, boss, st, KORGATH_CHAIN_FLAIL, victim);
  return true;
}

export function startThresholdCharge(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorgathFightState,
): boolean {
  if (busy(boss, st)) return false;
  const victim = farthest(claimPlayers(ctx, inst), boss, null);
  if (!victim) return false;
  st.chargeTimer = T.chargeEvery;
  startLane(ctx, inst, boss, st, KORGATH_THRESHOLD_CHARGE, victim);
  return true;
}

export function startBellow(boss: Entity, st: KorgathFightState): boolean {
  if (busy(boss, st)) return false;
  st.bellowTimer = T.bellowEvery;
  begin(boss, st, KORGATH_BELLOW, T.bellowCast, null);
  return true;
}

/** Strain's cadence: every 20 s, every 10 s on heroic with one chain left. */
export function strainEvery(inst: InstanceSlot, st: KorgathFightState): number {
  return heroicClaim(inst) && st.chains.length - chainsDown(st) === 1
    ? T.strainEveryLastLink
    : T.strainEvery;
}

export function startStrain(inst: InstanceSlot, boss: Entity, st: KorgathFightState): boolean {
  if (busy(boss, st)) return false;
  if (chainsDown(st) >= st.chains.length) return false;
  st.strainTimer = strainEvery(inst, st);
  begin(boss, st, KORGATH_STRAIN, T.strainCast, null);
  return true;
}

export function startStomp(boss: Entity, st: KorgathFightState): boolean {
  if (busy(boss, st)) return false;
  st.stompTimer = T.stompEvery;
  begin(boss, st, KORGATH_STOMP, T.stompCast, null);
  return true;
}

/** Enrage under 30 percent: the template's own enrage does the damage; this
 *  marker aura shows it. */
export function enrageKorgath(ctx: SimContext, boss: Entity, st: KorgathFightState): void {
  st.enraged = true;
  ctx.applyAura(boss, {
    id: KORGATH_ENRAGE,
    name: 'Enrage',
    kind: 'buff_dmg_done',
    remaining: 3600,
    duration: 3600,
    permanent: true,
    value: 0,
    sourceId: boss.id,
    school: 'physical',
    undispellable: true,
  });
}

function nova(ctx: SimContext, boss: Entity, castId: string): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'physical',
    fx: 'nova',
    ability: castId,
  });
}

function hit(
  ctx: SimContext,
  boss: Entity,
  p: Entity,
  min: number,
  max: number,
  name: string,
): void {
  ctx.dealDamage(
    boss,
    p,
    mechanicDamage(ctx, boss, min, max),
    false,
    'physical',
    name,
    'hit',
    true,
  );
}

/** Maul Arc lands: everyone in the frontal half-circle takes 1.3 swings. */
function landMaulArc(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorgathFightState,
): number {
  const yaw = st.maulYaw ?? boss.facing;
  st.maulYaw = null;
  nova(ctx, boss, KORGATH_MAUL_ARC);
  let n = 0;
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead || !inCone(boss.pos, yaw, p.pos, T.maulRange + BODY, T.maulArcDeg)) continue;
    const swing = ctx.rng.range(boss.weapon.min, boss.weapon.max) * T.maulMeleeMult;
    const landed = Math.max(1, Math.round(swing * (1 - armorReduction(p.stats.armor, boss.level))));
    ctx.dealDamage(boss, p, landed, false, 'physical', 'Maul Arc', 'hit', true);
    n++;
  }
  return n;
}

/** A lane bar ran out: the whip (or the charge) lands on everyone in it. */
function landLane(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorgathFightState,
  castId: string,
): number {
  const lane = st.lane;
  st.lane = null;
  if (!lane) return 0;
  const charge = castId === KORGATH_THRESHOLD_CHARGE;
  if (charge) st.charge = { x: lane.x, z: lane.z, yaw: lane.yaw, length: lane.length, t: 0 };
  nova(ctx, boss, castId);
  const o = ctx.instanceOriginOf(inst);
  let n = 0;
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead) continue;
    const px = p.pos.x - o.x;
    const pz = p.pos.z - o.z;
    if (!inLane(lane.x, lane.z, lane.yaw, lane.length + BODY, lane.halfWidth, px, pz)) continue;
    if (charge) hit(ctx, boss, p, T.chargeMin, T.chargeMax, 'Threshold Charge');
    else hit(ctx, boss, p, T.flailMin, T.flailMax, 'Chain Flail');
    if (charge && !p.dead) applyKnockback(ctx, boss, p, T.chargeKnockback);
    n++;
  }
  return n;
}

/** Yards from instance-local (x, z) along `yaw` before 2 yd short of the
 *  terrace's rim (the charge never carries him off it). */
export function chargeRoom(x: number, z: number, yaw: number): number {
  const ax = Math.sin(yaw);
  const az = Math.cos(yaw);
  const dx = x - LOCK_TERRACE.x;
  const dz = z - LOCK_TERRACE.z;
  const r = LOCK_TERRACE.r - 2;
  // |d + t a| = r, the forward root.
  const b = dx * ax + dz * az;
  const c = dx * dx + dz * dz - r * r;
  const disc = b * b - c;
  return disc < 0 ? 0 : Math.max(0, -b + Math.sqrt(disc));
}

/** The charge in flight: run him down his lane. */
function stepCharge(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorgathFightState,
): void {
  const c = st.charge;
  if (!c) return;
  c.t += DT;
  const k = Math.min(1, c.t / T.chargeRun);
  const o = ctx.instanceOriginOf(inst);
  const len = Math.min(c.length * k, chargeRoom(c.x, c.z, c.yaw));
  holdPlanted(
    ctx,
    boss,
    ctx.groundPos(o.x + c.x + Math.sin(c.yaw) * len, o.z + c.z + Math.cos(c.yaw) * len),
  );
  boss.facing = c.yaw;
  boss.swingTimer = Math.max(boss.swingTimer, 0.6);
  if (k >= 1) st.charge = null;
}

/** Foreman's Bellow: everyone hit and shoved away from him. */
function landBellow(ctx: SimContext, inst: InstanceSlot, boss: Entity): number {
  nova(ctx, boss, KORGATH_BELLOW);
  let n = 0;
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead) continue;
    hit(ctx, boss, p, T.bellowMin, T.bellowMax, "Foreman's Bellow");
    if (!p.dead) applyKnockback(ctx, boss, p, T.bellowShove);
    n++;
  }
  return n;
}

/** Strain: a ring round each INTACT pillar. Returns how many it struck. */
function landStrain(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorgathFightState,
): number {
  nova(ctx, boss, KORGATH_STRAIN);
  const o = ctx.instanceOriginOf(inst);
  let n = 0;
  for (const chain of st.chains) {
    if (chain.broken) continue;
    const pillar = pillarOf(chain.tool);
    const at = ctx.groundPos(o.x + pillar.x, o.z + pillar.z);
    for (const p of claimPlayers(ctx, inst)) {
      if (p.dead || dist2d(p.pos, at) > T.strainRadius) continue;
      hit(ctx, boss, p, T.strainMin, T.strainMax, 'Strain');
      // Thrown away from the pillar, not from him.
      if (!p.dead) applyKnockback(ctx, { ...boss, pos: at } as Entity, p, T.strainKnockback);
      n++;
    }
  }
  return n;
}

/** Shuddering Stomp: a ring round him. */
function landStomp(ctx: SimContext, inst: InstanceSlot, boss: Entity): number {
  nova(ctx, boss, KORGATH_STOMP);
  let n = 0;
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead || dist2d(p.pos, boss.pos) > T.stompRadius + BODY) continue;
    hit(ctx, boss, p, T.stompMin, T.stompMax, 'Shuddering Stomp');
    n++;
  }
  return n;
}

/** Until the Anvil chain breaks he cannot leave the middle of the terrace. */
function leash(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: KorgathFightState): void {
  if (st.chains[SEAL_TOOLS.indexOf('anvil')].broken) return;
  const o = ctx.instanceOriginOf(inst);
  const cx = o.x + KORGATH_SPOT.x;
  const cz = o.z + KORGATH_SPOT.z;
  const d = Math.hypot(boss.pos.x - cx, boss.pos.z - cz);
  if (d <= T.leashRadius) return;
  const k = T.leashRadius / d;
  holdPlanted(ctx, boss, ctx.groundPos(cx + (boss.pos.x - cx) * k, cz + (boss.pos.z - cz) * k));
}

// ---- the pull ----------------------------------------------------------------------

/** His fight state, laid out on his first tick (the chains wait for the pull). */
export function korgathFight(ctx: SimContext, inst: InstanceSlot, boss: Entity): KorgathFightState {
  const st = korgathState(boss);
  if (st) return st;
  const fresh = freshState();
  boss.sanctumFight = fresh;
  setupChains(ctx, inst, boss, fresh);
  return fresh;
}

/** Every Seal Shackle body in the claim (a re-riveted chain raised a second). */
function shackleBodies(ctx: SimContext, inst: InstanceSlot): number[] {
  return inst.mobIds.filter((id) => {
    const e = ctx.entities.get(id);
    return e !== undefined && SHACKLE_TEMPLATES.has(e.templateId);
  });
}

/** The pull ended (an evade or a wipe): every chain, shackle and Goadsmith
 *  goes; the next tick lays the lock out again. */
function endKorgathFight(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorgathFightState,
): void {
  clearCastIf(boss, ...BARS);
  for (const chain of st.chains) {
    if (chain.rivet) dropEncounterBody(ctx, inst, boss, chain.rivet.goadsmithId);
    if (chain.objectId !== null) dropEncounterObject(ctx, inst, chain.objectId);
  }
  for (const id of shackleBodies(ctx, inst)) dropEncounterBody(ctx, inst, boss, id);
  dropAuraById(boss, KORGATH_LOCKBOUND);
  dropAuraById(boss, KORGATH_ENRAGE);
  boss.sanctumFight = undefined;
}

/** He fell: the deeds, the last line, the chains slack, the shackles gone. */
function finishKorgath(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: KorgathFightState,
): void {
  st.finished = true;
  clearCastIf(boss, ...BARS);
  for (const id of korgathDeeds(st, heroicClaim(inst))) grantClaimDeed(ctx, inst, id);
  say(ctx, boss, st, 'free');
  for (const chain of st.chains) {
    if (chain.rivet) {
      const g = ctx.entities.get(chain.rivet.goadsmithId);
      if (g) clearCastIf(g, GOADSMITH_RERIVET);
      chain.rivet = null;
    }
    chain.rivetIn = null;
    chain.shackleId = null;
    const obj = chain.objectId !== null ? ctx.entities.get(chain.objectId) : undefined;
    if (obj) obj.templateId = sealChainTemplate(chain.tool, 'broken');
  }
  for (const id of shackleBodies(ctx, inst)) dropEncounterBody(ctx, inst, boss, id);
  dropAuraById(boss, KORGATH_LOCKBOUND);
}

/** One tick of Korgath's fight (after the mob AI). */
export function tickKorgath(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  engaged: boolean,
): void {
  const st0 = korgathState(boss);
  if (boss.dead) {
    if (st0 && !st0.finished) finishKorgath(ctx, inst, boss, st0);
    return;
  }
  if (!engaged) {
    if (st0?.engaged) {
      endKorgathFight(ctx, inst, boss, st0);
      return;
    }
    // Walking home after a wipe: the lock is laid out once he is back (the
    // reset at his spawn despawns his summoned adds, the shackles with them).
    if (boss.aiState === 'evade') return;
    // Before the pull: the lock is laid out and the shackles wait, untouchable.
    // A shackle body lost while he was out of his fight is raised again, so a
    // pull never starts on a chain nobody broke.
    const st = korgathFight(ctx, inst, boss);
    for (const chain of st.chains) {
      const s = chain.shackleId !== null ? ctx.entities.get(chain.shackleId) : undefined;
      if (s && !s.dead) holdShackle(s, boss, false);
      else if (!chain.broken) raiseShackle(ctx, inst, boss, chain);
    }
    return;
  }
  const st = korgathFight(ctx, inst, boss);
  if (!st.engaged) {
    st.engaged = true;
    say(ctx, boss, st, 'pull');
  }
  // The shackles: locked onto the fight; a fallen one breaks its chain.
  for (const chain of st.chains) {
    if (chain.broken) continue;
    const s = chain.shackleId !== null ? ctx.entities.get(chain.shackleId) : undefined;
    if (!s || s.dead) breakChain(ctx, inst, boss, st, chain.tool);
    else holdShackle(s, boss, true);
  }
  syncLockbound(ctx, boss, st);
  // Heroic Re-rivet.
  for (const chain of st.chains) {
    if (chain.rivet) stepRivet(ctx, inst, boss, st, chain);
    else if (chain.rivetIn !== null && chain.broken) {
      chain.rivetIn -= DT;
      if (chain.rivetIn <= 1e-9) sendGoadsmith(ctx, inst, boss, st, chain.tool);
    }
  }
  if (!st.enraged && boss.enraged) enrageKorgath(ctx, boss, st);
  // Every clock runs through the other bars.
  st.strainTimer -= DT;
  st.stompTimer -= DT;
  if (freed(st, 'hammer')) st.maulTimer -= DT;
  if (freed(st, 'tongs')) st.flailTimer -= DT;
  if (freed(st, 'anvil')) st.chargeTimer -= DT;
  if (freed(st, 'bellows')) st.bellowTimer -= DT;
  if (st.charge) {
    stepCharge(ctx, inst, boss, st);
    return;
  }
  leash(ctx, inst, boss, st);
  const bar = boss.castingAbility;
  if (bar !== null && BARS.includes(bar)) {
    if (st.plantedAt) holdPlanted(ctx, boss, st.plantedAt);
    if (bar === KORGATH_MAUL_ARC && st.maulYaw !== null) boss.facing = st.maulYaw;
    if ((bar === KORGATH_CHAIN_FLAIL || bar === KORGATH_THRESHOLD_CHARGE) && st.lane)
      boss.facing = st.lane.yaw;
    boss.swingTimer = Math.max(boss.swingTimer, 0.6);
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    if (boss.castRemaining > 0) return;
    clearCastIf(boss, bar);
    st.plantedAt = null;
    if (bar === KORGATH_MAUL_ARC) landMaulArc(ctx, inst, boss, st);
    else if (bar === KORGATH_CHAIN_FLAIL || bar === KORGATH_THRESHOLD_CHARGE)
      landLane(ctx, inst, boss, st, bar);
    else if (bar === KORGATH_BELLOW) landBellow(ctx, inst, boss);
    else if (bar === KORGATH_STRAIN) landStrain(ctx, inst, boss, st);
    else landStomp(ctx, inst, boss);
    return;
  }
  if (bar !== null || ctx.isStunned(boss)) return;
  st.plantedAt = null;
  // One bar at a time, the most dangerous first when several are due.
  if (st.strainTimer <= 0 && chainsDown(st) < st.chains.length) startStrain(inst, boss, st);
  else if (freed(st, 'anvil') && st.chargeTimer <= 0) startThresholdCharge(ctx, inst, boss, st);
  else if (freed(st, 'tongs') && st.flailTimer <= 0) startChainFlail(ctx, inst, boss, st);
  else if (freed(st, 'bellows') && st.bellowTimer <= 0) startBellow(boss, st);
  else if (st.stompTimer <= 0) startStomp(boss, st);
  else if (freed(st, 'hammer') && st.maulTimer <= 0) startMaulArc(boss, st);
}

/** `/dev sanctum trigger <mechanic>` for an engaged Korgath: the reply line, or
 *  null when `what` is not one of his mechanics. */
export function korgathDevTrigger(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  what: string,
): string | null {
  const [verb, arg] = what.trim().split(/\s+/);
  const known = [
    'maul',
    'flail',
    'charge',
    'bellow',
    'strain',
    'stomp',
    'enrage',
    'break',
    'rerivet',
  ];
  if (!known.includes(verb)) return null;
  const st = korgathFight(ctx, inst, boss);
  st.engaged = true;
  if (boss.castingAbility !== null) clearCastIf(boss, boss.castingAbility);
  st.charge = null;
  st.lane = null;
  const tool = SEAL_TOOLS.find((t) => t === arg);
  if (verb === 'break' || verb === 'rerivet') {
    if (!tool) return `Name a chain: ${SEAL_TOOLS.join(', ')}.`;
    if (verb === 'break')
      return breakChain(ctx, inst, boss, st, tool)
        ? `The ${tool} chain breaks.`
        : 'That chain is already broken.';
    return sendGoadsmith(ctx, inst, boss, st, tool)
      ? `A Goadsmith comes to re-rivet the ${tool} chain.`
      : 'That chain is not broken, or a Goadsmith is already on it.';
  }
  if (verb === 'maul') return startMaulArc(boss, st) ? 'Maul Arc.' : 'Korgath is busy.';
  if (verb === 'flail')
    return startChainFlail(ctx, inst, boss, st) ? 'Chain Flail.' : 'Nobody to flail.';
  if (verb === 'charge')
    return startThresholdCharge(ctx, inst, boss, st) ? 'Threshold Charge.' : 'Nobody to charge.';
  if (verb === 'bellow') return startBellow(boss, st) ? "Foreman's Bellow." : 'Korgath is busy.';
  if (verb === 'strain')
    return startStrain(inst, boss, st) ? 'Strain.' : 'No chain is left to strain.';
  if (verb === 'stomp') return startStomp(boss, st) ? 'Shuddering Stomp.' : 'Korgath is busy.';
  boss.enraged = true;
  enrageKorgath(ctx, boss, st);
  return 'Enrage.';
}
