// Sister Nhalia boss driver for The Drowned Litany finale (Phase 6).
//
// Owns Blackwater Mark puddles (driver-computed area damage to players, the
// Nythraxis pattern), Cantor add phases with an absorb shield while adds live,
// the Final Bell event at low HP, and the Tolling Bells volley mechanic. State
// lives on DelveRun.nhaliaBoss; the generic stomp / summonAdds / enrage
// mob-template hooks are NOT used.

import { DELVES, MOBS } from '../data';
import * as deedsMod from '../deeds';
import { createMob } from '../entity';
import type { SimContext } from '../sim_context';
import {
  type DelveRun,
  type DrownedLitanyBossState,
  DT,
  type Entity,
  SISTER_NHALIA_BOSS_ID,
  TOLLING_BELL_TEMPLATE_ID,
  type TollingBellEntity,
} from '../types';

const BLACKWATER_MARK_EVERY = 14;
const BLACKWATER_MARK_RADIUS = 4;
const BLACKWATER_MARK_DURATION = 8;
const BLACKWATER_MARK_TICK = 1;
const BLACKWATER_MARK_PCT_NORMAL = 0.05;
const BLACKWATER_MARK_PCT_HEROIC = 0.08;
const CANTOR_PHASE_HP = [0.7, 0.35];
const CANTOR_COUNT = 2;
const CANTOR_SHIELD_ABSORB = 120;
const SHIELD_AURA_ID = 'nhalia_cantor_shield';
const SHIELD_AURA_NAME = 'Drowned Canticle';
const FINAL_BELL_HP = 0.1;
const FINAL_BELL_THRALLS = 4;
const FINAL_BELL_DMG_PCT = 0.22;

// Tolling Bells: volley every ~10-12s, 4 bells per volley on every tier, spread
// evenly at 90 degrees apart with a random rotation per volley so each volley
// flies in 4 different directions. Each bell travels at 8 yd/s, passes straight
// through the apse walls, and despawns a short margin beyond them (lifetime is
// only a failsafe). Contact radius 2yd, damage 12% maxHp (nature), knockback
// directed outward from altar center.
const BELL_VOLLEY_INTERVAL_MIN = 10;
const BELL_VOLLEY_INTERVAL_MAX = 12;
const BELL_COUNT = 4;
const BELL_SPEED = 8; // yd/s
const BELL_LIFETIME = 12; // seconds, failsafe only; the bounds check despawns first
const BELL_HIT_RADIUS = 2.0; // yards, matches the ~2m rendered bell
const BELL_DMG_PCT = 0.12;
const BELL_KNOCKBACK_DIST = 5; // yards pushed outward from altar
const BELL_TEMPLATE_ID = TOLLING_BELL_TEMPLATE_ID;
// Altar center in room-local coords (Apse layout: altar at [0,72,11,11]).
const ALTAR_X = 0;
const ALTAR_Z = 72;
// Apse room bounds in room-local coords (delve_litany_layout LITANY_APSE:
// wallX 25, zMin -16, zMax 92). A bell that has flown this margin past a wall
// has visibly passed through it and despawns.
const APSE_WALL_X = 25;
const APSE_Z_MIN = -16;
const APSE_Z_MAX = 92;
const BELL_DESPAWN_MARGIN = 3;

export function initDrownedLitanyBossState(run: DelveRun): void {
  if (run.delveId !== 'drowned_litany') return;
  run.nhaliaBoss = {
    markTimer: BLACKWATER_MARK_EVERY,
    marks: [],
    firedCantorPhases: 0,
    cantorShieldAdds: [],
    finalBellFired: false,
    bellVolleyTimer: BELL_VOLLEY_INTERVAL_MIN + 2, // first volley after ~12s
    bells: [],
  };
}

export function clearDrownedLitanyBossState(run: DelveRun): void {
  run.nhaliaBoss = undefined;
}

