import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RiftMapPainter } from '../src/ui/hud/rift/rift_map_painter';
import type { MapMarkerArt } from '../src/ui/map_marker_icon_art';
import type { PainterHostWriters } from '../src/ui/painter_host';
import type { IWorld, RiftFloorView } from '../src/world_api';

interface FakeCanvas {
  width: number;
  height: number;
  getContext(): FakeContext;
}

interface FakeCanvasOp {
  kind: string;
  args: unknown[];
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
}

interface FakeContext {
  canvas: FakeCanvas;
  ops: FakeCanvasOp[];
  lineWidthWrites: number[];
  fontWrites: string[];
  drawImage: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  strokeText: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;
  [key: string]: unknown;
}

function fakeContext(): FakeContext {
  let lineWidth = 1;
  const lineWidthWrites: number[] = [];
  let font = '';
  const fontWrites: string[] = [];
  const ops: FakeCanvasOp[] = [];
  let ctx: FakeContext;
  const record = (kind: string, args: unknown[] = []): void => {
    ops.push({
      kind,
      args,
      fillStyle: String(ctx.fillStyle ?? ''),
      strokeStyle: String(ctx.strokeStyle ?? ''),
      lineWidth,
    });
  };
  ctx = {
    canvas: null as unknown as FakeCanvas,
    ops,
    lineWidthWrites,
    fontWrites,
    fillStyle: '',
    strokeStyle: '',
    get lineWidth(): number {
      return lineWidth;
    },
    set lineWidth(value: number) {
      lineWidth = value;
      lineWidthWrites.push(value);
    },
    get font(): string {
      return font;
    },
    set font(value: string) {
      font = value;
      fontWrites.push(value);
    },
    drawImage: vi.fn((...args: unknown[]) => record('drawImage', args)),
    clearRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({
      width: 72,
      actualBoundingBoxLeft: 36,
      actualBoundingBoxRight: 36,
      actualBoundingBoxAscent: 12,
      actualBoundingBoxDescent: 3,
    })),
    save: vi.fn(() => record('save')),
    restore: vi.fn(() => record('restore')),
    beginPath: vi.fn(() => record('beginPath')),
    closePath: vi.fn(() => record('closePath')),
    moveTo: vi.fn((...args: unknown[]) => record('moveTo', args)),
    lineTo: vi.fn((...args: unknown[]) => record('lineTo', args)),
    rect: vi.fn((...args: unknown[]) => record('rect', args)),
    arc: vi.fn((...args: unknown[]) => record('arc', args)),
    ellipse: vi.fn((...args: unknown[]) => record('ellipse', args)),
    clip: vi.fn(() => record('clip')),
    fill: vi.fn(() => record('fill')),
    stroke: vi.fn(() => record('stroke')),
    fillRect: vi.fn((...args: unknown[]) => record('fillRect', args)),
    strokeRect: vi.fn((...args: unknown[]) => record('strokeRect', args)),
    setLineDash: vi.fn((...args: unknown[]) => record('setLineDash', args)),
    translate: vi.fn((...args: unknown[]) => record('translate', args)),
    rotate: vi.fn((...args: unknown[]) => record('rotate', args)),
    scale: vi.fn((...args: unknown[]) => record('scale', args)),
  } as FakeContext;
  const canvas: FakeCanvas = { width: 0, height: 0, getContext: () => ctx };
  ctx.canvas = canvas;
  return ctx;
}

const FLOOR: RiftFloorView = {
  eventId: null,
  instanceId: 1,
  seed: 17,
  baseLevel: 20,
  floorIndex: 0,
  floorCount: 3,
  origin: { x: 4000, z: -1000 },
  contentId: 'rift-test',
  contentHash: 'content-a',
  upgrade: null,
  name: 'The Ember Test: Depth 1',
  themeName: 'Ember',
  tier: 'A',
};

