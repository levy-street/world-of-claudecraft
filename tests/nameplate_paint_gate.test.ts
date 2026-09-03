// @vitest-environment happy-dom
//
// The nameplate surface's repaint gate: the pure decision core, the tier knob
// that bounds the surface's pixel ratio, and the production painter path that
// consumes both. The fairness pins matter as much as the savings ones: a plate
// that moves or changes must still paint on its own frame, and the layer must
// come back the instant a plate does.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NAMEPLATE_PIXEL_RATIO_MAX,
  NAMEPLATE_PIXEL_RATIO_MIN,
  NAMEPLATE_PIXEL_RATIO_STEP,
  nameplatePixelRatio,
} from '../src/game/ui_tier_knobs';
import {
  createNameplateCadenceState,
  nameplateFullPassDue,
} from '../src/render/nameplate_cadence_core';
import {
  NAMEPLATE_MAX_PIXEL_RATIO,
  NAMEPLATE_MIN_PIXEL_RATIO,
} from '../src/render/nameplate_canvas';
import {
  NAMEPLATE_ANCHOR_EPSILON_PX,
  type NameplatePaintFields,
  NameplatePaintGate,
} from '../src/render/nameplate_paint_gate_core';
import { NameplatePainter } from '../src/render/nameplate_painter';
import type { EntityView } from '../src/render/renderer';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const VIEWPORT = { width: 1280, height: 720 };

// happy-dom rewrites a LITERAL new URL('...', import.meta.url) into an http URL;
// keeping the relative path in a variable leaves readFileSync a file URL.
const readSource = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

function fields(overrides: Partial<NameplatePaintFields> = {}): NameplatePaintFields {
  return {
    name: 'Add',
    nameColor: '#fff',
    level: '10',
    levelColor: '#fff',
    guild: '',
    guildLabel: '',
    guildTier: 0,
    title: '',
    border: '',
    marker: '',
    markerTone: 'none',
    hpVisible: true,
    hpFill: 1,
    castVisible: false,
    castFill: 0,
    castChannel: false,
    castLabel: '',
    currentTarget: false,
    hostile: true,
    deadEnemy: false,
    myPet: false,
    friendlyPet: false,
    threat: false,
    opacity: 1,
    frame: '',
    comboPips: 0,
    aiLabel: '',
    cheaterLabel: '',
    devOutline: null,
    badges: [],
    raidMarkerUrl: '',
    emoteIconUrl: '',
    emoteLabel: '',
    ...overrides,
  };
}

function paintedPass(
  gate: NameplatePaintGate,
  plates: Array<{ id: number; sx: number; sy: number; f: NameplatePaintFields }>,
  surface = { width: 1280, height: 720, ratio: 1, style: 0 },
): boolean {
  gate.beginPass(surface.width, surface.height, surface.ratio, surface.style);
  for (const plate of plates) gate.notePlate(plate.id, plate.sx, plate.sy, plate.f);
  const paint = gate.needsPaint();
  if (paint) gate.commit();
  return paint;
}

