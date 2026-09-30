// /dev pvpbot [name]: a World PvP sparring target for a solo playtest. Spawns a
// stationary dev bot beside the caller at the caller's level (so the grey rule
// never zeroes the kill), raises its /pvp flag, and puts 10g in its purse so the
// stake is visible, which is everything a flagged kill needs to drop spoils
// (src/sim/pvp/world_pvp_spoils.ts). The bot carries a dev-namespaced local
// identity so the trophy skull it drops records whose skull it is (a real
// player's identity is always host-supplied; this bot exists only here). The
// caller still raises their own flag
// with /pvp and must stand on contested ground: this helper never flags or
// moves the caller. Dev-gated by its caller (handleDevChat behind
// ctx.devCommands); never reached in production.
import { setWorldPvpFlag } from '../pvp/world_pvp';
import { WORLD_PVP_MIN_LEVEL } from '../pvp/world_pvp_rules';
import type { SimContext } from '../sim_context';
import { displacePlayerForDev } from './dev_displace';

export const DEV_PVP_BOT_PURSE_COPPER = 10 * 10_000;

/** Spawn the bot; returns its pid, or a refusal line for the caller. */
export function spawnDevPvpBot(
  ctx: SimContext,
  pid: number,
  name: string,
): { pid: number } | { error: string } {
  const caller = ctx.entities.get(pid);
  if (!caller) return { error: '[dev] No caller.' };
  const botPid = ctx.spawnDevBot(name);
  if (botPid < 0) return { error: `[dev] Could not spawn '${name}'.` };
  const bot = ctx.entities.get(botPid);
  const meta = ctx.players.get(botPid);
  if (!bot || !meta) return { error: `[dev] Could not spawn '${name}'.` };
  displacePlayerForDev(ctx, bot, caller.pos.x + 3, caller.pos.z + 3);
  ctx.setPlayerLevel(Math.max(WORLD_PVP_MIN_LEVEL, caller.level), botPid);
  bot.hp = bot.maxHp;
  meta.copper += DEV_PVP_BOT_PURSE_COPPER;
  meta.gathererIdentity ??= { kind: 'offline', id: `dev-pvpbot:${name.toLowerCase()}` };
  setWorldPvpFlag(ctx, botPid, true);
  return { pid: botPid };
}
