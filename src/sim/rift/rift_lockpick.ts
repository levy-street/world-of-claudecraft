// Rift locked-cache lockpicking. The giga-boss drops a sealed cache the party can
// pick for bonus copper spoils, reusing the pure "Tumbler's Path" grid engine
// (../lockpick) and the SAME client HUD + wire (the lockpickOffer / lockpickSession /
// lockpickStep / lockpickEnd / lockpickBonus SimEvents) as the delve chests.
//
// Self-contained on purpose: the session lives on RiftInstance (never a DelveRun),
// success/fail credit rift spoils rather than delve rewards, and the delve lockpick
// controller (delves/lockpick_controller.ts) is left entirely untouched. This is the
// second consumer of the shared engine; a third would earn a `LockHost` seam.
//
// The step machine mirrors the delve controller's contract (seeded sub-stream inside
// ../lockpick, deterministic per-step deadline in sim ticks), so it behaves
// identically offline, on the server, and headless. src/sim-pure: no DOM/Three, no
// Math.random/Date.now (enforced by tests/architecture.test.ts).

import type { LockpickView } from '../../world_api';
import { lockpickPresetFor } from '../content/delves/lockpick_tiers';
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
import type { SimContext } from '../sim_context';
import { DT, dist2d, type Entity } from '../types';
import type { RiftInstance } from './types';

// Rifts are endgame content, so their caches use the harder 16-wide "heroic" board.
const RIFT_LOCK_PRESET = 'heroic';
const CACHE_REACH = 3.5; // must be within this of the cache to work the lock

/** Set (or re-arm) the deterministic per-step deadline in sim ticks. */
function armStep(ctx: SimContext, session: LockSession): void {
  const ms = ANTE_TO_STEP_TIMEOUT_MS[session.ante];
  session.stepDeadlineTick = ctx.tickCount + Math.ceil(ms / (DT * 1000));
}

/** Begin a lockpick attempt on the rift cache: commit an ante (1/2/3 picks = loot
 * tier), generate the seeded board, and emit the opening lockpickSession. */
