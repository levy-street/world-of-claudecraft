// Player job-contract lifecycle service ("paid bodyguard"). Pure orchestration:
// it owns the state machine (pending_deposit → open → active → released/refunded)
// and drives the milestone engine, but reaches the database, the chain, and the
// live sim only through injected interfaces — so it's unit-tested with in-memory
// fakes (tests/job_contracts.test.ts), mirroring server/social.ts's SocialDb seam.
// No SQL here (that's jobs_db.ts); no direct @solana/web3 (that's job_escrow.ts);
// no Sim import (the observation source lives in game.ts).
import {
  type JobMilestone, type JobProgress, type JobObservation, type JobConfig,
  stepJob, initialProgress,
} from './job_milestone';

// pending_deposit: posted, awaiting the payer's on-chain deposit.
// open: funded + verified, offered to the helper (payer may still cancel).
// active: helper accepted; the milestone engine is now tracking it.
// released / refunded: terminal, settled on-chain.
export type JobLifecycle = 'pending_deposit' | 'open' | 'active' | 'released' | 'refunded';

export interface JobParty {
  accountId: number;
  characterId: number;
  name: string;
  wallet: string;
}

export interface JobRecord {
  jobId: bigint;
  realm: string;
  payer: JobParty;     // also the SUBJECT the milestone tracks
  helper: JobParty;
  currency: string;    // 'WOC' | 'USDC'
  mint: string;
  amountBase: bigint;
  milestone: JobMilestone;
  progress: JobProgress;
  status: JobLifecycle;
  deadlineSec: number; // wall-clock unix seconds
  jobPda: string;
  vault: string;
  depositSig: string | null;
  settleSig: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface JobsDb {
  nextJobId(): Promise<bigint>;
  insertJob(job: JobRecord): Promise<void>;
  getJob(jobId: bigint): Promise<JobRecord | null>;
  updateJob(jobId: bigint, patch: Partial<Pick<JobRecord, 'status' | 'progress' | 'depositSig' | 'settleSig'>>): Promise<void>;
  listActiveJobs(realm: string): Promise<JobRecord[]>;
  listJobsForCharacter(characterId: number, limit?: number): Promise<JobRecord[]>;
}

export interface JobEscrowOps {
  buildOpenTransaction(args: { jobId: bigint; payer: string; helper: string; mint: string; amountBase: bigint }): Promise<{ txBase64: string; jobPda: string; vault: string }>;
  verifyDeposit(args: { signature: string; jobId: bigint; payer: string; helper: string; mint: string; amountBase: bigint }): Promise<boolean>;
  releaseJob(args: { jobId: bigint; payer: string; helper: string; mint: string }): Promise<string>;
  refundJob(args: { jobId: bigint; payer: string; mint: string }): Promise<string>;
  jobAccountExists(jobId: bigint): Promise<boolean>;
}

/** Computes a JobObservation from the live sim; null when the subject is offline. */
export interface JobObservationSource {
  observe(job: JobRecord): JobObservation | null;
}

export interface CreateJobInput {
  payer: JobParty;
  helper: JobParty;
  currency: string;
  mint: string;
  amountBase: bigint;
  milestone: JobMilestone;
  deadlineSec: number;
}

export class JobContractService {
  // Funded, non-terminal jobs (open + active). The durable store is the DB; this
  // is the working set the per-tick evaluator iterates without hitting Postgres.
  private readonly activeJobs = new Map<string, JobRecord>();
  // Jobs whose settle (release/refund) is in flight, so the next tick doesn't
  // re-fire it. Keyed by jobId string.
  private readonly settling = new Set<string>();

  constructor(
    private readonly db: JobsDb,
    private readonly escrow: JobEscrowOps,
    private readonly source: JobObservationSource,
    private readonly realm: string,
  ) {}

  /** Reload funded, non-terminal jobs at boot so the evaluator + recovery resume. */
  async loadActive(): Promise<void> {
    this.activeJobs.clear();
    for (const job of await this.db.listActiveJobs(this.realm)) {
      this.activeJobs.set(key(job.jobId), job);
    }
  }

