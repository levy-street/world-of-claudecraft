import { describe, expect, it } from 'vitest';
import {
  MAP_MARKER_ART_IDS,
  MAP_MARKER_SIZES,
  type MapMarkerArtId,
  type MapMarkerSize,
  mapMarkerSizeForSemantic,
  mapMarkerSizesFor,
  type SemanticMapMarkerArt,
  semanticMapMarkerArt,
} from '../src/ui/map_marker_icon_art';
import { createMapMarkerArt, type MapMarkerRasterColors } from '../src/ui/map_marker_icon_loader';
import type { MapMarkerSemantic } from '../src/ui/map_marker_semantics_core';

const NEW_ART_IDS = [
  'delve-entrance',
  'delve-passage',
  'delve-surface-exit',
  'rift-entrance',
  'rift-descent',
  'rift-beacon',
  'rift-egress',
  'reward-treasure',
  'reward-locked-cache',
  'reward-reliquary',
  'world-passage',
] as const;

const RASTER_COLORS = {
  keyline: '#f5dfad',
  cooldownArcDark: '#24292a',
  cooldownArcLight: '#c8cdcc',
  lockDark: '#24170f',
  lockBronze: '#d39a45',
  lockHighlight: '#f2c46d',
  semanticDark: '#171a1d',
  semanticBronze: '#c28a42',
  semanticSilver: '#d7dce1',
  semanticGold: '#f2c357',
  semanticCyan: '#70d8ff',
  semanticJammed: '#e56d45',
  semanticOpened: '#d8dddc',
  neutralFallback: '#9ba1a2',
} as const satisfies MapMarkerRasterColors;

type SizeMatrix = readonly [MapMarkerSize, MapMarkerSize, MapMarkerSize, MapMarkerSize];

interface SemanticRouteCase {
  readonly label: string;
  readonly semantic: MapMarkerSemantic;
  readonly art: SemanticMapMarkerArt;
  /** Minimap standard, minimap compact, map standard, map compact. */
  readonly sizes: SizeMatrix;
}

const NAVIGATION_SIZES = [
  'minimapNavigation',
  'minimapNavigationCompact',
  'mapNavigation',
  'mapNavigationCompact',
] as const satisfies SizeMatrix;
const LOCKED_NAVIGATION_SIZES = [
  'minimapNavigationLocked',
  'minimapNavigationLockedCompact',
  'mapNavigationLocked',
  'mapNavigationLockedCompact',
] as const satisfies SizeMatrix;
const RANKED_NAVIGATION_SIZES = {
  C: [
    'minimapNavigationRankC',
    'minimapNavigationRankCCompact',
    'mapNavigationRankC',
    'mapNavigationRankCCompact',
  ],
  B: [
    'minimapNavigationRankB',
    'minimapNavigationRankBCompact',
    'mapNavigationRankB',
    'mapNavigationRankBCompact',
  ],
  A: [
    'minimapNavigationRankA',
    'minimapNavigationRankACompact',
    'mapNavigationRankA',
    'mapNavigationRankACompact',
  ],
  S: [
    'minimapNavigationRankS',
    'minimapNavigationRankSCompact',
    'mapNavigationRankS',
    'mapNavigationRankSCompact',
  ],
} as const satisfies Readonly<Record<'C' | 'B' | 'A' | 'S', SizeMatrix>>;

const REWARD_SIZES = {
  available: [
    'minimapRewardAvailable',
    'minimapRewardAvailableCompact',
    'mapRewardAvailable',
    'mapRewardAvailableCompact',
  ],
  locked: [
    'minimapRewardLocked',
    'minimapRewardLockedCompact',
    'mapRewardLocked',
    'mapRewardLockedCompact',
  ],
  active: [
    'minimapRewardActive',
    'minimapRewardActiveCompact',
    'mapRewardActive',
    'mapRewardActiveCompact',
  ],
  opened: [
    'minimapRewardOpened',
    'minimapRewardOpenedCompact',
    'mapRewardOpened',
    'mapRewardOpenedCompact',
  ],
  jammed: [
    'minimapRewardJammed',
    'minimapRewardJammedCompact',
    'mapRewardJammed',
    'mapRewardJammedCompact',
  ],
} as const satisfies Readonly<Record<SemanticMapMarkerArt['state'], SizeMatrix>>;

