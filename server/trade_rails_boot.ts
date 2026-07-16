// Fail-closed boot configuration for the two external trade rails (Claudium and
// $WOC). The house money-rail doctrine: a rail is OFF unless explicitly enabled,
// and a half-configured or typo'd enable THROWS at boot (loud misconfiguration,
// never a silent degrade). With both flags unset the rails read unavailable, the
// sim rejects pledges, and merging is behavior-neutral.

import type { WocTradeConfig } from './woc_trade';

const DEFAULT_WOC_MINT = '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth';
const DEFAULT_SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

const DEFAULT_WOC_TRADE_TIMEOUT_MS = 180_000;
const DEFAULT_WOC_TRADE_POLL_MS = 5000;

// Sane bounds so an operator typo cannot set a 5ms poll (RPC hammering) or a
// multi-hour timeout (escrow held far too long).
const MIN_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 900_000;
const MIN_POLL_MS = 1000;
const MAX_POLL_MS = 60_000;

export interface TradeRailsConfig {
  claudium: boolean;
  woc: WocTradeConfig | null;
}

type Env = Record<string, string | undefined>;

// A boolean enable flag accepts only unset / '0' / '1'. Anything else is a typo
// (e.g. 'true', 'yes', '1 '); throw naming the flag so it is caught at boot.
function readBoolFlag(env: Env, name: string): boolean {
  const raw = env[name];
  if (raw === undefined || raw === '0') return false;
  if (raw === '1') return true;
  throw new Error(
    `${name} must be '1', '0', or unset (got ${JSON.stringify(raw)}); refusing to boot on an ambiguous money-rail flag`,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readTimeoutMs(env: Env): number {
  const raw = env.WOC_TRADE_TIMEOUT_MS;
  const parsed = raw === undefined ? DEFAULT_WOC_TRADE_TIMEOUT_MS : Number(raw);
  const value = Number.isFinite(parsed) ? parsed : DEFAULT_WOC_TRADE_TIMEOUT_MS;
  return clamp(Math.trunc(value), MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
}

function readPollMs(env: Env): number {
  const raw = env.WOC_TRADE_POLL_MS;
  const parsed = raw === undefined ? DEFAULT_WOC_TRADE_POLL_MS : Number(raw);
  const value = Number.isFinite(parsed) ? parsed : DEFAULT_WOC_TRADE_POLL_MS;
  return clamp(Math.trunc(value), MIN_POLL_MS, MAX_POLL_MS);
}

// True only when BOTH the economy-service URL and internal secret are set (the
// same condition claudiumServiceConfigured() enforces, computed on the injected
// env so this stays unit-testable without mutating process.env).
function claudiumConfigured(env: Env): boolean {
  return (
    (env.WOC_ECONOMY_SERVICE_URL ?? '').trim() !== '' &&
    (env.WOC_ECONOMY_INTERNAL_SECRET ?? '') !== ''
  );
}

export function readTradeRailsConfig(env: Env = process.env): TradeRailsConfig {
  const claudiumEnabled = readBoolFlag(env, 'CLAUDIUM_TRADE_ENABLED');
  if (claudiumEnabled && !claudiumConfigured(env)) {
    throw new Error(
      'CLAUDIUM_TRADE_ENABLED=1 requires the economy service: set WOC_ECONOMY_SERVICE_URL and WOC_ECONOMY_INTERNAL_SECRET, or unset the flag',
    );
  }

  const wocEnabled = readBoolFlag(env, 'WOC_TRADE_ENABLED');
  const woc: WocTradeConfig | null = wocEnabled
    ? {
        rpcUrl: (env.SOLANA_RPC_URL ?? env.VITE_SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC_URL).trim(),
        mint: (env.WOC_MINT ?? env.VITE_WOC_MINT ?? DEFAULT_WOC_MINT).trim(),
        timeoutMs: readTimeoutMs(env),
        pollMs: readPollMs(env),
        minConfirm: 'finalized',
      }
    : null;

  return { claudium: claudiumEnabled, woc };
}