// Evade/leash reset: when Sister Nhalia goes home (kited past the leash or a
// party wipe), her encounter re-arms to the exact fresh-pull state, so the
// re-pull fires the Cantor phases and the Final Bell again. The generic
// resetEvadingMob already full-heals her, clears her auras (the Cantor shield),
// and despawns her summonedIds (Cantor and thrall adds); bells are deliberately
// NOT summoned adds, so drop the in-flight ones here before re-initializing.
export function resetDrownedLitanyBossEncounter(ctx: SimContext, boss: Entity): void {
  const run = ctx.delveRunForMob(boss.id);
  if (!run || run.delveId !== 'drowned_litany') return;
  const st = run.nhaliaBoss;
  if (!st) return;
  for (const bell of st.bells) {
    const be = ctx.entities.get(bell.entityId);
    if (be && !be.dead) ctx.dropEntity(bell.entityId);
  }
  initDrownedLitanyBossState(run);
}

// Player death: the Tolling Bells volley and Blackwater Mark puddles must not
// outlive the death, or an in-delve respawn at the module entry can be hit (or
// insta-killed) by an effect that was already in flight before they died. Drop
// every in-flight bell entity and empty both collections. Unlike the evade/leash
// reset above, this does NOT re-init the encounter: firedCantorPhases,
// finalBellFired, cantorShieldAdds, and bellVolleyTimer stay untouched so the
// fight keeps progressing for any party members still alive.
export function clearDrownedLitanyBellsAndMarks(ctx: SimContext, run: DelveRun): void {
  if (run.delveId !== 'drowned_litany') return;
  const st = run.nhaliaBoss;
  if (!st) return;
  for (const bell of st.bells) {
    const be = ctx.entities.get(bell.entityId);
    if (be && !be.dead) ctx.dropEntity(bell.entityId);
  }
  st.bells = [];
  st.marks = [];
}

function findNhaliaBoss(ctx: SimContext, run: DelveRun): Entity | null {
  for (const id of run.mobIds) {
    const e = ctx.entities.get(id);
    if (e && !e.dead && e.templateId === SISTER_NHALIA_BOSS_ID) return e;
  }
  return null;
}

function partyPlayers(ctx: SimContext, run: DelveRun): Entity[] {
  if (!run.partyKey) return [];
  const out: Entity[] = [];
  for (const pid of ctx.partyMembersForKey(run.partyKey)) {
    const p = ctx.entities.get(pid);
    if (p && !p.dead && p.kind === 'player') out.push(p);
  }
  return out;
}

function livingCantorShieldAdds(ctx: SimContext, st: DrownedLitanyBossState): number {
  let n = 0;
  for (const id of st.cantorShieldAdds) {
    const e = ctx.entities.get(id);
    if (e && !e.dead) n++;
  }
  return n;
}

function applyCantorShield(ctx: SimContext, boss: Entity): void {
  const existing = boss.auras.find((a) => a.id === SHIELD_AURA_ID);
  if (existing) {
    existing.value = CANTOR_SHIELD_ABSORB;
    existing.remaining = 9999;
    return;
  }
  ctx.applyAura(boss, {
    id: SHIELD_AURA_ID,
    name: SHIELD_AURA_NAME,
    kind: 'absorb',
    remaining: 9999,
    duration: 9999,
    value: CANTOR_SHIELD_ABSORB,
    sourceId: boss.id,
    school: 'nature',
  });
}

function removeCantorShield(ctx: SimContext, boss: Entity): void {
  const i = boss.auras.findIndex((a) => a.id === SHIELD_AURA_ID);
  if (i < 0) return;
  const name = boss.auras[i].name;
  boss.auras.splice(i, 1);
  ctx.emit({ type: 'aura', targetId: boss.id, name, gained: false });
}

function tickCantorPhases(
  ctx: SimContext,
  run: DelveRun,
  boss: Entity,
  st: DrownedLitanyBossState,
): void {
  const hpFrac = boss.hp / Math.max(1, boss.maxHp);
  while (
    st.firedCantorPhases < CANTOR_PHASE_HP.length &&
    hpFrac <= CANTOR_PHASE_HP[st.firedCantorPhases]
  ) {
    st.firedCantorPhases++;
    const before = boss.summonedIds.length;
    ctx.spawnBossAdds(boss, 'drowned_cantor', CANTOR_COUNT);
    if (run.affixes.includes('lively_choir')) {
      ctx.spawnBossAdds(boss, 'choir_thrall', 2);
    }
    // A burst can cross both HP thresholds in one update. Keep every phase's
    // shield adds tracked until all of them die instead of replacing the first
    // pair with the second pair.
    st.cantorShieldAdds.push(...boss.summonedIds.slice(before));
    applyCantorShield(ctx, boss);
    ctx.emit({
      type: 'log',
      text: 'Cantors, hold the note!',
      color: '#8cf',
      entityId: boss.id,
    });
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'holy',
      fx: 'nova',
    });
  }
}