const BOUNTIFUL_REWARD_SIZES = {
  available: [
    'minimapRewardAvailableBountiful',
    'minimapRewardAvailableBountifulCompact',
    'mapRewardAvailableBountiful',
    'mapRewardAvailableBountifulCompact',
  ],
  locked: [
    'minimapRewardLockedBountiful',
    'minimapRewardLockedBountifulCompact',
    'mapRewardLockedBountiful',
    'mapRewardLockedBountifulCompact',
  ],
  active: [
    'minimapRewardActiveBountiful',
    'minimapRewardActiveBountifulCompact',
    'mapRewardActiveBountiful',
    'mapRewardActiveBountifulCompact',
  ],
  opened: [
    'minimapRewardOpenedBountiful',
    'minimapRewardOpenedBountifulCompact',
    'mapRewardOpenedBountiful',
    'mapRewardOpenedBountifulCompact',
  ],
  jammed: [
    'minimapRewardJammedBountiful',
    'minimapRewardJammedBountifulCompact',
    'mapRewardJammedBountiful',
    'mapRewardJammedBountifulCompact',
  ],
} as const satisfies Readonly<Record<SemanticMapMarkerArt['state'], SizeMatrix>>;

const RANK_CASES = [null, 'C', 'B', 'A', 'S'] as const;
const RIFT_REWARD_CASES = [
  {
    reward: 'treasure',
    state: 'available',
    id: 'reward-treasure',
    paintState: 'available',
  },
  {
    reward: 'treasure',
    state: 'locked',
    id: 'reward-locked-cache',
    paintState: 'locked',
  },
  { reward: 'treasure', state: 'opened', id: 'reward-treasure', paintState: 'opened' },
  {
    reward: 'treasure',
    state: 'jammed',
    id: 'reward-locked-cache',
    paintState: 'jammed',
  },
  {
    reward: 'cache',
    state: 'available',
    id: 'reward-locked-cache',
    paintState: 'available',
  },
  { reward: 'cache', state: 'locked', id: 'reward-locked-cache', paintState: 'locked' },
  { reward: 'cache', state: 'opened', id: 'reward-locked-cache', paintState: 'opened' },
  { reward: 'cache', state: 'jammed', id: 'reward-locked-cache', paintState: 'jammed' },
] as const;
const DELVE_REWARD_CASES = [
  { reward: 'cache', state: 'locked', id: 'reward-locked-cache', paintState: 'locked' },
  { reward: 'cache', state: 'ready', id: 'reward-locked-cache', paintState: 'available' },
  { reward: 'cache', state: 'active', id: 'reward-locked-cache', paintState: 'active' },
  { reward: 'cache', state: 'opened', id: 'reward-locked-cache', paintState: 'opened' },
  { reward: 'reliquary', state: 'locked', id: 'reward-reliquary', paintState: 'locked' },
  { reward: 'reliquary', state: 'ready', id: 'reward-reliquary', paintState: 'available' },
  { reward: 'reliquary', state: 'active', id: 'reward-reliquary', paintState: 'active' },
  { reward: 'reliquary', state: 'opened', id: 'reward-reliquary', paintState: 'opened' },
] as const;

