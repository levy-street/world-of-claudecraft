// @vitest-environment happy-dom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tryIgnivarPlacerCommand } from '../src/game/ignivar_placer';
import { loadGltf } from '../src/render/assets/loader';
import { WORLD_QUEST_PLACER_ASSETS } from '../src/render/world_quest_placer_catalog';
import { isWorldQuestPlacerSourceHidden } from '../src/render/world_quest_placer_mask';
import type { CurrentQuestPlacement } from '../src/render/world_quest_placer_sources';
import {
  FARSHORE_HULL_FRAGMENT_PLACEMENT,
  FARSHORE_SALVAGE_PLACEMENTS,
  FARSHORE_SHIPWRECK_PLACEMENT,
} from '../src/sim/content/farshore_shipwreck_layout';
import type { Entity } from '../src/sim/types';

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(async () => {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 1), new THREE.MeshBasicMaterial()));
    return { scene };
  }),
}));
vi.mock('../src/render/ignivar_env_props', () => ({
  IGNIVAR_ENV_PROP_URLS: { dungeon_entrance: '/models/mock.glb' },
  appendIgnivarEnvProps: vi.fn(),
  prepareIgnivarEnvProps: vi.fn(async () => undefined),
}));
vi.mock('../src/render/dungeon_torch_rig', () => ({ addIgnivarPlacedTorchFires: vi.fn() }));
vi.mock('../src/render/farshore_shipwreck', () => ({
  prepareFarshoreShipwreck: vi.fn(async () => undefined),
  buildFarshoreShipwreck: () => {
    const root = new THREE.Group();
    for (const name of ['farshore-broken-ship', 'farshore-broken-hull']) {
      const part = new THREE.Group();
      part.name = name;
      part.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), new THREE.MeshBasicMaterial()));
      root.add(part);
    }
    return root;
  },
}));
vi.mock('../src/render/quest_objects', () => ({
  prepareFarshoreSalvageObjects: vi.fn(async () => undefined),
  farshoreSalvagePrewarmPlan: [0, 1, 2, 3, 5].map((visual) => ({
    visual,
    entityId: [2147100103, 2147100101, 2147100102, 2147100109, 0, 2147100106][visual],
  })),
  buildGroundQuestObject: () => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
    return { group };
  },
}));

const questStorage = 'woc_ignivar_placer:world_quests_shipwreck';
const exteriorStorage = 'woc_ignivar_placer:drakelands_exterior';
const deps = {
  scene: new THREE.Scene(),
  getPlayer: () => ({ pos: { x: 284, y: 1, z: 92 }, facing: 0 }) as never,
  log: vi.fn(),
  chat: vi.fn(),
  compilePreview: vi.fn(async () => undefined),
  getCurrentQuestPlacements: vi.fn((): CurrentQuestPlacement[] => []),
};

function click(label: string): void {
  const button = [...document.querySelectorAll<HTMLButtonElement>('#ignivar-placer button')].find(
    (node) => node.textContent === label,
  );
  expect(button, label).toBeDefined();
  button!.click();
}

async function open(): Promise<void> {
  expect(tryIgnivarPlacerCommand('/placer quests', deps)).toBe(true);
  await vi.waitFor(() => expect(document.querySelector('#ignivar-placer')).not.toBeNull());
}

afterEach(() => {
  if (document.querySelector('#ignivar-placer')) click('close');
  localStorage.clear();
  vi.clearAllMocks();
  deps.getCurrentQuestPlacements.mockReturnValue([]);
});

