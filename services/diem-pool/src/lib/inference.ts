import type { Prisma, Provider } from '@prisma/client';
import { prisma } from './db';
import { getEnv } from './env';
import { decryptSecret, redactSecrets } from './crypto';
import { WeightedRouter, type ProviderSnapshot } from './router';
import { VeniceError, type VeniceCallResult } from './venice';
import { computeCostUsd, FALLBACK_RATE, type ModelRate } from './pricing';
import { isRoutingPaused } from './config';
import { utcDay } from './settlement';
import { getAdapter } from './vendors';
import { effectiveCapacityUsd, type VendorName, type VendorPolicy } from './vendors/config';
import { getVendorPolicies } from './vendors/policies';
import type { ModelClassName, Purpose } from './schemas';

// Orchestrates one inference call: resolve the model class to concrete
// vendor models, pick a provider by weighted round-robin over eligible
// vendors, dispatch through the vendor adapter with retry + failover, meter
// actual usage, maintain provider health state. See router.ts for the
// weighting algorithm and docs/PLAN-byok-multi-vendor.md for the vendor model.

const POOL_CACHE_MS = 3_000;
const PRICING_CACHE_MS = 60_000;
const CLASS_MAP_CACHE_MS = 60_000;
const MAX_PROVIDERS_PER_REQUEST = 3;

export interface InferenceInput {
  payload: Record<string, unknown>;
  purpose: Purpose;
  modelClass?: ModelClassName;
  gameAccountId?: string;
}

export interface InferenceOutcome {
  status: number;
  body: unknown;
  providerId: string | null;
  vendor: VendorName | null;
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
  classMapCache?: { at: number; byClass: Map<string, Map<VendorName, string>> } | null;
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
  globalState.classMapCache = null;
}

/**
 * Fold class-map rows into the best (lowest priority number wins) active
 * concrete model per (class, vendor). Pure - exported for tests.
 */
export function foldClassMap(
  rows: Array<{ class: string; vendor: string; model: string; priority: number; active: boolean }>,
): Map<string, Map<VendorName, string>> {
  const byClass = new Map<string, Map<VendorName, string>>();
  for (const row of [...rows].sort((a, b) => a.priority - b.priority)) {
    if (!row.active) continue;
    const vendors = byClass.get(row.class) ?? new Map<VendorName, string>();
    if (!vendors.has(row.vendor as VendorName)) vendors.set(row.vendor as VendorName, row.model);
    byClass.set(row.class, vendors);
  }
  return byClass;
}

/** Cached class → vendor → concrete-model resolution. */
async function getClassMap(): Promise<Map<string, Map<VendorName, string>>> {
  const cached = globalState.classMapCache;
  if (cached && Date.now() - cached.at < CLASS_MAP_CACHE_MS) return cached.byClass;

  const byClass = foldClassMap(await prisma.modelClassMap.findMany({ where: { active: true } }));
  globalState.classMapCache = { at: Date.now(), byClass };
  return byClass;
}

/** "vendor:model" pins that vendor; a bare model is the legacy Venice contract. */
export function parsePinnedModel(model: string): { vendor: VendorName; model: string } {
  const idx = model.indexOf(':');
  if (idx > 0) {
    const vendor = model.slice(0, idx);
    if (['venice', 'openai', 'anthropic', 'kimi'].includes(vendor)) {
      return { vendor: vendor as VendorName, model: model.slice(idx + 1) };
    }
  }
  return { vendor: 'venice', model };
}

async function getRate(vendor: VendorName, model: string): Promise<ModelRate> {
  const now = Date.now();
  if (!globalState.pricingCache || now - globalState.pricingCache.at > PRICING_CACHE_MS) {
    const rows = await prisma.modelPricing.findMany({ where: { active: true } });
    globalState.pricingCache = {
      at: now,
      rates: new Map(
        rows.map((r) => [
          `${r.vendor}:${r.model}`,
          {
            inputUsdPerMTokens: Number(r.inputUsdPerMTokens),
            outputUsdPerMTokens: Number(r.outputUsdPerMTokens),
          },
        ]),
      ),
    };
  }
  const rate = globalState.pricingCache.rates.get(`${vendor}:${model}`);
  if (!rate) {
    // Conservative fallback so unknown models are never under-metered; warn
    // once per model so the admin adds real pricing.
    const warned = (globalState.unpricedModelsWarned ??= new Set());
    const key = `${vendor}:${model}`;
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(
        `[pricing] no active pricing for "${key}" - metering at conservative fallback rates; add it in the admin pricing table`,
      );
    }
    return FALLBACK_RATE;
  }
  return rate;
}