function world(floor: RiftFloorView | null = FLOOR, entityX = 4002): IWorld {
  const player = {
    id: 1,
    kind: 'player',
    pos: { x: 4000, y: 0, z: -1000 },
    facing: 0,
    ghost: false,
    corpsePos: null,
  };
  const mob = {
    id: 2,
    kind: 'mob',
    templateId: 'rift_mob',
    hostile: true,
    dead: false,
    lootable: false,
    aggroTargetId: 1,
    pos: { x: entityX, y: 0, z: -996 },
  };
  return {
    player,
    entities: new Map<number, unknown>([
      [1, player],
      [2, mob],
    ]),
    partyInfo: null,
    companionState: null,
    riftFloor: floor,
    riftBossDeathZones: () => [],
  } as unknown as IWorld;
}

function worldWithLiveGeometry(): IWorld {
  const active = world() as unknown as {
    player: {
      ghost: boolean;
      corpsePos: { x: number; z: number } | null;
    };
    entities: Map<number, unknown>;
    partyInfo: unknown;
    riftBossDeathZones: () => unknown[];
  };
  active.entities.set(3, {
    id: 3,
    kind: 'mob',
    templateId: 'rift_mob',
    hostile: true,
    dead: false,
    lootable: false,
    aggroTargetId: null,
    pos: { x: 4004, y: 0, z: -994 },
  });
  active.entities.set(4, {
    id: 4,
    kind: 'object',
    templateId: 'rift_gate_open',
    pos: { x: 4001, y: 0, z: -995 },
  });
  active.partyInfo = {
    members: [{ pid: 5, x: 4003, z: -997, cls: 'mage', dead: 1 }],
  };
  active.player.ghost = true;
  active.player.corpsePos = { x: 4001, z: -997 };
  active.riftBossDeathZones = () => [{ x: 4000, z: -998, radius: 4, remaining: 2, total: 4 }];
  return active as unknown as IWorld;
}

function worldWithObjects(templateIds: readonly string[], includePlayerLayers = false): IWorld {
  const active = world() as unknown as {
    player: {
      id: number;
      ghost: boolean;
      corpsePos: { x: number; z: number } | null;
    };
    entities: Map<number, unknown>;
    partyInfo: unknown;
  };
  active.entities = new Map([[active.player.id, active.player]]);
  templateIds.forEach((templateId, index) => {
    active.entities.set(index + 10, {
      id: index + 10,
      kind: 'object',
      templateId,
      dead: false,
      lootable: false,
      pos: { x: 4001 + index, y: 0, z: -996 + index },
    });
  });
  if (includePlayerLayers) {
    active.partyInfo = {
      members: [{ pid: 90, x: 4004, z: -997, cls: 'mage', dead: 0 }],
    };
    active.player.ghost = true;
    active.player.corpsePos = { x: 4002, z: -998 };
  }
  return active as unknown as IWorld;
}

