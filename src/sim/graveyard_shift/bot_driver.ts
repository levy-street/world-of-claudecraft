// Drives the adventurer party each tick through the same verbs a real player
// uses (castAbility, targetEntity, startAutoAttack, moveInput), so GCD, mana,
// range, line of sight and cooldowns are enforced by the real rules. Reads only
// visible state; decisions draw only on each bot's private Rng (bot_brain.ts).

import { advanceBotSteer } from '../bots/steer';
import { castAbility } from '../combat/casting_lifecycle';
import { isLockedOut, isSilenced } from '../combat/cc';
import { instanceClaimHolds } from '../instances/dungeons';
import type { SimContext } from '../sim_context';
import { angleTo, dist2d, type Entity, MELEE_RANGE, steadyAngleTo } from '../types';
import {
  BOT_THINK_INTERVAL_TICKS,
  type BotRole,
  botRange,
  type HealCandidate,
  interruptAllowed,
  isControlAbility,
  PARTY_ENGAGE_RADIUS,
  pickHealTarget,
  pickTarget,
  reactionDelayTicks,
  type TargetCandidate,
  willKick,
} from './bot_brain';
import type { GraveyardShiftBot, GraveyardShiftRun } from './run_state';

export function updateGraveyardShiftBots(ctx: SimContext, run: GraveyardShiftRun): void {
  const boss = ctx.entities.get(run.ownerPid);
  if (!boss || boss.dead) return;
  if (!run.engaged) {
    run.engaged = run.bots.some((bot) => {
      const e = ctx.entities.get(bot.pid);
      return !!e && !e.dead && (e.hp < e.maxHp || dist2d(e.pos, boss.pos) <= PARTY_ENGAGE_RADIUS);
    });
    if (!run.engaged) return;
  }
  run.bots.forEach((bot, index) => {
    const e = ctx.entities.get(bot.pid);
    const meta = ctx.players.get(bot.pid);
    if (!e || !meta || e.dead) return;
    if ((ctx.tickCount + index) % BOT_THINK_INTERVAL_TICKS === 0) think(ctx, run, bot, e, boss);
    move(ctx, bot, e, meta.moveInput);
  });
}

// Morthen and his owned allies still standing in the run's slot.
function enemiesOf(ctx: SimContext, run: GraveyardShiftRun, boss: Entity): Entity[] {
  const out = [boss];
  for (const e of ctx.entities.values()) {
    if (
      e.ownerId === boss.id &&
      e.kind === 'mob' &&
      !e.dead &&
      instanceClaimHolds(run.slot, e.pos)
    ) {
      out.push(e);
    }
  }
  return out;
}

function think(
  ctx: SimContext,
  run: GraveyardShiftRun,
  bot: GraveyardShiftBot,
  e: Entity,
  boss: Entity,
): void {
  const b = bot.brain;
  // Stimulus: Morthen starts a cast. Each interrupter that notices it schedules
  // its reaction. A pushed-back bar (damage delays the cast) is the same cast,
  // not a new one; the kit's casts all sit on cooldowns, so a recast always
  // follows a gap.
  const casting = boss.castingAbility;
  const freshCast = !!casting && casting !== b.seenCast;
  b.seenCast = casting;
  if (freshCast) {
    b.kickAt = willKick(bot.cls, b.rng) ? ctx.tickCount + reactionDelayTicks(b.rng) : null;
  } else if (!casting) b.kickAt = null;
  const target = chooseTarget(ctx, run, bot, e, boss);
  b.goalId =
    bot.role === 'healer' ? (healerAnchor(ctx, run, e)?.id ?? boss.id) : (target?.id ?? null);
  if (target && e.targetId !== target.id) ctx.targetEntity(target.id, bot.pid);
  if (bot.role === 'healer') thinkHealer(ctx, run, bot, e, boss);
  else if (bot.role === 'tank') thinkTank(ctx, bot, e, boss, target);
  else if (bot.cls === 'rogue') thinkRogue(ctx, bot, e, boss, target);
  else if (bot.cls === 'hunter') thinkHunter(ctx, bot, e, target);
  else thinkDps(ctx, bot, e, boss, target);
}

function chooseTarget(
  ctx: SimContext,
  run: GraveyardShiftRun,
  bot: GraveyardShiftBot,
  e: Entity,
  boss: Entity,
): Entity | null {
  const enemies = enemiesOf(ctx, run, boss);
  const tank = run.bots.find((other) => other.role === 'tank');
  const tankTarget = tank ? (ctx.entities.get(tank.pid)?.targetId ?? null) : null;
  const candidates: TargetCandidate[] = enemies.map((enemy) => ({
    id: enemy.id,
    hpFrac: enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 0,
    // The tank leads: it assists nobody and peels a minion off the healer.
    isAssist: bot.role === 'tank' ? isOnHealer(run, enemy) : enemy.id === tankTarget,
    attackingMe: enemy.targetId === e.id || enemy.aggroTargetId === e.id,
    isCurrent: enemy.id === e.targetId,
    isMinion: enemy.id !== boss.id,
  }));
  const pick = pickTarget(candidates);
  return pick ? (ctx.entities.get(pick.id) ?? null) : null;
}

