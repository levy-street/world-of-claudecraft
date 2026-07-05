// Engagement service: the authoritative orchestration that ties the pure cores
// (fairness, prize table, pack gacha, streak) to persistence (EngagementDb). It
// owns the daily commit-reveal lifecycle, the one-spin-per-UTC-day rule, settle
// idempotency, the streak credit, and the burn-replay-guarded pack open. No SQL
// here (that is EngagementDb); no DOM, no t() (server stays language-agnostic).
import {
  EngagementConfig,
} from './engagement_config';
import {
  commitFor,
  generateDailySeed,
  deriveOutcomeUnit,
  packUnit,
} from './fairness';
import {
  DEFAULT_PRIZE_TABLE,
  PrizeTier,
  selectPrize,
  scaleTableForTier,
  validatePrizeTable,
} from './spin_prizes';
import { PACKS_BY_ID, rollPack } from './packs';
import { utcDayFromMs, advanceStreak, isNewDay, keysForStreak } from './daily_streak';
import { EngagementDb, SpinRow, PackOpeningInput } from './engagement_db';
import type { PackRollResult } from './packs';
import type { PackPowerPolicy } from './engagement_config';

export interface SpinClaim {
  spin: SpinRow;
  prize: PrizeTier;
}

export interface DailyCredit {
  credited: boolean;
  streak: number;
  keysAwarded: number;
}

export interface PackOpenResult {
  openingId: number;
  result: PackRollResult;
}

export interface EngagementServiceOpts {
  prizeTable?: readonly PrizeTier[];
  now?: () => number;
  makeSeed?: () => Buffer;
}

export class EngagementService {
  private readonly prizeTable: readonly PrizeTier[];
  private readonly now: () => number;
  private readonly makeSeed: () => Buffer;

  constructor(
    private readonly db: EngagementDb,
    private readonly cfg: EngagementConfig,
    opts: EngagementServiceOpts = {},
  ) {
    this.prizeTable = opts.prizeTable ?? DEFAULT_PRIZE_TABLE;
    this.now = opts.now ?? (() => Date.now());
    this.makeSeed = opts.makeSeed ?? generateDailySeed;
    // Fail fast on a misconfigured table: no payout may exceed the on-chain cap,
    // so the program can never be asked to release more than it allows.
    const v = validatePrizeTable(this.prizeTable, this.cfg.spinMaxPayoutLamports);
    if (!v.ok) throw new Error(`EngagementService: invalid prize table (${v.reason})`);
  }

  /** The current UTC day per the service clock. */
  today(): number {
    return utcDayFromMs(this.now());
  }

  /**
   * The public commit for a UTC day, generating + storing the secret seed on
   * first access so the commitment is fixed before any spin can read it. Returns
   * only the public commitment and, once revealed, the seed (never the secret
   * seed before reveal).
   */
  async publicFairness(utcDay: number): Promise<{ utcDay: number; commitHash: string; revealedSeed: string | null }> {
    const row = await this.ensureDailyCommit(utcDay);
    return { utcDay, commitHash: row.commitHash, revealedSeed: row.revealed ? row.seedHex : null };
  }

  private async ensureDailyCommit(utcDay: number) {
    const existing = await this.db.getDailyCommit(utcDay);
    if (existing) return existing;
    const seed = this.makeSeed();
    const row = { utcDay, commitHash: commitFor(seed), seedHex: seed.toString('hex'), revealed: false };
    await this.db.putDailyCommit(row);
    return row;
  }

  /**
   * Claim the daily spin for an account. Enforces one spin per (account, UTC day)
   * at the data layer (throws `already_spun` if a row exists), derives the outcome
   * from the committed daily seed plus the player's client seed, and applies the
   * holder-tier odds scaling. The prize is recorded `pending`; settlement happens
   * on-chain via settleSpin once the keeper pays out. Eligibility (holder gate,
   * antibot) is checked by the caller before this point.
   */
  async claimSpin(opts: {
    accountId: number;
    clientSeed: string;
    holderTier: number;
    utcDay?: number;
    dayNonce?: number;
  }): Promise<SpinClaim> {
    const utcDay = opts.utcDay ?? this.today();
    const existing = await this.db.getSpinForDay(opts.accountId, utcDay);
    if (existing) throw new Error('already_spun');

    const commit = await this.ensureDailyCommit(utcDay);
    const seed = Buffer.from(commit.seedHex, 'hex');
    const dayNonce = opts.dayNonce ?? 1;
    const unit = deriveOutcomeUnit(seed, opts.accountId, dayNonce, opts.clientSeed);
    const table = scaleTableForTier(this.prizeTable, opts.holderTier);
    const prize = selectPrize(table, unit);

    const spin = await this.db.insertSpin({
      accountId: opts.accountId,
      utcDay,
      dayNonce,
      clientSeed: opts.clientSeed,
      prizeKey: prize.key,
      lamports: prize.lamports,
    });
    return { spin, prize };
  }