async function recordUsage(
  now: Date,
  providerId: string | null,
  vendor: VendorName,
  input: InferenceInput,
  result: VeniceCallResult,
): Promise<void> {
  const rate = await getRate(vendor, result.model);
  const costUsd = computeCostUsd(rate, result.usage.promptTokens, result.usage.completionTokens);

  const writes: Prisma.PrismaPromise<unknown>[] = [
    prisma.usageEvent.create({
      data: {
        providerId,
        vendor,
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

/**
 * Metering failure after a successful upstream call must not fail the
 * request: the provider's credit is already spent and the game already has
 * its completion. Serve the response, log loudly (unmetered = unpaid), and
 * let the next call surface persistent DB trouble via loadPool.
 */
async function meterOrWarn(
  now: Date,
  providerId: string | null,
  vendor: VendorName,
  input: InferenceInput,
  result: VeniceCallResult,
): Promise<void> {
  try {
    await recordUsage(now, providerId, vendor, input, result);
  } catch (err) {
    console.error(
      `[inference] METERING FAILED for provider=${providerId ?? 'house'} vendor=${vendor} model=${result.model} ` +
        `tokens=${result.usage.promptTokens}/${result.usage.completionTokens} - response served but unrewarded:`,
      err,
    );
  }
}

/** Stolen-key economics: an upstream-revoked key voids its unvested rewards. */
export async function voidPendingRewards(providerId: string, reason: string): Promise<void> {
  const res = await prisma.rewardLedger.updateMany({
    where: { providerId, status: 'PENDING' },
    data: { status: 'VOIDED' },
  });
  if (res.count > 0) {
    console.warn(`[rewards] voided ${res.count} pending ledger rows for provider=${providerId} (${reason})`);
  }
}

async function markInvalid(providerId: string): Promise<void> {
  await prisma.provider.update({
    where: { id: providerId },
    data: { status: 'INVALID', unhealthyToday: true },
  });
  await voidPendingRewards(providerId, 'key went INVALID upstream');
  getRouter().forget(providerId);
  invalidatePoolCache();
}

/** Upstream says the key's credit is gone: pin spend to the effective budget
 *  so the router excludes it until the next UTC day, without touching status. */
async function markCreditExhausted(provider: Provider, effectiveCapacity: number, now: Date): Promise<void> {
  await prisma.providerDailySpend.upsert({
    where: { providerId_date: { providerId: provider.id, date: utcDay(now) } },
    create: { providerId: provider.id, date: utcDay(now), spentUsd: effectiveCapacity, requests: 0 },
    update: { spentUsd: effectiveCapacity },
  });
  globalState.poolCache?.spentUsd.set(provider.id, effectiveCapacity);
}

async function onHardFailure(provider: Provider): Promise<void> {
  const updated = await prisma.provider.update({
    where: { id: provider.id },
    data: { consecutiveFailures: { increment: 1 } },
  });
  // `provider` is the cached row - keep it in sync so onSuccess's write-skip
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

/** One upstream attempt with a single same-key retry on retryable errors. */
async function callWithRetry(
  vendor: VendorName,
  apiKey: string,
  model: string,
  payload: Record<string, unknown>,
): Promise<VeniceCallResult> {
  const adapter = getAdapter(vendor);
  try {
    return await adapter.chat(apiKey, { model, payload });
  } catch (err) {
    if (err instanceof VeniceError && err.retryable) {
      return await adapter.chat(apiKey, { model, payload });
    }
    throw err;
  }
}

export async function routeInference(input: InferenceInput): Promise<InferenceOutcome> {
  if (await isRoutingPaused()) {
    return { status: 503, body: { error: 'routing paused by admin' }, providerId: null, vendor: null, house: false };
  }

  const env = getEnv();
  const now = new Date();
  const policies = await getVendorPolicies();
  const caps = { newUsd: env.TRUST_CAP_NEW_USD, establishedUsd: env.TRUST_CAP_ESTABLISHED_USD };

  // Resolve which vendors can serve this request and with which model.
  let modelFor: (vendor: VendorName) => string | null;
  if (input.modelClass) {
    const vendorModels = (await getClassMap()).get(input.modelClass);
    modelFor = (vendor) => vendorModels?.get(vendor) ?? null;
  } else {
    const pinned = parsePinnedModel(String(input.payload.model));
    modelFor = (vendor) => (vendor === pinned.vendor ? pinned.model : null);
  }

  const pool = await loadPool(now);
  const byId = new Map(pool.providers.map((p) => [p.id, p]));
  const effectiveCap = (p: Provider) =>
    effectiveCapacityUsd(
      Number(p.dailyCapacityUsd),
      p.trustTier,
      (policies[p.vendor as VendorName] as VendorPolicy).trustRampEnabled,
      caps,
    );
  const snapshots: ProviderSnapshot[] = pool.providers
    .filter((p) => policies[p.vendor as VendorName].enabled && modelFor(p.vendor as VendorName) !== null)
    .map((p) => ({
      id: p.id,
      status: p.status,
      dailyCapacityUsd: effectiveCap(p),
      spentTodayUsd: pool.spentUsd.get(p.id) ?? 0,
    }));
  const order = getRouter().pickOrder(snapshots, MAX_PROVIDERS_PER_REQUEST);

  for (const providerId of order) {
    const provider = byId.get(providerId);
    if (!provider?.encryptedKey) continue;
    const vendor = provider.vendor as VendorName;
    const model = modelFor(vendor)!;
    const apiKey = decryptSecret(provider.encryptedKey, env.KEY_ENCRYPTION_KEY);

    try {
      const result = await callWithRetry(vendor, apiKey, model, input.payload);
      await meterOrWarn(now, provider.id, vendor, input, result);
      await onSuccess(provider);
      return { status: 200, body: result.body, providerId: provider.id, vendor, house: false };
    } catch (err) {
      if (!(err instanceof VeniceError)) throw err;
      switch (err.kind) {
        case 'auth':
          await markInvalid(provider.id);
          continue;
        case 'insufficient_credit':
          await markCreditExhausted(provider, effectiveCap(provider), now);
          continue;
        case 'bad_request':
          // Our payload is at fault - failing over would just repeat it.
          return {
            status: err.status ?? 400,
            body: { error: 'upstream rejected request', detail: redactSecrets(err.message, [apiKey]) },
            providerId: null,
            vendor,
            house: false,
          };
        default:
          // server/network/rate_limited after retry → count a hard failure, fail over.
          await onHardFailure(provider);
          continue;
      }
    }
  }

  // Pool exhausted (or empty) → house Venice key fallback, tagged `house`.
  const houseKey = env.HOUSE_VENICE_API_KEY;
  const houseModel = modelFor('venice');
  if (houseKey && houseModel) {
    try {
      const result = await callWithRetry('venice', houseKey, houseModel, input.payload);
      await meterOrWarn(now, null, 'venice', input, result);
      return { status: 200, body: result.body, providerId: null, vendor: 'venice', house: true };
    } catch (err) {
      if (err instanceof VeniceError) {
        return {
          status: 502,
          body: { error: 'house key upstream failure', detail: redactSecrets(err.message, [houseKey]) },
          providerId: null,
          vendor: 'venice',
          house: true,
        };
      }
      throw err;
    }
  }

  return {
    status: 503,
    body: {
      error: houseKey
        ? 'provider pool exhausted and no venice mapping exists for this model class'
        : 'provider pool exhausted and no house key configured',
    },
    providerId: null,
    vendor: null,
    house: false,
  };
}
