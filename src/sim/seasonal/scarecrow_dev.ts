// /dev scarecrow: Old Thatchgrin playtests and captures (ALLOW_DEV_COMMANDS only: reached
// through handleDevChat behind the ctx.devCommands gate, like every /dev branch, so none of
// this exists in production).
//
//   /dev scarecrow            open Gourdlight Eve if it is closed, stand him up now if his
//                             field is empty, and put you twenty yards in front of him
//   /dev scarecrow rain       Gourdfall now: the burning pumpkins rain (he must be in a
//                             fight; `gourd` is kept as an alias)
//   /dev scarecrow call       his next call (crows or strawlings) starts now
//   /dev scarecrow swell      a Swelling Gourd heaves up behind him now
//   /dev scarecrow burst      the standing gourd's fuse runs down to its last second
//   /dev scarecrow break      the standing gourd breaks now (he reels: stun, split rind)
//   /dev scarecrow puppet     Thatchbound now; fought alone, two sturdy dev bots join his
//                             fight first, so there is someone to curse and someone to hit
//   /dev scarecrow reset      clear him and stand him up fresh at full health
//   /dev scarecrow lockout    forget your daily spoils lockout, so his corpse pays you again
//   /dev scarecrow wake       tear him off his pole now, whatever the hour (the nightfall
//                             wake: its yell, its rise); he stays up until the night comes
//                             round again, then the normal hours resume
//   /dev scarecrow sleep      send him back onto his pole now (he must be out of a fight)
// He is a NIGHT boss (mob/slumber.ts awakeAt 'night'): he keeps the world's day/night
// clock. OFFLINE that is the one clock the sky shares, so `/daynight night` (or
// `/dev servertime night`, which the offline client answers the same way:
// src/game/daynight_dev_command.ts) wakes him within a tick and `/daynight day` sends him
// back up his pole once he is out of a fight. ONLINE it is the server's clock:
// `/dev servertime night|day` moves it (then `/daynight` to match your own sky). A `wake`
// or `sleep` here is a hold that outlasts the clock until the clock agrees with it.
import { GOURDLIGHT_EVE_ID } from '../content/gourdlight_eve';
import { THATCHGRIN_ID } from '../content/gourdlight_eve_scarecrow';
import { displacePlayerForDev } from '../dev/dev_displace';
import { devSleepSlumber, devWakeSlumber } from '../mob/slumber';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { worldBossLockoutId } from '../world_boss';
import { clearThatchgrin, spawnThatchgrin } from './scarecrow';
import { resolveScarecrowField } from './scarecrow_field';
import { scarecrowFighters } from './scarecrow_fighters';
import { scarecrowEngaged, startCall, startGourdfall } from './scarecrow_kit';
import { startThatchbound } from './scarecrow_puppet';
import { raiseSwellingGourd } from './scarecrow_swell';
import { activeSeasonalEventOf } from './seasonal_state';

const USAGE =
  '[dev] Usage: /dev scarecrow [rain|call|swell|burst|break|puppet|reset|lockout|wake|sleep]. He keeps night hours: /daynight night|day offline, /dev servertime night|day online.';

/** What the hour does to him, said on arrival (the real behavior, not a guess). */
const HOURS_DAY =
  '[dev] It is day: he hangs on his pole until nightfall. Make it night to wake him (/daynight night offline, /dev servertime night online), or /dev scarecrow wake to fight now.';
const HOURS_NIGHT =
  '[dev] It is night: he is awake. Make it day (/daynight day offline, /dev servertime day online) and he climbs back onto his pole once out of a fight.';

/** Two sturdy dev bots join his fight beside the caller (so Thatchbound has a crowd). */
function joinDevFighters(ctx: SimContext, boss: Entity, pid: number): void {
  const caller = ctx.entities.get(pid);
  if (!caller) return;
  const names = ['Strawfriend Ada', 'Strawfriend Bo'];
  names.forEach((name, i) => {
    // a bot from an earlier call keeps its name: reuse it
    let botId = ctx.spawnDevBot(name);
    if (botId < 0) {
      for (const meta of ctx.players.values()) if (meta.name === name) botId = meta.entityId;
    }
    const bot = botId >= 0 ? ctx.entities.get(botId) : undefined;
    if (!bot) return;
    const side = i === 0 ? 1 : -1;
    bot.pos = ctx.groundPos(caller.pos.x + side * 7, caller.pos.z + 3);
    bot.prevPos = { ...bot.pos };
    bot.level = 20;
    bot.maxHp = 20_000;
    bot.hp = 20_000;
    bot.dead = false;
    ctx.dealDamage(bot, boss, 1, false, 'physical', null, 'hit', true);
  });
}

function me(ctx: SimContext, pid: number) {
  return ctx.entities.get(pid) ?? null;
}

