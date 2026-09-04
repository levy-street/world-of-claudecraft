import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCaravanDriver } from '../src/render/world_quest_caravan_driver';
import { syncWorldQuestCarryVisual } from '../src/render/world_quest_carry_visual';
import {
  buildMovingWorldQuestFreightWagon,
  buildWorldQuestFreightWagon,
  worldQuestFreightVisualInternalsForTest,
} from '../src/render/world_quest_freight_visual';
import { hasWorldQuestDeliveryCargo } from '../src/sim/world_quest_delivery';

vi.mock('../src/render/world_quest_caravan_driver', () => ({
  buildCaravanDriver: vi.fn(() => null),
}));

describe('world quest freight visual', () => {
  afterEach(() => {
    worldQuestFreightVisualInternalsForTest.reset();
    vi.restoreAllMocks();
  });

  it('recognizes public entity cargo', () => {
    const entity = {
      auras: [
        {
          id: 'world_quest_delivery_cargo',
          kind: 'world_quest_cargo' as const,
        },
      ],
    };
    expect(hasWorldQuestDeliveryCargo(entity as never)).toBe(true);
    expect(hasWorldQuestDeliveryCargo({ auras: [] } as never)).toBe(false);
  });

  it('builds once on pickup, follows the player group, and detaches on drop', () => {
    const parent = new THREE.Group();
    const crate = new THREE.Group();
    crate.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    const build = vi.fn(() => ({ group: crate }));

    const carrying = syncWorldQuestCarryVisual(null, parent, true, build);
    expect(carrying?.root).toBe(crate);
    expect(parent.children).toContain(crate);
    expect(crate.position).toMatchObject({ x: 0, y: 0.88, z: 0.48 });
    expect(syncWorldQuestCarryVisual(carrying, parent, true, build)).toBe(carrying);
    expect(build).toHaveBeenCalledTimes(1);

    expect(syncWorldQuestCarryVisual(carrying, parent, false, build)).toBeNull();
    expect(parent.children).not.toContain(crate);
  });

  it('uses the shipped wagon, horse, and crate models', () => {
    expect(worldQuestFreightVisualInternalsForTest.assetUrls).toEqual({
      wagon: '/models/biome/city_wagon.glb',
      horse: '/models/mounts/valorsteed.glb',
      crate: '/models/quest/supply_crate.glb',
    });
  });

  it.each(['eastbrook_freight_caravan', 'willowfen_remedy_caravan', 'frostveil_supply_caravan'])(
    'animates %s horses and disposes their skeleton textures once',
    (templateId) => {
      const { wagon, horse, crate } = worldQuestFreightVisualInternalsForTest.assetUrls;
      const plainScene = () => {
        const scene = new THREE.Group();
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
        return scene;
      };
      const horseScene = new THREE.Group();
      const bone = new THREE.Bone();
      const horseGeometry = new THREE.BoxGeometry(1, 1, 1);
      const vertexCount = horseGeometry.getAttribute('position').count;
      horseGeometry.setAttribute(
        'skinIndex',
        new THREE.Uint16BufferAttribute(new Uint16Array(vertexCount * 4), 4),
      );
      const weights = new Float32Array(vertexCount * 4);
      for (let index = 0; index < vertexCount; index++) weights[index * 4] = 1;
      horseGeometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
      const horseMesh = new THREE.SkinnedMesh(horseGeometry, new THREE.MeshBasicMaterial());
      horseMesh.add(bone);
      horseMesh.bind(new THREE.Skeleton([bone]));
      horseScene.add(horseMesh);
      const clips = [
        new THREE.AnimationClip('Idle', 1, [
          new THREE.NumberKeyframeTrack('.rotation[y]', [0, 1], [0, 0.01]),
        ]),
        new THREE.AnimationClip('Walk', 1, [
          new THREE.NumberKeyframeTrack('.rotation[y]', [0, 1], [0, 0.1]),
        ]),
      ];
      worldQuestFreightVisualInternalsForTest.setGltf(wagon, {
        scene: plainScene(),
        animations: [],
      } as never);
      worldQuestFreightVisualInternalsForTest.setGltf(horse, {
        scene: horseScene,
        animations: clips,
      } as never);
      worldQuestFreightVisualInternalsForTest.setGltf(crate, {
        scene: plainScene(),
        animations: [],
      } as never);
      const update = vi.spyOn(THREE.AnimationMixer.prototype, 'update');
      const uncache = vi.spyOn(THREE.AnimationMixer.prototype, 'uncacheRoot');
      const disposeSkeleton = vi.spyOn(THREE.Skeleton.prototype, 'dispose');

      const driverRoot = new THREE.Group();
      const driverUpdate = vi.fn();
      const driverDispose = vi.fn(() => driverRoot.removeFromParent());
      vi.mocked(buildCaravanDriver).mockReturnValueOnce({
        root: driverRoot,
        update: driverUpdate,
        dispose: driverDispose,
      });

      const visual = buildMovingWorldQuestFreightWagon(templateId);
      expect(buildCaravanDriver).toHaveBeenLastCalledWith(templateId);
      expect(visual).not.toBeNull();
      expect(driverRoot.parent).toBe(visual?.group);
      const seat = visual?.group.getObjectByName('caravan-driver-seat');
      expect(seat?.position.toArray()).toEqual([0, 0.45, -0.1]);
      if (!seat) throw new Error('Missing driver seat');
      expect(new THREE.Box3().setFromObject(seat).max.y).toBeCloseTo(1.17);
      expect(
        buildWorldQuestFreightWagon()?.group.getObjectByName('caravan-driver-seat'),
      ).toBeUndefined();
      expect(visual?.height).toBe(3);
      visual?.update(0.05, false);
      visual?.update(0.05, true);
      expect(update).toHaveBeenCalledTimes(4);
      expect(driverUpdate).toHaveBeenCalledTimes(2);
      visual?.update(0.05, false, false);
      expect(driverUpdate).toHaveBeenCalledTimes(2);
      visual?.update(0.05, false, true);
      expect(driverUpdate).toHaveBeenLastCalledWith(0.1);
      visual?.dispose();
      visual?.dispose();
      expect(uncache).toHaveBeenCalledTimes(2);
      expect(disposeSkeleton).toHaveBeenCalledTimes(2);
      expect(driverDispose).toHaveBeenCalledTimes(1);
      expect(driverRoot.parent).toBeNull();
    },
  );

  it('keeps the real character and ground-object renderer wiring', () => {
    const freightVisual = readFileSync(
      new URL('../src/render/world_quest_freight_visual.ts', import.meta.url),
      'utf8',
    );
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const presentation = readFileSync(
      new URL('../src/render/quest_entity_presentation.ts', import.meta.url),
      'utf8',
    );
    const questObjects = readFileSync(
      new URL('../src/render/quest_objects.ts', import.meta.url),
      'utf8',
    );
    expect(renderer).toContain('v.worldQuestCarryVisual = syncWorldQuestCarryVisual(');
    expect(renderer).toContain('!e.dead && !e.mountKey && hasWorldQuestDeliveryCargo(e)');
    expect(questObjects).toContain("if (itemId === 'eastbrook_freight_wagon')");
    expect(questObjects).toContain('const freightWagon = buildWorldQuestFreightWagon();');
    expect(questObjects).toContain('if (freightWagon) return freightWagon;');
    expect(renderer).toContain('isQuestCaravanEntity(e)');
    expect(presentation).toContain("e.kind === 'mob' && !!worldQuestCaravanForMob(e.templateId)");
    expect(renderer).toContain('freightCaravanVisual = buildQuestCaravanBody(e);');
    expect(presentation).toContain('buildMovingWorldQuestFreightWagon(e.templateId)');
    expect(renderer).toContain('syncQuestCaravanBody(');
    expect(presentation).toContain('view.freightCaravanVisual?.update(dt, moving, animateDriver);');
    expect(renderer).toContain('v.freightCaravanVisual?.dispose();');
    expect(freightVisual).toContain('clone as cloneSkinned');
    expect(freightVisual).toContain('const horse = cloneSkinned(horseSource);');
    expect(freightVisual).toContain('const mixer = new THREE.AnimationMixer(object);');
    expect(freightVisual).toContain('for (const skeleton of skeletons) skeleton.dispose();');
    expect(freightVisual).toContain('horse.position.set(x, 0, 3.45);');
    expect(freightVisual).toContain(
      'return { group: cloneSkinned(template) as THREE.Group, height: 2.3 };',
    );
  });
});
