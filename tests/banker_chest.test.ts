import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  attachBankerChestToNpcView,
  bankerChestPreloadInternalsForTest,
  isBankerNpcForRender,
} from '../src/render/banker_chest';
import { GFX } from '../src/render/gfx';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import type { NpcDef } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const TEST_WORLD_SEED = 20061;
const banker = (templateId: string) => ({ kind: 'npc' as const, templateId });

function placedBuiltInBanker(templateId: string) {
  const definition = Object.values(BUILTIN_WORLD.npcs).find((npc) => npc.id === templateId);
  if (!definition) throw new Error(`banker fixture ${templateId} not found`);
  return {
    ...banker(templateId),
    pos: {
      x: definition.pos.x,
      y: groundHeight(definition.pos.x, definition.pos.z, TEST_WORLD_SEED),
      z: definition.pos.z,
    },
    facing: definition.facing,
  };
}

afterEach(() => setActiveWorldContent(null));

describe('banker chest classification', () => {
  it('includes every built-in banker and excludes ordinary entities', () => {
    const bankerIds = Object.values(BUILTIN_WORLD.npcs)
      .filter((definition) => definition.banker)
      .map((definition) => definition.id);
    expect(bankerIds).toEqual(['bursar_fernando', 'bursar_petra_vell', 'bursar_aldous_crane']);
    for (const templateId of bankerIds) {
      expect(isBankerNpcForRender(banker(templateId))).toBe(true);
    }

    const ordinary = Object.values(BUILTIN_WORLD.npcs).find((definition) => !definition.banker);
    if (!ordinary) throw new Error('ordinary NPC fixture not found');
    expect(isBankerNpcForRender(banker(ordinary.id))).toBe(false);
    expect(isBankerNpcForRender({ kind: 'mob', templateId: bankerIds[0] })).toBe(false);
  });

  it('uses active custom-world definitions, including records keyed separately from ids', () => {
    const customBanker: NpcDef = {
      id: 'custom_vault_keeper',
      name: 'Vault Keeper',
      title: 'Banker',
      pos: { x: 4, z: 7 },
      facing: 0,
      color: 0x886633,
      questIds: [],
      banker: true,
      greeting: 'Welcome.',
    };
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      npcs: { editor_record_key: customBanker },
    });

    expect(isBankerNpcForRender(banker(customBanker.id))).toBe(true);
    expect(isBankerNpcForRender(banker(customBanker.id), { editor_record_key: customBanker })).toBe(
      true,
    );
    expect(
      isBankerNpcForRender(banker('editor_record_key'), { editor_record_key: customBanker }),
    ).toBe(false);
    expect(isBankerNpcForRender(banker('bursar_fernando'))).toBe(false);
  });
});

