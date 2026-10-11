import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PublicTraceReader } from '../src/render/world_quest_public_trace_core';
import { WorldQuestPublicTraceVisual } from '../src/render/world_quest_public_trace_visual';
import { worldQuestTraceMaterials } from '../src/render/world_quest_trace_materials';
import type { NearbyWorldQuestTrace } from '../src/sim/world_quest_trace_public';

function setup() {
  const root = new THREE.Group();
  const visual = new WorldQuestPublicTraceVisual(root, () => 0);
  const world: PublicTraceReader = {
    nearbyWorldQuestTraces: [],
    player: { id: 1, pos: { x: 172, y: 0, z: -28 } },
    entities: new Map(
      [2, 3, 4, 5].map((id) => [
        id,
        {
          id,
          kind: 'player' as const,
          name: `Writer${id}`,
          hostile: false,
          dead: false,
          pos: { x: 172, y: 0, z: -28 },
        },
      ]),
    ),
  };
  const trace = (pid = 2): NearbyWorldQuestTrace => ({
    pid,
    name: `Writer${pid}`,
    questId: 'wq_eastbrook_calligraphy',
    shapeIndex: 2,
    variant: 'star',
    phase: 'drawing',
    trail: [
      { x: 166, z: -31 },
      { x: 167, z: -31 },
    ],
  });
  const meshes = visual.group.children as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshBasicMaterial
  >[];
  return { visual, world, trace, meshes };
}
describe('public calligraphy renderer', () => {
  it('does not upload equivalent replacement snapshots, but notices a changed interior sample', () => {
    const { visual, world, trace, meshes } = setup();
    world.nearbyWorldQuestTraces = [
      {
        ...trace(),
        trail: [
          { x: 166, z: -31 },
          { x: 166.5, z: -31 },
          { x: 167, z: -31 },
        ],
      },
    ];
    visual.update(world);
    const attribute = meshes[0].geometry.getAttribute('position') as THREE.BufferAttribute;
    const version = attribute.version;
    world.nearbyWorldQuestTraces = [
      {
        ...world.nearbyWorldQuestTraces[0],
        trail: [
          { x: 166, z: -31 },
          { x: 166.5, z: -31 },
          { x: 167, z: -31 },
        ],
      },
    ];
    visual.update(world);
    expect(attribute.version).toBe(version);
    world.nearbyWorldQuestTraces = [
      {
        ...world.nearbyWorldQuestTraces[0],
        trail: [
          { x: 166, z: -31 },
          { x: 166.5, z: -30.8 },
          { x: 167, z: -31 },
        ],
      },
    ];
    visual.update(world);
    expect(attribute.version).toBeGreaterThan(version);
  });
  it('has four reusable blue-only slots without remote outlines or navigation markers', () => {
    const { visual, world, trace, meshes } = setup();
    expect(meshes).toHaveLength(8);
    const geometries = meshes.map((m) => m.geometry);
    const arrays = geometries.map((g) => g.getAttribute('position').array);
    world.nearbyWorldQuestTraces = [2, 3, 4, 5].map((pid) => trace(pid));
    visual.update(world);
    expect(meshes.filter((m) => m.visible)).toHaveLength(4);
    for (const mesh of meshes) {
      expect([
        worldQuestTraceMaterials().publicBlue,
        worldQuestTraceMaterials().completionBlue,
      ]).toContain(mesh.material);
      expect(mesh.name).not.toMatch(/gold|corner|sparkle|guide/);
      expect(Object.keys(mesh.geometry.attributes)).toEqual(['position']);
    }
    expect(worldQuestTraceMaterials().publicBlue.opacity).toBeLessThan(
      worldQuestTraceMaterials().blue.opacity,
    );
    world.nearbyWorldQuestTraces = [trace(5), trace(2)];
    visual.update(world);
    for (let i = 0; i < 8; i++) {
      expect(meshes[i].geometry).toBe(geometries[i]);
      expect(geometries[i].getAttribute('position').array).toBe(arrays[i]);
    }
    world.nearbyWorldQuestTraces = [];
    visual.update(world);
    expect(meshes.every((m) => !m.visible && m.geometry.drawRange.count === 0)).toBe(true);
  });
  it('shows a brief full cyan glyph only for authoritative success, then clears on removal', () => {
    const { visual, world, trace, meshes } = setup();
    world.nearbyWorldQuestTraces = [trace()];
    visual.update(world);
    expect(meshes[1].visible).toBe(false);
    world.nearbyWorldQuestTraces = [
      { ...trace(), phase: 'success', score: 97, rating: 'gold', expiresAt: 5 },
    ];
    visual.update(world);
    expect(meshes[1].visible).toBe(true);
    expect(meshes[1].geometry.drawRange.count).toBeGreaterThan(meshes[0].geometry.drawRange.count);
    expect(meshes[1].material).toBe(worldQuestTraceMaterials().completionBlue);
    world.nearbyWorldQuestTraces = [];
    visual.update(world);
    expect(meshes[1].visible).toBe(false);
  });
  it('changes cached round geometry even for the same owner and clears successful glyph on drawing', () => {
    const { visual, world, trace, meshes } = setup();
    world.nearbyWorldQuestTraces = [{ ...trace(), shapeIndex: 0 }];
    visual.update(world);
    const position = meshes[1].geometry.getAttribute('position') as THREE.BufferAttribute;
    const before = position.version;
    world.nearbyWorldQuestTraces = [{ ...trace(), shapeIndex: 2, variant: 'spiral' }];
    visual.update(world);
    expect(position.version).toBeGreaterThan(before);
    expect(meshes[1].visible).toBe(false);
  });
  it('contains no tier knobs, local timers or remote navigation constructors', () => {
    for (const file of ['world_quest_public_trace_core.ts', 'world_quest_public_trace_visual.ts']) {
      const source = readFileSync(new URL(`../src/render/${file}`, import.meta.url), 'utf8');
      expect(source).not.toMatch(
        /\b(?:GFX|gfxTierAtLeast|setTimeout|setInterval|requestAnimationFrame|traceGuidanceInto|writeTraceSparkles)\b/,
      );
    }
  });
});