function isOnHealer(run: GraveyardShiftRun, enemy: Entity): boolean {
  const healer = run.bots.find((bot) => bot.role === 'healer');
  if (!healer) return false;
  return enemy.targetId === healer.pid || enemy.aggroTargetId === healer.pid;
}

// The healer hovers near the tank (or whoever is left).
function healerAnchor(ctx: SimContext, run: GraveyardShiftRun, self: Entity): Entity | null {
  for (const role of ['tank', 'dps'] as BotRole[]) {
    const bot = run.bots.find((b) => b.role === role);
    const e = bot ? ctx.entities.get(bot.pid) : undefined;
    if (e && !e.dead && e.id !== self.id) return e;
  }
  return null;
}

function thinkTank(
  ctx: SimContext,
  bot: GraveyardShiftBot,
  e: Entity,
  boss: Entity,
  target: Entity | null,
): void {
  if (!target) return;
  if (kickReady(ctx, bot, boss) && kick(ctx, bot, e, 'pummel', boss)) return;
  if (target.id !== boss.id && tryCast(ctx, bot, e, 'taunt', target)) return;
  if (dist2d(e.pos, target.pos) <= MELEE_RANGE && !e.autoAttack) ctx.startAutoAttack(bot.pid);
  if (!e.auras.some((a) => a.id === 'battle_shout') && tryCast(ctx, bot, e, 'battle_shout', e)) {
    return;
  }
  tryCast(ctx, bot, e, 'heroic_strike', target);
}

function thinkDps(
  ctx: SimContext,
  bot: GraveyardShiftBot,
  e: Entity,
  boss: Entity,
  target: Entity | null,
): void {
  if (kickReady(ctx, bot, boss) && kick(ctx, bot, e, 'counterspell', boss)) return;
  if (!target || e.castingAbility) return;
  const filler = bot.brain.rng.chance(0.5) ? 'frostbolt' : 'fireball';
  tryCast(ctx, bot, e, filler, target);
}

// The rogue builds combo points with Sinister Strike and spends four or more
// on Eviscerate, swinging in melee between.
function thinkRogue(
  ctx: SimContext,
  bot: GraveyardShiftBot,
  e: Entity,
  boss: Entity,
  target: Entity | null,
): void {
  if (kickReady(ctx, bot, boss) && kick(ctx, bot, e, 'kick', boss)) return;
  if (!target) return;
  if (dist2d(e.pos, target.pos) <= MELEE_RANGE && !e.autoAttack) ctx.startAutoAttack(bot.pid);
  if (e.comboPoints >= 4 && tryCast(ctx, bot, e, 'eviscerate', target)) return;
  tryCast(ctx, bot, e, 'sinister_strike', target);
}

// The hunter shoots from range: Auto Shot, Serpent Sting kept up, Arcane Shot on
// cooldown, and Raptor Strike when something gets inside the dead zone.
function thinkHunter(
  ctx: SimContext,
  bot: GraveyardShiftBot,
  e: Entity,
  target: Entity | null,
): void {
  if (!target) return;
  if (!e.autoAttack) ctx.startAutoAttack(bot.pid);
  if (dist2d(e.pos, target.pos) <= MELEE_RANGE) {
    tryCast(ctx, bot, e, 'raptor_strike', target);
    return;
  }
  const stung = target.auras.some((a) => a.id === 'serpent_sting' && a.sourceId === e.id);
  if (!stung && tryCast(ctx, bot, e, 'serpent_sting', target)) return;
  tryCast(ctx, bot, e, 'arcane_shot', target);
}