describe('World Quests placer workflow', () => {
  it('does not fetch authoring GLBs merely by importing the chat tool', () => {
    expect(loadGltf).not.toHaveBeenCalled();
  });

  it('reopens the submitted layout with every new live source masked and no duplicate imports', async () => {
    const entries = [
      FARSHORE_SHIPWRECK_PLACEMENT,
      FARSHORE_HULL_FRAGMENT_PLACEMENT,
      ...FARSHORE_SALVAGE_PLACEMENTS,
    ];
    localStorage.setItem(
      questStorage,
      JSON.stringify({
        interior: 'world_quests_shipwreck',
        entries,
        importedSources: [
          'shipwreck:ship',
          'shipwreck:dock',
          'shipwreck:moorings',
          ...Array.from({ length: 8 }, (_, i) => `salvage:${2147100100 + i}`),
        ],
      }),
    );
    const originals = FARSHORE_SALVAGE_PLACEMENTS.map((_, i) => {
      const original = new THREE.Group();
      original.userData.entityId = 2147100101 + i;
      deps.scene.add(original);
      return original;
    });
    deps.getCurrentQuestPlacements.mockReturnValue(
      entries.map((row, i) => ({
        ...row,
        key: i === 0 ? 'wq_existing_ship' : 'wq_existing_debris_0',
        sourceId: i === 0 ? 'shipwreck:ship' : `salvage:${2147100100 + i - 1}`,
      })),
    );
    await open();
    expect(originals.every(isWorldQuestPlacerSourceHidden)).toBe(true);
    click('load current quest assets');
    const saved = JSON.parse(localStorage.getItem(questStorage)!);
    expect(saved.entries).toHaveLength(13);
    expect(saved.importedSources).toHaveLength(13);
    for (const [i, entry] of entries.entries()) expect(saved.entries[i]).toMatchObject(entry);
    click('close');
    expect(originals.some(isWorldQuestPlacerSourceHidden)).toBe(false);
    for (const original of originals) deps.scene.remove(original);
  });

  it('imports, moves, replaces and removes current assets without overwriting saved new assets', async () => {
    const landmark = new THREE.Group();
    landmark.name = 'farshore-shipwreck';
    const original = new THREE.Group();
    original.name = 'farshore-broken-ship';
    landmark.add(original);
    deps.scene.add(landmark);
    const originalDebris = new THREE.Group();
    originalDebris.userData.entityId = 2147100100;
    deps.scene.add(originalDebris);
    const expectAngles = (key: string) => {
      const model = deps.scene.getObjectByName(key)!;
      expect(model.rotation.x).toBeCloseTo(THREE.MathUtils.degToRad(3));
      expect(model.rotation.y).toBeCloseTo(THREE.MathUtils.degToRad(-57));
      expect(model.rotation.z).toBeCloseTo(THREE.MathUtils.degToRad(-11));
    };
    deps.getCurrentQuestPlacements.mockReturnValue([
      {
        key: 'wq_existing_ship',
        sourceId: 'shipwreck:ship',
        x: 269.8,
        y: -2.5,
        z: 105.8,
        rot: -57,
        pitch: 3,
        roll: -11,
        scale: 3.5,
      },
      {
        key: 'wq_existing_debris_0',
        sourceId: 'salvage:2147100100',
        x: 280,
        y: 0,
        z: 96,
        rot: 40,
        scale: 1,
      },
    ]);
    const saved = () => JSON.parse(localStorage.getItem(questStorage)!);
    const rowFor = (label: string) =>
      [...document.querySelectorAll('#ignivar-placer span')].find((node) =>
        node.textContent?.startsWith(`${label} (`),
      )!.parentElement!;
    const clipboard = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboard },
      configurable: true,
    });
    await open();
    click('Broken planks');
    click('load current quest assets');
    expect(saved().entries).toHaveLength(3);
    expect(saved().entries[0].key).toBe('wq_broken_planks');
    expect(original.visible).toBe(false);
    expectAngles('wq_existing_ship');
    rowFor('Current shipwreck').click();
    click('X+1');
    click('replace selected: off');
    click('Shipwreck');
    expectAngles('wq_shipwreck');
    expect(saved().entries[1]).toEqual({
      key: 'wq_shipwreck',
      sourceId: 'shipwreck:ship',
      x: 270.8,
      y: -2.5,
      z: 105.8,
      rot: -57,
      pitch: 3,
      roll: -11,
      scale: 26,
    });
    rowFor('Current broken planks').querySelector('button')!.click();
    expect(isWorldQuestPlacerSourceHidden(originalDebris)).toBe(true);
    click('load current quest assets');
    expect(saved().entries).toHaveLength(2);
    expect(isWorldQuestPlacerSourceHidden(originalDebris)).toBe(true);
    expect(saved().importedSources).toEqual(['shipwreck:ship', 'salvage:2147100100']);
    click('export JSON');
    expect(JSON.parse(clipboard.mock.calls[0][0])).toEqual(saved());
    click('close');
    expect(original.visible).toBe(true);
    expect(isWorldQuestPlacerSourceHidden(originalDebris)).toBe(false);
    await open();
    expect(original.visible).toBe(false);
    click('load current quest assets');
    expect(saved().entries).toHaveLength(2);
    expect(deps.scene.getObjectByName('wq_shipwreck')!.position.x).toBe(270.8);
    expectAngles('wq_shipwreck');
    expect(isWorldQuestPlacerSourceHidden(originalDebris)).toBe(true);
    click('kit: World Quests');
    expect(original.visible).toBe(true);
    expect(isWorldQuestPlacerSourceHidden(originalDebris)).toBe(false);
    deps.scene.remove(landmark);
    deps.scene.remove(originalDebris);
  });

  it('places all seven named assets at useful scales after shader preparation', async () => {
    let finishCompile: () => void = () => undefined;
    const finalCompile = new Promise<undefined>((resolve) => {
      finishCompile = () => resolve(undefined);
    });
    for (let i = 0; i < 13; i++) deps.compilePreview.mockResolvedValueOnce(undefined);
    deps.compilePreview.mockReturnValueOnce(finalCompile);
    expect(tryIgnivarPlacerCommand('/placer quests', deps)).toBe(true);
    await vi.waitFor(() => expect(deps.compilePreview).toHaveBeenCalledTimes(14));
    expect(document.querySelector('#ignivar-placer')).toBeNull();
    expect(deps.scene.getObjectByName('wq_shipwreck')).toBeUndefined();
    finishCompile();
    await vi.waitFor(() => expect(document.querySelector('#ignivar-placer')).not.toBeNull());
    expect(deps.compilePreview).toHaveBeenCalledTimes(14);
    expect(document.querySelector('#ignivar-placer')!.textContent).toContain('kit: World Quests');
    for (const [key, asset] of Object.entries(WORLD_QUEST_PLACER_ASSETS)) {
      click(asset.label);
      const model = deps.scene.getObjectByName(key)!;
      expect(model, key).toBeDefined();
      expect(model.scale.x).toBe(asset.scale);
      expect(model.position.toArray()).toEqual([284, 1, 94.5]);
    }
    const saved = JSON.parse(localStorage.getItem(questStorage)!);
    expect(saved.entries.map((entry: { key: string }) => entry.key)).toEqual(
      Object.keys(WORLD_QUEST_PLACER_ASSETS),
    );
    expect(localStorage.getItem(exteriorStorage)).toBeNull();
  });

  it('restores edited transforms, exports quest keys, and preserves the exterior save', async () => {
    const exterior = JSON.stringify({ interior: 'drakelands_exterior', entries: [] });
    localStorage.setItem(exteriorStorage, exterior);
    const writeText = vi.fn(async (_value: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await open();
    click('Broken planks');
    click('rot +45');
    click('X+1');
    click('x3');
    const saved = JSON.parse(localStorage.getItem(questStorage)!);
    expect(saved.entries[0]).toEqual({
      key: 'wq_broken_planks',
      x: 285,
      y: 1,
      z: 94.5,
      rot: 225,
      scale: 3,
    });
    click('export JSON');
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual(saved);
    click('close');
    await open();
    expect(JSON.parse(localStorage.getItem(questStorage)!)).toEqual(saved);
    expect(deps.scene.getObjectByName('wq_broken_planks')!.scale.x).toBe(3);
    expect(deps.scene.getObjectByName('wq_broken_planks')!.position.toArray()).toEqual([
      285, 1, 94.5,
    ]);
    expect(deps.scene.getObjectByName('wq_broken_planks')!.rotation.y).toBeCloseTo(
      (225 * Math.PI) / 180,
    );
    click('kit: World Quests');
    expect(document.querySelector('#ignivar-placer')!.textContent).toContain('kit: interior');
    expect(localStorage.getItem(exteriorStorage)).toBe(exterior);
    expect(tryIgnivarPlacerCommand('/placer quests', deps)).toBe(true);
    expect(JSON.parse(localStorage.getItem(questStorage)!)).toEqual(saved);
  });

  it('keeps repeated debris placements as independent scene objects', async () => {
    await open();
    click('Broken planks');
    click('X+1');
    click('Broken planks');
    click('X-1');
    const roots: THREE.Object3D[] = [];
    deps.scene.traverse((node) => {
      if (node.name === 'wq_broken_planks') roots.push(node);
    });
    expect(roots).toHaveLength(2);
    expect(roots[0]).not.toBe(roots[1]);
    expect(roots.map((root) => root.position.x)).toEqual([285, 283]);
  });

  it('keeps quest placements separate when switching kits inside an Ignivar room', async () => {
    const raidStorage = 'woc_ignivar_placer:ignivar';
    const raid = JSON.stringify({ interior: 'ignivar', entries: [] });
    localStorage.setItem(raidStorage, raid);
    const interiorDeps = {
      ...deps,
      getPlayer: () => ({ pos: { x: 116800, y: 1, z: -1250 }, facing: 0 }) as Entity,
    };
    expect(tryIgnivarPlacerCommand('/placer quests', interiorDeps)).toBe(true);
    await vi.waitFor(() => expect(document.querySelector('#ignivar-placer')).not.toBeNull());
    click('Broken planks');
    expect(localStorage.getItem(raidStorage)).toBe(raid);
    const saved = JSON.parse(localStorage.getItem(questStorage)!);
    expect(saved.entries[0]).toMatchObject({ key: 'wq_broken_planks', x: 116800, z: -1247.5 });
    click('kit: World Quests');
    expect(document.querySelector('#ignivar-placer')!.textContent).toContain(
      'Crucible of the Last Spring',
    );
    expect(localStorage.getItem(raidStorage)).toBe(raid);
    expect(tryIgnivarPlacerCommand('/placer quests', interiorDeps)).toBe(true);
    expect(JSON.parse(localStorage.getItem(questStorage)!)).toEqual(saved);
    expect(localStorage.getItem(raidStorage)).toBe(raid);
  });
});
