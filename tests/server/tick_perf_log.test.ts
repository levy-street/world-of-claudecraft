// The PERF_TICK_LOG heartbeat formatters (server/tick_perf_log.ts), moved out
// of GameServer.maybeLogTickPerf at Phase 18. Two contracts: the [perf] line's
// token set is byte-identical to the pre-extraction inline template (the
// parser in scripts/lib/mob_stall_parse.mjs and the verbatim samples in
// tests/mob_stall_parse.test.ts read these tokens), with the ONE deliberate
// addition of the blobP99= token at the end (the p99 character blob gauge's
// always-on view); and the two conditional sim lines stay quiet when no phase
// carries cost.
import { describe, expect, it } from 'vitest';
import {
  formatMobZoneLine,
  formatSimPhaseLine,
  formatTickPerfLine,
  MOB_ZONE_PHASE_BY_ID,
  MOB_ZONE_PHASE_INSTANCE,
  MOB_ZONE_PHASE_OTHER,
  MOB_ZONE_PHASE_PREFIX,
  SIM_MOB_ZONE_PHASES,
  TICK_PERF_LINE_PHASES,
  type TickPerfLineInputs,
} from '../../server/tick_perf_log';
import type { PhaseStats } from '../../server/tick_profiler';
import { ZONES } from '../../src/sim/data';

function stats(mean: number, p95: number, max: number): PhaseStats {
  return { mean, p50: mean, p95, p99: max, max };
}

const PHASES: Record<string, PhaseStats> = {
  total: stats(1, 2.82, 7.27),
  tick: stats(0.5, 1.19, 2.74),
  broadcast: stats(0.6, 1.44, 4.07),
  bcastSelf: stats(0.2, 0.47, 2.02),
  bcastGrid: stats(0.3, 0.59, 1.04),
  events: stats(0.01, 0.02, 0.66),
  social: stats(0, 0, 0.05),
};

const INPUTS: TickPerfLineInputs = {
  online: 20,
  ents: 430,
  tickHz: 20.1,
  tickMs: 1.83,
  overBudget: false,
  phases: PHASES,
  visits: 1941,
  serializes: 75,
  baseSerializes: 60,
  serializeNs: 130_000n,
  legacySerializes: 3,
  stableSerializes: 72,
  aggroVisits: 131,
  threatVisits: 0,
  blobP99Bytes: 18_944,
};

// The exact string the inline template produced before the extraction (the
// pre-Phase-18 game.ts maybeLogTickPerf), plus the appended blobP99 token.
const EXPECTED_LINE =
  '[perf] online=20 ents=430 tickHz=20.1 tickMs=1.83 | p95/max total=2.82/7.27 tick=1.19/2.74 broadcast=1.44/4.07 bcastSelf=0.47/2.02 bcastGrid=0.59/1.04 events=0.02/0.66 social=0/0.05 | visits=1941 serializes=75 baseSerializes=60 serializeMs=0.13 timerVariants=3/72 aggroVisits=131 threatVisits=0 blobP99=18944';

describe('formatTickPerfLine', () => {
  it('renders the pre-extraction token set byte for byte, with blobP99 appended last', () => {
    expect(formatTickPerfLine(INPUTS)).toBe(EXPECTED_LINE);
  });

  it('prints the phases in the pinned order the parser and samples rely on', () => {
    expect([...TICK_PERF_LINE_PHASES]).toEqual([
      'total',
      'tick',
      'broadcast',
      'bcastSelf',
      'bcastGrid',
      'events',
      'social',
    ]);
  });

  it('marks an over-budget pass with OVER right after tickMs and prints n/a during rate-meter warmup', () => {
    const line = formatTickPerfLine({ ...INPUTS, tickHz: null, tickMs: 61.02, overBudget: true });
    expect(line.startsWith('[perf] online=20 ents=430 tickHz=n/a tickMs=61.02 OVER | ')).toBe(true);
  });

  it('rounds serializeMs and tickHz to two decimals from the raw ns and Hz', () => {
    const line = formatTickPerfLine({ ...INPUTS, tickHz: 19.98765, serializeNs: 1_234_567n });
    expect(line).toContain(' tickHz=19.99 ');
    expect(line).toContain(' serializeMs=1.23 ');
  });

  it('carries the blob p99 as a bare byte count (0 before any save)', () => {
    expect(formatTickPerfLine({ ...INPUTS, blobP99Bytes: 0 }).endsWith(' blobP99=0')).toBe(true);
    expect(/\bblobP99=(\d+)$/.exec(formatTickPerfLine(INPUTS))?.[1]).toBe('18944');
  });
});