export function handleScarecrowDevChat(ctx: SimContext, raw: string, pid: number): boolean {
  const m = /^\/dev\s+scarecrow(?:\s+(\S+))?\s*$/i.exec(raw);
  if (!m) return false;
  const verb = (m[1] ?? '').toLowerCase();
  const log = (text: string) => ctx.emit({ type: 'log', text, pid });
  const st = ctx.seasonal.scarecrow;
  const boss = st.bossId !== null ? ctx.entities.get(st.bossId) : undefined;
  if (verb === '' || verb === 'reset') {
    const field = resolveScarecrowField(ctx.cfg.seed);
    if (!field) {
      ctx.error(pid, '[dev] Old Thatchgrin has no field in this world.');
      return true;
    }
    if (activeSeasonalEventOf(ctx.seasonal) !== GOURDLIGHT_EVE_ID) {
      ctx.seasonal.devOverride = GOURDLIGHT_EVE_ID;
      log('[dev] Gourdlight Eve forced open for the scarecrow.');
    }
    if (verb === 'reset' || (boss && boss.dead)) clearThatchgrin(ctx, st);
    const live = st.bossId !== null ? ctx.entities.get(st.bossId) : undefined;
    const standing = live ?? spawnThatchgrin(ctx, st);
    st.respawnAt = 0;
    const me = ctx.entities.get(pid);
    if (me && standing) {
      // Twenty yards in front of him, so the whole body reads on arrival.
      const x = standing.pos.x + Math.sin(field.facing) * 20;
      const z = standing.pos.z + Math.cos(field.facing) * 20;
      displacePlayerForDev(ctx, me, x, z);
      me.facing = Math.atan2(standing.pos.x - x, standing.pos.z - z);
    }
    log(
      `[dev] Old Thatchgrin stands in his field at ${field.x.toFixed(1)}, ${field.z.toFixed(1)}.`,
    );
    if (standing) log(standing.asleep ? HOURS_DAY : HOURS_NIGHT);
    return true;
  }
  const fightVerbs = ['rain', 'gourd', 'call', 'swell', 'burst', 'break', 'puppet'];
  if (fightVerbs.includes(verb)) {
    if (
      !boss ||
      boss.dead ||
      boss.templateId !== THATCHGRIN_ID ||
      !scarecrowEngaged(boss) ||
      !st.kit
    ) {
      ctx.error(pid, '[dev] Pull Old Thatchgrin first.');
      return true;
    }
    const kit = st.kit;
    let ok = false;
    if (verb === 'rain' || verb === 'gourd' || verb === 'call') {
      if (kit.rain.length > 0 || kit.callWindup > 0) {
        ctx.error(pid, '[dev] He is already winding one up.');
        return true;
      }
      ok = verb === 'call' ? startCall(ctx, boss, st) : startGourdfall(ctx, boss, st);
    } else if (verb === 'puppet') {
      if (scarecrowFighters(ctx, boss).length < 2) joinDevFighters(ctx, boss, pid);
      kit.puppetLast = [];
      ok = startThatchbound(ctx, boss, st);
    } else if (verb === 'swell') {
      ok = raiseSwellingGourd(ctx, boss, st) !== null;
    } else {
      const gourd = kit.swellId !== null ? ctx.entities.get(kit.swellId) : undefined;
      if (gourd && !gourd.dead) {
        ok = true;
        if (verb === 'burst') kit.swellFuse = Math.min(kit.swellFuse, 1);
        else ctx.dealDamage(me(ctx, pid), gourd, gourd.hp + 1, false, 'physical', null, 'hit');
      }
    }
    log(ok ? `[dev] Old Thatchgrin: ${verb} now.` : '[dev] Nothing to do that with.');
    return true;
  }
  if (verb === 'wake' || verb === 'sleep') {
    if (!boss || boss.dead || boss.templateId !== THATCHGRIN_ID) {
      ctx.error(pid, '[dev] Old Thatchgrin is not standing: /dev scarecrow first.');
      return true;
    }
    const ok = verb === 'wake' ? devWakeSlumber(ctx, boss) : devSleepSlumber(ctx, boss);
    log(
      ok
        ? verb === 'wake'
          ? '[dev] Old Thatchgrin tears himself off his pole.'
          : '[dev] Old Thatchgrin climbs back onto his pole (until the next nightfall).'
        : verb === 'wake'
          ? '[dev] He is already awake.'
          : '[dev] He is already on his pole, or still in a fight.',
    );
    return true;
  }
  if (verb === 'lockout') {
    const meta = ctx.players.get(pid);
    if (meta) {
      meta.raidLockouts.delete(worldBossLockoutId(THATCHGRIN_ID));
      meta.wireRev++;
    }
    log("[dev] Old Thatchgrin's daily spoils lockout forgotten.");
    return true;
  }
  ctx.error(pid, USAGE);
  return true;
}