function tickCantorShield(ctx: SimContext, boss: Entity, st: DrownedLitanyBossState): void {
  if (st.cantorShieldAdds.length === 0) return;
  if (livingCantorShieldAdds(ctx, st) > 0) return;
  removeCantorShield(ctx, boss);
  st.cantorShieldAdds = [];
}

function tickBlackwaterMarkCast(
  ctx: SimContext,
  run: DelveRun,
  boss: Entity,
  st: DrownedLitanyBossState,
): void {
  st.markTimer -= DT;
  if (st.markTimer > 0) return;
  st.markTimer = BLACKWATER_MARK_EVERY;
  const players = partyPlayers(ctx, run);
  if (!players.length) return;
  const target = players[ctx.rng.int(0, players.length - 1)];
  st.marks.push({
    x: target.pos.x,
    z: target.pos.z,
    remaining: BLACKWATER_MARK_DURATION,
    tickTimer: BLACKWATER_MARK_TICK,
  });
  ctx.emit({
    type: 'log',
    text: `${boss.name} marks ${target.name} with Blackwater!`,
    color: '#6af',
    entityId: boss.id,
    telegraph: true,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: target.id,
    school: 'nature',
    fx: 'projectile',
  });
}

function tickBlackwaterMarks(
  ctx: SimContext,
  run: DelveRun,
  boss: Entity,
  st: DrownedLitanyBossState,
): void {
  if (!st.marks.length) return;
  const tier = DELVES[run.delveId]?.tiers.find((t) => t.id === run.tierId);
  const highWater = run.affixes.includes('high_water');
  const pctBase =
    (tier?.enemyLevelBonus ?? 0) > 0 ? BLACKWATER_MARK_PCT_HEROIC : BLACKWATER_MARK_PCT_NORMAL;
  const pct = highWater ? pctBase * 1.35 : pctBase;
  const live: typeof st.marks = [];
  for (const mark of st.marks) {
    mark.remaining -= DT;
    if (mark.remaining <= 0) continue;
    mark.tickTimer -= DT;
    if (mark.tickTimer <= 0) {
      mark.tickTimer = BLACKWATER_MARK_TICK;
      for (const p of partyPlayers(ctx, run)) {
        const dx = p.pos.x - mark.x;
        const dz = p.pos.z - mark.z;
        if (dx * dx + dz * dz > BLACKWATER_MARK_RADIUS * BLACKWATER_MARK_RADIUS) continue;
        const dmg = Math.max(1, Math.round(p.maxHp * pct));
        ctx.dealDamage(boss, p, dmg, false, 'nature', 'Blackwater Mark', 'hit', true);
      }
    }
    live.push(mark);
  }
  st.marks = live;
}

function tickFinalBell(
  ctx: SimContext,
  run: DelveRun,
  boss: Entity,
  st: DrownedLitanyBossState,
): void {
  if (st.finalBellFired) return;
  const hpFrac = boss.hp / Math.max(1, boss.maxHp);
  if (hpFrac > FINAL_BELL_HP) return;
  st.finalBellFired = true;
  const school = 'holy';
  ctx.emit({ type: 'spellfx', sourceId: boss.id, targetId: boss.id, school, fx: 'nova' });
  ctx.emit({
    type: 'log',
    text: `${boss.name} unleashes Final Bell!`,
    color: '#ff9933',
    telegraph: true,
    entityId: boss.id,
  });
  ctx.spawnBossAdds(
    boss,
    'choir_thrall',
    FINAL_BELL_THRALLS + (run.affixes.includes('lively_choir') ? 2 : 0),
  );
  for (const p of partyPlayers(ctx, run)) {
    const dmg = Math.max(1, Math.round(p.maxHp * FINAL_BELL_DMG_PCT));
    ctx.dealDamage(boss, p, dmg, false, school, 'Final Bell', 'hit', true);
    if (p.dead) continue;
    ctx.applyAura(p, {
      id: 'stomp_stun',
      name: 'Final Bell',
      kind: 'stun',
      remaining: 1.5,
      duration: 1.5,
      value: 0,
      sourceId: boss.id,
      school,
    });
  }
}