  /** Open + active jobs currently tracked in memory (for status/metrics). */
  trackedCount(): number {
    return this.activeJobs.size;
  }

  /**
   * Post a job: build the payer's unsigned escrow-deposit transaction and persist
   * the contract as `pending_deposit`. The payer signs + submits the returned tx,
   * then calls confirmDeposit with the signature.
   */
  async createQuote(input: CreateJobInput): Promise<{ jobId: bigint; txBase64: string; jobPda: string; amountBase: bigint }> {
    if (input.payer.wallet === input.helper.wallet) {
      throw new Error('the payer and helper must be different wallets');
    }
    if (input.amountBase <= 0n) throw new Error('reward must be greater than zero');

    const jobId = await this.db.nextJobId();
    const built = await this.escrow.buildOpenTransaction({
      jobId,
      payer: input.payer.wallet,
      helper: input.helper.wallet,
      mint: input.mint,
      amountBase: input.amountBase,
    });
    const job: JobRecord = {
      jobId,
      realm: this.realm,
      payer: input.payer,
      helper: input.helper,
      currency: input.currency,
      mint: input.mint,
      amountBase: input.amountBase,
      milestone: input.milestone,
      progress: initialProgress(),
      status: 'pending_deposit',
      deadlineSec: input.deadlineSec,
      jobPda: built.jobPda,
      vault: built.vault,
      depositSig: null,
      settleSig: null,
    };
    await this.db.insertJob(job);
    return { jobId, txBase64: built.txBase64, jobPda: built.jobPda, amountBase: input.amountBase };
  }

  /** Verify the payer's deposit landed in escrow and open the job to the helper. */
  async confirmDeposit(jobId: bigint, signature: string, payerAccountId: number): Promise<JobRecord> {
    const job = await this.db.getJob(jobId);
    if (!job) throw new Error('job not found');
    if (job.payer.accountId !== payerAccountId) throw new Error('only the payer can confirm the deposit');
    if (job.status !== 'pending_deposit') {
      if (job.status === 'open' || job.status === 'active') return job; // idempotent re-confirm
      throw new Error('job is not awaiting a deposit');
    }
    const ok = await this.escrow.verifyDeposit({
      signature,
      jobId,
      payer: job.payer.wallet,
      helper: job.helper.wallet,
      mint: job.mint,
      amountBase: job.amountBase,
    });
    if (!ok) throw new Error('deposit not confirmed on-chain yet — retry once it finalizes');
    job.status = 'open';
    job.depositSig = signature;
    await this.db.updateJob(jobId, { status: 'open', depositSig: signature });
    this.activeJobs.set(key(jobId), job);
    return job;
  }

  /** The helper accepts the offered job; the milestone engine starts tracking it. */
  async accept(jobId: bigint, helperAccountId: number): Promise<JobRecord> {
    const job = this.activeJobs.get(key(jobId)) ?? await this.db.getJob(jobId);
    if (!job) throw new Error('job not found');
    if (job.helper.accountId !== helperAccountId) throw new Error('only the named helper can accept this job');
    if (job.status === 'active') return job; // idempotent
    if (job.status !== 'open') throw new Error('job is not open for acceptance');
    job.status = 'active';
    await this.db.updateJob(jobId, { status: 'active' });
    this.activeJobs.set(key(jobId), job);
    return job;
  }

  /** Payer cancels an OPEN (funded, not-yet-accepted) job → refund. Once a helper
   *  has accepted, only the milestone or the deadline can settle it (no griefing). */
  async cancel(jobId: bigint, payerAccountId: number): Promise<void> {
    const job = this.activeJobs.get(key(jobId)) ?? await this.db.getJob(jobId);
    if (!job) throw new Error('job not found');
    if (job.payer.accountId !== payerAccountId) throw new Error('only the payer can cancel this job');
    if (job.status !== 'open') throw new Error('only an unaccepted job can be cancelled');
    job.progress = { status: 'voided', startedSec: null, reason: 'cancelled' };
    await this.settle(job, 'refund');
  }

