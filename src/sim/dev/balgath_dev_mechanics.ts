// [dev] /dev balgath <mechanic>: force one of Balgath's mechanics on demand.
//
// A playtest hook for the Mirefen world boss (content/zone2.ts balgath_cyclops). The owner
// testing one telegraph used to wait out the whole rotation, and three of his mechanics
// never fire at all for a SOLO tester: Boulder Toss and Foreman's Glare aim only at
// players 18+ yards out, and Barrow Burden only marks when two players stand near him.
// This command starts any of them right now on the nearest live Balgath, aimed at the
// caller, through the SAME start functions a combat cast uses, so the ground ring, the
// wind-up cue, the landing, the damage and the launch are exactly the fight's.
//
// What a forced cast is allowed to skip, and nothing else:
//  - the AIM rules (range minimums, the two-player soak rule): the caller is the victim;
//  - the shared spacing lock, ONCE: the start claims it afresh, and the forced mechanic's
//    own cadence restarts, so the natural rotation resumes from here unchanged.
// What it never skips: one telegraph on the ground at a time. While any of his wind-ups
// or his cast bar is live it refuses, so a forced cast can never strand or stack a ring.
//
// Reached only through handleDevChat, which chat.ts calls behind ctx.devCommands (the
// ALLOW_DEV_COMMANDS host flag), so it does not exist in production. Replies are
// dev-channel English, like every other /dev reply. Draws no rng.

import { forceBossRangedMechanic } from '../mob/boss_ranged_mechanics';
import { forceBossSlam } from '../mob/boss_slams';
import { forceBossStarwake, starwakeActive } from '../mob/boss_starwake';
import { starwakeShowerActive } from '../mob/boss_starwake_meteors';
import { forceTelegraphedBossMechanic } from '../mob/locomotion';
import { devSleepSlumber, devWakeSlumber } from '../mob/slumber';
import { forceWarpathWreck } from '../mob/warpath';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { dist2d } from '../types';
import { BALGATH_DEV_LOOT_HELP } from './balgath_dev_loot';
import { BALGATH_QUEST_DEV_HELP } from './balgath_dev_quests';

/** The template the command drives. */
export const BALGATH_TEMPLATE_ID = 'balgath_cyclops';

/** How far from the caller a Balgath may stand and still be picked. */
export const BALGATH_DEV_RANGE = 150;

/** The verbs, in the order the help line lists them. */
export const BALGATH_DEV_MECHANICS = [
  'glare',
  'boulder',
  'burden',
  'cleave',
  'hammer',
  'smash',
  'stomp',
  'starwake',
  'wreck',
] as const;

export type BalgathDevMechanic = (typeof BALGATH_DEV_MECHANICS)[number];

/** One line per verb: what it forces and how to dodge it. */
const DESCRIBE: Record<BalgathDevMechanic, string> = {
  glare: "Foreman's Glare: a beam line through you (sidestep, or hide behind solid cover)",
  boulder: 'Boulder Toss: a boulder lands on your spot (move)',
  burden: 'Barrow Burden: a shared soak on you (stack; alone it is lethal by design)',
  cleave: 'Barrow Cleave: a 120-degree arm sweep aimed at you (jump it)',
  hammer: "Foreman's Hammer: one fist on your spot (move)",
  smash:
    'Barrow Smash: the 12 yd ring round his feet (walk out, or step into the open ring between the disc and the rim)',
  stomp: 'Shockwave Stomp: the 7 yd stun ring round his feet (walk out)',
  starwake:
    'Wake of the Fallen Star: the star wakes, lava fissures crawl out, geysers burst under you and along them, pools burn for 8 s, and as it erupts a Star Debris meteor shower rains down for 8 s, each meteor landing 2.5 s after its red circle appears (stand in a lane between the fissures, step out of your geyser circle, then keep moving out of the red circles)',
  wreck: 'Barrowfall: the 16 yd arrival slam where he stands (walk out)',
};

