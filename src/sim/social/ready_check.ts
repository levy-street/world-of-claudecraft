// Raid/party ready check. The party (or raid) leader runs `/ready`; every OTHER
// member's client plays a sound and shows a yes/no prompt (the readyCheckStart
// event), and the leader is auto-marked ready. Members answer yes/no; anyone still
// pending READY_CHECK_SECONDS later is marked "no response". The outcome is announced
// to the whole party as chat/log lines. State lives on Sim as `ctx.readyChecks`
// (party id -> ReadyCheck); this module owns the logic. Draws NO rng, uses the sim
// clock (ctx.time) not wall-clock, so replays and the parity gate stay byte-stable.
import type { SimContext } from '../sim_context';
import type { ReadyCheck } from '../types';

// Classic-era ready checks give stragglers 30 seconds; anyone still pending then is
// tallied as "no response".
export const READY_CHECK_SECONDS = 30;

export function readyCheckStart(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const party = ctx.partyOf(r.meta.entityId);
  if (!party) {
    ctx.error(r.meta.entityId, 'You must be in a party to start a ready check.');
    return;
  }
  if (party.leader !== r.meta.entityId) {
    ctx.error(r.meta.entityId, 'You are not the party leader.');
    return;
  }
  if (ctx.readyChecks.has(party.id)) {
    ctx.error(r.meta.entityId, 'A ready check is already in progress.');
    return;
  }
  const responses = new Map<number, 'ready' | 'notready' | 'pending'>();
  for (const mPid of party.members) {
    // The initiator is auto-ready (and gets no prompt), mirroring the classic client.
    responses.set(mPid, mPid === r.meta.entityId ? 'ready' : 'pending');
  }
  ctx.readyChecks.set(party.id, {
    partyId: party.id,
    initiator: r.meta.entityId,
    endsAt: ctx.time + READY_CHECK_SECONDS,
    responses,
  });
  const fromName = r.meta.name;
  for (const mPid of party.members) {
    // The initiator is auto-ready and gets no prompt; every other member does.
    if (mPid !== r.meta.entityId) ctx.emit({ type: 'readyCheckStart', fromName, pid: mPid });
  }
}

export function readyCheckRespond(ctx: SimContext, ready: boolean, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const party = ctx.partyOf(r.meta.entityId);
  if (!party) return;
  const check = ctx.readyChecks.get(party.id);
  if (!check || !check.responses.has(r.meta.entityId)) return;
  check.responses.set(r.meta.entityId, ready ? 'ready' : 'notready');
  // Finalize the moment no member is still pending.
  let pending = false;
  for (const state of check.responses.values()) if (state === 'pending') pending = true;
  if (!pending) finalizeReadyCheck(ctx, check);
}

// End-of-tick sweep: finalize any check whose timer has elapsed. Wired into the
// fixed end-of-tick system block, next to updateTradesAndInvites.
export function updateReadyChecks(ctx: SimContext): void {
  for (const check of [...ctx.readyChecks.values()]) {
    // Finalize on timeout, or as soon as nobody is still pending. The pending
    // sweep also catches a check emptied by a leaver whose slot was dropped
    // (social/party.ts) so the rest do not eat the full timeout.
    const pending = [...check.responses.values()].some((s) => s === 'pending');
    if (ctx.time >= check.endsAt || !pending) finalizeReadyCheck(ctx, check);
  }
}

function finalizeReadyCheck(ctx: SimContext, check: ReadyCheck): void {
  ctx.readyChecks.delete(check.partyId);
  let ready = 0;
  let notReady = 0;
  let noResponse = 0;
  for (const state of check.responses.values()) {
    if (state === 'ready') ready++;
    else if (state === 'notready') notReady++;
    else noResponse++; // still pending at finalize -> no response
  }
  // One counts-only summary line to every participant (the yes/no answers stay
  // private, as in the classic client). Numbers are re-localized client-side.
  for (const mPid of check.responses.keys()) {
    ctx.notice(
      mPid,
      `Ready check: ${ready} ready, ${notReady} not ready, ${noResponse} no response.`,
    );
  }
}