// Spawn a single bell projectile entity. The bell is a non-hostile mob entity
// so it replicates via the normal snapshot wire. It has no AI, no loot, no XP;
// the driver moves it each tick and removes it when it expires or leaves bounds.
function spawnBellEntity(
  ctx: SimContext,
  run: DelveRun,
  spawnX: number,
  spawnZ: number,
  vx: number,
  vz: number,
  zBase: number,
): TollingBellEntity {
  const template = MOBS[BELL_TEMPLATE_ID];
  const id = ctx.nextId++;
  const bell = createMob(id, template, template.minLevel, {
    x: spawnX + run.origin.x,
    y: 0,
    z: spawnZ + zBase,
  });
  // Non-hostile: no aggro, no auto-attack, no AI targeting.
  bell.hostile = false;
  bell.inCombat = false;
  bell.aggroTargetId = null;
  bell.aiState = 'idle';
  ctx.addEntity(bell);
  // Track in run.mobIds so it despawns with the instance, but NOT in boss.summonedIds
  // (which cantorShieldAdds watches). The bell's templateId is not in delve.bosses,
  // so it cannot trigger onDelveBossDefeated.
  run.mobIds.push(id);
  return { entityId: id, remaining: BELL_LIFETIME, vx, vz };
}

// Fire a Tolling Bells volley: emit the telegraph + spawn BELL_COUNT bells,
// evenly spaced around the altar with a random rotation so every volley flies
// out in 4 different directions.
function fireBellVolley(
  ctx: SimContext,
  run: DelveRun,
  boss: Entity,
  st: DrownedLitanyBossState,
  count: number,
  zBase: number,
): void {
  ctx.emit({
    type: 'log',
    text: `${boss.name} tolls the bells!`,
    color: '#ddbbff',
    entityId: boss.id,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'holy',
    fx: 'nova',
  });

  // Spread angles: count bells evenly around the full circle (90 degrees apart
  // for 4), rotated by a random offset each volley so the directions differ
  // volley to volley. Angle 0 = toward z-min (north, into the arena field).
  const offset = ctx.rng.next() * ((Math.PI * 2) / Math.max(1, count));
  for (let i = 0; i < count; i++) {
    const angle = offset + (i * Math.PI * 2) / Math.max(1, count);
    const vx = Math.sin(angle);
    const vz = -Math.cos(angle); // negative z = forward/north into the arena field
    const bell = spawnBellEntity(ctx, run, ALTAR_X, ALTAR_Z, vx, vz, zBase);
    st.bells.push(bell);
  }
}

// Advance all in-flight bells: move them, check player contact, remove expired.
function tickBells(
  ctx: SimContext,
  run: DelveRun,
  boss: Entity,
  st: DrownedLitanyBossState,
  zBase: number,
): void {
  if (!st.bells.length) return;
  const players = partyPlayers(ctx, run);
  const live: TollingBellEntity[] = [];
  for (const bell of st.bells) {
    bell.remaining -= DT;
    if (bell.remaining <= 0) {
      ctx.dropEntity(bell.entityId);
      continue;
    }
    const bellE = ctx.entities.get(bell.entityId);
    if (!bellE || bellE.dead) continue;

    // Move the bell entity this tick. Bells ignore collision on purpose: they
    // fly straight through the apse walls, then despawn just past them.
    bellE.pos.x += bell.vx * BELL_SPEED * DT;
    bellE.pos.z += bell.vz * BELL_SPEED * DT;
    ctx.rebucket(bellE);

    // Out of the room: the bell has passed through a wall, remove it.
    const localX = bellE.pos.x - run.origin.x;
    const localZ = bellE.pos.z - zBase;
    if (
      Math.abs(localX) > APSE_WALL_X + BELL_DESPAWN_MARGIN ||
      localZ < APSE_Z_MIN - BELL_DESPAWN_MARGIN ||
      localZ > APSE_Z_MAX + BELL_DESPAWN_MARGIN
    ) {
      ctx.dropEntity(bell.entityId);
      continue;
    }

    // Contact check: damage + knockback any player within hit radius.
    const bx = bellE.pos.x;
    const bz = bellE.pos.z;
    for (const p of players) {
      if (p.dead) continue;
      const dx = p.pos.x - bx;
      const dz = p.pos.z - bz;
      if (dx * dx + dz * dz > BELL_HIT_RADIUS * BELL_HIT_RADIUS) continue;
      const dmg = Math.max(1, Math.round(p.maxHp * BELL_DMG_PCT));
      ctx.dealDamage(boss, p, dmg, false, 'nature', 'Tolling Bell', 'hit', true);
      // A landed bell contact taints the footwork task.
      deedsMod.onBellContactForDeeds(ctx, boss);
      if (p.dead) continue;
      // Knockback: push radially outward from altar center.
      // Build a fake "source" position at the altar center so applyKnockback
      // computes the outward direction correctly.
      const altarPos = { x: run.origin.x + ALTAR_X, y: 0, z: ALTAR_Z + zBase };
      const fakeSource = { ...boss, pos: altarPos } as Entity;
      ctx.applyKnockback(fakeSource, p, BELL_KNOCKBACK_DIST);
      ctx.emit({
        type: 'spellfx',
        sourceId: boss.id,
        targetId: p.id,
        school: 'holy',
        fx: 'nova',
      });
    }

    live.push(bell);
  }
  st.bells = live;
}