describe('banker chest model and placement', () => {
  it('clones the cached source, normalizes and re-seats it, and shares converted materials', () => {
    const map = new THREE.Texture();
    const normalMap = new THREE.Texture();
    const roughnessMap = new THREE.Texture();
    const aoMap = new THREE.Texture();
    const sourceMaterial = new THREE.MeshStandardMaterial({
      color: 0x6a4022,
      map,
      vertexColors: true,
      normalMap,
      roughnessMap,
      aoMap,
      roughness: 0.63,
      metalness: 0.24,
      emissive: 0x120800,
      emissiveIntensity: 0.35,
      side: THREE.DoubleSide,
    });
    const sourceMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1), sourceMaterial);
    sourceMesh.position.y = 5;
    const source = new THREE.Group();
    source.add(sourceMesh);

    const first = bankerChestPreloadInternalsForTest.buildChestFromSource(source);
    const second = bankerChestPreloadInternalsForTest.buildChestFromSource(source);
    const firstMesh = first.getObjectByProperty('isMesh', true) as THREE.Mesh;
    const secondMesh = second.getObjectByProperty('isMesh', true) as THREE.Mesh;
    const bounds = new THREE.Box3().setFromObject(first);

    expect(first).not.toBe(source);
    expect(firstMesh).not.toBe(sourceMesh);
    expect(sourceMesh.material).toBe(sourceMaterial);
    expect(source.scale.toArray()).toEqual([1, 1, 1]);
    expect(bounds.min.y).toBeCloseTo(0, 6);
    expect(bankerChestPreloadInternalsForTest.targetHeight).toBe(1.3);
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(
      bankerChestPreloadInternalsForTest.targetHeight,
      6,
    );
    expect(firstMesh.castShadow).toBe(true);
    expect(firstMesh.receiveShadow).toBe(true);
    expect(firstMesh.material).toBe(secondMesh.material);
    expect(firstMesh.material).not.toBe(sourceMaterial);
    expect(firstMesh.material).toBeInstanceOf(
      GFX.standardMaterials ? THREE.MeshStandardMaterial : THREE.MeshLambertMaterial,
    );

    const converted = firstMesh.material as THREE.MeshStandardMaterial;
    expect(converted.color.getHex()).toBe(sourceMaterial.color.getHex());
    expect(converted.map).toBe(map);
    expect(converted.vertexColors).toBe(true);
    expect(converted.emissive.getHex()).toBe(sourceMaterial.emissive.getHex());
    expect(converted.emissiveIntensity).toBe(sourceMaterial.emissiveIntensity);
    expect(converted.side).toBe(THREE.DoubleSide);
    if (GFX.standardMaterials) {
      expect(converted.normalMap).toBe(normalMap);
      expect(converted.roughnessMap).toBe(roughnessMap);
      expect(converted.aoMap).toBe(aoMap);
      expect(converted.roughness).toBe(sourceMaterial.roughness);
      expect(converted.metalness).toBe(sourceMaterial.metalness);
    }
  });

  it('keeps vertex colors when the low tier converts the source to Lambert', () => {
    const mutableGfx = GFX as unknown as { standardMaterials: boolean };
    const previousStandardMaterials = mutableGfx.standardMaterials;
    mutableGfx.standardMaterials = false;
    try {
      const sourceMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.7,
        emissive: 0x120800,
        emissiveIntensity: 0.4,
        side: THREE.BackSide,
      });
      const source = new THREE.Group();
      source.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), sourceMaterial));

      const built = bankerChestPreloadInternalsForTest.buildChestFromSource(source);
      const mesh = built.getObjectByProperty('isMesh', true) as THREE.Mesh;
      expect(mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial);
      const converted = mesh.material as THREE.MeshLambertMaterial;
      expect(converted.vertexColors).toBe(true);
      expect(converted.flatShading).toBe(true);
      expect(converted.emissiveIntensity).toBe(0.4);
      expect(converted.side).toBe(THREE.BackSide);
    } finally {
      mutableGfx.standardMaterials = previousStandardMaterials;
    }
  });

  it('pins the candidate order and chooses an unobstructed built-in placement', () => {
    // The chest is a SOLID standable collider now: every candidate keeps the
    // banker's own interaction point clear (banker_chest_layout
    // placementClearsBanker), so the old hugging offsets moved back and out.
    expect(bankerChestPreloadInternalsForTest.placements).toEqual([
      { x: 1.15, y: 0, z: -1.6, rotationY: 0 },
      { x: -1.15, y: 0, z: -1.6, rotationY: 0 },
      { x: 2.0, y: 0, z: 0.9, rotationY: 0 },
      { x: -2.0, y: 0, z: 0.9, rotationY: 0 },
    ]);

    const expectedOffsets: Record<string, readonly [number, number]> = {
      // The bank facade stands directly behind Fernando, so his behind-side
      // candidates sample blocked and the chest takes the pushed-out front
      // corner; the other two towns keep the behind-and-beside spot.
      bursar_fernando: [2.0, 0.9],
      bursar_petra_vell: [-1.15, -1.6],
      bursar_aldous_crane: [2.0, 0.9],
    };
    for (const [templateId, expected] of Object.entries(expectedOffsets)) {
      const entity = placedBuiltInBanker(templateId);
      const placement = bankerChestPreloadInternalsForTest.resolveBankerChestPlacement(
        entity,
        TEST_WORLD_SEED,
      );
      expect([placement.x, placement.z]).toEqual(expected);
      expect(placement.rotationY).toBe(0);
      const facingCos = Math.cos(entity.facing);
      const facingSin = Math.sin(entity.facing);
      const worldX = entity.pos.x + placement.x * facingCos + placement.z * facingSin;
      const worldZ = entity.pos.z - placement.x * facingSin + placement.z * facingCos;
      expect(placement.y).toBeCloseTo(
        groundHeight(worldX, worldZ, TEST_WORLD_SEED) - entity.pos.y,
        8,
      );
    }
  });

  it('seats a custom-world chest at its chosen center ground height', () => {
    const entity = {
      ...banker('custom_vault_keeper'),
      pos: { x: 10, y: 2, z: 20 },
      facing: Math.PI / 2,
    };
    const groundSamples: Array<[number, number, number]> = [];
    const placement = bankerChestPreloadInternalsForTest.resolveBankerChestPlacement(
      entity,
      77,
      () => false,
      (x, z, seed) => {
        groundSamples.push([x, z, seed]);
        return 5.25;
      },
    );

    expect([placement.x, placement.y, placement.z, placement.rotationY]).toEqual([
      1.15, 3.25, -1.6, 0,
    ]);
    expect(groundSamples).toEqual([[8.4, 18.85, 77]]);
  });

  it('places a non-interactive sibling beside the live banker transform', () => {
    const viewGroup = new THREE.Group();
    const visualRoot = new THREE.Group();
    const clickProxy = new THREE.Object3D();
    visualRoot.add(clickProxy);
    viewGroup.add(visualRoot);
    const clickTargets = [clickProxy];

    const entity = placedBuiltInBanker('bursar_fernando');
    const chest = attachBankerChestToNpcView(viewGroup, entity, TEST_WORLD_SEED);
    if (!chest) throw new Error('built-in banker chest was not attached');
    expect(chest.parent).toBe(viewGroup);
    // Fernando's chest resolves to the pushed-out front corner (the bank
    // facade blocks his behind-side candidates), matching the sim's solid
    // collider spot exactly.
    expect(chest.position.x).toBe(2.0);
    expect(chest.position.z).toBeGreaterThan(0);
    expect(chest.rotation.y).toBe(0);
    expect(clickTargets).toEqual([clickProxy]);
    expect(clickProxy.getObjectByName('bankerChestDecoration')).toBeUndefined();

    const secondViewGroup = new THREE.Group();
    const secondChest = attachBankerChestToNpcView(secondViewGroup, entity, TEST_WORLD_SEED);
    expect(secondChest).not.toBeNull();
    expect(secondChest).not.toBe(chest);
    expect(secondChest?.parent).toBe(secondViewGroup);
    expect(chest.parent).toBe(viewGroup);

    viewGroup.position.set(12, 3, -8);
    viewGroup.rotation.y = Math.PI / 2;
    viewGroup.updateMatrixWorld(true);
    const actualWorldPosition = chest.getWorldPosition(new THREE.Vector3());
    const expectedWorldPosition = chest.position.clone().applyMatrix4(viewGroup.matrixWorld);
    expect(actualWorldPosition.distanceTo(expectedWorldPosition)).toBeLessThan(1e-8);

    const chestFront = new THREE.Vector3(0, 0, 1).applyQuaternion(
      chest.getWorldQuaternion(new THREE.Quaternion()),
    );
    const viewFront = new THREE.Vector3(0, 0, 1).applyQuaternion(
      viewGroup.getWorldQuaternion(new THREE.Quaternion()),
    );
    expect(chestFront.dot(viewFront)).toBeCloseTo(1, 8);
  });

  it('does not attach to an ordinary NPC view', () => {
    const ordinary = Object.values(BUILTIN_WORLD.npcs).find((definition) => !definition.banker);
    if (!ordinary) throw new Error('ordinary NPC fixture not found');
    const viewGroup = new THREE.Group();
    const ordinaryEntity = {
      ...banker(ordinary.id),
      pos: { x: ordinary.pos.x, y: 0, z: ordinary.pos.z },
      facing: ordinary.facing,
    };
    expect(attachBankerChestToNpcView(viewGroup, ordinaryEntity, TEST_WORLD_SEED)).toBeNull();
    expect(viewGroup.children).toHaveLength(0);
  });
});