const SEMANTIC_ROUTE_CASES: readonly SemanticRouteCase[] = [
  ...RANK_CASES.map(
    (rank): SemanticRouteCase => ({
      label: `rift entrance rank ${rank ?? 'unranked'}`,
      semantic: { kind: 'rift-entrance', rank },
      art: { id: 'rift-entrance', state: 'available', bountiful: false, rank },
      sizes: rank === null ? NAVIGATION_SIZES : RANKED_NAVIGATION_SIZES[rank],
    }),
  ),
  {
    label: 'rift descent',
    semantic: { kind: 'rift-descent' },
    art: { id: 'rift-descent', state: 'available', bountiful: false },
    sizes: NAVIGATION_SIZES,
  },
  ...RANK_CASES.map(
    (rank): SemanticRouteCase => ({
      label: `rift return beacon rank ${rank ?? 'unranked'}`,
      semantic: { kind: 'rift-return', route: 'beacon', rank },
      // Beacons are intentionally unranked artwork even when the shared semantic
      // type carries a rank. Enumerating all type-valid inputs keeps that collapse
      // explicit rather than letting the matrix self-certify only the null arm.
      art: { id: 'rift-beacon', state: 'available', bountiful: false, rank: null },
      sizes: NAVIGATION_SIZES,
    }),
  ),
  ...RANK_CASES.map(
    (rank): SemanticRouteCase => ({
      label: `rift egress rank ${rank ?? 'unranked'}`,
      semantic: { kind: 'rift-return', route: 'egress', rank },
      art: { id: 'rift-egress', state: 'available', bountiful: false, rank },
      sizes: rank === null ? NAVIGATION_SIZES : RANKED_NAVIGATION_SIZES[rank],
    }),
  ),
  ...RIFT_REWARD_CASES.map(
    ({ reward, state, id, paintState }): SemanticRouteCase => ({
      label: `rift ${reward} ${state}`,
      semantic: { kind: 'rift-reward', reward, state },
      art: { id, state: paintState, bountiful: false },
      sizes: REWARD_SIZES[paintState],
    }),
  ),
  {
    label: 'delve passage sealed',
    semantic: { kind: 'delve-passage', state: 'sealed' },
    art: { id: 'delve-passage', state: 'locked', bountiful: false },
    sizes: LOCKED_NAVIGATION_SIZES,
  },
  {
    label: 'delve passage open',
    semantic: { kind: 'delve-passage', state: 'open' },
    art: { id: 'delve-passage', state: 'available', bountiful: false },
    sizes: NAVIGATION_SIZES,
  },
  {
    label: 'delve surface exit',
    semantic: { kind: 'delve-surface' },
    art: { id: 'delve-surface-exit', state: 'available', bountiful: false },
    sizes: NAVIGATION_SIZES,
  },
  ...DELVE_REWARD_CASES.flatMap(({ reward, state, id, paintState }) =>
    ([false, true] as const).map(
      (bountiful): SemanticRouteCase => ({
        label: `delve ${reward} ${state} ${bountiful ? 'bountiful' : 'ordinary'}`,
        semantic: { kind: 'delve-reward', reward, state, bountiful },
        art: { id, state: paintState, bountiful },
        sizes: bountiful ? BOUNTIFUL_REWARD_SIZES[paintState] : REWARD_SIZES[paintState],
      }),
    ),
  ),
];

const RIFT_MECHANIC_CASES = [
  { kind: 'rift-mechanic', mechanic: 'pylon', state: 'unlit' },
  { kind: 'rift-mechanic', mechanic: 'pylon', state: 'lit' },
  { kind: 'rift-mechanic', mechanic: 'sequence-rune', state: 'unlit' },
  { kind: 'rift-mechanic', mechanic: 'sequence-rune', state: 'lit' },
  { kind: 'rift-mechanic', mechanic: 'ice-goal', state: 'target' },
  { kind: 'rift-mechanic', mechanic: 'boulder-pad', state: 'target' },
  { kind: 'rift-mechanic', mechanic: 'boulder', state: 'movable' },
  { kind: 'rift-mechanic', mechanic: 'boulder', state: 'placed' },
  { kind: 'rift-mechanic', mechanic: 'gate', state: 'sealed' },
  { kind: 'rift-mechanic', mechanic: 'gate', state: 'open' },
  { kind: 'rift-mechanic', mechanic: 'switch', state: 'ready' },
  { kind: 'rift-mechanic', mechanic: 'switch', state: 'on' },
  { kind: 'rift-mechanic', mechanic: 'orb', state: 'dormant' },
  { kind: 'rift-mechanic', mechanic: 'orb', state: 'active' },
  { kind: 'rift-mechanic', mechanic: 'roller', state: 'hazard' },
] as const satisfies readonly MapMarkerSemantic[];