export function riftLockpickEngage(
  ctx: SimContext,
  inst: RiftInstance,
  objectId: number,
  ante: Ante,
  pid?: number,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  if (inst.cacheId === null || objectId !== inst.cacheId) {
    ctx.error(r.meta.entityId, 'You cannot pick that.');
    return;
  }
  if (ante !== 1 && ante !== 2 && ante !== 3) {
    ctx.error(r.meta.entityId, 'Choose 1, 2, or 3 picks.');
    return;
  }
  const cache = ctx.entities.get(inst.cacheId);
  if (!cache || cache.templateId !== 'rift_locked_chest') {
    ctx.emit({ type: 'log', text: 'The chest is empty.', color: '#aaa', pid: r.meta.entityId });
    return;
  }
  if (dist2d(r.e.pos, cache.pos) > CACHE_REACH + 2) {
    ctx.error(r.meta.entityId, 'Move closer to the chest.');
    return;
  }
  if (inst.lockpick && inst.lockpick.state === 'IN_PROGRESS') {
    ctx.error(r.meta.entityId, 'Someone is already working the lock.');
    return;
  }

  const tier = lockpickPresetFor(RIFT_LOCK_PRESET);
  const baseSeed = ((inst.seed >>> 0) ^ (objectId * 0x9e3779b1)) >>> 0;
  const triesTotal = ANTE_TO_TRIES[ante];
  const pages = generateLockPages(baseSeed, tier, ANTE_TO_PAGES[ante]);
  const spec = pages[0];
  const session: LockSession = {
    sessionId: `rlp_${objectId}_${ctx.tickCount}`,
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
    stepDeadlineTick: 0,
    state: 'IN_PROGRESS',
  };
  inst.lockpick = session;
  armStep(ctx, session);
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

/** A failed try (slip/bind/trap or timeout): burn one try; regenerate a fresh board
 * if any remain ('retry'), else 'fail'. Fresh boards defeat memorization. */
function burnTry(ctx: SimContext, session: LockSession): 'retry' | 'fail' {
  session.triesLeft -= 1;
  if (session.triesLeft <= 0) return 'fail';
  const triesUsed = session.triesTotal - session.triesLeft;
  const seed = (session.baseSeed ^ (triesUsed * 0x85ebca6b)) >>> 0;
  session.pages = generateLockPages(seed, session.pages[0].tier, session.pages.length);
  session.pageIndex = 0;
  session.col = 0;
  session.row = session.pages[0].startRow;
  armStep(ctx, session);
  return 'retry';
}

/** Submit one pick action on the active rift attempt (server-authoritative). */
export function riftLockpickAction(
  ctx: SimContext,
  inst: RiftInstance,
  action: PickAction,
  pid?: number,
  sessionId?: string,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const session = inst.lockpick;
  if (!session) {
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
    riftLockpickAbort(ctx, inst, r.meta.entityId, session.sessionId);
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
    result = burnTry(ctx, session);
    spec = session.pages[session.pageIndex];
  } else {
    session.col = step.col;
    session.row = step.row;
    if (result === 'success' && session.pageIndex < session.pages.length - 1) {
      session.pageIndex += 1;
      spec = session.pages[session.pageIndex];
      session.col = 0;
      session.row = spec.startRow;
      result = 'pageCleared';
    }
    armStep(ctx, session);
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

  if (result === 'success') riftLockpickSucceed(ctx, inst, session);
  else if (result === 'fail') riftLockpickFail(ctx, inst, session);
}

/** Per-tick server-authoritative step clock; a passed deadline burns a try. */
export function tickRiftLockpick(ctx: SimContext, inst: RiftInstance): void {
  const s = inst.lockpick;
  if (s?.state !== 'IN_PROGRESS') return;
  if (ctx.tickCount < s.stepDeadlineTick) return;
  const result = burnTry(ctx, s);
  const spec = s.pages[s.pageIndex];
  ctx.emit({
    type: 'lockpickStep',
    sessionId: s.sessionId,
    col: s.col,
    row: s.row,
    page: s.pageIndex + 1,
    pageCount: s.pages.length,
    tries: s.triesLeft,
    triesTotal: s.triesTotal,
    result,
    visible: visibleCells(spec, s.col, spec.tier.visibilityWindow),
    pid: s.ownerId,
  });
  if (result === 'fail') riftLockpickFail(ctx, inst, s);
}

/** Abandon the attempt (player left / disconnected / pressed cancel). The cache is
 * preserved, so a fresh attempt can start. */
export function riftLockpickAbort(
  ctx: SimContext,
  inst: RiftInstance,
  pid?: number,
  sessionId?: string,
): void {
  const r = ctx.resolve(pid);
  const session = inst.lockpick;
  if (!session) return;
  if (r && session.ownerId !== r.meta.entityId) return;
  if (sessionId !== undefined && session.sessionId !== sessionId) return;
  session.state = 'ABANDONED';
  inst.lockpick = null;
  ctx.emit({
    type: 'lockpickEnd',
    sessionId: session.sessionId,
    outcome: 'abandoned',
    pid: session.ownerId,
  });
}

function riftLockpickSucceed(ctx: SimContext, inst: RiftInstance, session: LockSession): void {
  session.state = 'SUCCESS';
  const cache = ctx.entities.get(session.chestId);
  if (cache) {
    cache.name = 'Opened Cache';
    cache.templateId = 'rift_chest_open';
    cache.lootable = false;
    // A bright burst of spoils as the lid springs open.
    ctx.emit({ type: 'spellfxAt', x: cache.pos.x, z: cache.pos.z, school: 'holy', fx: 'nova' });
  }
  // Spoils scale with the run depth and the ante's loot tier. Copper goes straight
  // to the picker's purse (Heroic Marks are the boss-kill reward, not this cache).
  const mult = session.lootTier === 'premium' ? 2.2 : session.lootTier === 'medium' ? 1.5 : 1;
  const copper = Math.round((inst.baseLevel + inst.floorCount) * 90 * mult);
  const meta = ctx.players.get(session.ownerId);
  if (meta) meta.copper += copper;
  ctx.emit({
    type: 'lockpickBonus',
    tier: session.lootTier,
    marks: 0,
    copper,
    pid: session.ownerId,
  });
  ctx.emit({
    type: 'lockpickEnd',
    sessionId: session.sessionId,
    outcome: 'success',
    lootTier: session.lootTier,
    pid: session.ownerId,
  });
  inst.lockpick = null;
}

function riftLockpickFail(ctx: SimContext, inst: RiftInstance, session: LockSession): void {
  session.state = 'FAILED';
  const cache = ctx.entities.get(session.chestId);
  if (cache) {
    cache.name = 'Jammed Cache';
    cache.templateId = 'rift_chest_jammed';
    cache.lootable = false;
    // A dark puff as the last pick snaps and the lock seizes.
    ctx.emit({ type: 'spellfxAt', x: cache.pos.x, z: cache.pos.z, school: 'shadow', fx: 'burst' });
  }
  ctx.emit({
    type: 'lockpickEnd',
    sessionId: session.sessionId,
    outcome: 'fail',
    pid: session.ownerId,
  });
  inst.lockpick = null;
}

/** Read-only projection of the active attempt for IWorld (offline board render). */
export function riftLockpickViewFor(
  ctx: SimContext,
  inst: RiftInstance,
  pid?: number,
): LockpickView | null {
  const r = ctx.resolve(pid);
  if (!r) return null;
  const s = inst.lockpick;
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
