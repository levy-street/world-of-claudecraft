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
  // Real pools by default: the resource sampler reads these every second, and a
  // scripted player left at 0/0 makes the golden fixture a row of zeros that
  // pins nothing. Suites that care about a specific pool override them.
  return {
    id,
    templateId,
    name: `Fake${id}`,
    level: 20,
    dead: false,
    hp: 1000,
    maxHp: 1000,
    resource: 4000,
    maxResource: 5000,
    resourceType: 'mana',
  };
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
