// Optional host-side AI Dungeon Upgrader. Secrets and network calls stay here;
// the sim receives only a validated data manifest at a tick boundary.

import type { RiftEvent } from '../src/sim/rift/types';
import {
  draftForRiftEvent,
  installRiftUpgrade,
  markRiftUpgradeFallback,
  markRiftUpgradePending,
  type RiftDungeonDraft,
} from '../src/sim/rift/upgrader_draft';
import type { SimContext } from '../src/sim/sim_context';
import { readBodyCapped } from './bounded_body';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_REQUEST_BYTES = 96 * 1024;
const DEFAULT_MAX_PER_HOUR = 4;

export type RiftUpgraderProvider = 'dedicated' | 'openai';

export interface RiftUpgraderConfig {
  provider: RiftUpgraderProvider;
  url: string;
  apiKey: string;
  model?: string;
  timeoutMs: number;
  maxRequestsPerHour: number;
}

export function riftUpgraderConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RiftUpgraderConfig | null {
  const dedicatedUrl = env.RIFT_UPGRADER_URL?.trim();
  const dedicatedKey = env.RIFT_UPGRADER_API_KEY?.trim() ?? '';
  const timeout = Math.max(
    2_000,
    Math.min(60_000, Number(env.RIFT_UPGRADER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
  );
  const maxRequestsPerHour = Math.max(
    1,
    Math.min(24, Number(env.RIFT_UPGRADER_MAX_REQUESTS_PER_HOUR) || DEFAULT_MAX_PER_HOUR),
  );
  if (dedicatedUrl) {
    return {
      provider: 'dedicated',
      url: dedicatedUrl,
      apiKey: dedicatedKey,
      timeoutMs: timeout,
      maxRequestsPerHour,
    };
  }
  const openAiKey = env.OPENAI_API_KEY?.trim();
  const model = env.RIFT_UPGRADER_MODEL?.trim();
  if (!openAiKey || !model) return null;
  return {
    provider: 'openai',
    url: env.RIFT_UPGRADER_OPENAI_URL?.trim() || 'https://api.openai.com/v1/responses',
    apiKey: openAiKey,
    model,
    timeoutMs: timeout,
    maxRequestsPerHour,
  };
}

const FLOOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'floorIndex',
    'themeId',
    'pacing',
    'monsterIds',
    'specialEvent',
    'environmentalDetails',
  ],
  properties: {
    floorIndex: { type: 'integer', minimum: 0, maximum: 7 },
    themeId: { type: 'string' },
    pacing: { type: 'string', enum: ['breather', 'pressure', 'climax'] },
    monsterIds: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string' } },
    specialEvent: {
      type: 'string',
      enum: ['none', 'ambush', 'ritual', 'hazard', 'treasure'],
    },
    environmentalDetails: {
      type: 'array',
      maxItems: 6,
      items: { type: 'string', maxLength: 180 },
    },
  },
} as const;

export const RIFT_UPGRADE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'title',
    'synopsis',
    'lore',
    'floors',
    'boss',
    'rewards',
    'assetRequests',
  ],
  properties: {
    schemaVersion: { const: 1 },
    title: { type: 'string', minLength: 1, maxLength: 96 },
    synopsis: { type: 'string', minLength: 1, maxLength: 600 },
    lore: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 600 } },
    floors: { type: 'array', minItems: 1, maxItems: 8, items: FLOOR_SCHEMA },
    boss: {
      type: 'object',
      additionalProperties: false,
      required: ['templateId', 'name', 'concept'],
      properties: {
        templateId: { type: 'string' },
        name: { type: 'string', minLength: 1, maxLength: 96 },
        concept: { type: 'string', minLength: 1, maxLength: 600 },
      },
    },
    rewards: {
      type: 'object',
      additionalProperties: false,
      required: ['lootMultiplier', 'craftingMaterialBias'],
      properties: {
        lootMultiplier: { type: 'number', minimum: 0.5, maximum: 2 },
        craftingMaterialBias: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    assetRequests: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['requestId', 'kind', 'prompt', 'required'],
        properties: {
          requestId: { type: 'string', minLength: 1, maxLength: 64 },
          kind: { type: 'string', enum: ['boss_model', 'prop_model', 'texture'] },
          prompt: { type: 'string', minLength: 1, maxLength: 500 },
          required: { type: 'boolean' },
        },
      },
    },
  },
} as const;

