// Feature-gated bridge to a dedicated runtime asset-generation service (Tripo
// or another provider behind that service). It submits bounded requests and
// records only an opaque job id. Remote binaries are deliberately not hot-loaded
// into live combat; promotion through the immutable asset manifest is the safe
// graphics-fairness boundary.

import type { RiftAssetRequest, RiftEvent } from '../src/sim/rift/types';
import type { SimContext } from '../src/sim/sim_context';
import { readBodyCapped } from './bounded_body';

const MAX_RESPONSE_BYTES = 32 * 1024;

export interface RiftAssetConfig {
  url: string;
  apiKey: string;
  timeoutMs: number;
  maxRequestsPerEvent: number;
}

export function riftAssetConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RiftAssetConfig | null {
  if (env.RIFT_RUNTIME_ASSETS !== '1') return null;
  const url = env.RIFT_ASSET_PIPELINE_URL?.trim();
  if (!url) return null;
  return {
    url,
    apiKey: env.RIFT_ASSET_PIPELINE_API_KEY?.trim() ?? '',
    timeoutMs: Math.max(5_000, Math.min(120_000, Number(env.RIFT_ASSET_TIMEOUT_MS) || 60_000)),
    maxRequestsPerEvent: Math.max(
      1,
      Math.min(2, Number(env.RIFT_ASSET_MAX_REQUESTS_PER_EVENT) || 1),
    ),
  };
}

interface AssetJobResult {
  eventId: string;
  ok: boolean;
  jobId: string | null;
}

async function submitAssetJob(
  config: RiftAssetConfig,
  event: RiftEvent,
  requests: RiftAssetRequest[],
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey && { authorization: `Bearer ${config.apiKey}` }),
      },
      body: JSON.stringify({
        schemaVersion: 1,
        eventId: event.eventId,
        seed: event.seed,
        contentHash: event.contentHash,
        requests,
        constraints: {
          format: 'glb',
          maxTriangles: 75_000,
          maxTextureSize: 2048,
          combatReadableSilhouette: true,
          immutableManifestPromotionRequired: true,
        },
      }),
    });
    const body = await readBodyCapped(response, MAX_RESPONSE_BYTES);
    if (!response.ok) throw new Error(`asset pipeline HTTP ${response.status}`);
    const parsed = JSON.parse(body) as { jobId?: unknown };
    if (typeof parsed.jobId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(parsed.jobId)) {
      throw new Error('asset pipeline returned an invalid job id');
    }
    return parsed.jobId;
  } finally {
    clearTimeout(timeout);
  }
}

export class RiftAssetCoordinator {
  private readonly seen = new Set<string>();
  private readonly results: AssetJobResult[] = [];
  private inFlight = false;

  constructor(private readonly config: RiftAssetConfig | null) {}

  observe(ctx: SimContext): void {
    if (!this.config || this.inFlight) return;
    const event = ctx.riftEvents.find(
      (candidate) =>
        !this.seen.has(candidate.eventId) &&
        candidate.status === 'open' &&
        candidate.upgradeStatus !== 'pending' &&
        candidate.assetPipeline.status === 'none' &&
        (candidate.upgrade?.assetRequests.length ?? 0) > 0,
    );
    if (!event) return;
    const upgrade = event.upgrade;
    if (!upgrade) return;
    this.seen.add(event.eventId);
    const requests = upgrade.assetRequests
      .filter((request) => !request.required)
      .slice(0, this.config.maxRequestsPerEvent);
    if (requests.length === 0) return;
    event.assetPipeline = {
      status: 'pending',
      jobId: null,
      requestIds: requests.map((request) => request.requestId),
    };
    this.inFlight = true;
    void submitAssetJob(this.config, event, requests)
      .then((jobId) => this.results.push({ eventId: event.eventId, ok: true, jobId }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'unknown failure';
        console.warn(`[rift-assets] ${event.eventId} request failed: ${message}`);
        this.results.push({ eventId: event.eventId, ok: false, jobId: null });
      })
      .finally(() => {
        this.inFlight = false;
      });
  }

  drain(ctx: SimContext): void {
    while (this.results.length > 0) {
      const result = this.results.shift();
      if (!result) break;
      const event = ctx.riftEvents.find((candidate) => candidate.eventId === result.eventId);
      if (!event) continue;
      event.assetPipeline = {
        ...event.assetPipeline,
        status: result.ok ? 'queued' : 'failed',
        jobId: result.jobId,
      };
    }
    this.observe(ctx);
  }
}