describe('nameplate paint gate core', () => {
  it('paints the first pass, then skips an identical still scene', () => {
    const gate = new NameplatePaintGate();
    const plate = { id: 7, sx: 100, sy: 200, f: fields() };
    expect(paintedPass(gate, [plate])).toBe(true);
    for (let i = 0; i < 10; i++) expect(paintedPass(gate, [plate])).toBe(false);
  });

  it('paints every pass while a plate keeps moving', () => {
    const gate = new NameplatePaintGate();
    const f = fields();
    expect(paintedPass(gate, [{ id: 7, sx: 100, sy: 200, f }])).toBe(true);
    for (let i = 1; i <= 10; i++) {
      expect(paintedPass(gate, [{ id: 7, sx: 100 + i * 2, sy: 200, f }])).toBe(true);
    }
  });

  it('holds sub-pixel drift against the PAINTED anchor, so it cannot accumulate unseen', () => {
    const gate = new NameplatePaintGate();
    const f = fields();
    expect(paintedPass(gate, [{ id: 7, sx: 100, sy: 200, f }])).toBe(true);
    // Under the epsilon: the same pixels, so no repaint.
    expect(paintedPass(gate, [{ id: 7, sx: 100.2, sy: 200, f }])).toBe(false);
    // Still measured against 100 (the painted anchor), not against 100.2: one
    // more step of the same size crosses the threshold and repaints.
    expect(paintedPass(gate, [{ id: 7, sx: 100 + NAMEPLATE_ANCHOR_EPSILON_PX, sy: 200, f }])).toBe(
      true,
    );
  });

  it.each([
    ['hp', fields({ hpFill: 0.4 })],
    ['cast start', fields({ castVisible: true, castFill: 0.2, castLabel: 'Fireball' })],
    ['selection', fields({ currentTarget: true })],
    ['threat', fields({ threat: true })],
    ['opacity', fields({ opacity: 0.55 })],
    ['name', fields({ name: 'Other' })],
    ['level', fields({ level: '11' })],
    ['quest marker', fields({ marker: '!', markerTone: 'quest' })],
    ['guild line', fields({ guild: 'Vale', guildLabel: '<Vale>' })],
    ['deed title', fields({ title: 'the Bold' })],
    ['deed border', fields({ border: 'ember' })],
    ['elite frame', fields({ frame: 'elite' })],
    ['combo pips', fields({ comboPips: 3 })],
    ['raid marker', fields({ raidMarkerUrl: 'data:image/png;base64,skull' })],
    ['overhead emote', fields({ emoteIconUrl: '/ui/emotes/emote-wave.png', emoteLabel: 'Wave' })],
    ['badge set', fields({ badges: [{ url: '/badge.webp', size: 15 }] })],
  ])('repaints on a %s change at a fixed anchor', (_label, changed) => {
    const gate = new NameplatePaintGate();
    expect(paintedPass(gate, [{ id: 7, sx: 100, sy: 200, f: fields() }])).toBe(true);
    expect(paintedPass(gate, [{ id: 7, sx: 100, sy: 200, f: changed }])).toBe(true);
  });

  it('repaints on a badge FIELD change even though the badge object is reused', () => {
    const gate = new NameplatePaintGate();
    const badge = { url: '/badge.webp', size: 15, circular: false, glow: undefined as undefined };
    const f = fields({ badges: [badge] });
    expect(paintedPass(gate, [{ id: 7, sx: 100, sy: 200, f }])).toBe(true);
    expect(paintedPass(gate, [{ id: 7, sx: 100, sy: 200, f }])).toBe(false);
    badge.size = 24;
    expect(paintedPass(gate, [{ id: 7, sx: 100, sy: 200, f }])).toBe(true);
  });

  it('repaints when a plate appears or disappears', () => {
    const gate = new NameplatePaintGate();
    const a = { id: 7, sx: 100, sy: 200, f: fields() };
    const b = { id: 8, sx: 300, sy: 200, f: fields() };
    expect(paintedPass(gate, [a])).toBe(true);
    expect(paintedPass(gate, [a, b])).toBe(true);
    expect(paintedPass(gate, [a, b])).toBe(false);
    expect(paintedPass(gate, [a])).toBe(true);
    expect(paintedPass(gate, [])).toBe(true);
    expect(paintedPass(gate, [])).toBe(false);
  });

  it('repaints on a viewport, surface-ratio or style-revision change', () => {
    const gate = new NameplatePaintGate();
    const plate = { id: 7, sx: 100, sy: 200, f: fields() };
    const base = { width: 1280, height: 720, ratio: 1, style: 0 };
    expect(paintedPass(gate, [plate], base)).toBe(true);
    expect(paintedPass(gate, [plate], { ...base, width: 1600 })).toBe(true);
    expect(paintedPass(gate, [plate], { ...base, width: 1600, height: 900 })).toBe(true);
    expect(paintedPass(gate, [plate], { ...base, width: 1600, height: 900, ratio: 1.5 })).toBe(
      true,
    );
    const changed = { width: 1600, height: 900, ratio: 1.5, style: 1 };
    expect(paintedPass(gate, [plate], changed)).toBe(true);
    expect(paintedPass(gate, [plate], changed)).toBe(false);
  });

  it('a skipped pass never adopts its state, so the next differing pass still paints', () => {
    const gate = new NameplatePaintGate();
    const plate = { id: 7, sx: 100, sy: 200, f: fields() };
    expect(paintedPass(gate, [plate])).toBe(true);
    // A pass that is NOT painted must not commit: drive needsPaint() without
    // committing and confirm the recorded frame is still the painted one.
    gate.beginPass(1280, 720, 1, 0);
    gate.notePlate(7, 140, 200, fields());
    expect(gate.needsPaint()).toBe(true);
    expect(paintedPass(gate, [plate])).toBe(false);
  });

  it('invalidate() forces the next pass to repaint', () => {
    const gate = new NameplatePaintGate();
    const plate = { id: 7, sx: 100, sy: 200, f: fields() };
    expect(paintedPass(gate, [plate])).toBe(true);
    expect(paintedPass(gate, [plate])).toBe(false);
    gate.invalidate();
    expect(paintedPass(gate, [plate])).toBe(true);
  });
});