function promptFor(draft: RiftDungeonDraft): string {
  return [
    'Upgrade this already-generated Rift dungeon into one coherent adventure.',
    'Do not invent template IDs, themes, stats, mechanics, URLs, or executable content.',
    'Use only monster IDs and theme IDs present in the draft. Preserve floor count and floorIndex order.',
    'Pacing, lore, boss identity, encounter composition, rewards, environmental details, and optional asset requests may be improved.',
    JSON.stringify(draft),
  ].join('\n');
}

function outputText(response: Record<string, unknown>): string | null {
  if (typeof response.output_text === 'string') return response.output_text;
  if (!Array.isArray(response.output)) return null;
  for (const item of response.output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        part &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'output_text' &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  return null;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await readBodyCapped(response, MAX_RESPONSE_BYTES);
    if (!response.ok) throw new Error(`upgrader HTTP ${response.status}`);
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('upgrader returned a non-object response');
    }
    return parsed as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

export class RiftUpgraderClient {
  constructor(private readonly config: RiftUpgraderConfig) {}

  async upgrade(draft: RiftDungeonDraft): Promise<unknown> {
    const prompt = promptFor(draft);
    if (prompt.length > MAX_REQUEST_BYTES) throw new Error('upgrader request exceeds byte limit');
    if (this.config.provider === 'dedicated') {
      return fetchJson(
        this.config.url,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(this.config.apiKey && { authorization: `Bearer ${this.config.apiKey}` }),
          },
          body: JSON.stringify({ schemaVersion: 1, draft, outputSchema: RIFT_UPGRADE_JSON_SCHEMA }),
        },
        this.config.timeoutMs,
      );
    }

    const response = await fetchJson(
      this.config.url,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          input: [
            {
              role: 'system',
              content:
                'You are a bounded game-content upgrader. Return only the requested JSON artifact.',
            },
            { role: 'user', content: prompt },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'rift_upgrade',
              strict: true,
              schema: RIFT_UPGRADE_JSON_SCHEMA,
            },
          },
        }),
      },
      this.config.timeoutMs,
    );
    const text = outputText(response);
    if (!text) throw new Error('upgrader response omitted output text');
    return JSON.parse(text) as unknown;
  }
}

interface PendingResult {
  eventId: string;
  value: unknown | null;
}

/** One in-flight request at a time plus a rolling hourly cap. Promise callbacks
 * only enqueue host data; all sim mutation occurs in drain() at a tick boundary. */
export class RiftUpgradeCoordinator {
  private readonly client: RiftUpgraderClient | null;
  private readonly maxRequestsPerHour: number;
  private readonly seen = new Set<string>();
  private readonly inFlight = new Set<string>();
  private readonly queued: RiftEvent[] = [];
  private readonly results: PendingResult[] = [];
  private readonly requestTimes: number[] = [];

  constructor(config: RiftUpgraderConfig | null) {
    this.client = config ? new RiftUpgraderClient(config) : null;
    this.maxRequestsPerHour = config?.maxRequestsPerHour ?? 0;
  }

  observe(ctx: SimContext): void {
    if (!this.client) return;
    for (const event of ctx.riftEvents) {
      if (
        this.seen.has(event.eventId) ||
        event.contentLocked ||
        event.status !== 'open' ||
        (event.upgradeStatus !== 'heuristic' && event.upgradeStatus !== 'fallback')
      ) {
        continue;
      }
      this.seen.add(event.eventId);
      this.queued.push(event);
      markRiftUpgradePending(ctx, event.eventId);
    }
    this.startNext();
  }

  drain(ctx: SimContext): void {
    while (this.results.length > 0) {
      const result = this.results.shift();
      if (!result) break;
      if (result.value === null || !installRiftUpgrade(ctx, result.eventId, result.value, 'ai')) {
        markRiftUpgradeFallback(ctx, result.eventId);
      }
    }
    this.startNext();
  }

  private startNext(): void {
    if (!this.client || this.inFlight.size > 0 || this.queued.length === 0) return;
    const now = Date.now();
    while (this.requestTimes.length > 0 && now - this.requestTimes[0] >= 60 * 60 * 1000) {
      this.requestTimes.shift();
    }
    if (this.requestTimes.length >= this.maxRequestsPerHour) return;
    const event = this.queued.shift();
    if (!event) return;
    this.requestTimes.push(now);
    this.inFlight.add(event.eventId);
    const draft = draftForRiftEvent(event);
    void this.client
      .upgrade(draft)
      .then((value) => this.results.push({ eventId: event.eventId, value }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'unknown failure';
        console.warn(`[rift-upgrader] ${event.eventId} fell back: ${message}`);
        this.results.push({ eventId: event.eventId, value: null });
      })
      .finally(() => {
        this.inFlight.delete(event.eventId);
        this.startNext();
      });
  }
}
