// The Thornhollow Fields queue-pop confirmation: a timed Accept / Decline
// prompt between the matchmaker choosing ten fighters and the match actually
// starting.
//
// Why it exists: a queue pop used to seat whoever the matchmaker picked, present
// or not. A player who walked away kept their spot in line, got seated, and then
// stood in a keep for the whole match while their team played four against five.
// Confirming costs everyone thirty seconds; NOT confirming costs one side the
// match.
//
// The model is the Dungeon Finder's proposal (social/dungeon_finder.ts), on
// purpose: it is the same question in the same shape, it was tuned against real
// play, and two queues that answer a pop differently would be a bug report. Three
// of its decisions are load-bearing and copied deliberately:
//
//  - SILENCE IS A DECLINE. Someone who never answers is exactly the away player
//    this feature exists to catch. Returning them to the queue would let them
//    cycle forever, blowing up pop after pop for everyone else, so a lapsed
//    proposal blames every fighter who did not accept, not just the ones who
//    pressed Decline.
//  - A GROUP FALLS WITH ITS MEMBER. A queued party is one indivisible unit to
//    the matchmaker, so it cannot be seated without one of its own. Its innocent
//    members leave the queue with a different line saying why.
//  - EVERYONE ELSE KEEPS THEIR PLACE. Returned groups carry their ORIGINAL
//    `waited`, so answering promptly and being sent back by someone else's
//    silence never costs a player the wait they already served.
//
// State (the proposal list) lives on Sim as a live `ctx` view like every other
// battleground collection; this module holds only functions. It draws NO rng: it
// decides who is seated, never anything about the match itself.

import type { SimContext } from '../sim_context';
import type { BgQueueGroup } from './battleground';

/** Seconds a fighter has to answer before silence is read as a decline. */
export const BG_PROPOSAL_SECONDS = 30;

/**
 * Requeue lockout after failing a proposal, in seconds. Deliberately equal to
 * the answer window rather than to the finder's longer cooldown: this is a 5v5
 * that needs ten people, so parking a returning player for a full minute mostly
 * punishes the eight who answered and are still waiting. It exists to stop an
 * away client from re-entering the very next pop, which one window achieves.
 */
export const BG_PROPOSAL_LOCKOUT_SECONDS = 30;

export interface BgProposal {
  id: number;
  /** The seating the matchmaker chose, held intact so an accept-all can seat it. */
  teams: [number[], number[]];
  /** The queue groups consumed, so survivors return with their original wait. */
  groups: BgQueueGroup[];
  /** True when at least one consumed group queued together (premade provenance). */
  grouped: boolean;
  /** The battleground slot reserved for this proposal. */
  slot: number;
  accepted: Set<number>;
  /** Sim time at which silence becomes a decline. */
  expiresAt: number;
}

export function bgProposalPids(proposal: BgProposal): number[] {
  return [...proposal.teams[0], ...proposal.teams[1]];
}

export function bgProposalFor(ctx: SimContext, pid: number): BgProposal | null {
  return ctx.bgProposals.find((p) => bgProposalPids(p).includes(pid)) ?? null;
}

/** Whole seconds left to answer, floored at 0 and rounded up for display. */
export function bgProposalRemaining(ctx: SimContext, proposal: BgProposal): number {
  return Math.max(0, Math.ceil(proposal.expiresAt - ctx.time));
}

export function bgRequeueLockedUntil(ctx: SimContext, pid: number): number {
  const until = ctx.bgProposalLockouts.get(pid);
  if (until === undefined) return 0;
  if (until <= ctx.time) {
    ctx.bgProposalLockouts.delete(pid);
    return 0;
  }
  return until;
}

/**
 * Every fighter in a proposal who has NOT accepted, which is the offender set a
 * lapsed proposal blames. Pure over the proposal, so the "silence is a decline"
 * rule is one readable expression rather than a branch inside the sweep.
 */
export function bgProposalSilentPids(proposal: BgProposal): number[] {
  return bgProposalPids(proposal).filter((pid) => !proposal.accepted.has(pid));
}

/**
 * Hold the matchmaker's pick as a proposal instead of seating it. The slot is
 * reserved up front so a second pop cannot claim the field this one is waiting
 * for, and released again by `failBgProposal` if the ten never assemble.
 */
