import { describe, expect, it } from 'vitest';
import {
  JobContractService,
  type JobsDb, type JobEscrowOps, type JobObservationSource,
  type JobRecord, type JobParty, type CreateJobInput,
} from '../server/job_contracts';
import type { JobObservation } from '../server/job_milestone';

// ── In-memory fakes (the service reaches DB / chain / sim only via interfaces) ──
class FakeDb implements JobsDb {
  jobs = new Map<string, JobRecord>();
  private seq = 0n;
  async nextJobId() { return ++this.seq; }
  async insertJob(j: JobRecord) { this.jobs.set(j.jobId.toString(), j); }
  async getJob(id: bigint) { return this.jobs.get(id.toString()) ?? null; }
  async updateJob(id: bigint, patch: Partial<JobRecord>) {
    const j = this.jobs.get(id.toString());
    if (j) Object.assign(j, patch);
  }
  async listActiveJobs(realm: string) {
    return [...this.jobs.values()].filter((j) => j.realm === realm && (j.status === 'open' || j.status === 'active'));
  }
  async listPendingJobs(realm: string) {
    return [...this.jobs.values()].filter((j) => j.realm === realm && j.status === 'pending_deposit');
  }
  async listJobsForCharacter(cid: number) {
    return [...this.jobs.values()].filter((j) => j.payer.characterId === cid || j.helper.characterId === cid);
  }
}

class FakeEscrow implements JobEscrowOps {
  released: bigint[] = [];
  refunded: bigint[] = [];
  verifyResult = true;
  jobStateOk = true;      // does the on-chain Job exist on our exact terms?
  exists = true;          // does the on-chain job account still exist?
  failReleaseTimes = 0;   // simulate transient RPC failures
  async buildOpenTransaction(a: { jobId: bigint }) {
    return { txBase64: `TX_${a.jobId}`, jobPda: `PDA_${a.jobId}`, vault: `VAULT_${a.jobId}` };
  }
  async verifyDeposit() { return this.verifyResult; }
  async verifyJobState() { return this.jobStateOk; }
  async releaseJob(a: { jobId: bigint }) {
    if (this.failReleaseTimes > 0) { this.failReleaseTimes--; throw new Error('rpc down'); }
    this.released.push(a.jobId);
    return `REL_${a.jobId}`;
  }
  async refundJob(a: { jobId: bigint }) { this.refunded.push(a.jobId); return `REF_${a.jobId}`; }
  async jobAccountExists() { return this.exists; }
}

class FakeSource implements JobObservationSource {
  obs: JobObservation | null = null;
  observe() { return this.obs; }
}

const payer: JobParty = { accountId: 1, characterId: 11, name: 'Alice', wallet: 'PAYER' };
const helper: JobParty = { accountId: 2, characterId: 22, name: 'Bob', wallet: 'HELPER' };

const input = (over: Partial<CreateJobInput> = {}): CreateJobInput => ({
  payer, helper, currency: 'WOC', mint: 'MINT', amountBase: 1_000_000n,
  milestone: { kind: 'reach_level', target: 10 }, deadlineSec: 9_999_999_999, ...over,
});

const obs = (over: Partial<JobObservation> = {}): JobObservation => ({
  nowSec: 1000, subjectLevel: 1, subjectAlive: true, subjectDiedThisTick: false,
  subjectPos: { x: 0, z: 0 }, helperPresent: true, questTurnIns: [], dungeonClears: [], ...over,
});

function setup() {
  const db = new FakeDb();
  const escrow = new FakeEscrow();
  const source = new FakeSource();
  const svc = new JobContractService(db, escrow, source, 'TestRealm');
  return { db, escrow, source, svc };
}

const flush = () => new Promise((r) => setTimeout(r, 0)); // let fire-and-forget settles resolve

async function openAndAccept(svc: JobContractService): Promise<bigint> {
  const { jobId } = await svc.createQuote(input());
  await svc.confirmDeposit(jobId, 'DEPOSIT_SIG', payer.accountId);
  await svc.accept(jobId, helper.accountId);
  return jobId;
}

