// REST handlers for player job contracts ("paid bodyguard"). Thin HTTP boundary:
// validate untrusted input, resolve the payer (the authenticated account's
// character + its verified wallet) and the helper (by character name → verified
// wallet), then delegate to the JobContractService. No SQL and no chain here —
// those live in jobs_db.ts / job_escrow.ts behind the service.
import type http from 'node:http';
import { json, readBody } from './http_util';
import { getCharacter, walletForAccount, jobPartyByCharacterName } from './db';
import { parseMilestone, describeMilestone } from './job_milestone';
import { isEscrowCurrency, escrowCurrencyInfo, rewardToBase, jobEscrowReady, type EscrowCurrency } from './job_escrow';
import { JOB_MAX_DURATION_SECONDS } from './woc_config';
import { QUESTS, DUNGEONS } from '../src/sim/data';
import type { JobContractService, JobRecord } from './job_contracts';

// What the client sees for a job in its list. Amounts are surfaced both as exact
// base units (string) and a human number for display; wallets are omitted (not
// needed to render, and each party already knows the other's address).
function serializeJob(job: JobRecord, viewerCharacterId: number) {
  const { decimals } = escrowCurrencyInfo(job.currency as EscrowCurrency);
  return {
    jobId: job.jobId.toString(),
    role: job.payer.characterId === viewerCharacterId ? 'payer' : 'helper',
    payerName: job.payer.name,
    helperName: job.helper.name,
    currency: job.currency,
    amountBase: job.amountBase.toString(),
    amount: Number(job.amountBase) / 10 ** decimals,
    milestone: job.milestone,
    milestoneText: describeMilestone(job.milestone),
    status: job.status,
    progress: job.progress.status,
    reason: job.progress.reason ?? null,
    deadlineSec: job.deadlineSec,
    depositSig: job.depositSig,
    settleSig: job.settleSig,
  };
}

// POST /api/jobs/quote → build the deposit tx + record the contract.
export async function handleJobQuote(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
  svc: JobContractService,
): Promise<void> {
  if (!jobEscrowReady()) return json(res, 503, { error: 'job contracts are not available on this realm' });

  const body = await readBody(req);
  const characterId = Number(body.characterId);
  const helperName = typeof body.helperName === 'string' ? body.helperName.trim() : '';
  const currency = body.currency;
  const amount = Number(body.amount);
  if (!Number.isFinite(characterId)) return json(res, 400, { error: 'invalid character' });
  if (!isEscrowCurrency(currency)) return json(res, 400, { error: 'reward currency must be WOC or USDC' });
  if (!(amount > 0)) return json(res, 400, { error: 'reward must be greater than zero' });

  const milestone = parseMilestone(body.milestone);
  if (!milestone) return json(res, 400, { error: 'invalid job goal' });
  if (milestone.kind === 'complete_quest' && !QUESTS[milestone.questId]) return json(res, 400, { error: 'unknown quest' });
  if (milestone.kind === 'clear_dungeon' && !DUNGEONS[milestone.dungeonId]) return json(res, 400, { error: 'unknown dungeon' });

  const character = await getCharacter(accountId, characterId);
  if (!character) return json(res, 404, { error: 'character not found' });
  const payerWallet = await walletForAccount(accountId);
  if (!payerWallet) return json(res, 400, { error: 'link a verified wallet before posting a job' });

  const helper = await jobPartyByCharacterName(helperName);
  if (!helper) return json(res, 404, { error: 'no player by that name has a verified wallet' });
  if (helper.characterId === characterId) return json(res, 400, { error: 'you cannot hire yourself' });
  if (helper.wallet === payerWallet.pubkey) return json(res, 400, { error: 'the helper must use a different wallet' });

  const { mint, decimals } = escrowCurrencyInfo(currency);
  const amountBase = rewardToBase(amount, decimals);
  if (amountBase <= 0n) return json(res, 400, { error: 'reward is too small' });
  const deadlineSec = Math.floor(Date.now() / 1000) + JOB_MAX_DURATION_SECONDS;

  try {
    const result = await svc.createQuote({
      payer: { accountId, characterId, name: character.name, wallet: payerWallet.pubkey },
      helper,
      currency,
      mint,
      amountBase,
      milestone,
      deadlineSec,
    });
    return json(res, 200, {
      jobId: result.jobId.toString(),
      txBase64: result.txBase64,
      jobPda: result.jobPda,
      amountBase: result.amountBase.toString(),
      mint,
      currency,
      deadlineSec,
    });
  } catch (err) {
    return json(res, 400, { error: (err as Error).message });
  }
}

// POST /api/jobs/:id/confirm → verify the deposit landed; open the job.
export async function handleJobConfirm(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
  svc: JobContractService,
  jobId: bigint,
): Promise<void> {
  const body = await readBody(req);
  const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
  if (!signature) return json(res, 400, { error: 'a transaction signature is required' });
  try {
    const job = await svc.confirmDeposit(jobId, signature, accountId);
    return json(res, 200, { status: job.status });
  } catch (err) {
    return json(res, 400, { error: (err as Error).message });
  }
}

// POST /api/jobs/:id/accept → the helper accepts; tracking begins.
export async function handleJobAccept(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
  svc: JobContractService,
  jobId: bigint,
): Promise<void> {
  try {
    const job = await svc.accept(jobId, accountId);
    return json(res, 200, { status: job.status });
  } catch (err) {
    return json(res, 400, { error: (err as Error).message });
  }
}

// POST /api/jobs/:id/cancel → payer cancels an unaccepted job → refund.
export async function handleJobCancel(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
  svc: JobContractService,
  jobId: bigint,
): Promise<void> {
  try {
    await svc.cancel(jobId, accountId);
    return json(res, 200, { status: 'refunded' });
  } catch (err) {
    return json(res, 400, { error: (err as Error).message });
  }
}

// GET /api/jobs?characterId= → jobs this character posted or was hired for.
export async function handleJobList(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
  svc: JobContractService,
): Promise<void> {
  const characterId = Number(new URL(req.url ?? '/', 'http://localhost').searchParams.get('characterId') ?? '');
  if (!Number.isFinite(characterId)) return json(res, 400, { error: 'invalid character' });
  const character = await getCharacter(accountId, characterId);
  if (!character) return json(res, 404, { error: 'character not found' }); // ownership check
  const jobs = await svc.listForCharacter(characterId);
  return json(res, 200, { jobs: jobs.map((j) => serializeJob(j, characterId)) });
}
