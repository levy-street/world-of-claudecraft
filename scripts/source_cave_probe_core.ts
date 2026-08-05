// Pure configuration and measurement helpers for the Source Cave raid probe.
// Keeping these independent of Sim makes the balance harness itself cheap to
// test, especially its pacing-invalidity rules and composition matrix.

export type SourceCaveProbeProfileKey =
  | 'aoe'
  | 'single-target-mixed'
  | 'single-target-melee'
  | 'single-target-hunter';

type ProbeDpsClass = 'warrior' | 'rogue' | 'mage' | 'shaman' | 'hunter';

export interface SourceCaveProbeProfile {
  key: SourceCaveProbeProfileKey;
  dpsClasses: readonly ProbeDpsClass[];
  allowPlayerAoe: boolean;
  allowTankAoe: boolean;
  controlledHunterPets: boolean;
}

export const SOURCE_CAVE_PROBE_PROFILES = {
  aoe: {
    key: 'aoe',
    dpsClasses: ['warrior', 'rogue', 'mage', 'mage', 'shaman', 'hunter'],
    allowPlayerAoe: true,
    allowTankAoe: true,
    controlledHunterPets: false,
  },
  'single-target-mixed': {
    key: 'single-target-mixed',
    dpsClasses: ['warrior', 'rogue', 'mage', 'mage', 'shaman', 'hunter'],
    allowPlayerAoe: false,
    allowTankAoe: false,
    controlledHunterPets: false,
  },
  'single-target-melee': {
    key: 'single-target-melee',
    dpsClasses: ['rogue', 'rogue', 'rogue', 'rogue', 'rogue', 'rogue'],
    allowPlayerAoe: false,
    allowTankAoe: false,
    controlledHunterPets: false,
  },
  'single-target-hunter': {
    key: 'single-target-hunter',
    dpsClasses: ['hunter', 'hunter', 'hunter', 'hunter', 'hunter', 'hunter'],
    allowPlayerAoe: false,
    allowTankAoe: false,
    controlledHunterPets: true,
  },
} as const satisfies Readonly<Record<SourceCaveProbeProfileKey, SourceCaveProbeProfile>>;

export const DEFAULT_SOURCE_CAVE_PROBE_SEEDS = [
  7, 42, 137, 271, 509, 733, 997, 1234, 1601, 2027, 2551, 3163, 4001, 4999, 6007, 7001, 8081, 9001,
  10009, 12011,
] as const;

export function parseProbeSeeds(env: { PROBE_SEED?: string; PROBE_SEEDS?: string }): number[] {
  const source = env.PROBE_SEED ?? env.PROBE_SEEDS;
  if (!source) return [...DEFAULT_SOURCE_CAVE_PROBE_SEEDS];
  const seeds = source
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0);
  if (seeds.length === 0) throw new Error('PROBE_SEED(S) must contain a non-negative integer');
  return [...new Set(seeds)];
}

export interface ProbeWaveActivationInput {
  before: ReadonlySet<number>;
  after: ReadonlySet<number>;
  livingWaveIndexes: readonly number[];
  nextWaveAt: number | null;
  time: number;
  dt: number;
  totalWaves: number;
  breached: boolean;
}

export interface ProbeWaveActivationValidation {
  valid: boolean;
  reason?: string;
}

export function validateProbeWaveActivation(
  input: ProbeWaveActivationInput,
): ProbeWaveActivationValidation {
  if (input.breached) return { valid: false, reason: 'breach invalidated encounter pacing' };
  const added = [...input.after].filter((wave) => !input.before.has(wave));
  if (added.length === 0) return { valid: true };
  if (added.length > 1) return { valid: false, reason: 'multiple waves activated in one tick' };
  if (input.livingWaveIndexes.length > 0) {
    return { valid: false, reason: 'wave activated while another wave is alive' };
  }
  const expected = Array.from({ length: input.totalWaves }, (_, index) => index).find(
    (index) => !input.before.has(index),
  );
  if (added[0] !== expected) return { valid: false, reason: 'non-sequential wave activation' };
  if (input.nextWaveAt === null || input.time + input.dt < input.nextWaveAt - 1e-9) {
    return { valid: false, reason: 'wave activated before the pacing timer' };
  }
  return { valid: true };
}

export function hunterProbePosition(
  centre: { x: number; z: number },
  target: { x: number; z: number },
  hunterIndex: number,
): { x: number; z: number } {
  const dx = target.x - centre.x;
  const dz = target.z - centre.z;
  const distance = Math.hypot(dx, dz);
  const fallback = (Math.PI * 2 * hunterIndex) / 6;
  const ux = distance > 1e-9 ? dx / distance : Math.sin(fallback);
  const uz = distance > 1e-9 ? dz / distance : Math.cos(fallback);
  const radius = 8.5;
  return { x: centre.x - ux * radius, z: centre.z - uz * radius };
}

export type ProbeOutcome = 'cleared' | 'wipe' | 'timeout' | 'invalid';

export interface ProbeAggregateInput {
  outcome: ProbeOutcome;
  seconds: number;
  deaths: number;
  minHealerManaPct: number;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function aggregateProbeRuns(runs: readonly ProbeAggregateInput[]): {
  validRuns: number;
  invalidRuns: number;
  clears: number;
  clearRate: number;
  medianClearSeconds: number;
  p90Deaths: number;
  p10MinHealerManaPct: number;
} {
  const valid = runs.filter((run) => run.outcome !== 'invalid');
  const cleared = valid.filter((run) => run.outcome === 'cleared');
  const clears = cleared.length;
  return {
    validRuns: valid.length,
    invalidRuns: runs.length - valid.length,
    clears,
    clearRate: valid.length > 0 ? clears / valid.length : 0,
    medianClearSeconds: median(cleared.map((run) => run.seconds)),
    p90Deaths: percentile(
      valid.map((run) => run.deaths),
      0.9,
    ),
    p10MinHealerManaPct: percentile(
      valid.map((run) => run.minHealerManaPct),
      0.1,
    ),
  };
}
