import type { SimContext } from './sim_context';
import { revivePlayerAt } from './spirit';

/** Revives one sanctioned practice bot without moving it out of its current room. */
export function reviveRaidDevBotInPlace(ctx: SimContext, botPid: number): boolean {
  const botMeta = ctx.players.get(botPid);
  const bot = ctx.entities.get(botPid);
  if (!botMeta?.isDevBot || bot?.kind !== 'player') return false;
  if (bot.dead || bot.ghost) revivePlayerAt(ctx, botPid, bot.pos, 1);
  return true;
}

/** Resets one sanctioned practice-raider at an authoritative room position. */
export function resetRaidDevBot(ctx: SimContext, botPid: number, x: number, z: number): boolean {
  if (!reviveRaidDevBotInPlace(ctx, botPid)) return false;
  ctx.setPlayerLevel(20, botPid);
  const botMeta = ctx.players.get(botPid);
  if (botMeta) botMeta.devAnchored = true;
  const bot = ctx.entities.get(botPid);
  if (!bot) return false;
  bot.pos = ctx.groundPos(x, z);
  bot.prevPos = { ...bot.pos };
  bot.vx = 0;
  bot.vy = 0;
  bot.vz = 0;
  bot.jumping = false;
  bot.onGround = true;
  bot.fallStartY = bot.pos.y;
  bot.targetId = null;
  bot.autoAttack = false;
  bot.castingAbility = null;
  bot.castRemaining = 0;
  bot.castTotal = 0;
  bot.castTargetId = null;
  bot.castAim = null;
  bot.inCombat = false;
  bot.devGod = false;
  bot.profilerInvulnerable = true;
  bot.hp = bot.maxHp;
  bot.resource = bot.maxResource;
  ctx.rebucket(bot);
  return true;
}