// Countdown and fire Tolling Bells volleys. Interleaved with the rest of the
// boss driver; runs regardless of cantor-shield state (bells continue mid-shield).
function tickTollingBells(
  ctx: SimContext,
  run: DelveRun,
  boss: Entity,
  st: DrownedLitanyBossState,
  zBase: number,
): void {
  // Countdown to next volley.
  st.bellVolleyTimer -= DT;
  if (st.bellVolleyTimer > 0) return;

  // Reset timer with random interval.
  st.bellVolleyTimer =
    BELL_VOLLEY_INTERVAL_MIN +
    ctx.rng.next() * (BELL_VOLLEY_INTERVAL_MAX - BELL_VOLLEY_INTERVAL_MIN);

  fireBellVolley(ctx, run, boss, st, BELL_COUNT, zBase);
}

export function tickDrownedLitanyBoss(ctx: SimContext, run: DelveRun): void {
  if (run.delveId !== 'drowned_litany') return;
  const delve = DELVES[run.delveId];
  const moduleId = run.modules[run.moduleIndex];
  if (moduleId !== delve.finaleModuleId) return;

  const boss = findNhaliaBoss(ctx, run);
  if (!boss) {
    // Sister Nhalia is dead (the lookup only returns a living boss) or not yet
    // spawned: drop any in-flight bells so they do not linger frozen in the
    // apse through the rite.
    const st = run.nhaliaBoss;
    if (st && st.bells.length > 0) {
      for (const bell of st.bells) {
        const be = ctx.entities.get(bell.entityId);
        if (be && !be.dead) ctx.dropEntity(bell.entityId);
      }
      st.bells = [];
    }
    return;
  }

  if (!run.nhaliaBoss) initDrownedLitanyBossState(run);
  const st = run.nhaliaBoss!;

  // Compute the z-offset for this module (so altar world-Z = ALTAR_Z + zBase).
  // We read it as the difference between boss's spawn z and ALTAR_Z to stay
  // consistent with how runs.ts positions entities.
  const zBase = boss.spawnPos.z - ALTAR_Z;

  tickBlackwaterMarks(ctx, run, boss, st);
  // In-flight bells keep moving (and despawn past the walls) even while the
  // boss is out of combat or resetting; only NEW volleys need the combat gate.
  // (Boss death is handled above: findNhaliaBoss only returns a living boss,
  // so the !boss branch is where lingering bells are dropped.)
  tickBells(ctx, run, boss, st, zBase);
  if (!boss.inCombat && boss.aiState !== 'attack' && boss.aiState !== 'chase') return;

  tickCantorPhases(ctx, run, boss, st);
  tickCantorShield(ctx, boss, st);
  tickBlackwaterMarkCast(ctx, run, boss, st);
  tickFinalBell(ctx, run, boss, st);
  tickTollingBells(ctx, run, boss, st, zBase);
}
