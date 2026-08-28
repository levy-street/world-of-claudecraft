// The battleground view map (src/render/battleground_views.ts): the copy the
// player is matched into builds when they stand in the band, the queue
// proposal prebuilds a hidden copy whose parts link ahead, and every streamed
// part joins the field through the host's gated attach (battleground.ts).

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { built, commit } = vi.hoisted(() => ({
  built: [] as { origin: { x: number; z: number }; seed: number; opts: unknown }[],
  commit: vi.fn(async () => {}),
}));

vi.mock('../src/render/battleground', () => ({
  battlegroundAssetPrewarm: { commit },
  buildBattleground: (
    origin: { x: number; z: number },
    seed: number,
    opts: { attachPart?: (part: THREE.Object3D, into: THREE.Group) => void },
  ) => {
    built.push({ origin, seed, opts });
    const group = new THREE.Group();
    group.name = 'battleground';
    // One streamed part lands right away, through the host's attach.
    const part = new THREE.Mesh();
    part.name = 'terrain';
    if (opts.attachPart) opts.attachPart(part, group);
    else group.add(part);
    return { group, setWardState: vi.fn(), dispose: vi.fn() };
  },
}));

import {
  type BattlegroundViewHost,
  type BattlegroundViews,
  BG_PREBUILD_SLOT,
  ensureBattlegroundViewNear,
  prebuildBattlegroundView,
} from '../src/render/battleground_views';
import { BG_SLOT_COUNT, battlegroundOrigin } from '../src/sim/data';

function host() {
  const scene = new THREE.Scene();
  const attached: string[] = [];
  const api: BattlegroundViewHost = {
    scene,
    seed: 7,
    lowGfx: false,
    fireLights: [],
    attachPart: (part, into) => {
      attached.push(part.name);
      part.visible = false;
      into.add(part);
    },
  };
  return { scene, attached, api };
}

beforeEach(() => {
  built.length = 0;
  commit.mockClear();
});

describe('ensureBattlegroundViewNear', () => {
  it('builds the copy of the slot the player stands in, visible, once', () => {
    const { scene, attached, api } = host();
    const views: BattlegroundViews = new Map();
    const origin = battlegroundOrigin(1);
    ensureBattlegroundViewNear(views, origin.x + 10, origin.z - 10, api);
    ensureBattlegroundViewNear(views, origin.x + 10, origin.z - 10, api);
    expect(built).toHaveLength(1);
    expect(built[0].origin).toEqual(origin);
    expect(built[0].seed).toBe(7);
    expect(built[0].opts).toBe(api);
    expect([...views.keys()]).toEqual([1]);
    expect(views.get(1)?.group.visible).toBe(true);
    expect(scene.children).toEqual([views.get(1)?.group]);
    // The streamed part went through the host's attach, not a bare add.
    expect(attached).toEqual(['terrain']);
  });

  it('builds nothing while the player is outside every slot', () => {
    const { api } = host();
    const views: BattlegroundViews = new Map();
    const origin = battlegroundOrigin(0);
    ensureBattlegroundViewNear(views, origin.x + 1000, origin.z, api);
    expect(built).toHaveLength(0);
    expect(BG_SLOT_COUNT).toBeGreaterThan(1);
  });
});

describe('prebuildBattlegroundView', () => {
  it('prebuilds one hidden copy at the proposal and commits the asset preload, idempotently', () => {
    const { scene, api } = host();
    const views: BattlegroundViews = new Map();
    prebuildBattlegroundView(views, api);
    prebuildBattlegroundView(views, api);
    expect(built).toHaveLength(1);
    expect(built[0].origin).toEqual(battlegroundOrigin(BG_PREBUILD_SLOT));
    expect(views.get(BG_PREBUILD_SLOT)?.group.visible).toBe(false);
    expect(scene.children).toHaveLength(1);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('shows the prebuilt copy when the player lands in its slot, and builds another slot as a hit', () => {
    const { api } = host();
    const views: BattlegroundViews = new Map();
    prebuildBattlegroundView(views, api);
    const home = battlegroundOrigin(BG_PREBUILD_SLOT);
    ensureBattlegroundViewNear(views, home.x, home.z, api);
    expect(built).toHaveLength(1);
    expect(views.get(BG_PREBUILD_SLOT)?.group.visible).toBe(true);
    const other = battlegroundOrigin(BG_PREBUILD_SLOT + 1);
    ensureBattlegroundViewNear(views, other.x, other.z, api);
    expect(built).toHaveLength(2);
    expect(views.size).toBe(2);
  });
});

describe('the streamed parts and the renderer wiring (source pins)', () => {
  const source = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

  it('routes every streamed part of the field through attachPart, lights excepted', () => {
    const field = source('../src/render/battleground.ts');
    const start = field.indexOf('void (async () => {');
    const end = field.indexOf('freezeStaticMatrices(group);', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const streamed = field.slice(start, end);
    const bareAdds = [...streamed.matchAll(/group\.add\(([^)]*)\)/g)].map((m) => m[1]);
    expect(bareAdds).toEqual(['light']);
    for (const part of [
      'terrain.group',
      'wards.group',
      'placements.group',
      'grass',
      'mesh',
      'flames',
    ])
      expect(streamed).toContain(`attach(${part});`);
  });

  it('attaches the yumi maze and every field part through the compile gate, and prebuilds at the proposal', () => {
    const renderer = source('../src/render/renderer.ts');
    expect(renderer).toContain(
      'void attachSceneGroupGated(this.scene, view.group, this.worldCompileGate());',
    );
    expect(renderer).toContain(
      'attachPart: (part, into) => void attachSceneGroupGated(into, part, this.worldCompileGate()),',
    );
    expect(renderer).toContain(
      'ensureBattlegroundViewNear(this.bgViews, px, pz, this.battlegroundViewHost());',
    );
    expect(renderer).toContain(
      "case 'bgProposed':\n        prebuildBattlegroundView(this.bgViews, this.battlegroundViewHost());",
    );
    expect(renderer).not.toContain('this.scene.add(view.group);');
  });
});