describe('the gate sees every field the surface draws', () => {
  it('NameplatePaintFields covers every state.<field> the canvas reads', () => {
    const canvas = readSource('../src/render/nameplate_canvas.ts');
    const gate = readSource('../src/render/nameplate_paint_gate_core.ts');
    const interfaceBody = gate.slice(
      gate.indexOf('export interface NameplatePaintFields {'),
      gate.indexOf('interface PlateRecord {'),
    );
    const compared = new Set(
      [...interfaceBody.matchAll(/^\s+readonly (\w+)[?:]/gm)].map((m) => m[1]),
    );
    const drawn = new Set([...canvas.matchAll(/\bstate\.(\w+)/g)].map((m) => m[1]));
    // Never drawn: `initialized` is the resolve latch, `castSource` is the raw
    // ability id the localized castLabel is derived from.
    drawn.delete('initialized');
    drawn.delete('castSource');
    expect(drawn.size).toBeGreaterThan(20);
    const missing = [...drawn].filter((field) => !compared.has(field)).sort();
    expect(
      missing,
      'a drawn plate field the repaint gate does not compare would be painted once and then frozen',
    ).toEqual([]);
  });
});

describe('nameplate surface pixel-ratio knob', () => {
  it('agrees with the surface clamp it feeds', () => {
    // The surface imports nothing from the knob module: the deed-accent
    // fairness guard (tests/deed_border_accent.test.ts) forbids any
    // quality-knob read on the plate-drawing path, so the two bounds are
    // declared separately and pinned equal here instead.
    expect(NAMEPLATE_PIXEL_RATIO_MAX).toBe(NAMEPLATE_MAX_PIXEL_RATIO);
    expect(NAMEPLATE_PIXEL_RATIO_MIN).toBe(NAMEPLATE_MIN_PIXEL_RATIO);
  });

  it('follows the renderer below the device ratio and never exceeds the historical cap', () => {
    // A native 1x panel is unchanged.
    expect(nameplatePixelRatio(1, 1)).toBe(1);
    // A HiDPI panel used to size at 2 whatever the world did; it now follows the
    // tier's own cap (gfx_aa_policy_core: 1.75 high/ultra, 1.48 low/medium).
    expect(nameplatePixelRatio(2, 1.75)).toBe(1.75);
    expect(nameplatePixelRatio(2, 1.48)).toBe(1.375);
    // The historical ceiling still binds when the renderer asks for more.
    expect(nameplatePixelRatio(3, 3)).toBe(NAMEPLATE_PIXEL_RATIO_MAX);
  });

  it('tracks the live render scale, quantized so the sprite cache is not thrashed', () => {
    // 1.75 cap times a backed-off render scale.
    expect(nameplatePixelRatio(2, 1.75 * 0.8)).toBe(1.375);
    expect(nameplatePixelRatio(2, 1.75 * 0.9)).toBe(1.5);
    // Neighbouring scales inside one step resolve to the SAME ratio, so a
    // wobbling governor does not re-rasterize every label.
    expect(nameplatePixelRatio(2, 1.51)).toBe(nameplatePixelRatio(2, 1.62));
    expect(nameplatePixelRatio(2, 1.5) % NAMEPLATE_PIXEL_RATIO_STEP).toBeCloseTo(0, 10);
  });

  it('never drops a text layer below CSS resolution, whatever the renderer does', () => {
    expect(nameplatePixelRatio(1, 0.5)).toBe(NAMEPLATE_PIXEL_RATIO_MIN);
    expect(nameplatePixelRatio(2, 0.35)).toBe(NAMEPLATE_PIXEL_RATIO_MIN);
    expect(nameplatePixelRatio(Number.NaN, Number.NaN)).toBe(NAMEPLATE_PIXEL_RATIO_MIN);
    expect(nameplatePixelRatio(0, 0)).toBe(NAMEPLATE_PIXEL_RATIO_MIN);
  });
});