describe('job contract lifecycle', () => {
  it('posts a quote (pending_deposit) and returns the deposit tx', async () => {
    const { svc, db } = setup();
    const { jobId, txBase64 } = await svc.createQuote(input());
    expect(txBase64).toBe(`TX_${jobId}`);
    expect((await db.getJob(jobId))!.status).toBe('pending_deposit');
  });

  it('rejects a job to your own wallet', async () => {
    const { svc } = setup();
    await expect(svc.createQuote(input({ helper: { ...helper, wallet: payer.wallet } }))).rejects.toThrow();
  });

  it('opens the job once the deposit verifies', async () => {
    const { svc, db } = setup();
    const { jobId } = await svc.createQuote(input());
    await svc.confirmDeposit(jobId, 'SIG', payer.accountId);
    expect((await db.getJob(jobId))!.status).toBe('open');
  });

  it('refuses to open when the deposit cannot be verified', async () => {
    const { svc, db, escrow } = setup();
    const { jobId } = await svc.createQuote(input());
    escrow.verifyResult = false;
    await expect(svc.confirmDeposit(jobId, 'SIG', payer.accountId)).rejects.toThrow();
    expect((await db.getJob(jobId))!.status).toBe('pending_deposit');
  });

  it('only the named helper can accept', async () => {
    const { svc } = setup();
    const { jobId } = await svc.createQuote(input());
    await svc.confirmDeposit(jobId, 'SIG', payer.accountId);
    await expect(svc.accept(jobId, 999)).rejects.toThrow();
    await expect(svc.accept(jobId, helper.accountId)).resolves.toBeDefined();
  });
});

describe('auto-release on milestone completion', () => {
  it('releases to the helper when the milestone is met with the helper present', async () => {
    const { svc, db, escrow, source } = setup();
    const jobId = await openAndAccept(svc);
    source.obs = obs({ subjectLevel: 10 });
    svc.evaluateTick(1000);
    await flush();
    expect(escrow.released).toContain(jobId);
    expect(escrow.refunded).toHaveLength(0);
    const job = (await db.getJob(jobId))!;
    expect(job.status).toBe('released');
    expect(job.settleSig).toBe(`REL_${jobId}`);
  });

  it('does NOT release while the helper is absent', async () => {
    const { svc, db, escrow, source } = setup();
    const jobId = await openAndAccept(svc);
    source.obs = obs({ subjectLevel: 10, helperPresent: false });
    svc.evaluateTick(1000);
    await flush();
    expect(escrow.released).toHaveLength(0);
    expect((await db.getJob(jobId))!.status).toBe('active');
  });

  it('does nothing for an active job whose subject is offline', async () => {
    const { svc, escrow, source } = setup();
    await openAndAccept(svc);
    source.obs = null; // offline
    svc.evaluateTick(1000);
    await flush();
    expect(escrow.released).toHaveLength(0);
    expect(escrow.refunded).toHaveLength(0);
  });
});

describe('refund paths', () => {
  it('refunds the payer when the deadline passes (even if offline)', async () => {
    const { svc, db, escrow, source } = setup();
    const { jobId } = await svc.createQuote(input({ deadlineSec: 5000 }));
    await svc.confirmDeposit(jobId, 'SIG', payer.accountId);
    await svc.accept(jobId, helper.accountId);
    source.obs = null;
    svc.evaluateTick(5001); // past deadline
    await flush();
    expect(escrow.refunded).toContain(jobId);
    expect((await db.getJob(jobId))!.status).toBe('refunded');
  });

  it('refunds when a bodyguard subject dies', async () => {
    const { svc, db, escrow, source } = setup();
    const { jobId } = await svc.createQuote(input({ milestone: { kind: 'survive', durationSec: 60 } }));
    await svc.confirmDeposit(jobId, 'SIG', payer.accountId);
    await svc.accept(jobId, helper.accountId);
    source.obs = obs({ subjectDiedThisTick: true });
    svc.evaluateTick(1000);
    await flush();
    expect(escrow.refunded).toContain(jobId);
    expect((await db.getJob(jobId))!.status).toBe('refunded');
  });

  it('lets the payer cancel an unaccepted job → refund', async () => {
    const { svc, db, escrow } = setup();
    const { jobId } = await svc.createQuote(input());
    await svc.confirmDeposit(jobId, 'SIG', payer.accountId);
    await svc.cancel(jobId, payer.accountId);
    expect(escrow.refunded).toContain(jobId);
    expect((await db.getJob(jobId))!.status).toBe('refunded');
  });

  it('cannot cancel once a helper has accepted (no griefing)', async () => {
    const { svc } = setup();
    const jobId = await openAndAccept(svc);
    await expect(svc.cancel(jobId, payer.accountId)).rejects.toThrow();
  });
});

