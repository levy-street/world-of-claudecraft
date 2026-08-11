// Refer-a-friend bond stamping service (docs/prd/refer-a-friend.md).
//
// The server owns WHEN a bond exists: the referral graph (referrals_db.ts) says
// who is bonded, and the durable characters.level column plus live level-up
// events say when the bond ends (BOND_END_LEVEL promotes the referral to
// completed). This service turns those facts into the session-only
// PlayerMeta.bondBuff stamp via Sim.setPlayerBond, exactly the guildMembership
// re-stamp shape: recomputed on every join, leave, and bond-ending level-up of
// either side. The sim then decides per-award activity (partied + same place)
// deterministically in src/sim/bond_buff.ts.
//
// All DB work rides a per-process FIFO promise tail the game loop never awaits
// (the deeds_records.ts runtime shape): recomputes serialize in arrival order,
// a failure logs and never throws into the caller, and the join-time
// refreshReferralStatuses call doubles as the offline-ding reconcile (a referee
// who reached BOND_END_LEVEL while everyone was offline completes at the next
// touch of either account).
import type { BondBuffStamp } from '../src/sim/bond_buff';
import { referralProgramConfig } from './referral_program';
import {
  activeBondEdgesForAccount,
  completeReferralsForReferee,
  refreshReferralStatuses,
} from './referrals_db';

/** The narrow session view the service needs (a ClientSession satisfies it). */
export interface BondSessionView {
  pid: number;
  characterId: number;
}

/** The host surface (GameServer) the service stamps through. */
export interface ReferralBondHost {
  /** Live sessions for an account on this realm (bounded by the per-account cap). */
  sessionsForAccount(accountId: number): BondSessionView[];
  setPlayerBond(pid: number, stamp: BondBuffStamp | null): void;
}

export interface ReferralBondDb {
  activeBondEdgesForAccount: typeof activeBondEdgesForAccount;
  completeReferralsForReferee: typeof completeReferralsForReferee;
  refreshReferralStatuses: typeof refreshReferralStatuses;
}

const REAL_BOND_DB: ReferralBondDb = {
  activeBondEdgesForAccount,
  completeReferralsForReferee,
  refreshReferralStatuses,
};

export class ReferralBondService {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly host: ReferralBondHost,
    private readonly db: ReferralBondDb = REAL_BOND_DB,
  ) {}

  /**
   * A session of this account joined or left. Fire-and-forget: the recompute
   * runs on the FIFO tail off the game loop.
   */
  onSessionChange(accountId: number): void {
    this.tail = this.tail
      .then(() => this.recompute(accountId))
      .catch((err) => console.error('referral bond recompute failed:', err));
  }

  /**
   * The server SAW this referee's live level-up reach BOND_END_LEVEL. The
   * durable characters.level column lags that event by up to one autosave, so
   * the row-driven refresh inside recompute would not promote yet; complete the
   * referral off the event first, then recompute stamps for both sides.
   */
  onRefereeBondEnd(accountId: number): void {
    this.tail = this.tail
      .then(async () => {
        const completed = await this.db.completeReferralsForReferee(accountId);
        await this.recompute(accountId);
        // The completed referrals' edges are gone, so the recompute above can
        // no longer see those referrers as partners; restamp them explicitly
        // or they would keep a stale stamp naming this referee.
        const cfg = referralProgramConfig();
        const referrers = new Set(completed.map((pair) => pair.referrerAccountId));
        referrers.delete(accountId);
        for (const referrerAccountId of referrers) {
          await this.stampAccount(referrerAccountId, cfg);
        }
      })
      .catch((err) => console.error('referral bond completion failed:', err));
  }

  /** Await the FIFO tail (tests only). */
  idle(): Promise<void> {
    return this.tail.then(
      () => {},
      () => {},
    );
  }

  private async recompute(accountId: number): Promise<void> {
    const cfg = referralProgramConfig();
    // Promote statuses from durable truth first, so a completed referral drops
    // out of the edge set before stamps are recomputed.
    await this.db.refreshReferralStatuses(accountId, cfg.bondEndLevel);
    const partners = await this.stampAccount(accountId, cfg);
    // One hop is enough: only this account's liveness/level changed, so only
    // its own stamps and its direct partners' stamps can be stale.
    for (const partnerAccountId of partners) {
      await this.stampAccount(partnerAccountId, cfg);
    }
  }

  /** Restamp every live session of one account; returns its partner accounts. */
  private async stampAccount(
    accountId: number,
    cfg: ReturnType<typeof referralProgramConfig>,
  ): Promise<number[]> {
    const edges = await this.db.activeBondEdgesForAccount(accountId);
    const partnerAccounts = [
      ...new Set(
        edges.map((e) =>
          e.refereeAccountId === accountId ? e.referrerAccountId : e.refereeAccountId,
        ),
      ),
    ];
    const sessions = this.host.sessionsForAccount(accountId);
    if (sessions.length === 0) return partnerAccounts;
    // Bond activity needs both sides ONLINE (partied + co-located is checked in
    // the sim per award), so the stamp carries only the partner characters with
    // a live session on this realm; partner join/leave re-stamps via its own
    // onSessionChange.
    const partnerCharacterIds: number[] = [];
    for (const partnerAccountId of partnerAccounts) {
      for (const partnerSession of this.host.sessionsForAccount(partnerAccountId)) {
        partnerCharacterIds.push(partnerSession.characterId);
      }
    }
    for (const session of sessions) {
      this.host.setPlayerBond(
        session.pid,
        partnerCharacterIds.length > 0
          ? {
              partnerCharacterIds,
              multiplier: cfg.bondXpMultiplier,
              summonCooldownSeconds: cfg.summonCooldownSeconds,
            }
          : null,
      );
    }
    return partnerAccounts;
  }
}
