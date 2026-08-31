// The battleground field streams into an ALREADY-ATTACHED live group
// (src/render/battleground.ts): the renderer adds the group synchronously and
// the terrain, wards, placements, grass, decals and lantern flames land in it
// as their async loads resolve. Every piece added visible links its shader
// programs synchronously on its first visible frame, which is the
// first-match battleground hitch (fleet telemetry: main-thread stalls on the
// scenes with the SMALLEST GPU load). These cases pin that the stream now
// rides the gated-attach seam (src/render/gated_scene_attach.ts): gate
// COMPILATION, not availability. A piece still attaches the moment its load
// lands, hidden, and reveals once its programs are linked, so a player
// reconnecting into an active match keeps watching the field fill in.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stripComments } from './helpers/strip_comments';

vi.mock('../src/render/dungeon', () => ({
  ensureDungeonAssets: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/render/battleground_terrain', () => ({
  buildBattlegroundTerrain: vi.fn(),
}));
vi.mock('../src/render/battleground_placements', () => ({
  buildBattlegroundPlacements: vi.fn(),
}));
vi.mock('../src/render/battleground_lantern_fx', () => ({
  buildLanternFlames: vi.fn(() => null),
}));
vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(() => Promise.resolve({})),
  loadTexture: vi.fn(() => Promise.reject(new Error('no texture decode in Node'))),
}));

import { loadTexture } from '../src/render/assets/loader';
import { buildBattleground } from '../src/render/battleground';
import { bgFieldDecals } from '../src/render/battleground_core';
import { buildLanternFlames } from '../src/render/battleground_lantern_fx';
import { buildBattlegroundPlacements } from '../src/render/battleground_placements';
import { buildBattlegroundTerrain } from '../src/render/battleground_terrain';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fakeView(name: string): { group: THREE.Group; dispose: ReturnType<typeof vi.fn> } {
  const group = new THREE.Group();
  group.name = name;
  return { group, dispose: vi.fn() };
}

/** Records every compile-gate target and holds each gate open until the test
 *  releases it, the way a slow driver link would. */
function gateRecorder(): {
  gates: { target: THREE.Object3D; release: () => void }[];
  gateFor: (target: THREE.Object3D) => { release: () => void } | undefined;
  compileGate: (target: THREE.Object3D) => Promise<unknown>;
} {
  const gates: { target: THREE.Object3D; release: () => void }[] = [];
  return {
    gates,
    gateFor: (target) => gates.find((gate) => gate.target === target),
    compileGate: (target) =>
      new Promise<void>((res) => {
        gates.push({ target, release: res });
      }),
  };
}

const wardGroupOf = (group: THREE.Group): THREE.Object3D | undefined =>
  group.children.find((child) => child.name === 'battleground-wards');

