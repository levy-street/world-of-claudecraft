// Shared scripted-sim fixture for the server/parse suites (recorder, pve,
// golden): a mutable RecorderSim plus the common entity/flag builders. Each
// suite keeps its own participant resolver (they deliberately differ).
import type { ParseFlags } from '../../server/parse/flags';
import type {
  ArenaMatchView,
  BgMatchView,
  InstanceSlotView,
  RecorderEntityView,
  RecorderSim,
  RiftInstanceView,
  RiftPortalView,
} from '../../server/parse/types';

export interface FakeSim extends RecorderSim {
  tickCount: number;
  entities: Map<number, RecorderEntityView>;
  arenaMatches: Map<number, ArenaMatchView>;
  bgMatches: Map<number, BgMatchView>;
  instances: InstanceSlotView[];
  riftInstances: RiftInstanceView[];
  naturalRiftPortals: RiftPortalView[];
}

export function fakeSim(): FakeSim {
  return {
    tickCount: 0,
    entities: new Map(),
    arenaMatches: new Map(),
    bgMatches: new Map(),
    instances: [],
    riftInstances: [],
    naturalRiftPortals: [],
  };
}

export function fakePlayer(id: number, templateId = 'mage'): RecorderEntityView {
  return { id, templateId, level: 20, dead: false };
}

export const FAKE_PARSE_FLAGS: ParseFlags = {
  enabled: true,
  ingestUrl: 'http://unused',
  ingestToken: null,
  surfaces: new Set(['arena', 'battleground', 'raid', 'dungeon', 'rift']),
  spoolDir: 'unused',
  spoolMaxBytes: 1,
  envLabel: 'dev',
  censusEnabled: false,
  censusUtcHour: 9,
};
