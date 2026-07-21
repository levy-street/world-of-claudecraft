import { getEnv } from '../env';
import {
  chatCompletion,
  probeKey,
  validateKey,
  type ProbeResult,
  type VeniceCallResult,
} from '../venice';
import { anthropicChat, anthropicProbe, anthropicValidateKey } from './anthropic';
import type { VendorName } from './config';

// Adapter registry. Base URLs are pinned from env - providers can never
// supply their own endpoint (usage-minting / SSRF; see the BYOK plan §7).
//
// Venice, OpenAI, and Kimi share the OpenAI-compatible transport in
// venice.ts (Bearer auth, /chat/completions, prompt/completion_tokens); its
// 429-body credit sniffing already classifies OpenAI's `insufficient_quota`
// and Moonshot's quota errors as credit exhaustion. Anthropic is a real
// translation adapter (anthropic.ts).

export interface ChatRequest {
  /** Concrete vendor model (already resolved from the model class). */
  model: string;
  /** OpenAI-style chat payload; `model` inside it is overridden. */
  payload: Record<string, unknown>;
}

export interface VendorAdapter {
  vendor: VendorName;
  validateKey(key: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  probe(key: string): Promise<ProbeResult>;
  /** Normalized OpenAI-shape result regardless of vendor. */
  chat(key: string, req: ChatRequest): Promise<VeniceCallResult>;
}

function openAiCompatibleAdapter(
  vendor: VendorName,
  baseUrl: string,
  validationModel: string,
): VendorAdapter {
  const opts = { baseUrl };
  return {
    vendor,
    validateKey: (key) => validateKey(key, validationModel, opts),
    probe: (key) => probeKey(key, opts),
    chat: (key, req) => chatCompletion(key, { ...req.payload, model: req.model }, opts),
  };
}

function anthropicAdapter(baseUrl: string, validationModel: string): VendorAdapter {
  const opts = { baseUrl };
  return {
    vendor: 'anthropic',
    validateKey: (key) => anthropicValidateKey(key, validationModel, opts),
    probe: (key) => anthropicProbe(key, opts),
    chat: (key, req) => anthropicChat(key, req.payload, req.model, opts),
  };
}

const globalState = globalThis as unknown as {
  vendorAdapters?: Record<VendorName, VendorAdapter>;
};

export function getAdapter(vendor: VendorName): VendorAdapter {
  if (!globalState.vendorAdapters) {
    const env = getEnv();
    globalState.vendorAdapters = {
      venice: openAiCompatibleAdapter('venice', env.VENICE_BASE_URL, env.VENICE_VALIDATION_MODEL),
      openai: openAiCompatibleAdapter('openai', env.POOL_OPENAI_BASE_URL, env.OPENAI_VALIDATION_MODEL),
      kimi: openAiCompatibleAdapter('kimi', env.POOL_KIMI_BASE_URL, env.KIMI_VALIDATION_MODEL),
      anthropic: anthropicAdapter(env.POOL_ANTHROPIC_BASE_URL, env.ANTHROPIC_VALIDATION_MODEL),
    };
  }
  return globalState.vendorAdapters[vendor];
}
