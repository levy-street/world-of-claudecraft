// Lockpicking minigame controller ("Tumbler's Path"), server-authoritative (I2b),
// MOVED verbatim out of the 17.5k-line Sim class behind SimContext. This module
// owns the per-attempt lock SESSION state machine: engage an ante, submit one pick
// action per step, time a step out on the sim clock, burn a try (regenerating a
// fresh board), and succeed or jam. It drives the pure `../lockpick` grid engine
// (generateLockPages/stepLock/visibleCells) and is invoked from the delve runs
// coordinator (I2a, via ctx.tickLockpickTimeout / ctx.abandonLockpick) and from the
// IWorld/server lockpick commands (Sim keeps thin delegates lockpickEngage/
// lockpickAction/lockpickAbort/lockpickViewFor). The full board layout is never
// serialized; only the fogged visibleCells() window is emitted.
//
// Move-not-rewrite: every statement, branch, and iteration order is preserved from
// the original Sim methods; `this.X` became `ctx.X` (seam primitive/callback), a
// sibling call into ./runs (grantDelveRewards/openDelveSurfaceExit), or a pure
// free-function/const import. The grid shuffle draws a SEEDED `new Rng(seed)`
// sub-stream INSIDE ../lockpick (NOT the shared stream), so the seed derivations
// (baseSeed, the retry `^ triesUsed * 0x85ebca6b`) are what must stay byte-identical;
// the ONLY shared-stream draw in the slice is the reward roll
// (delveChestItemsForTier(..., ctx.rng, ...)) in lockpickSucceed.
//
// Per the refactor's immutability waiver, the in-place mutation of the LockSession /
// DelveRun / DelveObjectState / PlayerMeta is intentional and preserved (the engine
// aliases these live objects); do NOT rewrite to immutable copies. This module is
// src/sim-pure (no DOM/Three, no Math.random/Date.now), enforced by
// tests/architecture.test.ts.

import type { LockpickView } from '../../world_api';
import {
  delveChestItemsForTier,
  LOCKPICK_TIER_REWARD,
  lockpickPresetFor,
} from '../content/delves/lockpick_tiers';
import { DELVES } from '../data';
import {
  ANTE_TO_PAGES,
  ANTE_TO_STEP_TIMEOUT_MS,
  ANTE_TO_TIER,
  ANTE_TO_TRIES,
  type Ante,
  generateLockPages,
  type LockSession,
  type PickAction,
  stepLock,
  visibleCells,
} from '../lockpick';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import {
  DELVE_PLATE_RADIUS,
  type DelveObjectState,
  type DelveRun,
  DT,
  dist2d,
  type Entity,
} from '../types';
import { grantDelveRewards, openDelveSurfaceExit } from './runs';

/** Resolve the locked-chest object + run for an acting player, with all the
 * proximity/eligibility guards. Returns null (after emitting an error) on any
 * failure. */
function resolveLockChest(
  ctx: SimContext,
  objectId: number,
  pid?: number,
): {
  r: { e: Entity; meta: PlayerMeta };
  run: DelveRun;
  state: DelveObjectState;
  obj: Entity;
} | null {
  const r = ctx.resolve(pid);
  if (!r) return null;
  let run = ctx.delveRunForPlayer(r.meta.entityId);
  if (!run)
    run = ctx.delveRuns.find((d) => d.partyKey !== null && d.objectIds.includes(objectId)) ?? null;
  if (!run) {
    ctx.error(r.meta.entityId, 'You are not in a delve.');
    return null;
  }
  const state = run.objectState[objectId];
  const obj = ctx.entities.get(objectId);
  if (!state || !obj || state.kind !== 'locked_chest') {
    ctx.error(r.meta.entityId, 'You cannot pick that.');
    return null;
  }
  if (dist2d(r.e.pos, obj.pos) > DELVE_PLATE_RADIUS + 2) {
    ctx.error(r.meta.entityId, 'Move closer to the chest.');
    return null;
  }
  return { r, run, state, obj };
}