export type BalgathDevCommand =
  | { kind: 'help' }
  | { kind: 'mechanic'; mechanic: BalgathDevMechanic }
  | { kind: 'slumber'; action: 'wake' | 'sleep' }
  | { kind: 'unknown'; verb: string };

export function isBalgathDevMechanic(verb: string): verb is BalgathDevMechanic {
  return (BALGATH_DEV_MECHANICS as readonly string[]).includes(verb);
}

/**
 * Parse `/dev balgath [verb]` (or `/devbalgath [verb]`). Null when the line is not this
 * command at all, so the dev router falls through to its other branches.
 */
export function parseBalgathDevCommand(raw: string): BalgathDevCommand | null {
  const m = /^\/(?:dev\s+balgath|devbalgath)(?:\s+(\S+))?\s*$/i.exec(raw);
  if (!m) return null;
  const verb = (m[1] ?? '').toLowerCase();
  if (verb === '' || verb === 'help') return { kind: 'help' };
  if (isBalgathDevMechanic(verb)) return { kind: 'mechanic', mechanic: verb };
  if (verb === 'wake' || verb === 'sleep') return { kind: 'slumber', action: verb };
  return { kind: 'unknown', verb };
}

/** The help text: every verb with what it does. */
export function balgathDevHelp(): string {
  const lines = BALGATH_DEV_MECHANICS.map((v) => `/dev balgath ${v}: ${DESCRIBE[v]}`);
  lines.push(
    '/dev balgath wake: wake him now, even at night (he stays up until the day comes)',
    '/dev balgath sleep: send him to bed now if he is not fighting (he sleeps until the night comes)',
    '/dev servertime day|night|dawn|dusk|<0..1>|auto: move the SERVER day/night clock (auto restores real time; match your sky with /daynight)',
    ...BALGATH_QUEST_DEV_HELP,
    BALGATH_DEV_LOOT_HELP,
  );
  return `[dev] Balgath mechanics (nearest live Balgath within ${BALGATH_DEV_RANGE} yd, aimed at you): ${lines.join('; ')}.`;
}

