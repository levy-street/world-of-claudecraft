// Mob death lifecycle (M4), extracted from the Sim monolith.
//
// This module owns the five mob death-lifecycle execution bodies: respawning a
// slain wild mob to its spawn point, despawning the adds a boss summoned this
// pull, the pack-frenzy buff a packmate's death grants its neighbors, and the
// two-phase Death Throes (arm a corpse fuse, then detonate it). The mechanic is
// interleaved across three slices: the ARM trigger runs in handleDeath (C1), the
// corpse-tick fuse/respawn COUNTDOWN runs in updateMob (M2, now mob/locomotion.ts),
// and only the execution bodies live here. handleDeath and the corpse tick reach
// them through the SimContext seam (ctx.frenzyPackmates / ctx.armDeathThroes /
// ctx.detonateCorpse / ctx.respawnMob / ctx.despawnSummonedAdds).
//
// PRIME DIRECTIVE: this is a MOVE, not a rewrite. Each function is the former Sim
// method verbatim, with `this.X` rewritten to `ctx.X` (the SimContext seam) or, for
// the one intra-slice call (respawnMob -> despawnSummonedAdds), to the sibling
// function. Statement order, branch order, the early `return` guards, and EVERY rng
// draw position (respawnMob's wanderTimer rng.range(2,8); detonateCorpse's
// rng.range(min,max) per in-radius player, in this.players iteration order) are
// preserved exactly so the parity gate's full-state trace AND rng draw-order log stay
// byte-identical. The in-place Entity mutation is intentional (the refactor's
// immutability waiver).
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts). data/types/world/threat are imported
// directly (already pure); everything that touches not-yet-extracted Sim state
// (dealDamage, dropEntity, rebucket, despawnPersistentPet, clearNonPlayerStatAuras,
// resetNythraxisEncounter, the rng/emit/grid/players/entities/cfg primitives) routes
// through the seam, all of which still resolve on Sim.

import { MOBS } from '../data';
import type { SimContext } from '../sim_context';
import { clearThreat } from '../threat';
import { dist2d, type Entity, NYTHRAXIS_BOSS_ID } from '../types';
import { groundHeight } from '../world';

const PACK_FRENZY_AURA_ID = 'pack_frenzy'; // attack-speed buff granted to surviving packmates

export function respawnMob(ctx: SimContext, mob: Entity): void {
  if (mob.ownerId !== null) {
    ctx.despawnPersistentPet(mob);
    return;
  }
  ctx.clearNonPlayerStatAuras(mob);
  mob.dead = false;
  mob.lootable = false;
  mob.loot = null;
  mob.lootRecipientIds = undefined;
  mob.tappedById = null;
  mob.ownerId = null;
  mob.hostile = true;
  mob.pos = { ...mob.spawnPos };
  mob.pos.y = groundHeight(mob.pos.x, mob.pos.z, ctx.cfg.seed);
  mob.prevPos = { ...mob.pos };
  ctx.rebucket(mob);
  mob.hp = mob.maxHp;
  mob.auras = [];
  mob.aiState = 'idle';
  mob.aggroTargetId = null;
  mob.inCombat = false;
  if (mob.templateId === NYTHRAXIS_BOSS_ID) {
    mob.facing = Math.PI;
    mob.prevFacing = Math.PI;
  }
  mob.leashAnchor = null;
  mob.evadeStall = 0;
  mob.fleeTimer = 0;
  mob.fleeReturnTimer = 0;
  mob.hasFled = false;
  clearThreat(mob);
  despawnSummonedAdds(ctx, mob);
  mob.firedSummons = 0;
  mob.enraged = false;
  mob.healedThisPull = false;
  mob.stompTimer = MOBS[mob.templateId]?.stomp?.every ?? 0;
  mob.terrifyTimer = MOBS[mob.templateId]?.terrify?.every ?? 0;
  mob.mendTimer = MOBS[mob.templateId]?.mendAlly?.every ?? 0;
  mob.wardTimer = MOBS[mob.templateId]?.wardAllies?.every ?? 0;
  mob.stoneskinTimer = MOBS[mob.templateId]?.stoneskin?.every ?? 0;
  mob.rallyTimer = MOBS[mob.templateId]?.rally?.every ?? 0;
  mob.warcryTimer = MOBS[mob.templateId]?.warcry?.every ?? 0;
  // A mid-flight bigCast dies with the pull: clear the bar, reseed the cadence,
  // and let the next pull bark its engage line again.
  const bigCastDef = MOBS[mob.templateId]?.bigCast;
  mob.bigCastTimer = bigCastDef?.every ?? 0;
  if (bigCastDef && mob.castingAbility === bigCastDef.castId) {
    mob.castingAbility = null;
    mob.castTotal = 0;
    mob.castRemaining = 0;
  }
  mob.yelledEngage = false;
  mob.wanderTimer = ctx.rng.range(2, 8);
  if (mob.templateId === NYTHRAXIS_BOSS_ID) ctx.resetNythraxisEncounter(mob);
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (e && e.targetId === mob.id) e.targetId = null;
  }
}