describe('the two conditional sim lines', () => {
  const SIM_PHASES = ['sim.p.move', 'sim.mob.update', 'sim.farming'];

  it('formatSimPhaseLine is null when no sim phase carries cost', () => {
    expect(formatSimPhaseLine(PHASES, SIM_PHASES)).toBeNull();
    const zeroed = { ...PHASES, 'sim.p.move': stats(0, 0, 0) };
    expect(formatSimPhaseLine(zeroed, SIM_PHASES)).toBeNull();
  });

  it('formatSimPhaseLine strips the sim. prefix and sorts by mean, heaviest first', () => {
    const withSim = {
      ...PHASES,
      'sim.p.move': stats(0.4, 0.9, 2),
      'sim.mob.update': stats(1.5, 3, 9),
      'sim.farming': stats(0.1, 0.2, 0.3),
    };
    expect(formatSimPhaseLine(withSim, SIM_PHASES)).toBe(
      '[perf.sim] mean/p95/max mob.update=1.5/3/9 p.move=0.4/0.9/2 farming=0.1/0.2/0.3',
    );
  });

  it('formatSimPhaseLine prints at most the fourteen heaviest phases', () => {
    const many: Record<string, PhaseStats> = {};
    const names: string[] = [];
    for (let i = 0; i < 20; i++) {
      const name = `sim.phase${String(i).padStart(2, '0')}`;
      names.push(name);
      many[name] = stats(i + 1, i + 1, i + 1);
    }
    const line = formatSimPhaseLine(many, names);
    expect(line).not.toBeNull();
    expect((line as string).split(' ').filter((tok) => tok.includes('=')).length).toBe(14);
    expect(line).toContain('phase19=20/20/20');
    expect(line).not.toContain('phase05=');
  });

  it('formatMobZoneLine is quiet without zone cost and strips the zone prefix otherwise', () => {
    expect(formatMobZoneLine(PHASES)).toBeNull();
    const [zoneA, zoneB] = ZONES;
    const withZones = {
      ...PHASES,
      [`${MOB_ZONE_PHASE_PREFIX}${zoneA.id}`]: stats(0.2, 0.5, 1),
      [`${MOB_ZONE_PHASE_PREFIX}${zoneB.id}`]: stats(0.7, 1.1, 3),
      [MOB_ZONE_PHASE_INSTANCE]: stats(0.1, 0.1, 0.1),
    };
    expect(formatMobZoneLine(withZones)).toBe(
      `[perf.sim.mob] zone mean/p95/max ${zoneB.id}=0.7/1.1/3 ${zoneA.id}=0.2/0.5/1 instance=0.1/0.1/0.1`,
    );
  });
});

describe('the mob-zone phase buckets (moved beside their line from server/game.ts)', () => {
  it('names one bucket per authored zone plus the instance and other safety nets', () => {
    expect(MOB_ZONE_PHASE_PREFIX).toBe('sim.mob.z:');
    expect(SIM_MOB_ZONE_PHASES).toHaveLength(ZONES.length + 2);
    for (const zone of ZONES) {
      expect(SIM_MOB_ZONE_PHASES).toContain(`sim.mob.z:${zone.id}`);
      expect(MOB_ZONE_PHASE_BY_ID.get(zone.id)).toBe(`sim.mob.z:${zone.id}`);
    }
    expect(MOB_ZONE_PHASE_INSTANCE).toBe('sim.mob.z:instance');
    expect(MOB_ZONE_PHASE_OTHER).toBe('sim.mob.z:other');
    expect(SIM_MOB_ZONE_PHASES.slice(-2)).toEqual([MOB_ZONE_PHASE_INSTANCE, MOB_ZONE_PHASE_OTHER]);
  });
});