export function openBgProposal(
  ctx: SimContext,
  teams: [number[], number[]],
  groups: BgQueueGroup[],
  slot: number,
  grouped: boolean,
): BgProposal {
  const proposal: BgProposal = {
    id: ctx.nextBgProposalId++,
    teams,
    groups,
    grouped,
    slot,
    accepted: new Set(),
    expiresAt: ctx.time + BG_PROPOSAL_SECONDS,
  };
  ctx.bgProposals.push(proposal);
  ctx.bgBusySlots.add(slot);
  for (const pid of bgProposalPids(proposal)) {
    ctx.emit({ type: 'bgProposed', seconds: BG_PROPOSAL_SECONDS, pid });
    ctx.emit({
      type: 'log',
      text: 'Thornhollow Fields is ready. Accept to join the battle.',
      color: '#7fd4ff',
      pid,
    });
  }
  return proposal;
}

function removeBgProposal(ctx: SimContext, proposal: BgProposal): void {
  const idx = ctx.bgProposals.indexOf(proposal);
  if (idx >= 0) ctx.bgProposals.splice(idx, 1);
  ctx.bgBusySlots.delete(proposal.slot);
}

/**
 * Tear a proposal down and sort its fighters into the two outcomes.
 *
 * `offenders` are the fighters who did not accept (a decline, or silence when
 * the window lapsed). Their whole GROUP leaves the queue with them, because the
 * matchmaker treats a queued party as indivisible and cannot seat it without one
 * of its own; the innocent members of that group get their own line so the
 * refusal never reads as their fault. Every other group returns to the queue
 * carrying its original `waited`.
 */
export function failBgProposal(
  ctx: SimContext,
  proposal: BgProposal,
  offenders: Set<number>,
): void {
  removeBgProposal(ctx, proposal);
  for (const group of proposal.groups) {
    if (!group.pids.some((pid) => offenders.has(pid))) {
      ctx.bgQueue.push(group);
      for (const pid of group.pids) {
        ctx.emit({
          type: 'log',
          text: 'The battle did not fill. You keep your place in the Thornhollow Fields queue.',
          color: '#7fd4ff',
          pid,
        });
      }
      continue;
    }
    for (const pid of group.pids) {
      if (offenders.has(pid))
        ctx.bgProposalLockouts.set(pid, ctx.time + BG_PROPOSAL_LOCKOUT_SECONDS);
      ctx.emit({ type: 'bgUnqueued', pid });
      ctx.emit({
        type: 'log',
        text: offenders.has(pid)
          ? 'You leave the Thornhollow Fields queue.'
          : 'Your group leaves the Thornhollow Fields queue.',
        color: '#7fd4ff',
        pid,
      });
    }
  }
}

/**
 * Answer a live proposal. Returns the proposal when THIS response completed it
 * (every fighter has accepted), so the caller seats it; null otherwise. The
 * caller owns seating rather than this module, which keeps the dependency
 * one-way: the proposal knows the queue, never the match.
 */
export function bgProposalRespond(
  ctx: SimContext,
  accept: boolean,
  pid?: number,
): BgProposal | null {
  const r = ctx.resolve(pid);
  if (!r) return null;
  const id = r.meta.entityId;
  const proposal = bgProposalFor(ctx, id);
  if (!proposal) {
    ctx.error(id, 'You have no Thornhollow Fields invitation to answer.');
    return null;
  }
  if (!accept) {
    failBgProposal(ctx, proposal, new Set([id]));
    return null;
  }
  if (proposal.accepted.has(id)) return null;
  proposal.accepted.add(id);
  ctx.emit({ type: 'bgProposalUpdate', accepted: proposal.accepted.size, pid: id });
  return proposal.accepted.size === bgProposalPids(proposal).length ? proposal : null;
}

/**
 * Expire lapsed proposals. Seating never happens here: a proposal can only
 * complete on the last accept, so this path has exactly one outcome, and every
 * fighter still silent at the deadline is blamed for it.
 */
export function sweepBgProposals(ctx: SimContext): void {
  for (const proposal of [...ctx.bgProposals]) {
    if (proposal.expiresAt > ctx.time) continue;
    failBgProposal(ctx, proposal, new Set(bgProposalSilentPids(proposal)));
  }
}

/**
 * Drop one pid out of a live proposal (the disconnect path). The proposal fails
 * with them as the offender: nine people must not hold a reserved field open for
 * a client that is gone, and the eight or nine who answered keep their place.
 */
export function bgProposalDisconnect(ctx: SimContext, pid: number): boolean {
  const proposal = bgProposalFor(ctx, pid);
  if (!proposal) return false;
  failBgProposal(ctx, proposal, new Set([pid]));
  return true;
}