const MECHANIC_FALLBACK_CASES = [
  {
    label: 'unlit pylon',
    templateId: 'rift_pylon',
    fill: 'resolved:--color-minimap-gather-cooldown',
    operations: 'beginPath,moveTo,lineTo,lineTo,closePath,fill,stroke',
  },
  {
    label: 'lit pylon',
    templateId: 'rift_pylon_lit',
    fill: 'resolved:--color-minimap-gather-ready',
    operations:
      'beginPath,moveTo,lineTo,lineTo,closePath,fill,stroke,beginPath,moveTo,lineTo,moveTo,lineTo,stroke',
  },
  {
    label: 'unlit sequence rune',
    templateId: 'rift_seq_rune',
    fill: 'resolved:--color-minimap-gather-cooldown',
    operations: 'beginPath,moveTo,lineTo,lineTo,lineTo,closePath,fill,stroke',
  },
  {
    label: 'lit sequence rune',
    templateId: 'rift_seq_rune_lit',
    fill: 'resolved:--color-minimap-gather-ready',
    operations:
      'beginPath,moveTo,lineTo,lineTo,lineTo,closePath,fill,stroke,beginPath,moveTo,lineTo,moveTo,lineTo,stroke',
  },
  {
    label: 'ice target',
    templateId: 'rift_ice_goal',
    fill: 'resolved:--color-minimap-gather-cooldown',
    operations: 'beginPath,arc,stroke,beginPath,arc,fill',
  },
  {
    label: 'boulder target',
    templateId: 'rift_boulder_pad',
    fill: 'resolved:--color-minimap-gather-cooldown',
    operations: 'beginPath,arc,stroke,beginPath,arc,fill',
  },
  {
    label: 'movable boulder',
    templateId: 'rift_boulder',
    fill: 'resolved:--color-minimap-gather-cooldown',
    operations: 'beginPath,arc,fill,stroke',
  },
  {
    label: 'placed boulder',
    templateId: 'rift_boulder_placed',
    fill: 'resolved:--color-minimap-gather-ready',
    operations: 'beginPath,arc,fill,stroke,beginPath,moveTo,lineTo,lineTo,stroke',
  },
  {
    label: 'sealed gate',
    templateId: 'rift_gate',
    fill: 'resolved:--color-minimap-gather-cooldown',
    operations:
      'beginPath,arc,lineTo,lineTo,closePath,fill,stroke,beginPath,moveTo,lineTo,moveTo,lineTo,stroke',
  },
  {
    label: 'open gate',
    templateId: 'rift_gate_open',
    fill: 'resolved:--color-minimap-gather-ready',
    operations: 'beginPath,arc,lineTo,lineTo,closePath,fill,stroke',
  },
  {
    label: 'ready switch',
    templateId: 'rift_switch',
    fill: 'resolved:--color-minimap-gather-cooldown',
    operations: 'fillRect,strokeRect',
  },
  {
    label: 'on switch',
    templateId: 'rift_switch_on',
    fill: 'resolved:--color-minimap-gather-ready',
    operations: 'fillRect,strokeRect,beginPath,moveTo,lineTo,lineTo,stroke',
  },
  {
    label: 'dormant orb',
    templateId: 'rift_infernal_orb',
    fill: 'resolved:--color-minimap-gather-cooldown',
    operations: 'beginPath,arc,fill,stroke',
  },
  {
    label: 'active orb',
    templateId: 'rift_infernal_orb_active',
    fill: 'resolved:--color-minimap-gather-ready',
    operations: 'beginPath,arc,fill,stroke,beginPath,moveTo,lineTo,moveTo,lineTo,stroke',
  },
  {
    label: 'hazard roller',
    templateId: 'rift_roller',
    fill: 'resolved:--color-delve-mob-aggro',
    operations:
      'beginPath,moveTo,lineTo,lineTo,closePath,fill,stroke,beginPath,moveTo,lineTo,stroke,beginPath,arc,fill',
  },
] as const;

const RIFT_SURFACE_PROFILES = [
  { surface: 'minimap', profile: 'standard', outlineWidth: 1.5 },
  { surface: 'minimap', profile: 'compact', outlineWidth: 2 },
  { surface: 'map', profile: 'standard', outlineWidth: 1.5 },
  { surface: 'map', profile: 'compact', outlineWidth: 2.25 },
] as const;

const writers: PainterHostWriters = {
  setText: vi.fn(),
  setDisplay: vi.fn(),
  setTransform: vi.fn(),
  setWidth: vi.fn(),
  setStyleProp: vi.fn(),
  toggleClass: vi.fn(),
  setAttr: vi.fn(),
};

const markerArt: MapMarkerArt = { sprite: vi.fn(() => null), preload: vi.fn() };
afterEach(() => {
  vi.unstubAllGlobals();
  Object.values(writers).forEach((fn) => {
    vi.mocked(fn).mockClear();
  });
});

function installBrowser(): FakeContext[] {
  const created: FakeContext[] = [];
  vi.stubGlobal('document', {
    documentElement: {},
    createElement(tag: string): FakeCanvas {
      if (tag !== 'canvas') throw new Error(`unexpected ${tag}`);
      const ctx = fakeContext();
      created.push(ctx);
      return ctx.canvas;
    },
  });
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (token: string) => `resolved:${token}`,
  }));
  return created;
}

function isolatedObjectOps(ctx: FakeContext): FakeCanvasOp[] {
  const backgroundAt = ctx.ops.findIndex((op) => op.kind === 'drawImage');
  const playerAt = ctx.ops.findIndex((op, index) => index > backgroundAt && op.kind === 'save');
  if (backgroundAt < 0 || playerAt < 0) throw new Error('expected background and player layers');
  return ctx.ops.slice(backgroundAt + 1, playerAt);
}