// Encounter reset: remove the adds a boss summoned this pull so retries
// start clean (firedSummons re-fires a fresh wave per pull). Player
// target refs are cleared first, like freeInstance does (combo points are
// character-bound, so a despawning combo target leaves them untouched).
export function despawnSummonedAdds(ctx: SimContext, boss: Entity): void {
  if (boss.summonedIds.length === 0) return;
  for (const id of boss.summonedIds) {
    if (!ctx.entities.has(id)) continue;
    for (const meta of ctx.players.values()) {
      const e = ctx.entities.get(meta.entityId);
      if (e?.targetId === id) e.targetId = null;
    }
    ctx.dropEntity(id);
  }
  boss.summonedIds = [];
}

// Classic beast "Frenzy": when a mob carrying the packFrenzy trait dies, the
// surviving same-family hostile mobs nearby briefly attack faster. Modelled as
// a refreshable buff_haste aura, so it rides the normal aura tick (expires on
// its own) and the existing snapshot wire — no new Entity field is needed.
export function frenzyPackmates(ctx: SimContext, dead: Entity): void {
  const fr = MOBS[dead.templateId]?.packFrenzy;
  if (!fr) return;
  const r2 = fr.radius * fr.radius;
  ctx.grid.forEachInRadius(dead.pos.x, dead.pos.z, fr.radius, (m, d2) => {
    if (m.id === dead.id || m.kind !== 'mob' || m.dead || m.aiState === 'dead') return;
    if (!m.hostile || m.ownerId !== null || d2 > r2) return;
    // packmates = same creature type (a wolf pack), matching the social-aggro convention
    if (m.templateId !== dead.templateId) return;
    const existing = m.auras.find((a) => a.id === PACK_FRENZY_AURA_ID);
    if (existing) {
      existing.remaining = fr.duration; // refresh on each further loss; don't stack
      return;
    }
    m.auras.push({
      id: PACK_FRENZY_AURA_ID,
      name: 'Pack Frenzy',
      kind: 'buff_haste',
      remaining: fr.duration,
      duration: fr.duration,
      value: fr.hasteMult,
      sourceId: m.id,
      school: 'physical',
    });
    ctx.emit({ type: 'aura', targetId: m.id, name: 'Pack Frenzy', gained: true });
    ctx.emit({
      type: 'log',
      text: `${m.name} flies into a frenzy!`,
      color: '#ff8c00',
      entityId: m.id,
    });
    ctx.emit({
      type: 'spellfx',
      sourceId: m.id,
      targetId: m.id,
      school: 'physical',
      fx: 'nova',
    });
  });
}

// Death Throes (arm): a volatile creature does not explode the instant it
// dies. Its corpse destabilizes for `delay` seconds — a telegraph players can
// run from — by arming a fuse that the corpse tick (updateMob) counts down.
export function armDeathThroes(ctx: SimContext, dead: Entity): void {
  const dt = MOBS[dead.templateId]?.deathThroes;
  if (!dt) return;
  dead.detonateTimer = dt.delay;
  const school = dt.school ?? 'nature';
  ctx.emit({ type: 'spellfx', sourceId: dead.id, targetId: dead.id, school, fx: 'nova' });
  ctx.emit({
    type: 'log',
    text: `${dead.name} begins to swell — get clear!`,
    color: '#9acd32',
    entityId: dead.id,
  });
}

// Death Throes (detonate): the corpse bursts for min..max `school` damage to
// every living player within `radius`. Mirrors the aoePulse damage loop; the
// dead mob is the damage source so credit/threat resolve as a normal hit.
export function detonateCorpse(ctx: SimContext, dead: Entity): void {
  const dt = MOBS[dead.templateId]?.deathThroes;
  if (!dt) return;
  const school = dt.school ?? 'nature';
  ctx.emit({ type: 'spellfx', sourceId: dead.id, targetId: dead.id, school, fx: 'nova' });
  ctx.emit({
    type: 'log',
    text: `${dead.name} bursts in a cloud of ${dt.name}!`,
    color: '#9acd32',
    entityId: dead.id,
  });
  for (const meta of ctx.players.values()) {
    const pe = ctx.entities.get(meta.entityId);
    if (pe && !pe.dead && dist2d(pe.pos, dead.pos) <= dt.radius) {
      const dmg = Math.round(ctx.rng.range(dt.min, dt.max));
      ctx.dealDamage(dead, pe, dmg, false, school, dt.name, 'hit', true);
    }
  }
}