function thinkHealer(
  ctx: SimContext,
  run: GraveyardShiftRun,
  bot: GraveyardShiftBot,
  e: Entity,
  boss: Entity,
): void {
  if (e.castingAbility) return;
  const allies: HealCandidate[] = [];
  for (const other of run.bots) {
    const ally = ctx.entities.get(other.pid);
    if (!ally || ally.dead) continue;
    allies.push({
      id: ally.id,
      hpFrac: ally.maxHp > 0 ? ally.hp / ally.maxHp : 1,
      role: other.role,
      isSelf: ally.id === e.id,
    });
  }
  const need = pickHealTarget(allies);
  const b = bot.brain;
  // A new heal need is a stimulus like any other: it waits out a reaction delay.
  if ((need?.id ?? null) !== b.healTargetId) {
    b.healTargetId = need?.id ?? null;
    b.healAt = ctx.tickCount + reactionDelayTicks(b.rng);
  }
  if (need && ctx.tickCount >= b.healAt) {
    const ally = ctx.entities.get(need.id);
    if (!ally) return;
    const shielded = ally.auras.some((a) => a.id === 'power_word_shield');
    const renewed = ally.auras.some((a) => a.id === 'renew');
    if (need.hpFrac < 0.5 && !shielded && tryCast(ctx, bot, e, 'power_word_shield', ally)) return;
    if (need.hpFrac < 0.8 && !renewed && tryCast(ctx, bot, e, 'renew', ally)) return;
    if (need.hpFrac < 0.65 && tryCast(ctx, bot, e, 'lesser_heal', ally)) return;
  }
  // Everyone healthy and mana to spare: the healer chips in on Morthen.
  const everyoneUp = allies.every((ally) => ally.hpFrac > 0.8);
  if (!everyoneUp || e.resource <= e.maxResource * 0.5) return;
  const dotted = boss.auras.some((a) => a.id === 'shadow_word_pain' && a.sourceId === e.id);
  if (!dotted && tryCast(ctx, bot, e, 'shadow_word_pain', boss)) return;
  if (tryCast(ctx, bot, e, 'mind_blast', boss)) return;
  tryCast(ctx, bot, e, 'smite', boss);
}

function kickReady(ctx: SimContext, bot: GraveyardShiftBot, boss: Entity): boolean {
  const b = bot.brain;
  return (
    !!boss.castingAbility &&
    b.kickAt !== null &&
    ctx.tickCount >= b.kickAt &&
    interruptAllowed(boss.castTotal, boss.castRemaining)
  );
}

// A player switches to the caster and stops their own cast to land a kick, but
// only when the kick can actually go out (ready, affordable, in reach and sight):
// a tank peeling a skeleton keeps swinging at it while its kick is down.
function kick(
  ctx: SimContext,
  bot: GraveyardShiftBot,
  e: Entity,
  abilityId: string,
  boss: Entity,
): boolean {
  const res = ctx.resolvedAbility(abilityId, bot.pid);
  if (!res || (e.cooldowns.get(res.cooldownId ?? abilityId) ?? 0) > 0) return false;
  const reach = res.def.range > 0 ? res.def.range : MELEE_RANGE;
  if (e.resource < res.cost || dist2d(e.pos, boss.pos) > reach) return false;
  if (!ctx.hasLineOfSight(e, boss)) return false;
  if (res.def.school !== 'physical' && (isSilenced(e) || isLockedOut(e, res.def.school))) {
    return false;
  }
  // The verbs strike the current target: switch to the caster first.
  if (e.targetId !== boss.id) ctx.targetEntity(boss.id, bot.pid);
  if (e.castingAbility) ctx.cancelCast(e);
  return tryCast(ctx, bot, e, abilityId, boss);
}

// Casts only what a player in this spot could cast right now, so the real path
// never refuses (no error spam) and never wastes a control on the boss.
function tryCast(
  ctx: SimContext,
  bot: GraveyardShiftBot,
  e: Entity,
  abilityId: string,
  target: Entity,
): boolean {
  const res = ctx.resolvedAbility(abilityId, bot.pid);
  if (!res || isControlAbility(res.def)) return false;
  if ((e.cooldowns.get(res.cooldownId ?? abilityId) ?? 0) > 0) return false;
  if (!res.def.offGcd && e.gcdRemaining > 0) return false;
  if (e.castingAbility || e.resource < res.cost) return false;
  // Silenced or school-locked (Sexton's Chain): the real path would refuse.
  if (res.def.school !== 'physical' && (isSilenced(e) || isLockedOut(e, res.def.school))) {
    return false;
  }
  const reach = res.def.range > 0 ? res.def.range : MELEE_RANGE;
  if (dist2d(e.pos, target.pos) > reach) return false;
  if (target.id !== e.id && !ctx.hasLineOfSight(e, target)) return false;
  castAbility(ctx, abilityId, bot.pid, undefined, target.id);
  return true;
}

// Every tick: walk toward the goal until in role range and in sight, then stop
// and face it. Never moves while casting (movement breaks a cast).
function move(
  ctx: SimContext,
  bot: GraveyardShiftBot,
  e: Entity,
  input: { forward: boolean },
): void {
  const goal = bot.brain.goalId !== null ? ctx.entities.get(bot.brain.goalId) : undefined;
  if (!goal || goal.dead || e.castingAbility) {
    input.forward = false;
    return;
  }
  const want = botRange(bot.role, bot.cls);
  const far = dist2d(e.pos, goal.pos) > want;
  if (far || !ctx.hasLineOfSight(e, goal)) {
    input.forward = true;
    e.facing = advanceBotSteer(bot.brain.steer, e.pos.x, e.pos.z, angleTo(e.pos, goal.pos));
  } else {
    input.forward = false;
    e.facing = steadyAngleTo(e.pos, goal.pos, e.facing);
  }
}
