import type { Prisma, Provider } from '@prisma/client';
import { prisma } from './db';
import { getEnv } from './env';
import { decryptSecret, redactSecrets } from './crypto';
import { WeightedRouter, type ProviderSnapshot } from './router';
import { chatCompletion, VeniceError, type VeniceCallResult } from './venice';
import { computeCostUsd, FALLBACK_RATE, type ModelRate } from './pricing';
import { isRoutingPaused } from './config';
import { utcDay } from './settlement';
import type { Purpose } from './schemas';

// Orchestrates one inference call: pick a provider by weighted round-robin,
// call Venice with retry + failover, meter actual usage, maintain provider
// health state. See router.ts for the weighting algorithm.

const POOL_CACHE_MS = 3_000;
const PRICING_CACHE_MS = 60_000;
const MAX_PROVIDERS_PER_REQUEST = 3;

export interface InferenceInput {
  payload: Record<string, unknown>;
  purpose: Purpose;
  gameAccountId?: string;
}

export interface InferenceOutcome {
  status: number;
  body: unknown;
  providerId: string | null;
  house: boolean;
}

interface PoolCache {
  at: number;
  providers: Provider[];
  /** Intraday spend per provider, mutated locally as we meter so the router
   *  sees spend immediately instead of waiting out the cache TTL. */
  spentUsd: Map<string, number>;
}

const globalState = globalThis as unknown as {
  poolRouter?: WeightedRouter;
  poolCache?: PoolCache | null;
  pricingCache?: { at: number; rates: Map<string, ModelRate> } | null;
  unpricedModelsWarned?: Set<string>;
};

function getRouter(): WeightedRouter {
  if (!globalState.poolRouter) {
    globalState.poolRouter = new WeightedRouter({ headroomFraction: getEnv().SPEND_HEADROOM });
  }
  return globalState.poolRouter;
}

async function loadPool(now: Date): Promise<PoolCache> {
  const cached = globalState.poolCache;
  if (cached && now.getTime() - cached.at < POOL_CACHE_MS) return cached;

  const providers = await prisma.provider.findMany({
    where: { status: 'ACTIVE', encryptedKey: { not: null } },
  });
  const spends = await prisma.providerDailySpend.findMany({
    where: { date: utcDay(now), providerId: { in: providers.map((p) => p.id) } },
  });
  const spentUsd = new Map(spends.map((s) => [s.providerId, Number(s.spentUsd)]));
  const fresh: PoolCache = { at: now.getTime(), providers, spentUsd };
  globalState.poolCache = fresh;
  return fresh;
}

/** Test/ops hook: force a pool reload on the next request. */
export function invalidatePoolCache(): void {
  globalState.poolCache = null;
}

async function getRate(model: string): Promise<ModelRate> {
  const now = Date.now();
  if (!globalState.pricingCache || now - globalState.pricingCache.at > PRICING_CACHE_MS) {
    const rows = await prisma.modelPricing.findMany({ where: { active: true } });
    globalState.pricingCache = {
      at: now,
      rates: new Map(
        rows.map((r) => [
          r.model,
          {
            inputUsdPerMTokens: Number(r.inputUsdPerMTokens),
            outputUsdPerMTokens: Number(r.outputUsdPerMTokens),
          },
        ]),
      ),
    };
  }
  const rate = globalState.pricingCache.rates.get(model);
  if (!rate) {
    // Conservative fallback so unknown models are never under-metered; warn
    // once per model so the admin adds real pricing.
    const warned = (globalState.unpricedModelsWarned ??= new Set());
    if (!warned.has(model)) {
      warned.add(model);
      console.warn(
        `[pricing] no active pricing for model "${model}" — metering at conservative fallback rates; add it in the admin pricing table`,
      );
    }
    return FALLBACK_RATE;
  }
  return rate;
}

async function recordUsage(
  now: Date,
  providerId: string | null,
  input: InferenceInput,
  result: VeniceCallResult,
): Promise<void> {
  const rate = await getRate(result.model);
  const costUsd = computeCostUsd(rate, result.usage.promptTokens, result.usage.completionTokens);

  const writes: Prisma.PrismaPromise<unknown>[] = [
    prisma.usageEvent.create({
      data: {
        providerId,
        purpose: input.purpose,
        model: result.model,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        costUsd,
        gameAccountId: input.gameAccountId ?? null,
        house: providerId === null,
        // Explicit routing timestamp (not DB insert time) so the settlement
        // window and the intraday spend row always agree on the UTC day.
        createdAt: now,
      },
    }),
  ];
  if (providerId !== null) {
    writes.push(
      prisma.providerDailySpend.upsert({
        where: { providerId_date: { providerId, date: utcDay(now) } },
        create: { providerId, date: utcDay(now), spentUsd: costUsd, requests: 1 },
        update: { spentUsd: { increment: costUsd }, requests: { increment: 1 } },
      }),
    );
  }
  await prisma.$transaction(writes);

  const cache = globalState.poolCache;
  if (providerId !== null && cache) {
    cache.spentUsd.set(providerId, (cache.spentUsd.get(providerId) ?? 0) + costUsd);
  }
}

async function markInvalid(providerId: string): Promise<void> {
  await prisma.provider.update({
    where: { id: providerId },
    data: { status: 'INVALID', unhealthyToday: true },
  });
  getRouter().forget(providerId);
  invalidatePoolCache();
}

/** Venice says the key's daily credit is gone: pin spend to capacity so the
 *  router excludes it until the next UTC day, without touching status. */