/** Start a lockpicking attempt: commit an ante (1/2/3 lives = loot tier). */
export function lockpickEngage(ctx: SimContext, objectId: number, ante: Ante, pid?: number): void {
  const got = resolveLockChest(ctx, objectId, pid);
  if (!got) return;
  const { r, run, state } = got;
  if (ante !== 1 && ante !== 2 && ante !== 3) {
    ctx.error(r.meta.entityId, 'Choose 1, 2, or 3 picks.');
    return;
  }
  if (state.looted) {
    ctx.emit({ type: 'log', text: 'The chest is empty.', color: '#aaa', pid: r.meta.entityId });
    return;
  }
  if (!state.attemptAvailable) {
    ctx.error(
      r.meta.entityId,
      'The lock is jammed beyond picking. Clear the delve again for another attempt.',
    );
    return;
  }
  if (run.lockpick && run.lockpick.state === 'IN_PROGRESS') {
    ctx.error(r.meta.entityId, 'Someone is already working the lock.');
    return;
  }

  // §7.6 Bountiful Coffer: a purple coffer only yields to a Hard-tier (heroic
  // preset) + Premium-ante (1) solve. Server-authoritative, rejected here no
  // matter what ante the UI offered; the lower antes are not an option.
  const isCoffer = run.bountiful && objectId === run.rewardChestId;
  if (isCoffer && ante !== 1) {
    ctx.error(
      r.meta.entityId,
      "This seal yields only to a master's hand. Only the Premium ante can open it.",
    );
    return;
  }

  const tier = lockpickPresetFor(isCoffer ? 'heroic' : run.tierId);
  const baseSeed = (run.seed ^ (objectId * 0x9e3779b1)) >>> 0;
  const triesTotal = ANTE_TO_TRIES[ante];
  const pages = generateLockPages(baseSeed, tier, ANTE_TO_PAGES[ante]);
  const spec = pages[0];
  const session: LockSession = {
    // Unique per engage (tickCount is the deterministic sim clock) so the
    // staleness guard rejects actions from a prior, re-engaged attempt.
    sessionId: `lp_${objectId}_${ctx.tickCount}`,
    chestId: objectId,
    ownerId: r.meta.entityId,
    baseSeed,
    pages,
    pageIndex: 0,
    ante,
    lootTier: ANTE_TO_TIER[ante],
    col: 0,
    row: spec.startRow,
    triesLeft: triesTotal,
    triesTotal,
    stepDeadlineTick: 0, // set by armLockpickStep below
    state: 'IN_PROGRESS',
  };
  run.lockpick = session;
  armLockpickStep(ctx, session);
  ctx.emit({
    type: 'lockpickSession',
    sessionId: session.sessionId,
    objectId,
    w: spec.tier.cols,
    h: spec.tier.rows,
    col: session.col,
    row: session.row,
    page: 1,
    pageCount: pages.length,
    tries: session.triesLeft,
    triesTotal: session.triesTotal,
    lootTier: session.lootTier,
    allowed: spec.tier.allowedActions,
    visible: visibleCells(spec, session.col, spec.tier.visibilityWindow),
    stepTimeoutMs: ANTE_TO_STEP_TIMEOUT_MS[ante],
    pid: r.meta.entityId,
  });
}

/** (Re)start the per-step clock for the active page. The deadline is in sim
 * ticks (deterministic), so the timeout is reproducible from the input timing
 * alone and identical offline, on the server, and headless. The budget is the
 * ante's ANTE_TO_STEP_TIMEOUT_MS (hard 3s / medium 6s / easy 9s per move). */
function armLockpickStep(ctx: SimContext, session: LockSession): void {
  const ms = ANTE_TO_STEP_TIMEOUT_MS[session.ante];
  session.stepDeadlineTick = ctx.tickCount + Math.ceil(ms / (DT * 1000));
}

/** Server-authoritative per-step clock, run every tick for every run (so a solo
 * offline run, an online run, and a headless run all enforce it identically).
 * When the active step's deadline passes it counts as a failed try; the client
 * never reports a timeout. */
export function tickLockpickTimeout(ctx: SimContext, run: DelveRun): void {
  const s = run.lockpick;
  if (s?.state !== 'IN_PROGRESS') return;
  if (ctx.tickCount >= s.stepDeadlineTick) lockpickStepTimeout(ctx, run, s);
}

/** A step's clock expired: burn a try (board reset on retry, chest jams when
 * tries run out), mirroring a slip. lockpickBurnTry re-arms the clock on retry. */
function lockpickStepTimeout(ctx: SimContext, run: DelveRun, session: LockSession): void {
  const result = lockpickBurnTry(ctx, session);
  const spec = session.pages[session.pageIndex];
  ctx.emit({
    type: 'lockpickStep',
    sessionId: session.sessionId,
    col: session.col,
    row: session.row,
    page: session.pageIndex + 1,
    pageCount: session.pages.length,
    tries: session.triesLeft,
    triesTotal: session.triesTotal,
    result,
    visible: visibleCells(spec, session.col, spec.tier.visibilityWindow),
    pid: session.ownerId,
  });
  if (result === 'fail') lockpickFail(ctx, run, session);
}

/** Submit one pick action on the player's active attempt. Abort ends it
 * (preserving the chest). `sessionId`, when supplied (server path), is checked
 * for staleness; offline play omits it and acts on the one live session. */
