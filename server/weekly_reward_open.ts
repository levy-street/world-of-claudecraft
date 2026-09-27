// Opening is a durability barrier: only a successful, still-authoritative
// character save may publish the rolled item. Reuse the character save FIFO.

import type { SimContext } from '../src/sim/sim_context';
import { parseWeeklyTableSelection } from '../src/sim/weekly_reward_options';
import {
  finishWeeklyRewardOpen,
  isWeeklyRewardOpeningCurrent,
  prepareWeeklyRewardOpen,
} from '../src/sim/weekly_rewards';

export const WEEKLY_OPEN_SAVE_TIMEOUT_MS = 15_000;
export const WEEKLY_OPEN_RETRY_MS = 2_000;

export interface WeeklyRewardSession {
  pid: number;
  characterId: number;
  left: boolean;
  escrowQuarantined: boolean;
}

export interface WeeklyRewardOpenHost<S extends WeeklyRewardSession> {
  sim: {
    ctx: SimContext;
    claimWeeklyReward(choice: string, pid: number, token: string): void;
  };
  clients: ReadonlyMap<number, S>;
  saveCharacter(
    session: S,
    opts: {
      backgroundDbPermit: boolean;
      shouldStart: () => boolean;
      signal: AbortSignal;
    },
  ): Promise<boolean>;
}

interface OpenAdmission {
  active: Set<number>;
  retryAt: WeakMap<WeeklyRewardSession, number>;
}
const admissions = new WeakMap<object, OpenAdmission>();

/** Session comes from authenticated dispatch, never from fields in the frame. */
export async function dispatchWeeklyRewardCommand<S extends WeeklyRewardSession>(
  host: WeeklyRewardOpenHost<S>,
  session: S,
  command: string,
  msg: { choice?: unknown; token?: unknown; table?: unknown; tables?: unknown },
): Promise<void> {
  if (
    typeof msg.choice !== 'string' ||
    msg.choice.length > 64 ||
    typeof msg.token !== 'string' ||
    msg.token.length > 64 ||
    (msg.table !== undefined && msg.tables !== undefined) ||
    ((msg.tables ?? msg.table) !== undefined && !parseWeeklyTableSelection(msg.tables ?? msg.table))
  )
    return;
  const live = () =>
    host.clients.get(session.pid) === session &&
    !session.left &&
    !session.escrowQuarantined &&
    host.sim.ctx.players.has(session.pid) &&
    host.sim.ctx.entities.has(session.pid);
  if (!live()) return;
  let admission = admissions.get(host);
  if (!admission) {
    admission = { active: new Set(), retryAt: new WeakMap() };
    admissions.set(host, admission);
  }
  // Claims cannot consume a batch while one of its slots is awaiting a save.
  if (admission.active.has(session.characterId)) return;
  if (command === 'weekly_reward_claim') {
    host.sim.claimWeeklyReward(msg.choice, session.pid, msg.token);
    return;
  }
  if (command !== 'weekly_reward_open' || (admission.retryAt.get(session) ?? 0) > Date.now())
    return;
  const opening = prepareWeeklyRewardOpen(
    host.sim.ctx,
    msg.choice,
    session.pid,
    msg.token,
    (msg.tables ?? msg.table) as string | string[] | undefined,
  );
  if (!opening) return;
  admission.active.add(session.characterId);
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), WEEKLY_OPEN_SAVE_TIMEOUT_MS);
  const current = () => live() && isWeeklyRewardOpeningCurrent(host.sim.ctx, session.pid, opening);
  let durable = false;
  try {
    const saved = await host.saveCharacter(session, {
      backgroundDbPermit: true,
      shouldStart: current,
      signal: abort.signal,
    });
    durable = saved && current();
  } catch (error) {
    // A thrown COMMIT can be ambiguous. Retain the exact rolled item and let
    // a later save or reconnect recover it, never compensate by rerolling.
    console.error(`weekly vault save failed for character ${session.characterId}:`, error);
  } finally {
    clearTimeout(timeout);
    finishWeeklyRewardOpen(opening, durable);
    admission.active.delete(session.characterId);
    if (!durable) admission.retryAt.set(session, Date.now() + WEEKLY_OPEN_RETRY_MS);
    else admission.retryAt.delete(session);
  }
}
