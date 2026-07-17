// Responsible-gambling configuration for the RiverBoat casino realm, resolved
// from env with safe defaults. Pure (no IO): the deposit/loss caps, the minimum
// age, the self-exclusion durations, and the reality-check cadence. The RG
// service reads these; the admin can tune them per the plan's bot_detector_config
// precedent later, but the env defaults are the fail-safe floor.

export interface RgLimits {
  // The default rolling caps on total inflow NOTIONAL (in copper for soft mode,
  // or the money-route's own base unit) over each window. A player may lower
  // instantly and raise only after a cooldown (enforced by the service). 0 means
  // no cap for that window (the caps default generous, not off).
  dailyNotionalCap: number;
  weeklyNotionalCap: number;
  monthlyNotionalCap: number;
}

export interface RgConfig {
  // The minimum age in years to enter the casino realm. Self-attested DOB by
  // default; a KYC vendor swaps in behind the same ageVerdict seam.
  minAgeYears: number;
  // The default per-account inflow caps.
  limits: RgLimits;
  // How long a raise to a limit is held before it takes effect (standard RG
  // anti-tilt pattern: lowers are instant, raises wait).
  limitRaiseCooldownMs: number;
  // The self-exclusion cool-off window durations (permanent has no expiry).
  cooloffMs: { cooloff_24h: number; cooloff_30d: number };
  // The reality-check interval (a session-time toast cadence, ms).
  realityCheckMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = (env[name] ?? '').trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

// The generous default caps (in copper): a whale can move real volume, but a
// runaway session hits a wall. Operators tune via env; counsel may tighten.
const DEFAULT_DAILY = 100_000_000; // 10,000g
const DEFAULT_WEEKLY = 500_000_000;
const DEFAULT_MONTHLY = 2_000_000_000;

export function resolveRgConfig(env: NodeJS.ProcessEnv = process.env): RgConfig {
  return {
    minAgeYears: intEnv(env, 'RIVERBOAT_MIN_AGE_YEARS', 18),
    limits: {
      dailyNotionalCap: intEnv(env, 'RIVERBOAT_DAILY_NOTIONAL_CAP', DEFAULT_DAILY),
      weeklyNotionalCap: intEnv(env, 'RIVERBOAT_WEEKLY_NOTIONAL_CAP', DEFAULT_WEEKLY),
      monthlyNotionalCap: intEnv(env, 'RIVERBOAT_MONTHLY_NOTIONAL_CAP', DEFAULT_MONTHLY),
    },
    limitRaiseCooldownMs: intEnv(env, 'RIVERBOAT_LIMIT_RAISE_COOLDOWN_MS', DAY_MS),
    cooloffMs: { cooloff_24h: DAY_MS, cooloff_30d: 30 * DAY_MS },
    realityCheckMs: intEnv(env, 'RIVERBOAT_REALITY_CHECK_MS', 60 * 60 * 1000),
  };
}

export const RG_CONFIG: RgConfig = resolveRgConfig();