describe('banker chest renderer integration', () => {
  it('preloads one unconditional URL and composes before click-target selection', () => {
    expect(bankerChestPreloadInternalsForTest.bankerChestAssetUrl).toBe(
      '/models/props/banker_chest.glb',
    );
    const moduleSource = readFileSync(
      new URL('../src/render/banker_chest.ts', import.meta.url),
      'utf8',
    );
    const preloadStart = moduleSource.indexOf("if (typeof window !== 'undefined')");
    const preloadEnd = moduleSource.indexOf('type BankerNpcRef', preloadStart);
    const preloadBlock = moduleSource.slice(preloadStart, preloadEnd);
    expect(preloadBlock).toContain('registerPreload(');
    expect(preloadBlock).toContain('loadGltf(BANKER_CHEST_ASSET_URL)');
    expect(preloadBlock).not.toContain('GFX');
    expect(preloadBlock).not.toContain('getActiveWorldContent');

    const rendererSource = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    );
    expect(rendererSource).toContain(
      "import { attachBankerChestToNpcView } from './banker_chest';",
    );
    const attachAt = rendererSource.indexOf('const bankerChest = attachBankerChestToNpcView(');
    const clickTargetAt = rendererSource.indexOf('let clickTarget: THREE.Object3D;', attachAt);
    expect(attachAt).toBeGreaterThan(rendererSource.indexOf('private createView(e: Entity): void'));
    expect(clickTargetAt).toBeGreaterThan(attachAt);
    expect(rendererSource.slice(attachAt, clickTargetAt)).toContain('this.sim.cfg.seed');
    expect(rendererSource.slice(attachAt, clickTargetAt)).toContain('this.sim.cfg.world?.npcs');
    expect(rendererSource).toContain(
      'else if (bankerChest) collectCasters(bankerChest, objectCasters);',
    );
    expect(rendererSource).toContain('for (const caster of v.objectCasters)');
  });
});