describe('settlement robustness', () => {
  it('finalizes idempotently when the escrow was already settled on-chain', async () => {
    const { svc, db, escrow, source } = setup();
    const jobId = await openAndAccept(svc);
    escrow.exists = false; // a prior settle landed before a crash
    source.obs = obs({ subjectLevel: 10 });
    svc.evaluateTick(1000);
    await flush();
    expect(escrow.released).toHaveLength(0);          // no double release
    expect((await db.getJob(jobId))!.status).toBe('released'); // still finalized
  });

  it('retries a settle that failed on-chain', async () => {
    const { svc, db, escrow, source } = setup();
    const jobId = await openAndAccept(svc);
    escrow.failReleaseTimes = 1; // first release throws
    source.obs = obs({ subjectLevel: 10 });
    svc.evaluateTick(1000);
    await flush();
    expect((await db.getJob(jobId))!.status).toBe('active'); // not settled yet
    svc.evaluateTick(1000); // retry
    await flush();
    expect(escrow.released).toContain(jobId);
    expect((await db.getJob(jobId))!.status).toBe('released');
  });

  it('reloads open + active jobs on boot', async () => {
    const { svc, db } = setup();
    const jobId = await openAndAccept(svc);
    const svc2 = new JobContractService(db, new FakeEscrow(), new FakeSource(), 'TestRealm');
    await svc2.loadActive();
    expect(svc2.trackedCount()).toBe(1);
    void jobId;
  });
});

describe('reconcile abandoned deposits', () => {
  it('opens a funded-but-unconfirmed deposit so its escrow can settle (no stranding)', async () => {
    const { svc, db, escrow } = setup();
    const { jobId } = await svc.createQuote(input()); // pending_deposit, payer dropped before /confirm
    escrow.jobStateOk = true; // the reward DID land on-chain on our terms
    await svc.reconcilePending();
    expect((await db.getJob(jobId))!.status).toBe('open');
    expect(svc.trackedCount()).toBe(1);
  });

  it('leaves a job pending when the deposit has not landed (or terms mismatch)', async () => {
    const { svc, db, escrow } = setup();
    const { jobId } = await svc.createQuote(input());
    escrow.jobStateOk = false;
    await svc.reconcilePending();
    expect((await db.getJob(jobId))!.status).toBe('pending_deposit');
    expect(svc.trackedCount()).toBe(0);
  });
});

describe('settled hook', () => {
  it('fires once with the outcome when a job releases', async () => {
    const db = new FakeDb();
    const escrow = new FakeEscrow();
    const source = new FakeSource();
    const settled: Array<{ id: bigint; outcome: string }> = [];
    const svc = new JobContractService(db, escrow, source, 'TestRealm', (job, outcome) => settled.push({ id: job.jobId, outcome }));
    const { jobId } = await svc.createQuote(input());
    await svc.confirmDeposit(jobId, 'SIG', payer.accountId);
    await svc.accept(jobId, helper.accountId);
    source.obs = obs({ subjectLevel: 10 });
    svc.evaluateTick(1000);
    await flush();
    expect(settled).toEqual([{ id: jobId, outcome: 'released' }]);
  });
});