describe('RiftMapPainter', () => {
  it('builds each surface background once and redraws live state without rebuilding', () => {
    const created = installBrowser();
    const ctx = fakeContext();
    const painter = new RiftMapPainter(
      writers,
      () => 'class',
      (name, rank) => `${name} (${rank})`,
      markerArt,
    );
    painter.paintMinimap(
      ctx as unknown as CanvasRenderingContext2D,
      world(),
      {} as HTMLElement,
      162,
    );
    expect(created).toHaveLength(1);
    const firstBackground = created[0].canvas;
    painter.paintMinimap(
      ctx as unknown as CanvasRenderingContext2D,
      world(FLOOR, 4012),
      {} as HTMLElement,
      162,
    );
    expect(created).toHaveLength(1);
    expect(ctx.drawImage).toHaveBeenCalledWith(firstBackground, 0, 0);

    painter.paintWorldMap(ctx as unknown as CanvasRenderingContext2D, world(), 560);
    // One world background plus the title sprite; repeated redraw reuses both.
    expect(created).toHaveLength(3);
    painter.paintWorldMap(ctx as unknown as CanvasRenderingContext2D, world(FLOOR, 4015), 560);
    expect(created).toHaveLength(3);
  });

  it('strokes the walkable dais as elevation instead of filling it as an obstacle', () => {
    const created = installBrowser();
    const ctx = fakeContext();
    const painter = new RiftMapPainter(
      writers,
      () => 'class',
      (name) => name,
      markerArt,
    );

    painter.paintMinimap(
      ctx as unknown as CanvasRenderingContext2D,
      world(),
      {} as HTMLElement,
      162,
    );

    const background = created[0];
    // The floor itself and any real filled overlays still fill, while the
    // collider-free dais contributes one extra outline-only elevation cue.
    expect(background.stroke).toHaveBeenCalled();
    expect(background.fill).toHaveBeenCalled();
    expect(background.stroke.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      background.fill.mock.invocationCallOrder.at(-1) ?? -1,
    );
  });

  it('rebuilds only the affected static surface when floor content changes', () => {
    const created = installBrowser();
    const ctx = fakeContext();
    const painter = new RiftMapPainter(
      writers,
      () => 'class',
      (name) => name,
      markerArt,
    );
    painter.paintMinimap(
      ctx as unknown as CanvasRenderingContext2D,
      world(),
      {} as HTMLElement,
      162,
    );
    painter.paintMinimap(
      ctx as unknown as CanvasRenderingContext2D,
      world({ ...FLOOR, contentHash: 'content-b' }),
      {} as HTMLElement,
      162,
    );
    expect(created).toHaveLength(2);
  });

  it('clips the minimap to its circular rim and elides the zone-label DOM write', () => {
    installBrowser();
    const ctx = fakeContext();
    const labelEl = {} as HTMLElement;
    const painter = new RiftMapPainter(
      writers,
      () => 'class',
      (name, rank) => `${name} - ${rank}`,
      markerArt,
    );
    painter.paintMinimap(ctx as unknown as CanvasRenderingContext2D, world(), labelEl, 162);
    expect(ctx.arc).toHaveBeenCalledWith(81, 81, 79, 0, Math.PI * 2);
    expect(ctx.clip).toHaveBeenCalled();
    expect(writers.setText).toHaveBeenCalledWith(labelEl, 'The Ember Test: Depth 1 - A');
  });

  it.each(
    MECHANIC_FALLBACK_CASES.flatMap((mechanic) =>
      RIFT_SURFACE_PROFILES.map((surfaceProfile) => ({ ...mechanic, ...surfaceProfile })),
    ),
  )(
    'paints the exact $profile $surface hue-independent $label fallback without generated art',
    ({ templateId, fill, operations, surface, profile, outlineWidth }) => {
      installBrowser();
      const ctx = fakeContext();
      const sprite = vi.fn(() => null);
      const resolveProfile = vi.fn(() => profile);
      const painter = new RiftMapPainter(
        writers,
        () => 'class',
        (name) => name,
        { sprite, preload: vi.fn() },
        resolveProfile,
      );

      const active = worldWithObjects([templateId]);
      const model =
        surface === 'minimap'
          ? painter.paintMinimap(
              ctx as unknown as CanvasRenderingContext2D,
              active,
              {} as HTMLElement,
              162,
            )
          : painter.paintWorldMap(ctx as unknown as CanvasRenderingContext2D, active, 560);

      expect(model?.objects).toHaveLength(1);
      expect(resolveProfile).toHaveBeenCalledTimes(1);
      expect(sprite).not.toHaveBeenCalled();
      const objectOps = isolatedObjectOps(ctx);
      expect(objectOps.map(({ kind }) => kind).join(',')).toBe(operations);
      expect(objectOps.find(({ kind }) => kind === 'fill' || kind === 'fillRect')?.fillStyle).toBe(
        fill,
      );
      expect(
        objectOps
          .filter(({ kind }) => kind === 'stroke')
          .every(({ lineWidth }) => lineWidth === outlineWidth),
      ).toBe(true);
    },
  );

  it.each([
    {
      surface: 'minimap',
      profile: 'standard',
      expected: [
        { id: 'reward-treasure', size: 'minimapRewardAvailable' },
        { id: 'rift-descent', size: 'minimapNavigation' },
      ],
    },
    {
      surface: 'minimap',
      profile: 'compact',
      expected: [
        { id: 'reward-treasure', size: 'minimapRewardAvailableCompact' },
        { id: 'rift-descent', size: 'minimapNavigationCompact' },
      ],
    },
    {
      surface: 'map',
      profile: 'standard',
      expected: [
        { id: 'reward-treasure', size: 'mapRewardAvailable' },
        { id: 'rift-descent', size: 'mapNavigation' },
      ],
    },
    {
      surface: 'map',
      profile: 'compact',
      expected: [
        { id: 'reward-treasure', size: 'mapRewardAvailableCompact' },
        { id: 'rift-descent', size: 'mapNavigationCompact' },
      ],
    },
  ] as const)(
    'routes successful $profile $surface Rift art through its exact raster profile',
    ({ surface, profile, expected }) => {
      installBrowser();
      const ctx = fakeContext();
      const calls: Array<{ id: string; size: string }> = [];
      const resolveProfile = vi.fn(() => profile);
      const painter = new RiftMapPainter(
        writers,
        () => 'class',
        (name) => name,
        {
          sprite(id, size): CanvasImageSource {
            calls.push({ id, size });
            return { markerId: id, sizeId: size } as unknown as CanvasImageSource;
          },
          preload: vi.fn(),
        },
        resolveProfile,
      );
      const active = worldWithObjects(['rift_descent', 'rift_treasure']);

      if (surface === 'minimap') {
        painter.paintMinimap(
          ctx as unknown as CanvasRenderingContext2D,
          active,
          {} as HTMLElement,
          162,
        );
      } else {
        painter.paintWorldMap(ctx as unknown as CanvasRenderingContext2D, active, 560);
      }

      expect(resolveProfile).toHaveBeenCalledTimes(1);
      expect(calls).toEqual(expected);
      expect(
        ctx.ops
          .filter(
            ({ kind, args }) =>
              kind === 'drawImage' &&
              typeof args[0] === 'object' &&
              args[0] !== null &&
              'markerId' in args[0],
          )
          .map(({ args }) => args[0]),
      ).toEqual(
        expected.map(({ id, size }) => ({
          markerId: id,
          sizeId: size,
        })),
      );
    },
  );

  it.each(['minimap', 'map'] as const)(
    'paints $surface mechanics, rewards, navigation, party, corpse, and player in visual order',
    (surface) => {
      installBrowser();
      const ctx = fakeContext();
      const artCalls: Array<{ id: string; size: string }> = [];
      const art: MapMarkerArt = {
        sprite(id, size): CanvasImageSource | null {
          artCalls.push({ id, size });
          if (id !== 'reward-treasure' && id !== 'rift-descent') return null;
          return { markerId: id, sizeId: size } as unknown as CanvasImageSource;
        },
        preload: vi.fn(),
      };
      const painter = new RiftMapPainter(
        writers,
        (cls) => `class:${cls}`,
        (name) => name,
        art,
      );
      const active = worldWithObjects(['rift_descent', 'rift_treasure', 'rift_pylon'], true);

      if (surface === 'minimap') {
        painter.paintMinimap(
          ctx as unknown as CanvasRenderingContext2D,
          active,
          {} as HTMLElement,
          162,
        );
      } else {
        painter.paintWorldMap(ctx as unknown as CanvasRenderingContext2D, active, 560);
      }

      const markerBlitAt = (id: string): number =>
        ctx.ops.findIndex(
          ({ kind, args }) =>
            kind === 'drawImage' &&
            typeof args[0] === 'object' &&
            args[0] !== null &&
            (args[0] as { markerId?: string }).markerId === id,
        );
      const fillAt = (style: string): number =>
        ctx.ops.findIndex(
          ({ kind, fillStyle }) => (kind === 'fill' || kind === 'fillRect') && fillStyle === style,
        );
      const mechanicAt = fillAt('resolved:--color-minimap-gather-cooldown');
      const rewardAt = markerBlitAt('reward-treasure');
      const navigationAt = markerBlitAt('rift-descent');
      const partyAt = fillAt('class:mage');
      const corpseAt = fillAt('resolved:--color-minimap-corpse');
      const playerAt = fillAt('resolved:--color-minimap-player');

      expect(
        [mechanicAt, rewardAt, navigationAt, partyAt, corpseAt, playerAt].every((at) => at >= 0),
      ).toBe(true);
      expect(mechanicAt).toBeLessThan(rewardAt);
      expect(rewardAt).toBeLessThan(navigationAt);
      expect(navigationAt).toBeLessThan(partyAt);
      expect(partyAt).toBeLessThan(corpseAt);
      expect(corpseAt).toBeLessThan(playerAt);
      expect(artCalls).toEqual([
        {
          id: 'reward-treasure',
          size: surface === 'minimap' ? 'minimapRewardAvailable' : 'mapRewardAvailable',
        },
        {
          id: 'rift-descent',
          size: surface === 'minimap' ? 'minimapNavigation' : 'mapNavigation',
        },
      ]);
    },
  );

  it('enlarges every compact minimap live-marker family with restored outlines', () => {
    installBrowser();
    const ctx = fakeContext();
    const profile = vi.fn(() => 'compact' as const);
    const painter = new RiftMapPainter(
      writers,
      () => 'class',
      (name) => name,
      markerArt,
      profile,
    );

    painter.paintMinimap(
      ctx as unknown as CanvasRenderingContext2D,
      worldWithLiveGeometry(),
      {} as HTMLElement,
      162,
    );

    expect(profile).toHaveBeenCalledTimes(1);
    expect(ctx.arc.mock.calls.some((call) => call[2] === 3.5)).toBe(true);
    expect(ctx.arc.mock.calls.some((call) => call[2] === 8)).toBe(true);
    expect(ctx.arc.mock.calls.filter((call) => call[2] === 5.5)).toHaveLength(2);
    expect(ctx.moveTo).toHaveBeenCalledWith(0, -9);
    expect(ctx.lineTo).toHaveBeenCalledWith(5.4, 7.2);
    expect(ctx.lineTo).toHaveBeenCalledWith(-5.4, 7.2);
    expect(ctx.lineWidthWrites.slice(0, 3)).toEqual([2, 3, 2]);
    expect(ctx.lineWidthWrites.at(-1)).toBe(2);
  });

  it('enlarges every compact M-map live-marker family without changing its rectangular fit', () => {
    const created = installBrowser();
    const ctx = fakeContext();
    const profile = vi.fn(() => 'compact' as const);
    const painter = new RiftMapPainter(
      writers,
      () => 'class',
      (name) => name,
      markerArt,
      profile,
    );

    painter.paintWorldMap(ctx as unknown as CanvasRenderingContext2D, worldWithLiveGeometry(), 560);

    expect(profile).toHaveBeenCalledTimes(1);
    expect(ctx.arc.mock.calls.some((call) => call[2] === 5)).toBe(true);
    expect(ctx.arc.mock.calls.some((call) => call[2] === 11)).toBe(true);
    expect(ctx.arc.mock.calls.filter((call) => call[2] === 7)).toHaveLength(2);
    expect(ctx.moveTo).toHaveBeenCalledWith(0, -12);
    expect(ctx.lineTo).toHaveBeenCalledWith(7.2, 9.6);
    expect(ctx.lineTo).toHaveBeenCalledWith(-7.2, 9.6);
    expect(ctx.lineWidthWrites.slice(0, 3)).toEqual([2.25, 3, 2.25]);
    expect(ctx.lineWidthWrites.at(-1)).toBe(2.25);
    expect(created.flatMap((createdCtx) => createdCtx.fontWrites)).toContain('bold 21px Georgia');
    expect(created.flatMap((createdCtx) => createdCtx.lineWidthWrites)).toContain(4.5);
  });

  it('renders M-map titles through cached sprites, leaving the hot context text API untouched', () => {
    installBrowser();
    const ctx = fakeContext();
    const painter = new RiftMapPainter(
      writers,
      () => 'class',
      (name) => name,
      markerArt,
    );
    painter.paintWorldMap(ctx as unknown as CanvasRenderingContext2D, world(), 560);
    painter.paintWorldMap(ctx as unknown as CanvasRenderingContext2D, world(), 560);
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(ctx.strokeText).not.toHaveBeenCalled();
    expect(ctx.measureText).not.toHaveBeenCalled();
  });

  it('drops title sprites once on relocalize and re-latches the same rendered title', () => {
    const created = installBrowser();
    const ctx = fakeContext();
    const painter = new RiftMapPainter(
      writers,
      () => 'class',
      () => 'The Ember Test',
      markerArt,
    );

    painter.paintWorldMap(ctx as unknown as CanvasRenderingContext2D, world(), 560);
    const canvasCountAfterFirstTitle = created.length;
    painter.paintWorldMap(ctx as unknown as CanvasRenderingContext2D, world(), 560);
    expect(created).toHaveLength(canvasCountAfterFirstTitle);

    painter.relocalize();
    painter.paintWorldMap(ctx as unknown as CanvasRenderingContext2D, world(), 560);
    expect(created).toHaveLength(canvasCountAfterFirstTitle + 1);
    painter.paintWorldMap(ctx as unknown as CanvasRenderingContext2D, world(), 560);
    expect(created).toHaveLength(canvasCountAfterFirstTitle + 1);
  });

  it('returns the already-painted reusable M-map model for zero-scan accessibility output', () => {
    installBrowser();
    const ctx = fakeContext();
    const painter = new RiftMapPainter(
      writers,
      () => 'class',
      (name, rank) => `${name} (${rank})`,
      markerArt,
    );

    const first = painter.paintWorldMap(ctx as unknown as CanvasRenderingContext2D, world(), 560);
    const second = painter.paintWorldMap(
      ctx as unknown as CanvasRenderingContext2D,
      world(FLOOR, 4015),
      560,
    );

    expect(first?.areaLabel).toBe('The Ember Test: Depth 1 (A)');
    expect(second).toBe(first);
    expect(
      painter.paintWorldMap(ctx as unknown as CanvasRenderingContext2D, world(null), 560),
    ).toBeNull();
  });
});

describe('rift painter performance source contract', () => {
  const source = readFileSync(
    new URL('../src/ui/hud/rift/rift_map_painter.ts', import.meta.url),
    'utf8',
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('uses no hot canvas filters, shadows, timers, or raw canvas text', () => {
    expect(code).not.toMatch(/\.filter\s*=/);
    expect(code).not.toContain('shadowBlur');
    expect(code).not.toContain('setTimeout');
    expect(code).not.toContain('requestAnimationFrame');
    expect(code).not.toContain('fillText(');
    expect(code).not.toContain('strokeText(');
  });

  it('uses a single design-token resolve boundary and no literal color values', () => {
    expect(code.match(/getComputedStyle/g)).toHaveLength(1);
    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });

  it('uses circular-safe minimap projection and frozen redraw-level geometry profiles', () => {
    expect(code).toContain("createRiftMapView('circle')");
    expect(code).toContain('RIFT_DYNAMIC_GEOMETRY[surface][profile]');
    expect(code).not.toContain('this.markerProfile() ===');
    expect(code.match(/Object\.freeze/g)?.length).toBeGreaterThanOrEqual(7);
  });
});