export function lockpickAction(
  ctx: SimContext,
  action: PickAction,
  pid?: number,
  sessionId?: string,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const run = ctx.delveRunForPlayer(r.meta.entityId);
  const session = run?.lockpick ?? null;
  if (!run || !session) {
    ctx.error(r.meta.entityId, 'No lock attempt in progress.');
    return;
  }
  if (sessionId !== undefined && session.sessionId !== sessionId) {
    ctx.error(r.meta.entityId, 'No lock attempt in progress.');
    return;
  }
  if (session.ownerId !== r.meta.entityId) {
    ctx.error(r.meta.entityId, 'That is not your lock.');
    return;
  }
  if (session.state !== 'IN_PROGRESS') return;

  if (action === 'abort') {
    lockpickAbort(ctx, r.meta.entityId, session.sessionId);
    return;
  }
  let spec = session.pages[session.pageIndex];
  if (!spec.tier.allowedActions.includes(action)) {
    ctx.error(r.meta.entityId, 'That tool slips off this lock.');
    return;
  }

  const step = stepLock(spec, session.col, session.row, action);
  let result = step.result;
  if (result === 'slip' || result === 'bind' || result === 'trap') {
    // The try failed. Burn one try; if any remain, reset to a fresh board so
    // the player can try again. Only when tries run out does the chest jam.
    result = lockpickBurnTry(ctx, session);
    spec = session.pages[session.pageIndex];
  } else {
    session.col = step.col;
    session.row = step.row;
    if (result === 'success' && session.pageIndex < session.pages.length - 1) {
      // Page seated but more remain, roll onto the next lock board.
      session.pageIndex += 1;
      spec = session.pages[session.pageIndex];
      session.col = 0;
      session.row = spec.startRow;
      result = 'pageCleared';
    }
    // A correct move re-arms the per-step clock (a terminal success ends the
    // session right after, so the fresh deadline is simply never reached).
    armLockpickStep(ctx, session);
  }

  ctx.emit({
    type: 'lockpickStep',
    sessionId: session.sessionId,
    col: session.col,
    row: session.row,
    page: session.pageIndex + 1,
    pageCount: session.pages.length,
    tries: session.triesLeft,
    triesTotal: session.triesTotal,
    result,
    visible: visibleCells(spec, session.col, spec.tier.visibilityWindow),
    pid: r.meta.entityId,
  });

  if (result === 'success') {
    lockpickSucceed(ctx, run, session);
  } else if (result === 'fail') {
    lockpickFail(ctx, run, session);
  }
}

/** A try failed (slip/bind/trap or timeout). Consume one try; if any remain,
 * regenerate a fresh page set and reset to the start, returning 'retry'.
 * Otherwise return 'fail' (caller jams the chest). */
function lockpickBurnTry(ctx: SimContext, session: LockSession): 'retry' | 'fail' {
  session.triesLeft -= 1;
  if (session.triesLeft <= 0) return 'fail';
  // Fresh boards each try so a failed run can't simply be memorized.
  const triesUsed = session.triesTotal - session.triesLeft;
  const seed = (session.baseSeed ^ (triesUsed * 0x85ebca6b)) >>> 0;
  session.pages = generateLockPages(seed, session.pages[0].tier, session.pages.length);
  session.pageIndex = 0;
  session.col = 0;
  session.row = session.pages[0].startRow;
  armLockpickStep(ctx, session); // fresh board, fresh per-step clock
  return 'retry';
}

export function lockpickAbort(ctx: SimContext, pid?: number, sessionId?: string): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const run = ctx.delveRunForPlayer(r.meta.entityId);
  const session = run?.lockpick ?? null;
  if (!run || !session || session.ownerId !== r.meta.entityId) return;
  if (sessionId !== undefined && session.sessionId !== sessionId) return;
  session.state = 'ABANDONED';
  run.lockpick = null;
  // ABANDONED preserves the attempt (disconnect-friendly): attemptAvailable stays true.
  ctx.emit({
    type: 'lockpickEnd',
    sessionId: session.sessionId,
    outcome: 'abandoned',
    pid: r.meta.entityId,
  });
}

/** Tear down any active lockpick session on a run (player left / disconnected). */
export function abandonLockpick(ctx: SimContext, run: DelveRun): void {
  const session = run.lockpick;
  if (session?.state !== 'IN_PROGRESS') return;
  session.state = 'ABANDONED';
  run.lockpick = null;
  ctx.emit({
    type: 'lockpickEnd',
    sessionId: session.sessionId,
    outcome: 'abandoned',
    pid: session.ownerId,
  });
}