async function flushStream(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the battleground field stream gates every piece on the compile gate', () => {
  it('attaches the terrain hidden and reveals it only when its own gate settles', async () => {
    const terrain = fakeView('terrain');
    vi.mocked(buildBattlegroundTerrain).mockResolvedValue(terrain as never);
    // the art stream stays pending, so only the ground and the wards land
    vi.mocked(buildBattlegroundPlacements).mockReturnValue(deferred<never>().promise);
    const { compileGate, gateFor } = gateRecorder();

    const view = buildBattleground({ x: 0, z: 0 }, 1, { lowGfx: true, compileGate });
    await vi.waitFor(() => expect(terrain.group.parent).toBe(view.group));

    // attached the moment the load landed (availability), hidden (compilation)
    expect(terrain.group.visible).toBe(false);
    const terrainGate = gateFor(terrain.group);
    expect(terrainGate, 'the terrain never reached the compile gate').toBeTruthy();

    terrainGate?.release();
    await flushStream();
    expect(terrain.group.visible).toBe(true);
  });

  it('reveals the art only after its own gate, still hidden while the link is in flight', async () => {
    const terrain = fakeView('terrain');
    const placements = fakeView('placements');
    vi.mocked(buildBattlegroundTerrain).mockResolvedValue(terrain as never);
    const placementsLoad = deferred<typeof placements>();
    vi.mocked(buildBattlegroundPlacements).mockReturnValue(placementsLoad.promise as never);
    const { compileGate, gateFor } = gateRecorder();

    const view = buildBattleground({ x: 0, z: 0 }, 1, { lowGfx: true, compileGate });
    await vi.waitFor(() => expect(terrain.group.parent).toBe(view.group));
    placementsLoad.resolve(placements);
    await vi.waitFor(() => expect(placements.group.parent).toBe(view.group));

    expect(placements.group.visible).toBe(false);
    gateFor(placements.group)?.release();
    await flushStream();
    expect(placements.group.visible).toBe(true);
  });

  it('attaches the wards visible immediately, taking the gate only as a link prewarm', async () => {
    const terrain = fakeView('terrain');
    vi.mocked(buildBattlegroundTerrain).mockResolvedValue(terrain as never);
    // the art stream never lands at all in this case
    vi.mocked(buildBattlegroundPlacements).mockReturnValue(deferred<never>().promise);
    const { compileGate, gateFor } = gateRecorder();

    const view = buildBattleground({ x: 0, z: 0 }, 1, { lowGfx: true, compileGate });
    // a ward state arriving before the stream lands is remembered, not dropped
    view.setWardState({ countdown: true, ghost: false, myTeam: null });
    await vi.waitFor(() => expect(wardGroupOf(view.group)).toBeTruthy());

    // AVAILABILITY is never gated: the sim already enforces the rule the ward
    // draws, so a hidden ward would be an invisible refusal. It is visible
    // while the terrain link, the whole art stream, and even its own prewarm
    // (the recorder never releases a gate on its own) are still in flight.
    const wards = wardGroupOf(view.group) as THREE.Object3D;
    expect(wards.visible).toBe(true);
    expect(terrain.group.visible).toBe(false);
    // the remembered ward state was applied: the form-up gate sheets are on
    expect(wards.children.some((mesh) => mesh.visible)).toBe(true);
    // and the ward program still rides the gate as an off-thread prewarm, so
    // the first countdown reveal finds it linked instead of sync-linking
    expect(gateFor(wards), 'the ward program is never prewarmed').toBeTruthy();
  });

  it('gates the grass, decal and flame dressing per piece, decals sharing a material per texture', async () => {
    const terrain = fakeView('terrain');
    const placements = fakeView('placements');
    vi.mocked(buildBattlegroundTerrain).mockResolvedValue(terrain as never);
    vi.mocked(buildBattlegroundPlacements).mockResolvedValue(placements as never);
    vi.mocked(loadTexture).mockImplementation(() => Promise.resolve({} as never));
    const flames = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
    vi.mocked(buildLanternFlames).mockReturnValueOnce(flames as never);
    const { compileGate, gateFor } = gateRecorder();

    const view = buildBattleground({ x: 0, z: 0 }, 1, { lowGfx: true, compileGate });
    const pieceByName = (name: string) => view.group.children.find((c) => c.name === name);
    await vi.waitFor(() => expect(pieceByName('battleground-decals')).toBeTruthy());
    await vi.waitFor(() => expect(flames.parent).toBe(view.group));

    const dressing = [
      pieceByName('battleground-grass') as THREE.Object3D,
      pieceByName('battleground-decals') as THREE.Object3D,
      flames,
    ];
    for (const piece of dressing) {
      expect(piece.visible).toBe(false);
      const gate = gateFor(piece);
      expect(gate, `${piece.name || piece.type} never reached the compile gate`).toBeTruthy();
      gate?.release();
    }
    await flushStream();
    for (const piece of dressing) expect(piece.visible).toBe(true);

    // one shared material per decal texture: the compile gate cuts its queue
    // units per material, so a per-quad material would submit a dozen units
    // for one program's worth of work
    const decals = (pieceByName('battleground-decals') as THREE.Group).children as THREE.Mesh[];
    expect(decals.length).toBe(bgFieldDecals().length);
    expect(new Set(decals.map((mesh) => mesh.material)).size).toBe(
      new Set(bgFieldDecals().map((d) => d.tex)).size,
    );
  });

  it('streams ungated when no compile gate is supplied (no async compile support)', async () => {
    const terrain = fakeView('terrain');
    const placements = fakeView('placements');
    vi.mocked(buildBattlegroundTerrain).mockResolvedValue(terrain as never);
    vi.mocked(buildBattlegroundPlacements).mockResolvedValue(placements as never);

    const view = buildBattleground({ x: 0, z: 0 }, 1, { lowGfx: true });
    await vi.waitFor(() => expect(placements.group.parent).toBe(view.group));

    expect(terrain.group.visible).toBe(true);
    expect(placements.group.visible).toBe(true);
    expect(wardGroupOf(view.group)?.visible).toBe(true);
  });

  it('cancels a pending reveal on dispose and still releases every streamed view', async () => {
    const terrain = fakeView('terrain');
    const placements = fakeView('placements');
    vi.mocked(buildBattlegroundTerrain).mockResolvedValue(terrain as never);
    const placementsLoad = deferred<typeof placements>();
    vi.mocked(buildBattlegroundPlacements).mockReturnValue(placementsLoad.promise as never);
    const { compileGate, gateFor } = gateRecorder();

    const view = buildBattleground({ x: 0, z: 0 }, 1, { lowGfx: true, compileGate });
    await vi.waitFor(() => expect(terrain.group.parent).toBe(view.group));

    view.dispose();
    expect(terrain.dispose).toHaveBeenCalledOnce();

    // a gate settling after dispose must not reveal the retired piece
    gateFor(terrain.group)?.release();
    await flushStream();
    expect(terrain.group.visible).toBe(false);

    // the art load landing after dispose is released, never attached
    placementsLoad.resolve(placements);
    await vi.waitFor(() => expect(placements.dispose).toHaveBeenCalledOnce());
    expect(placements.group.parent).toBeNull();
  });

  it('releases a decal load that lands after dispose without attaching or streaming on', async () => {
    const terrain = fakeView('terrain');
    const placements = fakeView('placements');
    vi.mocked(buildBattlegroundTerrain).mockResolvedValue(terrain as never);
    vi.mocked(buildBattlegroundPlacements).mockResolvedValue(placements as never);
    const textureLoad = deferred<unknown>();
    vi.mocked(loadTexture).mockReturnValue(textureLoad.promise as never);
    const { compileGate } = gateRecorder();

    const view = buildBattleground({ x: 0, z: 0 }, 1, { lowGfx: true, compileGate });
    await vi.waitFor(() => expect(placements.group.parent).toBe(view.group));

    // the field is retired while the decal texture load is still in flight
    view.dispose();
    const released = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    textureLoad.resolve({});
    await flushStream();

    // the early-out released every decal geometry inline...
    expect(released.mock.calls.length).toBe(bgFieldDecals().length);
    // ...attached nothing, and never streamed on to the flames or the lights
    expect(view.group.children.some((child) => child.name === 'battleground-decals')).toBe(false);
    expect(buildLanternFlames).not.toHaveBeenCalled();
    released.mockRestore();
  });

  it('routes every streamed piece through the gated attach seam, gate injected by the renderer (source pins)', () => {
    // Stripped so a comment near-quoting a pinned call can never satisfy a
    // positive pin after a regression; the pins read CODE only.
    const field = stripComments(
      readFileSync(new URL('../src/render/battleground.ts', import.meta.url), 'utf8'),
    );
    expect(field).toContain("from './gated_scene_attach'");
    // one helper, cancellation owned by the view's own disposed flag
    expect(field).toContain(
      'attachSceneGroupGated(group, piece, opts.compileGate, () => disposed)',
    );
    // every shader-bearing streamed piece goes through it; a bare group.add
    // would relink synchronously at first visible frame (lights carry no
    // programs and stay direct on purpose)
    for (const piece of [
      'attachPieceGated(terrain.group)',
      'attachPieceGated(placements.group)',
      'attachPieceGated(grass)',
      'attachPieceGated(decalGroup)',
      'attachPieceGated(flames)',
    ]) {
      expect(field, `${piece} missing`).toContain(piece);
    }
    // the wards are the one deliberate exception: availability is a sim rule
    // made visible, so they attach ungated and the gate is only a prewarm
    expect(field).toContain('group.add(wards.group)');
    expect(field).toContain('opts.compileGate?.(wards.group)');
    expect(field).not.toContain('group.add(terrain.group)');
    expect(field).not.toContain('group.add(placements.group)');

    const renderer = stripComments(
      readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8'),
    );
    const start = renderer.indexOf('buildBattleground(o, this.sim.cfg.seed, {');
    expect(start).toBeGreaterThan(-1);
    // The end marker is asserted too: an unchecked -1 would silently widen
    // the slice to the file tail and let the pin pass from anywhere.
    const end = renderer.indexOf('this.bgViews.set(i, view);', start);
    expect(end).toBeGreaterThan(-1);
    const construction = renderer.slice(start, end);
    expect(construction).toContain(
      'compileGate: this.asyncCompileSupported ? (t) => this.compileGate(t) : undefined,',
    );
  });
});