/** The nearest living Balgath within BALGATH_DEV_RANGE of `from`, or null. */
export function nearestBalgath(ctx: SimContext, from: Entity): Entity | null {
  let best: Entity | null = null;
  let bestD = BALGATH_DEV_RANGE;
  for (const e of ctx.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.templateId !== BALGATH_TEMPLATE_ID) continue;
    const d = dist2d(e.pos, from.pos);
    if (d <= bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/** The live telegraph that blocks a forced cast, named for the reply, or null. */
function liveTelegraph(mob: Entity): string | null {
  if ((mob.slamWindup ?? 0) > 0)
    return mob.slamKind === 'cleave' ? 'Barrow Cleave' : "Foreman's Hammer";
  if ((mob.rangedWindup ?? 0) > 0) return mob.rangedKind ?? 'a ranged mechanic';
  if ((mob.pulseWindupRemaining ?? 0) > 0) return 'Barrow Smash';
  if ((mob.stompWindupRemaining ?? 0) > 0) return 'Shockwave Stomp';
  if (starwakeActive(mob)) return 'Wake of the Fallen Star';
  if (mob.castingAbility !== null) return 'His cast bar';
  if (mob.warpathPhase === 'wreck') return 'Barrowfall';
  return null;
}

export interface BalgathDevResult {
  ok: boolean;
  message: string;
}

/**
 * Force `mechanic` on the nearest live Balgath, aimed at the caller `pid`.
 *
 * An awake, idle Balgath is engaged with the caller first (the forced wind-up resolves on
 * his engaged ticks, like every telegraph). An asleep one refuses: sleep is neutral and
 * unattackable, and only dawn wakes him.
 */
export function forceBalgathDevMechanic(
  ctx: SimContext,
  pid: number,
  mechanic: BalgathDevMechanic,
): BalgathDevResult {
  const caller = ctx.entities.get(pid);
  if (!caller || caller.dead)
    return { ok: false, message: 'You must be alive to call his mechanics.' };
  const boss = nearestBalgath(ctx, caller);
  if (!boss) {
    return {
      ok: false,
      message: `No live Balgath within ${BALGATH_DEV_RANGE} yd. He rises in the Starfall Crater, east Mirefen (/dev tp 147 310), by day.`,
    };
  }
  if (boss.asleep) {
    return {
      ok: false,
      message:
        'Balgath is asleep in his crater (neutral and unattackable). Dawn wakes him: /dev balgath wake, or /dev servertime dawn.',
    };
  }
  if ((boss.slumberRise ?? 0) > 0) {
    return {
      ok: false,
      message: 'Balgath is still standing up from his sleep. Try again in a few seconds.',
    };
  }
  if (boss.aiState === 'evade') {
    return {
      ok: false,
      message:
        'Balgath is walking home (he gave up the pull). Try again once he is back in his crater.',
    };
  }
  const busy = liveTelegraph(boss);
  if (busy) {
    return {
      ok: false,
      message: `${busy} is still on the ground. One telegraph at a time: try again when it lands.`,
    };
  }
  if (mechanic === 'starwake' && starwakeShowerActive(boss)) {
    return {
      ok: false,
      message: 'The Star Debris shower is still falling. Try again when the last meteor lands.',
    };
  }
  let engaged = '';
  if (boss.aiState !== 'chase' && boss.aiState !== 'attack') {
    if (!ctx.aggroMob(boss, caller, false)) {
      return {
        ok: false,
        message: 'Could not engage Balgath with you (is /dev noaggro or /dev freezemobs on?).',
      };
    }
    engaged = ' He was idle, so he is now engaged with you.';
  }
  if (!startForced(ctx, boss, caller, mechanic)) {
    return { ok: false, message: `Balgath could not start ${mechanic} right now.` };
  }
  return { ok: true, message: `Balgath: ${DESCRIBE[mechanic]}.${engaged}` };
}

function startForced(
  ctx: SimContext,
  boss: Entity,
  caller: Entity,
  mechanic: BalgathDevMechanic,
): boolean {
  switch (mechanic) {
    case 'glare':
    case 'boulder':
    case 'burden':
      return forceBossRangedMechanic(ctx, boss, mechanic, caller);
    case 'cleave':
    case 'hammer':
      return forceBossSlam(ctx, boss, mechanic, caller);
    case 'smash':
      return forceTelegraphedBossMechanic(ctx, boss, 'pulse');
    case 'stomp':
      return forceTelegraphedBossMechanic(ctx, boss, 'stomp');
    case 'starwake':
      return forceBossStarwake(ctx, boss);
    case 'wreck':
      return forceWarpathWreck(ctx, boss);
  }
}

/**
 * Wake the nearest Balgath now (`wake`), or put him to bed (`sleep`), through the slumber
 * module's own dev entry points (mob/slumber.ts), so the rise, the yells and the realm
 * notices are the real ones.
 */
export function balgathDevSlumber(
  ctx: SimContext,
  pid: number,
  action: 'wake' | 'sleep',
): BalgathDevResult {
  const caller = ctx.entities.get(pid);
  if (!caller) return { ok: false, message: 'No caller.' };
  const boss = nearestBalgath(ctx, caller);
  if (!boss) {
    return {
      ok: false,
      message: `No live Balgath within ${BALGATH_DEV_RANGE} yd. He rises in the Starfall Crater, east Mirefen (/dev tp 147 310).`,
    };
  }
  if (action === 'wake') {
    if (!boss.asleep) return { ok: false, message: 'Balgath is already awake.' };
    devWakeSlumber(ctx, boss);
    return {
      ok: true,
      message:
        'Balgath wakes and rises. He stays up until the day comes, then sleeps at the next dusk as usual.',
    };
  }
  if (boss.asleep) return { ok: false, message: 'Balgath is already asleep.' };
  if (!devSleepSlumber(ctx, boss)) {
    return { ok: false, message: 'Balgath is fighting (or walking home). End the pull first.' };
  }
  return {
    ok: true,
    message:
      'Balgath lies down in his crater. He sleeps until the night comes, then wakes at the next dawn as usual.',
  };
}