describe('rift and delve painted map marker catalog', () => {
  it('keeps every accepted identity in the closed catalog', () => {
    for (const id of NEW_ART_IDS) expect(MAP_MARKER_ART_IDS).toContain(id);
  });

  it('enumerates every valid Rift and Delve generated-art semantic exactly once', () => {
    expect(SEMANTIC_ROUTE_CASES).toHaveLength(43);
    expect(new Set(SEMANTIC_ROUTE_CASES.map(({ semantic }) => JSON.stringify(semantic))).size).toBe(
      43,
    );
    expect(RIFT_MECHANIC_CASES).toHaveLength(15);
    expect(new Set(RIFT_MECHANIC_CASES.map((semantic) => JSON.stringify(semantic))).size).toBe(15);
  });

  it.each(SEMANTIC_ROUTE_CASES)(
    'routes $label through its exact art record and four raster profiles',
    ({ semantic, art, sizes }) => {
      const resolved = semanticMapMarkerArt(semantic);
      expect(resolved).toEqual(art);
      if (!resolved) throw new Error(`expected generated art for ${JSON.stringify(semantic)}`);
      expect([
        mapMarkerSizeForSemantic('minimap', false, resolved),
        mapMarkerSizeForSemantic('minimap', true, resolved),
        mapMarkerSizeForSemantic('map', false, resolved),
        mapMarkerSizeForSemantic('map', true, resolved),
      ]).toEqual(sizes);
    },
  );

  it.each(RIFT_MECHANIC_CASES)(
    'keeps $mechanic $state procedural instead of requesting unrelated generated art',
    (semantic) => {
      expect(semanticMapMarkerArt(semantic)).toBeNull();
    },
  );

  it('keeps the expanded exact-raster cache under one MiB including decoded masters', () => {
    let canvasCount = 0;
    let retainedBytes = 0;
    for (const id of MAP_MARKER_ART_IDS) {
      for (const size of mapMarkerSizesFor(id)) {
        canvasCount++;
        retainedBytes += MAP_MARKER_SIZES[size] ** 2 * 4;
      }
    }
    const decodedMasterBytes = MAP_MARKER_ART_IDS.length * 64 * 64 * 4;
    expect(canvasCount).toBe(248);
    expect(retainedBytes).toBe(523_712);
    expect(retainedBytes + decodedMasterBytes).toBeLessThan(1024 * 1024);
  });

  it('ships standard and compact exact rasters above the micro-scale minima', () => {
    expect(MAP_MARKER_SIZES.minimapNavigation).toBe(18);
    expect(MAP_MARKER_SIZES.minimapNavigationCompact).toBe(24);
    expect(MAP_MARKER_SIZES.mapNavigation).toBe(22);
    expect(MAP_MARKER_SIZES.mapNavigationCompact).toBe(30);
    expect(MAP_MARKER_SIZES.minimapRewardAvailable).toBe(18);
    expect(MAP_MARKER_SIZES.minimapRewardAvailableCompact).toBe(24);
    expect(MAP_MARKER_SIZES.mapRewardAvailable).toBe(20);
    expect(MAP_MARKER_SIZES.mapRewardAvailableCompact).toBe(28);

    expect(mapMarkerSizesFor('rift-egress')).toEqual(
      expect.arrayContaining([
        'minimapNavigation',
        'minimapNavigationCompact',
        'mapNavigation',
        'mapNavigationCompact',
      ]),
    );
    expect(mapMarkerSizesFor('world-passage')).toEqual([
      'minimapNavigation',
      'minimapNavigationCompact',
      'mapNavigation',
      'mapNavigationCompact',
    ]);
    expect(mapMarkerSizesFor('reward-reliquary')).toContain('mapRewardActiveBountifulCompact');
  });

  it('routes exact semantic identity and state without relying on hue alone', () => {
    expect(semanticMapMarkerArt({ kind: 'rift-entrance', rank: 'S' })).toEqual({
      id: 'rift-entrance',
      state: 'available',
      bountiful: false,
      rank: 'S',
    });
    expect(semanticMapMarkerArt({ kind: 'rift-return', route: 'beacon', rank: null })?.id).toBe(
      'rift-beacon',
    );
    expect(semanticMapMarkerArt({ kind: 'rift-return', route: 'egress', rank: 'A' })?.id).toBe(
      'rift-egress',
    );
    expect(semanticMapMarkerArt({ kind: 'rift-reward', reward: 'cache', state: 'jammed' })).toEqual(
      { id: 'reward-locked-cache', state: 'jammed', bountiful: false },
    );
    expect(
      semanticMapMarkerArt({
        kind: 'delve-reward',
        reward: 'reliquary',
        state: 'active',
        bountiful: true,
      }),
    ).toEqual({ id: 'reward-reliquary', state: 'active', bountiful: true });
    expect(semanticMapMarkerArt({ kind: 'delve-passage', state: 'sealed' })).toEqual({
      id: 'delve-passage',
      state: 'locked',
      bountiful: false,
    });
    expect(semanticMapMarkerArt({ kind: 'delve-surface' })?.id).toBe('delve-surface-exit');
    expect(
      semanticMapMarkerArt({ kind: 'rift-mechanic', mechanic: 'gate', state: 'sealed' }),
    ).toBeNull();
  });

  it('returns stable cached routing records on repeated redraws', () => {
    const semantic = {
      kind: 'delve-reward',
      reward: 'reliquary',
      state: 'active',
      bountiful: true,
    } as const;
    const first = semanticMapMarkerArt(semantic);
    expect(semanticMapMarkerArt(semantic)).toBe(first);
    if (!first) throw new Error('expected painted reliquary art');
    expect(mapMarkerSizeForSemantic('minimap', true, first)).toBe(
      'minimapRewardActiveBountifulCompact',
    );
  });
});

