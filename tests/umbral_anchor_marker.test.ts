import { describe, expect, it } from 'vitest';
import { UmbralAnchorMarker } from '../src/render/umbral_anchor_marker';
import { Sim } from '../src/sim/sim';

function sceneGraphResources(marker: UmbralAnchorMarker): {
  nodes: object[];
  geometries: object[];
  materials: object[];
  textures: object[];
} {
  const nodes: object[] = [];
  const geometries = new Set<object>();
  const materials = new Set<object>();
  const textures = new Set<object>();
  marker.group.traverse((node) => {
    nodes.push(node);
    const renderable = node as typeof node & {
      geometry?: object;
      material?: Record<string, unknown> | Record<string, unknown>[];
    };
    if (renderable.geometry) geometries.add(renderable.geometry);
    const nodeMaterials = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : [];
    for (const material of nodeMaterials) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (
          value &&
          typeof value === 'object' &&
          'isTexture' in value &&
          value.isTexture === true
        ) {
          textures.add(value);
        }
      }
    }
  });
  return {
    nodes,
    geometries: [...geometries],
    materials: [...materials],
    textures: [...textures],
  };
}

describe('Umbral Anchor marker', () => {
  it('uses one fixed scene graph while following replicated aura state', () => {
    const sim = new Sim({ seed: 809, playerClass: 'warlock', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('affliction')).toBe(true);
    sim.player.resource = sim.player.maxResource;
    const marker = new UmbralAnchorMarker();
    const resources = sceneGraphResources(marker);

    marker.update(sim.player, 0);
    expect(marker.group.visible).toBe(false);

    const origin = { ...sim.player.pos };
    sim.castAbility('umbral_anchor');
    sim.player.pos.x += 6;
    sim.player.prevPos = { ...sim.player.pos };
    for (let frame = 0; frame < 300; frame++) marker.update(sim.player, frame / 60);

    expect(marker.group.visible).toBe(true);
    expect(marker.group.position.toArray()).toEqual([origin.x, origin.y, origin.z]);
    expect(sceneGraphResources(marker)).toEqual(resources);
  });

  it('plays a bounded recall implosion without growing its scene graph', () => {
    const sim = new Sim({ seed: 810, playerClass: 'warlock', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('affliction')).toBe(true);
    sim.player.resource = sim.player.maxResource;
    const marker = new UmbralAnchorMarker();

    sim.castAbility('umbral_anchor');
    marker.update(sim.player, 2);
    const resources = sceneGraphResources(marker);

    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    sim.player.pos.x += 8;
    sim.castAbility('umbral_anchor');
    marker.update(sim.player, 2.2);

    expect(marker.group.visible).toBe(true);
    expect(sceneGraphResources(marker)).toEqual(resources);

    marker.update(sim.player, 3);
    expect(marker.group.visible).toBe(false);
    expect(sceneGraphResources(marker)).toEqual(resources);
  });

  it('freezes painter motion and shader time when reduced motion is enabled', () => {
    const sim = new Sim({ seed: 811, playerClass: 'warlock', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('affliction')).toBe(true);
    sim.player.resource = sim.player.maxResource;
    const marker = new UmbralAnchorMarker();

    sim.castAbility('umbral_anchor');
    marker.update(sim.player, 4, true);
    const firstPose = marker.group.children.map((child) => ({
      position: child.position.toArray(),
      rotation: [child.rotation.x, child.rotation.y, child.rotation.z],
      scale: child.scale.toArray(),
    }));
    const sigil = marker.group.getObjectByName('umbral-anchor-sigil') as
      | { material?: { uniforms?: { uTime?: { value: number } } } }
      | undefined;
    expect(sigil?.material?.uniforms?.uTime?.value).toBe(0);

    marker.update(sim.player, 40, true);
    const secondPose = marker.group.children.map((child) => ({
      position: child.position.toArray(),
      rotation: [child.rotation.x, child.rotation.y, child.rotation.z],
      scale: child.scale.toArray(),
    }));

    expect(secondPose).toEqual(firstPose);
    expect(sigil?.material?.uniforms?.uTime?.value).toBe(0);
  });

  it('drapes the persistent ground layers over sloped terrain once placed', () => {
    const sim = new Sim({ seed: 812, playerClass: 'warlock', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('affliction')).toBe(true);
    sim.player.resource = sim.player.maxResource;
    const origin = { ...sim.player.pos };
    const marker = new UmbralAnchorMarker((x) => origin.y + (x - origin.x) * 0.22);

    sim.castAbility('umbral_anchor');
    marker.update(sim.player, 1);

    const sigil = marker.group.getObjectByName('umbral-anchor-sigil') as
      | {
          geometry?: { getAttribute(name: string): { count: number; getY(index: number): number } };
        }
      | undefined;
    const position = sigil?.geometry?.getAttribute('position');
    if (!position) throw new Error('Expected Umbral Anchor sigil geometry');
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < position.count; index++) {
      minY = Math.min(minY, position.getY(index));
      maxY = Math.max(maxY, position.getY(index));
    }

    expect(maxY - minY).toBeGreaterThan(0.6);
  });

  it('keeps the actionable rune while shedding cosmetic layers on low detail', () => {
    const sim = new Sim({ seed: 813, playerClass: 'warlock', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('affliction')).toBe(true);
    sim.player.resource = sim.player.maxResource;
    const marker = new UmbralAnchorMarker();

    sim.castAbility('umbral_anchor');
    marker.update(sim.player, 1, false, true);

    expect(marker.group.getObjectByName('umbral-anchor-ground-layer')?.visible).toBe(true);
    expect(marker.group.getObjectByName('umbral-anchor-rune-layer')?.visible).toBe(true);
    expect(marker.group.getObjectByName('umbral-anchor-vertical-layer')?.visible).toBe(false);
    expect(marker.group.getObjectByName('umbral-anchor-shard-layer')?.visible).toBe(false);
    expect(marker.group.getObjectByName('umbral-anchor-wisps')?.visible).toBe(false);
  });
});