describe('nameplate cadence core', () => {
  it('fires once the interval has elapsed and restarts the accumulator', () => {
    const state = createNameplateCadenceState();
    expect(nameplateFullPassDue(state, 1 / 60, 1 / 24)).toBe(false);
    expect(nameplateFullPassDue(state, 1 / 60, 1 / 24)).toBe(false);
    expect(nameplateFullPassDue(state, 1 / 60, 1 / 24)).toBe(true);
    expect(nameplateFullPassDue(state, 1 / 60, 1 / 24)).toBe(false);
  });

  it('is due every frame at a non-positive interval', () => {
    const state = createNameplateCadenceState();
    expect(nameplateFullPassDue(state, 1 / 60, 0)).toBe(true);
    expect(nameplateFullPassDue(state, 1 / 60, 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The production painter path.
// ---------------------------------------------------------------------------

function fakeContext(): CanvasRenderingContext2D {
  const noop = vi.fn();
  return {
    setTransform: noop,
    scale: noop,
    translate: noop,
    clearRect: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    rect: noop,
    clip: noop,
    fill: noop,
    stroke: noop,
    drawImage: noop,
    fillText: noop,
    strokeText: noop,
    measureText: (text: string) => ({
      width: text.length * 7,
      actualBoundingBoxLeft: (text.length * 7) / 2,
      actualBoundingBoxRight: (text.length * 7) / 2,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 3,
    }),
  } as unknown as CanvasRenderingContext2D;
}

// Every <img> the nameplate image cache mints. It never appends them to the
// document, so this is the only handle a test has on a pending decode.
let createdImages: HTMLImageElement[] = [];

beforeEach(() => {
  vi.restoreAllMocks();
  createdImages = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext());
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,raid');
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const element = create(tag);
    if (tag === 'img') createdImages.push(element as HTMLImageElement);
    return element;
  }) as typeof document.createElement);
});

function entity(id: number, kind: Entity['kind'] = 'mob'): Entity {
  return {
    id,
    kind,
    name: kind === 'player' ? 'Raider' : `Add ${id}`,
    templateId: kind === 'player' ? 'warrior' : 'cinder_artificer',
    pos: { x: 0, y: 0, z: 0 },
    scale: 1,
    level: 10,
    hp: 100,
    maxHp: 100,
    dead: false,
    lootable: false,
    hostile: kind === 'mob',
    ownerId: null,
    guild: '',
    auras: [],
    questIds: [],
    targetId: null,
    aggroTargetId: null,
    comboPoints: 0,
    comboTargetId: null,
    castingAbility: null,
    castTotal: 0,
    castRemaining: 0,
    channeling: false,
  } as unknown as Entity;
}

function harness(options: { devicePixelRatio?: number; renderPixelRatio?: number } = {}) {
  // The renderer resolves the surface ratio through the pure knob and hands the
  // painter the result; the painter reads no knob of its own (the deed-accent
  // fairness path). This mirrors that wiring exactly.
  const surfacePixelRatio = (): number =>
    nameplatePixelRatio(
      options.devicePixelRatio ?? 1,
      options.renderPixelRatio ?? Number.POSITIVE_INFINITY,
    );
  const player = entity(1, 'player');
  player.pos = { x: 0, y: 0, z: 3 } as Entity['pos'];
  const target = entity(7);
  const group = new THREE.Group();
  group.position.set(0, 0, 0);
  const views = new Map<number, EntityView>([
    [7, { group, height: 2, mountLift: 0 } as EntityView],
  ]);
  const entities = new Map<number, Entity>([
    [player.id, player],
    [7, target],
  ]);
  const camera = new THREE.PerspectiveCamera(60, VIEWPORT.width / VIEWPORT.height, 0.1, 500);
  camera.position.set(0, 3, 12);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld(true);
  let showNameplates = true;
  const world = {
    player,
    entities,
    markerFor: () => null,
    questState: () => 'available',
  } as unknown as IWorld;
  const viewport = { ...VIEWPORT };
  const painter = new NameplatePainter({
    views,
    camera,
    world,
    layer: document.createElement('div'),
    getViewport: () => viewport,
    getDevicePixelRatio: () => options.devicePixelRatio ?? 1,
    getSurfacePixelRatio: surfacePixelRatio,
    showNameplates: () => showNameplates,
    showDevBadges: () => true,
    showOwnNameplate: () => false,
    showPlayerNameplates: () => true,
    isHostilePlayer: () => false,
  });
  const canvas = (painter as unknown as { surface: { canvas: HTMLCanvasElement } }).surface.canvas;
  return {
    painter,
    canvas,
    group,
    target,
    viewport,
    setShowNameplates: (value: boolean) => {
      showNameplates = value;
    },
  };
}

describe('nameplate painter surface repaints', () => {
  it('paints a still scene once, then skips every identical pass', () => {
    const { painter } = harness();
    painter.update(true);
    expect(painter.paintStats()).toEqual({ paints: 1, paintsSkipped: 0 });
    for (let i = 0; i < 8; i++) painter.update(false);
    painter.update(true); // a full content re-resolve still resolves the same plate
    expect(painter.paintStats()).toEqual({ paints: 1, paintsSkipped: 9 });
  });

  it('paints every frame while the plate is moving', () => {
    const { painter, group } = harness();
    painter.update(true);
    for (let i = 1; i <= 5; i++) {
      group.position.x = i * 0.25;
      painter.update(false);
    }
    expect(painter.paintStats()).toEqual({ paints: 6, paintsSkipped: 0 });
  });

  it('repaints when the health bar moves without the plate moving', () => {
    const { painter, target } = harness();
    painter.update(true);
    painter.update(false);
    expect(painter.paintStats().paints).toBe(1);
    target.hp = 42;
    painter.update(false);
    expect(painter.paintStats().paints).toBe(2);
  });

  it('repaints on a viewport change', () => {
    const { painter, viewport } = harness();
    painter.update(true);
    painter.update(false);
    expect(painter.paintStats().paints).toBe(1);
    viewport.width = 1600;
    viewport.height = 900;
    painter.update(false);
    expect(painter.paintStats().paints).toBe(2);
  });

  it('hides the layer when no plate is drawn and unhides on the first plate back', () => {
    const { painter, canvas, setShowNameplates } = harness();
    painter.update(true);
    expect(canvas.hidden).toBe(false);

    setShowNameplates(false);
    painter.update(true);
    expect(canvas.hidden).toBe(true);
    const afterHide = painter.paintStats();
    // An empty scene settles: the hide is one pass, the rest are skipped.
    painter.update(false);
    painter.update(false);
    expect(painter.paintStats().paints).toBe(afterHide.paints);

    setShowNameplates(true);
    painter.update(true);
    expect(canvas.hidden).toBe(false);
    expect(painter.paintStats().paints).toBe(afterHide.paints + 1);
  });

  it('repaints when a badge image finishes decoding, though no plate state moved', () => {
    const { painter, target } = harness();
    // A player plate carries badges; give this one a Discord avatar url, which
    // resolves through the async image cache.
    Object.assign(target, { kind: 'player', name: 'Raider', discordAvatar: '/avatar.webp' });
    painter.update(true);
    const settled = painter.paintStats().paints;
    painter.update(false);
    expect(painter.paintStats().paints).toBe(settled);

    // The bytes land: the plate's url did not change, but the surface would now
    // draw a picture where it drew nothing. The <img> is never in the document
    // (the cache holds it), so it is captured at creation.
    const image = createdImages.find((el) => el.src.endsWith('/avatar.webp'));
    expect(image, 'the badge url should have started a decode').toBeDefined();
    image?.dispatchEvent(new Event('load'));
    painter.update(false);
    expect(painter.paintStats().paints).toBe(settled + 1);
    painter.update(false);
    expect(painter.paintStats().paints).toBe(settled + 1);
  });

  it('sizes the backing store by the renderer ratio, not the device ratio', () => {
    const native = harness({ devicePixelRatio: 2, renderPixelRatio: Number.POSITIVE_INFINITY });
    native.painter.update(true);
    expect(native.canvas.width).toBe(VIEWPORT.width * NAMEPLATE_PIXEL_RATIO_MAX);

    const bounded = harness({ devicePixelRatio: 2, renderPixelRatio: 1.75 });
    bounded.painter.update(true);
    expect(bounded.canvas.width).toBe(Math.ceil(VIEWPORT.width * 1.75));

    const downscaled = harness({ devicePixelRatio: 2, renderPixelRatio: 1.75 * 0.7 });
    downscaled.painter.update(true);
    expect(downscaled.canvas.width).toBe(Math.ceil(VIEWPORT.width * 1.125));
    expect(downscaled.canvas.width).toBeLessThan(bounded.canvas.width);
  });
});