class StateImage {
  decoding = '';
  complete = false;
  naturalWidth = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
}

class StateCanvas {
  width = 0;
  height = 0;
  readonly fills: string[] = [];
  readonly strokes: string[] = [];
  imageDataReads = 0;
  readonly context = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    drawImage: () => {},
    clearRect: () => {},
    fillRect: () => this.fills.push(this.context.fillStyle),
    beginPath: () => {},
    arc: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => this.strokes.push(this.context.strokeStyle),
    getImageData: () => {
      this.imageDataReads++;
      return { data: new Uint8ClampedArray(this.width * this.height * 4) };
    },
    putImageData: () => {},
  };
  getContext(): typeof this.context {
    return this.context;
  }
}

function stateSprite(
  id: MapMarkerArtId,
  size: MapMarkerSize,
): { sprite: StateCanvas; scratch: StateCanvas } {
  const images: StateImage[] = [];
  const canvases: StateCanvas[] = [];
  const art = createMapMarkerArt(
    {
      createElement: () => {
        const canvas = new StateCanvas();
        canvases.push(canvas);
        return canvas;
      },
    } as unknown as Pick<Document, 'createElement'>,
    () => {
      const image = new StateImage();
      images.push(image);
      return image as unknown as HTMLImageElement;
    },
    RASTER_COLORS,
  );
  expect(art.sprite(id, size)).toBeNull();
  images[0].onload?.();
  return {
    sprite: art.sprite(id, size) as unknown as StateCanvas,
    scratch: canvases[0],
  };
}

describe('rift and delve cached state grammar', () => {
  it('bakes locked, active, opened, jammed, bountiful, and ranked cues once', () => {
    const { sprite: locked } = stateSprite('reward-reliquary', 'minimapRewardLocked');
    expect(locked.fills).toEqual(expect.arrayContaining(['#d39a45', '#f2c46d']));

    const { sprite: active } = stateSprite('reward-reliquary', 'minimapRewardActive');
    expect(active.strokes).toContain('#70d8ff');

    const { sprite: opened, scratch: openedScratch } = stateSprite(
      'reward-treasure',
      'minimapRewardOpened',
    );
    expect(openedScratch.imageDataReads).toBe(4);
    expect(opened.strokes).toContain('#d8dddc');

    const { sprite: jammed, scratch: jammedScratch } = stateSprite(
      'reward-locked-cache',
      'minimapRewardJammed',
    );
    expect(jammedScratch.imageDataReads).toBe(12);
    expect(jammed.strokes).toContain('#e56d45');

    const { sprite: bountiful } = stateSprite(
      'reward-reliquary',
      'minimapRewardActiveBountifulCompact',
    );
    expect(bountiful.fills).toContain('#f2c357');

    const { sprite: ranked } = stateSprite('rift-egress', 'minimapNavigationRankA');
    expect(ranked.strokes).toContain('#f2c357');
    expect(ranked.fills.filter((color) => color === '#f2c357')).toHaveLength(3);

    const { sprite: rankS } = stateSprite('rift-egress', 'minimapNavigationRankS');
    expect(rankS.fills.filter((color) => color === '#f2c357')).toHaveLength(5);
  });
});
