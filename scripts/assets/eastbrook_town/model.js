import { buildBank, buildInn, buildSmithy } from './buildings_commerce.js';
import { buildChapel, buildToolworks, buildWeavingWorkshop } from './buildings_craft.js';
import { buildCivicWellBeacon, buildMarketStall, buildWallWing } from './furniture.js';
import { createTownBuckets, finishTownAsset } from './shared.js';

export const EASTBROOK_TOWN_ASSET_IDS = Object.freeze([
  'bank',
  'smithy',
  'inn',
  'chapel',
  'weaving_workshop',
  'toolworks',
  'civic_well_beacon',
  'market_stall',
  'wall_wing',
]);

export const EASTBROOK_TOWN_CONTRACTS = Object.freeze({
  bank: Object.freeze({
    id: 'eastbrook-bank',
    rootName: 'EastbrookBank',
    outputName: 'eastbrook_bank.glb',
    referenceName: 'bank.png',
    dimensions: Object.freeze({ width: 7, height: 7.8, depth: 5.5 }),
    triangleCeiling: 6000,
    byteCeiling: 350 * 1024,
    serviceCues: Object.freeze(['arched-entry', 'teller-window', 'vault-alcove', 'bank-banner']),
    sockets: Object.freeze([
      Object.freeze({
        id: 'front-entry',
        name: 'Socket_FrontEntry',
        position: [-1.48, 0, 2.62],
        purpose: 'front entrance alignment',
      }),
      Object.freeze({
        id: 'teller',
        name: 'Socket_TellerWindow',
        position: [0.72, 1.42, 2.45],
        purpose: 'bank service cue',
      }),
    ]),
    build: buildBank,
  }),
  smithy: Object.freeze({
    id: 'eastbrook-smithy',
    rootName: 'EastbrookSmithy',
    outputName: 'eastbrook_smithy.glb',
    referenceName: 'smithy.png',
    dimensions: Object.freeze({ width: 7, height: 7.5, depth: 5.5 }),
    triangleCeiling: 6000,
    byteCeiling: 350 * 1024,
    serviceCues: Object.freeze(['open-forge', 'chimney', 'anvil', 'tool-rack', 'log-rack']),
    sockets: Object.freeze([
      Object.freeze({
        id: 'front-entry',
        name: 'Socket_FrontEntry',
        position: [-1.45, 0, 3.45],
        purpose: 'front entrance alignment',
      }),
      Object.freeze({
        id: 'forge',
        name: 'Socket_Forge',
        position: [1.72, 1.1, 1.8],
        purpose: 'smithing service cue',
      }),
    ]),
    build: buildSmithy,
  }),
  inn: Object.freeze({
    id: 'eastbrook-inn',
    rootName: 'EastbrookInn',
    outputName: 'eastbrook_inn.glb',
    referenceName: 'inn.png',
    dimensions: Object.freeze({ width: 7.5, height: 8.5, depth: 6 }),
    triangleCeiling: 6000,
    byteCeiling: 350 * 1024,
    serviceCues: Object.freeze(['deep-portico', 'upper-dormer', 'chimney-hood', 'provision-table']),
    sockets: Object.freeze([
      Object.freeze({
        id: 'front-entry',
        name: 'Socket_FrontEntry',
        position: [0, 0, 4.35],
        purpose: 'front entrance alignment',
      }),
      Object.freeze({
        id: 'provisions',
        name: 'Socket_Provisions',
        position: [-2.35, 1, 3.82],
        purpose: 'inn service cue',
      }),
    ]),
    build: buildInn,
  }),
  chapel: Object.freeze({
    id: 'eastbrook-chapel',
    rootName: 'EastbrookChapel',
    outputName: 'eastbrook_chapel.glb',
    referenceName: 'chapel.png',
    dimensions: Object.freeze({ width: 5.5, height: 7, depth: 6 }),
    triangleCeiling: 6000,
    byteCeiling: 350 * 1024,
    serviceCues: Object.freeze([
      'pointed-entry',
      'lancet-windows',
      'flower-boxes',
      'crystal-finial',
    ]),
    sockets: Object.freeze([
      Object.freeze({
        id: 'front-entry',
        name: 'Socket_FrontEntry',
        position: [0, 0, 3.65],
        purpose: 'front entrance alignment',
      }),
      Object.freeze({
        id: 'altar-axis',
        name: 'Socket_AltarAxis',
        position: [0, 1.1, -2.8],
        purpose: 'chapel interior axis cue',
      }),
    ]),
    build: buildChapel,
  }),
  weaving_workshop: Object.freeze({
    id: 'eastbrook-weaving-workshop',
    rootName: 'EastbrookWeavingWorkshop',
    outputName: 'eastbrook_weaving_workshop.glb',
    referenceName: 'weaving-workshop.png',
    dimensions: Object.freeze({ width: 5.5, height: 5.8, depth: 4.5 }),
    triangleCeiling: 6000,
    byteCeiling: 350 * 1024,
    serviceCues: Object.freeze(['open-loom-bay', 'threaded-loom', 'fabric-rolls', 'dye-barrel']),
    sockets: Object.freeze([
      Object.freeze({
        id: 'front-entry',
        name: 'Socket_FrontEntry',
        position: [-1.3, 0, 3.0],
        purpose: 'front entrance alignment',
      }),
      Object.freeze({
        id: 'loom',
        name: 'Socket_Loom',
        position: [1.15, 1.2, 2.48],
        purpose: 'weaving service cue',
      }),
    ]),
    build: buildWeavingWorkshop,
  }),
  toolworks: Object.freeze({
    id: 'eastbrook-toolworks',
    rootName: 'EastbrookToolworks',
    outputName: 'eastbrook_toolworks.glb',
    referenceName: 'toolworks.png',
    dimensions: Object.freeze({ width: 5.5, height: 5.8, depth: 4.5 }),
    triangleCeiling: 6000,
    byteCeiling: 350 * 1024,
    serviceCues: Object.freeze(['covered-tool-display', 'workbench', 'crate', 'barrel']),
    sockets: Object.freeze([
      Object.freeze({
        id: 'front-entry',
        name: 'Socket_FrontEntry',
        position: [0.72, 0, 3.0],
        purpose: 'front entrance alignment',
      }),
      Object.freeze({
        id: 'tool-display',
        name: 'Socket_ToolDisplay',
        position: [-1.32, 1.45, 2.48],
        purpose: 'tool service cue',
      }),
    ]),
    build: buildToolworks,
  }),
  civic_well_beacon: Object.freeze({
    id: 'eastbrook-civic-well-beacon',
    rootName: 'EastbrookCivicWellBeacon',
    outputName: 'eastbrook_civic_well_beacon.glb',
    referenceName: 'civic-well-beacon.png',
    dimensions: Object.freeze({ width: 3.2, height: 3.1, depth: 3.2 }),
    triangleCeiling: 3000,
    byteCeiling: 180 * 1024,
    serviceCues: Object.freeze(['masonry-well', 'water-basin', 'crystal-beacon']),
    sockets: Object.freeze([
      Object.freeze({
        id: 'center',
        name: 'Socket_CivicCenter',
        position: [0, 0, 0],
        purpose: 'civic center alignment',
      }),
      Object.freeze({
        id: 'beacon',
        name: 'Socket_Beacon',
        position: [0, 2.65, 0],
        purpose: 'beacon effect anchor',
      }),
    ]),
    build: buildCivicWellBeacon,
  }),
  market_stall: Object.freeze({
    id: 'eastbrook-market-stall',
    rootName: 'EastbrookMarketStall',
    outputName: 'eastbrook_market_stall.glb',
    referenceName: 'market-stall-fence.png',
    dimensions: Object.freeze({ width: 2.8, height: 2.7, depth: 2.2 }),
    triangleCeiling: 3000,
    byteCeiling: 180 * 1024,
    serviceCues: Object.freeze(['striped-canopy', 'counter-goods', 'crate', 'barrel', 'lanterns']),
    sockets: Object.freeze([
      Object.freeze({
        id: 'vendor',
        name: 'Socket_Vendor',
        position: [0, 0, -0.42],
        purpose: 'vendor alignment',
      }),
      Object.freeze({
        id: 'counter',
        name: 'Socket_Counter',
        position: [0, 1, 0.68],
        purpose: 'market service cue',
      }),
    ]),
    build: buildMarketStall,
  }),
  wall_wing: Object.freeze({
    id: 'eastbrook-wall-wing',
    rootName: 'EastbrookWallWing',
    outputName: 'eastbrook_wall_wing.glb',
    referenceName: 'wall-wing.png',
    dimensions: Object.freeze({ width: 6.5, height: 2.7, depth: 0.65 }),
    triangleCeiling: 206,
    byteCeiling: 180 * 1024,
    serviceCues: Object.freeze([
      'masonry-courses',
      'rail-caps',
      'watch-lantern',
      'banded-gate-leaf',
    ]),
    sockets: Object.freeze([
      Object.freeze({
        id: 'left-join',
        name: 'Socket_LeftJoin',
        position: [-3.25, 0, 0],
        purpose: 'wall chaining anchor',
      }),
      Object.freeze({
        id: 'right-gate',
        name: 'Socket_RightGate',
        position: [3.25, 0, 0],
        purpose: 'gate-side chaining anchor',
      }),
    ]),
    build: buildWallWing,
  }),
});

export function createEastbrookTownAsset(assetId) {
  const contract = EASTBROOK_TOWN_CONTRACTS[assetId];
  if (!contract) throw new Error(`unknown Eastbrook town asset: ${assetId}`);
  const buckets = createTownBuckets();
  contract.build(buckets);
  return finishTownAsset(contract, buckets);
}
