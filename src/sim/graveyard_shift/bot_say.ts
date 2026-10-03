// The adventurers speak aloud: short keyed say lines from LIVING bots, heard by
// every player within SAY_RANGE of the speaker (pid-routed, in the style of
// emitMobYell), never through party chat. Lines react to observed run state
// (the party notices Morthen, a bot dies, the healer runs dry, a wipe looms,
// Morthen loses), never to a timer. The speaker and the line are drawn on the
// run's own say Rng, so neither the shared stream nor the bots' brain rngs move.

import { Rng } from '../rng';
import { SAY_RANGE } from '../sim';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity, TICK_RATE } from '../types';
import { BOT_LINES, type BotLine, type BotSayTrigger, botLineAllowed } from './bot_lines';
import type { GraveyardShiftBot, GraveyardShiftRun } from './run_state';

// One line every 3 sec across the party, and 10 sec between two lines of a bot.
export const BOT_SAY_GLOBAL_COOLDOWN_TICKS = 3 * TICK_RATE;
export const BOT_SAY_BOT_COOLDOWN_TICKS = 10 * TICK_RATE;
// An observed event waits this long for a free voice before it goes stale; as
// long as a bot's own cooldown, so a lone survivor still answers the next event.
export const BOT_SAY_PENDING_TICKS = BOT_SAY_BOT_COOLDOWN_TICKS;
// The healer calls oom below this mana fraction (the concept's drink threshold).
export const BOT_SAY_HEALER_OOM_FRACTION = 0.15;
// A wipe looms with this many adventurers down, or the living party's average
// health fraction under the second threshold.
export const BOT_SAY_WIPE_DEAD = 2;
export const BOT_SAY_WIPE_HP_FRACTION = 0.35;

interface PendingSay {
  readonly trigger: BotSayTrigger;
  readonly expiresTick: number;
}

// Session-only say state, created on the run's first say tick.
export interface BotSayState {
  readonly rng: Rng;
  readonly used: Set<string>;
  lastTick: number;
  readonly botLastTick: Map<number, number>;
  sawEngaged: boolean;
  readonly deadSeen: Set<number>;
  healerLow: boolean;
  wipeThreat: boolean;
  outcomeSaid: boolean;
  readonly pending: PendingSay[];
}

// The say stream's seed, salted away from the run seed and every botSeed.
export function botSaySeed(runSeed: number): number {
  return (Math.imul(runSeed ^ 0x5bd1e995, 0x27d4eb2d) ^ 0x51a7e0b5) >>> 0 || 1;
}

export function freshBotSayState(runSeed: number): BotSayState {
  return {
    rng: new Rng(botSaySeed(runSeed)),
    used: new Set(),
    lastTick: Number.NEGATIVE_INFINITY,
    botLastTick: new Map(),
    sawEngaged: false,
    deadSeen: new Set(),
    healerLow: false,
    wipeThreat: false,
    outcomeSaid: false,
    pending: [],
  };
}

const living = (e: Entity | undefined): e is Entity => !!e && !e.dead && !e.ghost;

// Observes the run, queues what changed, and speaks at most one line. Called
// once per run tick before the teardown, so the party's win line is heard.
export function updateGraveyardShiftSay(ctx: SimContext, run: GraveyardShiftRun): void {
  run.say ??= freshBotSayState(run.seed);
  const state = run.say;
  const now = ctx.tickCount;
  const boss = ctx.entities.get(run.ownerPid);
  if (!state.outcomeSaid && (run.pendingOutcome === 'lost' || boss?.dead)) {
    state.outcomeSaid = true;
    speak(ctx, run, state, 'partyWins', true);
    return;
  }
  observe(ctx, run, state, now);
  for (let i = state.pending.length - 1; i >= 0; i--) {
    if (now > state.pending[i].expiresTick) state.pending.splice(i, 1);
  }
  if (now - state.lastTick < BOT_SAY_GLOBAL_COOLDOWN_TICKS) return;
  for (let i = 0; i < state.pending.length; i++) {
    if (speak(ctx, run, state, state.pending[i].trigger, false)) {
      state.pending.splice(i, 1);
      return;
    }
  }
}

function queue(state: BotSayState, trigger: BotSayTrigger, now: number): void {
  if (state.pending.some((p) => p.trigger === trigger)) return;
  state.pending.push({ trigger, expiresTick: now + BOT_SAY_PENDING_TICKS });
}

function observe(ctx: SimContext, run: GraveyardShiftRun, state: BotSayState, now: number): void {
  if (run.engaged && !state.sawEngaged) queue(state, 'notice', now);
  state.sawEngaged = run.engaged;
  let dead = 0;
  let hpSum = 0;
  let alive = 0;
  let healerLow = false;
  for (const bot of run.bots) {
    const e = ctx.entities.get(bot.pid);
    if (!living(e)) {
      dead++;
      if (!state.deadSeen.has(bot.pid)) {
        state.deadSeen.add(bot.pid);
        queue(state, 'death', now);
      }
      continue;
    }
    state.deadSeen.delete(bot.pid);
    alive++;
    hpSum += e.maxHp > 0 ? e.hp / e.maxHp : 1;
    if (bot.role === 'healer' && e.resourceType === 'mana' && e.maxResource > 0) {
      healerLow = e.resource / e.maxResource < BOT_SAY_HEALER_OOM_FRACTION;
    }
  }
  if (healerLow && !state.healerLow) queue(state, 'healerOom', now);
  state.healerLow = healerLow;
  const wipe = alive > 0 && (dead >= BOT_SAY_WIPE_DEAD || hpSum / alive < BOT_SAY_WIPE_HP_FRACTION);
  if (wipe && !state.wipeThreat) queue(state, 'wipeThreat', now);
  state.wipeThreat = wipe;
}

// Picks a living, rested speaker with an unsaid line for the trigger and says
// it. `ignoreCooldowns` is the closing line only: the teardown follows it on the
// same tick, so there is no later tick to wait for.
function speak(
  ctx: SimContext,
  run: GraveyardShiftRun,
  state: BotSayState,
  trigger: BotSayTrigger,
  ignoreCooldowns: boolean,
): boolean {
  const now = ctx.tickCount;
  const candidates: { bot: GraveyardShiftBot; e: Entity; lines: BotLine[] }[] = [];
  for (const bot of run.bots) {
    const e = ctx.entities.get(bot.pid);
    if (!living(e)) continue;
    const last = state.botLastTick.get(bot.pid);
    if (!ignoreCooldowns && last !== undefined && now - last < BOT_SAY_BOT_COOLDOWN_TICKS) {
      continue;
    }
    const lines = BOT_LINES[trigger].filter(
      (l) => !state.used.has(l.id) && botLineAllowed(l, bot.role),
    );
    if (lines.length > 0) candidates.push({ bot, e, lines });
  }
  if (candidates.length === 0) return false;
  const pick = candidates[state.rng.int(0, candidates.length - 1)];
  const said = pick.lines[state.rng.int(0, pick.lines.length - 1)];
  state.used.add(said.id);
  state.lastTick = now;
  state.botLastTick.set(pick.bot.pid, now);
  emitBotSay(ctx, pick.e, said);
  return true;
}

function emitBotSay(ctx: SimContext, speaker: Entity, said: BotLine): void {
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p || dist2d(p.pos, speaker.pos) > SAY_RANGE) continue;
    ctx.emit({
      type: 'chat',
      fromPid: speaker.id,
      from: speaker.name,
      text: said.text,
      textKey: said.key,
      channel: 'say',
      entityId: speaker.id,
      pid: meta.entityId,
    });
  }
}
