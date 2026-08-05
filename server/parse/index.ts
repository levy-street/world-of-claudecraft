// Public surface of the parse-capture subsystem. game.ts calls exactly three
// things: createParseSubsystem at boot, subsystem.observe(events) at the tick
// drain, and subsystem.stop() at shutdown; main.ts registers the metrics.
import type { SimEvent } from '../../src/sim/types';
import type { FightParticipant, ParseEnv } from './contract';
import { CONTRACT_VERSION } from './contract';
import { createParseCounters, registerParseMetrics, type ParseCounters } from './counters';
import { loadParseFlags, type ParseFlags } from './flags';
import { ParseRecorder } from './recorder';
import { BatchShipper } from './shipper';
import { BatchSpool } from './spool';
import type { RecorderSim } from './types';

export { CONTRACT_VERSION } from './contract';
export type { FightParticipant, ParseEnv } from './contract';
export { readBuildVersion } from './build_version';
export { createParseCounters, registerParseMetrics } from './counters';
export type { ParseCounters } from './counters';
export { loadParseFlags } from './flags';
export type { ParseFlags } from './flags';
export { ParseRecorder } from './recorder';
export type { ParseRecorderOptions } from './recorder';
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
  const recorder = new ParseRecorder({
    flags,
    sim: opts.sim,
    sink: shipper,
    counters,
    resolveParticipant: opts.resolveParticipant,
  });
  console.log(
    `[parse] capture enabled (contract v${CONTRACT_VERSION}, env ${flags.envLabel}, surfaces ${[...flags.surfaces].join(',')})`,
  );
  return {
    enabled: true,
    counters,
    observe: (events) => recorder.observe(events),
    stop: async () => {
      recorder.stop();
      await shipper.stop();
    },
  };
}