  /** Read-only spin state for an account on a UTC day (drives /api/spin/status). */
  async spinStatus(accountId: number, utcDay?: number): Promise<{ utcDay: number; alreadySpun: boolean; spin: SpinRow | null }> {
    const day = utcDay ?? this.today();
    const spin = await this.db.getSpinForDay(accountId, day);
    return { utcDay: day, alreadySpun: spin !== null, spin };
  }

  /**
   * Record that a spin's on-chain payout settled. Idempotent: re-settling with
   * the same signature returns the settled row; a different signature for an
   * already-settled spin is a conflict (`already_settled`). The on-chain receipt
   * PDA is the ultimate single-settlement guard; this keeps the DB consistent
   * with it and safe to retry.
   */
  async settleSpin(spinId: number, settleSig: string): Promise<SpinRow> {
    const spin = await this.db.getSpin(spinId);
    if (!spin) throw new Error('no_such_spin');
    if (spin.status === 'settled') {
      if (spin.settleSig === settleSig) return spin;
      throw new Error('already_settled');
    }
    await this.db.markSpinSettled(spinId, settleSig);
    return { ...spin, status: 'settled', settleSig };
  }

  /** Mark a spin's payout as failed so the keeper can surface / retry it. */
  async failSpin(spinId: number): Promise<void> {
    await this.db.markSpinFailed(spinId);
  }

  /**
   * Credit a day of activity toward the login streak. No-op (returns
   * credited:false) if the account was already credited on this UTC day, so it is
   * safe to call on every login. Returns the new streak and the keys it earns.
   */
  async creditDaily(accountId: number, utcDay?: number): Promise<DailyCredit> {
    const day = utcDay ?? this.today();
    const prev = await this.db.getStreak(accountId);
    const prevState = { lastDay: prev.lastDay, streak: prev.streak };
    if (!isNewDay(prevState, day)) {
      return { credited: false, streak: prev.streak, keysAwarded: 0 };
    }
    const next = advanceStreak(prevState, day);
    await this.db.setStreak(accountId, next);
    return { credited: true, streak: next.streak, keysAwarded: keysForStreak(next.streak) };
  }

  /**
   * Rip a pack after its $WOC burn has been verified by the caller. Guards
   * against a replayed burn signature, rolls the contents under the realm's
   * policy with the account's running pity counter, persists the updated counter
   * and the opening (whose tx_sig is UNIQUE, the second replay guard), and returns
   * the revealed contents. `units` are server-derived fair uniforms in [0,1).
   */
  async openPack(opts: {
    accountId: number;
    packId: string;
    txSig: string;
    policy: PackPowerPolicy;
    units: readonly number[];
  }): Promise<PackOpenResult> {
    const pack = PACKS_BY_ID[opts.packId];
    if (!pack) throw new Error('no_such_pack');
    if (await this.db.hasPaymentSig(opts.txSig)) throw new Error('replayed_payment');

    const pity = await this.db.getPity(opts.accountId, opts.packId);
    const result: PackRollResult = rollPack(pack, opts.policy, opts.units, pity);
    await this.db.setPity(opts.accountId, opts.packId, result.opensSincePityAfter);

    const input: PackOpeningInput = {
      accountId: opts.accountId,
      packId: opts.packId,
      txSig: opts.txSig,
      contents: result.rewards,
    };
    const openingId = await this.db.recordPackOpening(input);
    return { openingId, result };
  }

  /**
   * Open a pack with server-derived provably fair rolls. The units are derived
   * from the committed daily seed plus the burn signature, so the contents are
   * fixed the moment the burn lands and are recomputable from the revealed seed.
   * The caller has already verified the burn on-chain. One extra unit is derived
   * for a possible pity pick.
   */
  async openPackFair(opts: {
    accountId: number;
    packId: string;
    txSig: string;
    policy: PackPowerPolicy;
    utcDay?: number;
  }): Promise<PackOpenResult> {
    const pack = PACKS_BY_ID[opts.packId];
    if (!pack) throw new Error('no_such_pack');
    const utcDay = opts.utcDay ?? this.today();
    const commit = await this.ensureDailyCommit(utcDay);
    const seed = Buffer.from(commit.seedHex, 'hex');
    const units: number[] = [];
    for (let i = 0; i < pack.rolls + 1; i++) units.push(packUnit(seed, opts.accountId, opts.txSig, i));
    return this.openPack({ accountId: opts.accountId, packId: opts.packId, txSig: opts.txSig, policy: opts.policy, units });
  }

  /** Reveal the secret seed for a closed day so outcomes can be audited. */
  async revealDay(utcDay: number): Promise<string> {
    const commit = await this.db.getDailyCommit(utcDay);
    if (!commit) throw new Error('no_commit');
    if (!commit.revealed) await this.db.revealDailySeed(utcDay);
    return commit.seedHex;
  }
}