  /** Jobs touching a character (posted or hired), newest first — for the UI. */
  listForCharacter(characterId: number, limit = 25): Promise<JobRecord[]> {
    return this.db.listJobsForCharacter(characterId, limit);
  }

  /**
   * One evaluation pass over every funded, non-terminal job. Called each sim tick
   * by game.ts with the wall-clock time. It resumes any settle that didn't durably
   * finish, enforces the deadline (even while the subject is offline), and steps
   * the milestone engine for active jobs whose subject is observable.
   */
  evaluateTick(nowSec: number): void {
    for (const job of this.activeJobs.values()) {
      if (this.settling.has(key(job.jobId))) continue;

      // Resume a settle that completed in the engine but not on-chain/DB (e.g. a
      // crash between detecting completion and confirming the payout).
      if (job.progress.status === 'completed') { void this.settle(job, 'release'); continue; }
      if (job.progress.status === 'voided') { void this.settle(job, 'refund'); continue; }

      // Hard deadline → refund, regardless of whether the subject is online.
      if (nowSec >= job.deadlineSec) {
        job.progress = { status: 'voided', startedSec: job.progress.startedSec, reason: 'expired' };
        void this.settle(job, 'refund');
        continue;
      }

      // Only an accepted job tracks its milestone; an unaccepted 'open' job just
      // waits (it can only expire above, or be cancelled by the payer).
      if (job.status !== 'active') continue;

      const obs = this.source.observe(job);
      if (!obs) continue; // subject offline this tick — no progress, no penalty

      const next = stepJob(this.configFor(job), job.progress, obs);
      if (next.status === job.progress.status && next.startedSec === job.progress.startedSec) continue;

      job.progress = next;
      if (next.status === 'completed') { void this.settle(job, 'release'); }
      else if (next.status === 'voided') { void this.settle(job, 'refund'); }
      else { void this.persistProgress(job); } // survive-timer start/reset
    }
  }

  private configFor(job: JobRecord): JobConfig {
    return { milestone: job.milestone, deadlineSec: job.deadlineSec, requireHelperPresent: true };
  }

  private async persistProgress(job: JobRecord): Promise<void> {
    try {
      await this.db.updateJob(job.jobId, { progress: job.progress });
    } catch (err) {
      console.error(`[jobs] failed to persist progress for job ${job.jobId}:`, err);
    }
  }

  /**
   * Move the escrow on-chain and finalize the record. Idempotent: if the on-chain
   * job account is already gone (a prior settle landed before a crash), it just
   * records the terminal state. On a chain error it leaves the job in the working
   * set so the next tick retries — funds are never stranded.
   */
  private async settle(job: JobRecord, kind: 'release' | 'refund'): Promise<void> {
    const k = key(job.jobId);
    if (this.settling.has(k)) return;
    this.settling.add(k);
    this.activeJobs.delete(k);
    const terminal: JobLifecycle = kind === 'release' ? 'released' : 'refunded';
    try {
      let signature = job.settleSig;
      const stillEscrowed = await this.escrow.jobAccountExists(job.jobId);
      if (stillEscrowed) {
        signature = kind === 'release'
          ? await this.escrow.releaseJob({ jobId: job.jobId, payer: job.payer.wallet, helper: job.helper.wallet, mint: job.mint })
          : await this.escrow.refundJob({ jobId: job.jobId, payer: job.payer.wallet, mint: job.mint });
      }
      job.status = terminal;
      job.settleSig = signature;
      await this.db.updateJob(job.jobId, { status: terminal, progress: job.progress, settleSig: signature });
    } catch (err) {
      console.error(`[jobs] ${kind} failed for job ${job.jobId}; will retry:`, err);
      this.activeJobs.set(k, job); // retry next tick
    } finally {
      this.settling.delete(k);
    }
  }
}

function key(jobId: bigint): string {
  return jobId.toString();
}
