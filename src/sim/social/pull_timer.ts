// Pull countdown timer (/pull X).
// The party/raid leader runs `/pull X` (or `/pull "X"`), where X is a duration in seconds (1-60).
// Emits a raidWarning announcement to all party members at start, then counts down at
// 5, 4, 3, 2, 1, and announces "PULL!" at 0.
// If /pull cancel or /pull 0 is run, cancels the active countdown.
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { PullTimer } from '../types';
import { speakerClass, speakerTitle } from './chat';

export const PULL_TIMER_MAX_SECONDS = 60;
export const PULL_TIMER_DEFAULT_SECONDS = 10;

function broadcastPullRaidWarning(
  ctx: SimContext,
  members: number[],
  leaderMeta: PlayerMeta,
  text: string,
): void {
  for (const mPid of members) {
    ctx.emit({
      type: 'chat',
      fromPid: leaderMeta.entityId,
      from: leaderMeta.name,
      ...speakerTitle(leaderMeta),
      ...speakerClass(leaderMeta),
      text,
      channel: 'raidWarning',
      pid: mPid,
    });
  }
}

export function pullTimerStart(ctx: SimContext, rawCommand: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const party = ctx.partyOf(r.meta.entityId);
  if (!party) {
    ctx.error(r.meta.entityId, 'You are not in a party.');
    return;
  }
  if (party.leader !== r.meta.entityId) {
    ctx.error(r.meta.entityId, 'You are not the party leader.');
    return;
  }

  // Parse: strip "/pull" prefix and quotes
  const arg = rawCommand
    .replace(/^\/pull\s*/i, '')
    .replace(/["']/g, '')
    .trim();
  if (arg.toLowerCase() === 'cancel' || arg === '0' || arg.toLowerCase() === 'stop') {
    if (ctx.pullTimers.has(party.id)) {
      ctx.pullTimers.delete(party.id);
      broadcastPullRaidWarning(ctx, party.members, r.meta, 'Pull cancelled.');
    }
    return;
  }

  let seconds = PULL_TIMER_DEFAULT_SECONDS;
  if (arg.length > 0) {
    const parsed = parseInt(arg, 10);
    if (!isNaN(parsed) && parsed > 0) {
      seconds = Math.max(1, Math.min(PULL_TIMER_MAX_SECONDS, parsed));
    }
  }

  const timer: PullTimer = {
    partyId: party.id,
    initiator: r.meta.entityId,
    endsAt: ctx.time + seconds,
    totalSeconds: seconds,
    lastAnnounced: seconds,
  };
  ctx.pullTimers.set(party.id, timer);

  broadcastPullRaidWarning(ctx, party.members, r.meta, `Pull in ${seconds} sec!`);
}

export function pullTimerCancel(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const party = ctx.partyOf(r.meta.entityId);
  if (!party || !ctx.pullTimers.has(party.id)) return;
  ctx.pullTimers.delete(party.id);
  broadcastPullRaidWarning(ctx, party.members, r.meta, 'Pull cancelled.');
}

// End-of-tick sweep: advance active pull timers.
export function updatePullTimers(ctx: SimContext): void {
  for (const timer of [...ctx.pullTimers.values()]) {
    const leaderMeta = ctx.players.get(timer.initiator);
    const party = leaderMeta ? ctx.partyOf(leaderMeta.entityId) : null;
    if (!party || !leaderMeta || party.id !== timer.partyId) {
      ctx.pullTimers.delete(timer.partyId);
      continue;
    }

    const remaining = Math.ceil(timer.endsAt - ctx.time);
    if (remaining < timer.lastAnnounced) {
      if (remaining > 0 && remaining <= 5) {
        broadcastPullRaidWarning(ctx, party.members, leaderMeta, `${remaining}`);
        timer.lastAnnounced = remaining;
      } else if (remaining <= 0) {
        broadcastPullRaidWarning(ctx, party.members, leaderMeta, 'PULL!');
        ctx.pullTimers.delete(timer.partyId);
      } else {
        timer.lastAnnounced = remaining;
      }
    }
  }
}