async function markCreditExhausted(provider: Provider, now: Date): Promise<void> {
  const capacity = Number(provider.dailyCapacityUsd);
  await prisma.providerDailySpend.upsert({
    where: { providerId_date: { providerId: provider.id, date: utcDay(now) } },
    create: { providerId: provider.id, date: utcDay(now), spentUsd: capacity, requests: 0 },
    update: { spentUsd: capacity },
  });
  globalState.poolCache?.spentUsd.set(provider.id, capacity);
}

async function onHardFailure(provider: Provider): Promise<void> {
  const updated = await prisma.provider.update({
    where: { id: provider.id },
    data: { consecutiveFailures: { increment: 1 } },
  });
  // `provider` is the cached row — keep it in sync so onSuccess's write-skip
  // and the 2-strike threshold see failures accrued within the cache TTL.
  provider.consecutiveFailures = updated.consecutiveFailures;
  if (updated.consecutiveFailures >= 2 && updated.status === 'ACTIVE') {
    await prisma.provider.update({
      where: { id: provider.id },
      data: { status: 'DEGRADED', unhealthyToday: true },
    });
    invalidatePoolCache();
  }
}

async function onSuccess(provider: Provider): Promise<void> {
  // Skip the write entirely for already-healthy providers (the common case).
  if (provider.consecutiveFailures === 0) return;
  await prisma.provider.updateMany({
    where: { id: provider.id, consecutiveFailures: { gt: 0 } },
    data: { consecutiveFailures: 0 },
  });
  provider.consecutiveFailures = 0;
}

/**
 * Metering failure after a successful upstream call must not fail the
 * request: the provider's credit is already spent and the game already has
 * its completion. Serve the response, log loudly (unmetered = unpaid), and
 * let the next call surface persistent DB trouble via loadPool.
 */
async function meterOrWarn(
  now: Date,
  providerId: string | null,
  input: InferenceInput,
  result: VeniceCallResult,
): Promise<void> {
  try {
    await recordUsage(now, providerId, input, result);
  } catch (err) {
    console.error(
      `[inference] METERING FAILED for provider=${providerId ?? 'house'} model=${result.model} ` +
        `tokens=${result.usage.promptTokens}/${result.usage.completionTokens} — response served but unrewarded:`,
      err,
    );
  }
}

/** One upstream attempt with a single same-key retry on retryable errors. */
async function callWithRetry(
  apiKey: string,
  payload: Record<string, unknown>,
): Promise<VeniceCallResult> {
  const opts = { baseUrl: getEnv().VENICE_BASE_URL };
  try {
    return await chatCompletion(apiKey, payload, opts);
  } catch (err) {
    if (err instanceof VeniceError && err.retryable) {
      return await chatCompletion(apiKey, payload, opts);
    }
    throw err;
  }
}

function toSnapshot(p: Provider, spentUsd: Map<string, number>): ProviderSnapshot {
  return {
    id: p.id,
    status: p.status,
    dailyCapacityUsd: Number(p.dailyCapacityUsd),
    spentTodayUsd: spentUsd.get(p.id) ?? 0,
  };
}

export async function routeInference(input: InferenceInput): Promise<InferenceOutcome> {
  if (await isRoutingPaused()) {
    return { status: 503, body: { error: 'routing paused by admin' }, providerId: null, house: false };
  }

  const now = new Date();
  const pool = await loadPool(now);
  const byId = new Map(pool.providers.map((p) => [p.id, p]));
  const order = getRouter().pickOrder(
    pool.providers.map((p) => toSnapshot(p, pool.spentUsd)),
    MAX_PROVIDERS_PER_REQUEST,
  );

  for (const providerId of order) {
    const provider = byId.get(providerId);
    if (!provider?.encryptedKey) continue;
    const apiKey = decryptSecret(provider.encryptedKey, getEnv().KEY_ENCRYPTION_KEY);

    try {
      const result = await callWithRetry(apiKey, input.payload);
      await meterOrWarn(now, provider.id, input, result);
      await onSuccess(provider);
      return { status: 200, body: result.body, providerId: provider.id, house: false };
    } catch (err) {
      if (!(err instanceof VeniceError)) throw err;
      switch (err.kind) {
        case 'auth':
          await markInvalid(provider.id);
          continue;
        case 'insufficient_credit':
          await markCreditExhausted(provider, now);
          continue;
        case 'bad_request':
          // Our payload is at fault — failing over would just repeat it.
          return {
            status: err.status ?? 400,
            body: { error: 'upstream rejected request', detail: redactSecrets(err.message, [apiKey]) },
            providerId: null,
            house: false,
          };
        default:
          // server/network/rate_limited after retry → count a hard failure, fail over.
          await onHardFailure(provider);
          continue;
      }
    }
  }

  // Pool exhausted (or empty) → house key fallback, tagged `house`.
  const houseKey = getEnv().HOUSE_VENICE_API_KEY;
  if (houseKey) {
    try {
      const result = await callWithRetry(houseKey, input.payload);
      await meterOrWarn(now, null, input, result);
      return { status: 200, body: result.body, providerId: null, house: true };
    } catch (err) {
      if (err instanceof VeniceError) {
        return {
          status: 502,
          body: { error: 'house key upstream failure', detail: redactSecrets(err.message, [houseKey]) },
          providerId: null,
          house: true,
        };
      }
      throw err;
    }
  }

  return {
    status: 503,
    body: { error: 'provider pool exhausted and no house key configured' },
    providerId: null,
    house: false,
  };
}
