// Public surface of the parse-capture subsystem. game.ts calls exactly three
// things: createParseSubsystem at boot, subsystem.observe(events) at the tick
// drain, and subsystem.stop() at shutdown; main.ts registers the metrics.
import { MOBS } from '../../src/sim/data';
import type { SimEvent } from '../../src/sim/types';
import { CensusExporter } from './census';
import { loadCensusRows } from './census_db';
import type { FightParticipant, ParseEnv } from './contract';
import { CONTRACT_VERSION } from './contract';
import { createParseCounters, type ParseCounters, registerParseMetrics } from './counters';
import { loadParseFlags, type ParseFlags } from './flags';
import { ParseRecorder } from './recorder';
import { BatchShipper } from './shipper';
import { BatchSpool } from './spool';
import type { RecorderSim } from './types';

export { readBuildVersion } from './build_version';
export type { FightParticipant, ParseEnv } from './contract';
export { CONTRACT_VERSION } from './contract';
export type { ParseCounters } from './counters';
export { createParseCounters, registerParseMetrics } from './counters';
export type { ParseFlags } from './flags';
export { loadParseFlags } from './flags';
export type { ParseRecorderOptions } from './recorder';
export { ParseRecorder } from './recorder';
export { BatchShipper } from './shipper';
export { BatchSpool } from './spool';
export type { RecorderSim, RecordSink, SegmenterHost } from './types';

export interface ParseSubsystem {
  readonly enabled: boolean;
  readonly counters: ParseCounters;
  /** Per-tick hook: MUST be called before routeEvents so it sees every tick. */
  observe(events: readonly SimEvent[]): void;
  /** Shutdown: closes open fights and flushes the shipper (spools on failure). */
  stop(): Promise<void>;
}

export interface ParseSubsystemOptions {
  sim: RecorderSim;
  realm: string;
  build: string;
  resolveParticipant: (pid: number) => FightParticipant | null;
  flags?: ParseFlags;
}

const INERT: Omit<ParseSubsystem, 'counters'> = {
  enabled: false,
  observe: () => undefined,
  stop: async () => undefined,
};

export function createParseSubsystem(opts: ParseSubsystemOptions): ParseSubsystem {
  const flags = opts.flags ?? loadParseFlags();
  const counters = createParseCounters();
  if (!flags.enabled || flags.ingestUrl === null) {
    return { ...INERT, counters };
  }
  const spool = new BatchSpool(flags.spoolDir, flags.spoolMaxBytes, counters);
  const shipper = new BatchShipper(
    { realm: opts.realm, env: flags.envLabel, build: opts.build },
    flags.ingestUrl,
    flags.ingestToken,
    spool,
    counters,
  );
  shipper.startReplayHeartbeat();
  const recorder = new ParseRecorder({
    flags,
    sim: opts.sim,
    sink: shipper,
    counters,
    resolveParticipant: opts.resolveParticipant,
    // Boss detection for dungeon/raid segmentation. Named mid-bosses without
    // the template flag (see morthen's neighbour in content/dungeons.ts)
    // segment as trash; the content pack can refine labeling at read time.
    isBossTemplate: (templateId) => MOBS[templateId]?.boss === true,
  });
  let census: CensusExporter | null = null;
  if (flags.censusEnabled) {
    census = new CensusExporter(
      (snapshotDate) => loadCensusRows(opts.realm, snapshotDate),
      shipper,
      counters,
      flags.censusUtcHour,
    );
    census.start();
  }
  console.log(
    `[parse] capture enabled (contract v${CONTRACT_VERSION}, env ${flags.envLabel}, surfaces ${[...flags.surfaces].join(',')}, census ${flags.censusEnabled ? 'on' : 'off'})`,
  );
  // A throw from the observer must never unwind into the tick loop (it would
  // skip routeEvents and snapshots for the whole timer callback): first throw
  // disables capture for the life of the process, like the budget breaker.
  let observeDead = false;
  return {
    enabled: true,
    counters,
    observe: (events) => {
      if (observeDead) return;
      try {
        recorder.observe(events);
      } catch (e) {
        observeDead = true;
        counters.captureDisabled = 1;
        console.error('[parse] observe threw; capture disabled until restart:', e);
      }
    },
    stop: async () => {
      census?.stop();
      recorder.stop();
      await shipper.stop();
    },
  };
}