function lockpickSucceed(ctx: SimContext, run: DelveRun, session: LockSession): void {
  session.state = 'SUCCESS';
  const state = run.objectState[session.chestId];
  const obj = ctx.entities.get(session.chestId);
  const ownerCls = ctx.players.get(session.ownerId)?.cls ?? 'warrior';
  // A solved Bountiful Coffer guarantees the signature rare (see §7.6).
  const isCoffer = run.bountiful && session.chestId === run.rewardChestId;
  const items = delveChestItemsForTier(session.lootTier, ownerCls, ctx.rng, isCoffer);
  if (state) {
    state.looted = true;
    state.open = true;
    state.triggered = true;
    state.attemptAvailable = false;
    state.lootedTier = session.lootTier;
    state.pendingLoot = items.map((s) => ({ ...s }));
    // Loot belongs to the picker; record it so a non-picker party member who is
    // also standing on the chest cannot front-run the collect.
    state.lootOwnerId = session.ownerId;
  }
  if (obj) {
    obj.name = 'Opened Chest';
    obj.templateId = 'delve_reward_chest';
  }
  grantDelveRewards(ctx, run);
  grantLockpickBonus(ctx, run, session.lootTier);
  openDelveSurfaceExit(ctx, run);
  ctx.emit({ type: 'delveChestLoot', chestId: session.chestId, items, pid: session.ownerId });
  ctx.emit({
    type: 'lockpickEnd',
    sessionId: session.sessionId,
    outcome: 'success',
    lootTier: session.lootTier,
    pid: session.ownerId,
  });
  run.lockpick = null;
}

function lockpickFail(ctx: SimContext, run: DelveRun, session: LockSession): void {
  session.state = 'FAILED';
  const state = run.objectState[session.chestId];
  if (state) state.attemptAvailable = false; // chest lost, re-clear the delve
  ctx.emit({
    type: 'lockpickEnd',
    sessionId: session.sessionId,
    outcome: 'fail',
    pid: session.ownerId,
  });
  if (run.partyKey) {
    for (const pid of ctx.partyMembersForKey(run.partyKey)) {
      ctx.emit({
        type: 'log',
        text: 'The last pick snaps. The lock jams. The chest is lost unless you clear the delve again.',
        color: '#f88',
        pid,
      });
    }
  }
  // The boss is already dead and the chest is now jammed: open the surface exit
  // so a failed pick can never strand the party in a cleared delve. (Success
  // opens it via lockpickSuccess; this mirrors that for the failure path.)
  openDelveSurfaceExit(ctx, run);
  run.lockpick = null;
}

/** Loot-tier bonus on top of the base delve chest rewards (marks + copper). */
function grantLockpickBonus(
  ctx: SimContext,
  run: DelveRun,
  tier: 'premium' | 'medium' | 'low',
): void {
  const reward = LOCKPICK_TIER_REWARD[tier];
  const delve = DELVES[run.delveId];
  const members = run.partyKey ? ctx.partyMembersForKey(run.partyKey) : [];
  const baseCopper = Math.round((delve.baseRewards.copperMin + delve.baseRewards.copperMax) / 2);
  const bonusCopper = Math.round(baseCopper * (reward.copperMult - 1));
  for (const pid of members) {
    const meta = ctx.players.get(pid);
    if (!meta) continue;
    meta.delveMarks += reward.bonusMarks;
    meta.copper += bonusCopper;
    // Structured (no prose crosses the sim boundary): the client builds the
    // localized "spoils" line from the tier token and formats the numbers.
    ctx.emit({
      type: 'lockpickBonus',
      tier,
      marks: reward.bonusMarks,
      copper: bonusCopper,
      pid,
    });
  }
}

/** Read-only projection of the active lockpick attempt for IWorld (offline). */
export function lockpickViewFor(ctx: SimContext, pid?: number): LockpickView | null {
  const r = ctx.resolve(pid);
  if (!r) return null;
  const run = ctx.delveRunForPlayer(r.meta.entityId);
  const s = run?.lockpick ?? null;
  if (s?.state !== 'IN_PROGRESS' || s.ownerId !== r.meta.entityId) return null;
  const spec = s.pages[s.pageIndex];
  return {
    sessionId: s.sessionId,
    objectId: s.chestId,
    w: spec.tier.cols,
    h: spec.tier.rows,
    col: s.col,
    row: s.row,
    page: s.pageIndex + 1,
    pageCount: s.pages.length,
    tries: s.triesLeft,
    triesTotal: s.triesTotal,
    lootTier: s.lootTier,
    allowed: spec.tier.allowedActions.slice(),
    visible: visibleCells(spec, s.col, spec.tier.visibilityWindow),
    stepTimeoutMs: ANTE_TO_STEP_TIMEOUT_MS[s.ante],
  };
}
