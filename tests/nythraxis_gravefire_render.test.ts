import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { abilityVfxFullSpecFor } from '../src/render/ability_vfx/encounter_specs';
import { getFlameTex } from '../src/render/ignivar_fire_vfx';
import { INTERIOR_ENCOUNTER_PREWARM } from '../src/render/interior_encounter_prewarm';
import {
  buildNythraxisGravePrewarmVisual,
  NYTHRAXIS_GRAVE_PREWARM_NAME,
} from '../src/render/nythraxis_grave_flame_visual';
import {
  NYTHRAXIS_GRAVEFIRE_EDGE_WIDTH,
  NYTHRAXIS_GRAVEFIRE_GROUND_LIFT,
  NYTHRAXIS_GRAVEFIRE_HEAD_CAP_YARDS,
  NYTHRAXIS_GRAVEFIRE_HEAD_TONGUE_BOOST,
  NYTHRAXIS_GRAVEFIRE_LAYER_OPACITY,
  NYTHRAXIS_GRAVEFIRE_PALETTE,
  type NythraxisGravefirePlan,
  nythraxisGravefirePlanInto,
  nythraxisGravefirePulseInto,
} from '../src/render/nythraxis_gravefire_core';
import {
  buildNythraxisGravefireStrip,
  NYTHRAXIS_GRAVEFIRE_FIRE_NAME,
  NYTHRAXIS_GRAVEFIRE_STRIP_NAME,
  NYTHRAXIS_GRAVEFIRE_VISUAL_NAME,
  NythraxisGravefireVisuals,
  nythraxisGravefireVisualInternalsForTest,
} from '../src/render/nythraxis_gravefire_visual';
import type { NythraxisSoftFire } from '../src/render/nythraxis_soft_fire';
import {
  NYTHRAXIS_SOFT_FIRE_RAMPS,
  nythraxisGravefireSpotInto,
  nythraxisGravefireSpriteCount,
} from '../src/render/nythraxis_soft_fire_core';
import {
  type ActiveNythraxisGravefire,
  NYTHRAXIS_GRAVEFIRE_CAST_ID,
} from '../src/sim/nythraxis_gravefire';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

const LINE: ActiveNythraxisGravefire = {
  id: '42:gfl:3',
  sourceId: 42,
  x: 10,
  z: 20,
  dirX: 1,
  dirZ: 0,
  tail: 2,
  head: 8,
  halfWidth: 1.5,
  remaining: 5,
};

const readSource = (path: string): string =>
  codeWithoutLineComments(readFileSync(new URL(path, import.meta.url), 'utf8'));

function stripOf(
  root: THREE.Object3D,
): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]> {
  return root.getObjectByName(NYTHRAXIS_GRAVEFIRE_STRIP_NAME) as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshBasicMaterial[]
  >;
}

function fireMeshOf(
  root: THREE.Object3D,
): THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> {
  return root.getObjectByName(NYTHRAXIS_GRAVEFIRE_FIRE_NAME) as THREE.Mesh<
    THREE.InstancedBufferGeometry,
    THREE.ShaderMaterial
  >;
}

function fireOf(root: THREE.Object3D): NythraxisSoftFire {
  return root.userData.fire as NythraxisSoftFire;
}

/** Sprites whose fixed spot lies inside the lit window, straight from the core. */
function litSpriteCount(row: ActiveNythraxisGravefire): number {
  const spot = { along: 0, across: 0 };
  let lit = 0;
  for (let index = 0; index < nythraxisGravefireSpriteCount(); index++) {
    nythraxisGravefireSpotInto(spot, index, row.halfWidth);
    if (spot.along >= row.tail && spot.along <= row.head) lit++;
  }
  return lit;
}

function planOf(row: ActiveNythraxisGravefire): NythraxisGravefirePlan {
  return nythraxisGravefirePlanInto(
    {
      tail: 0,
      head: 0,
      tailX: 0,
      tailZ: 0,
      headX: 0,
      headZ: 0,
      headCapTail: 0,
      length: 0,
      halfWidth: 0,
    },
    row,
  );
}

describe('Nythraxis Gravefire rendering', () => {
  it('dresses the actionable footprint as an ember bed with legible edges, never a flat stripe', () => {
    expect(readSource('../src/render/nythraxis_gravefire_visual.ts')).not.toMatch(/from '\.\/gfx'/);
    const internals = nythraxisGravefireVisualInternalsForTest;
    const first = buildNythraxisGravefireStrip(LINE, () => 3);
    const second = buildNythraxisGravefireStrip(LINE, () => 3);
    for (const root of [first, second]) {
      expect(root.name).toBe(NYTHRAXIS_GRAVEFIRE_VISUAL_NAME);
      expect(root.userData).toMatchObject({
        renderCategory: 'ui3d',
        actionable: true,
        gravefireId: LINE.id,
        sourceId: LINE.sourceId,
        halfWidth: LINE.halfWidth,
      });
      const strip = stripOf(root);
      expect(strip.userData).toMatchObject({ renderCategory: 'ui3d', actionable: true });
      expect(strip.geometry.groups).toHaveLength(internals.layerCount);
      const underlay = strip.material[internals.underlayMaterial];
      const glow = strip.material[internals.glowMaterial];
      const edge = strip.material[internals.edgeMaterial];
      const head = strip.material[internals.headMaterial];
      expect(underlay.color.getHex()).toBe(NYTHRAXIS_GRAVEFIRE_PALETTE.underlay);
      expect(underlay.blending).toBe(THREE.NormalBlending);
      // The inside is scorched ground, not paint: the underlay and glow sit well
      // below full opacity while the edges (the footprint the sim burns) stay bright.
      expect(underlay.opacity).toBeLessThanOrEqual(0.6);
      expect(glow.color.getHex()).toBe(NYTHRAXIS_GRAVEFIRE_PALETTE.glow);
      expect(glow.opacity).toBeLessThanOrEqual(0.35);
      expect(glow.blending).toBe(THREE.AdditiveBlending);
      expect(edge.color.getHex()).toBe(NYTHRAXIS_GRAVEFIRE_PALETTE.edge);
      expect(edge.opacity).toBeGreaterThanOrEqual(0.9);
      expect(head.color.getHex()).toBe(NYTHRAXIS_GRAVEFIRE_PALETTE.head);

      const positions = strip.geometry.getAttribute('position');
      const verticesPerLayer = internals.maxSegments * 4;
      // The underlay spans the full authored width...
      expect(
        Math.hypot(positions.getX(0) - positions.getX(1), positions.getZ(0) - positions.getZ(1)),
      ).toBeCloseTo(LINE.halfWidth * 2, 5);
      // ...and each edge line is a thin band at the very edge of it.
      const leftEdge = internals.leftEdgeLayer * verticesPerLayer;
      expect(
        Math.hypot(
          positions.getX(leftEdge) - positions.getX(leftEdge + 1),
          positions.getZ(leftEdge) - positions.getZ(leftEdge + 1),
        ),
      ).toBeCloseTo(NYTHRAXIS_GRAVEFIRE_EDGE_WIDTH, 5);
      expect(Math.abs(positions.getZ(leftEdge) - LINE.z)).toBeCloseTo(LINE.halfWidth, 5);
    }
    expect(stripOf(first).geometry.getAttribute('position').count).toBe(
      stripOf(second).geometry.getAttribute('position').count,
    );
  });

  it('burns a violet soft fire over the strip: one sprite draw, windowed to the lit yards', () => {
    const root = buildNythraxisGravefireStrip(LINE, () => 3);
    const mesh = fireMeshOf(root);
    const fire = fireOf(root);
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(mesh).toBe(fire.mesh);
    expect(mesh.geometry.instanceCount).toBe(nythraxisGravefireSpriteCount());
    expect(mesh.material.blending).toBe(THREE.AdditiveBlending);
    expect(mesh.material.depthWrite).toBe(false);
    expect(mesh.renderOrder).toBeGreaterThan(stripOf(root).renderOrder);
    expect((mesh.material.uniforms.uBody.value as THREE.Color).getHex()).toBe(
      NYTHRAXIS_SOFT_FIRE_RAMPS.gravefire.body,
    );
    expect(mesh.material.uniforms.uOpacity.value).toBe(NYTHRAXIS_GRAVEFIRE_LAYER_OPACITY.tongue);
    // The lit window and the head cap ride two uniforms, not a re-upload.
    const plan = planOf(LINE);
    expect(mesh.material.uniforms.uTail.value).toBe(plan.tail);
    expect(mesh.material.uniforms.uHead.value).toBe(plan.head);
    expect(mesh.material.uniforms.uHeadCapTail.value).toBe(plan.headCapTail);
    expect(mesh.material.uniforms.uHeadBoost.value).toBe(NYTHRAXIS_GRAVEFIRE_HEAD_TONGUE_BOOST);
    // Only the sprites the window reaches are placed, on the ground, inside the footprint.
    const spots = mesh.geometry.getAttribute('iSpot');
    const placed = (root.userData.visual as { spotPlaced: Uint8Array }).spotPlaced;
    let placedCount = 0;
    for (let index = 0; index < fire.count; index++) {
      if (placed[index] === 0) continue;
      placedCount++;
      const along = fire.spotAlong(index);
      expect(along).toBeGreaterThanOrEqual(LINE.tail);
      expect(along).toBeLessThanOrEqual(LINE.head);
      expect(spots.getX(index)).toBeCloseTo(LINE.x + along, 5);
      expect(Math.abs(spots.getZ(index) - LINE.z)).toBeLessThanOrEqual(LINE.halfWidth);
      expect(spots.getY(index)).toBeCloseTo(3 + NYTHRAXIS_GRAVEFIRE_GROUND_LIFT, 5);
    }
    expect(placedCount).toBe(litSpriteCount(LINE));
    expect(placedCount).toBeGreaterThan(0);
    expect(placedCount).toBeLessThan(fire.count);
    // The fire's cull bound covers the strip plus the sprites' rise.
    const stripSphere = stripOf(root).geometry.boundingSphere as THREE.Sphere;
    expect(mesh.geometry.boundingSphere?.center.equals(stripSphere.center)).toBe(true);
    expect(mesh.geometry.boundingSphere?.radius).toBeGreaterThan(stripSphere.radius);
  });

  it('keeps one preallocated geometry and rewrites the moving window in place, fire following', () => {
    const scene = new THREE.Scene();
    const visuals = new NythraxisGravefireVisuals(scene, () => 0);
    visuals.sync([LINE]);
    const root = scene.children[0];
    const strip = stripOf(root);
    const geometry = strip.geometry;
    const positions = geometry.getAttribute('position');
    const internals = nythraxisGravefireVisualInternalsForTest;
    const verticesPerLayer = internals.maxSegments * 4;
    const glowStart = internals.glowLayer * verticesPerLayer;
    const glowEnd = glowStart + 5 * 4 + 2;
    const headStart = internals.headLayer * verticesPerLayer;
    const headEnd = headStart + 4 + 2;
    expect(positions.getX(glowStart)).toBeCloseTo(12, 5);
    expect(positions.getX(glowEnd)).toBeCloseTo(18, 5);
    expect(positions.getX(headStart)).toBeCloseTo(16, 5);
    expect(positions.getX(headEnd)).toBeCloseTo(18, 5);
    const mesh = fireMeshOf(root);
    const placed = (root.userData.visual as { spotPlaced: Uint8Array }).spotPlaced;
    const placedBefore = placed.reduce((sum, flag) => sum + flag, 0);

    const moved = { ...LINE, tail: 3, head: 10, remaining: 4.8 };
    visuals.sync([moved]);

    expect(scene.children[0]).toBe(root);
    expect(strip.geometry).toBe(geometry);
    expect(strip.geometry.getAttribute('position')).toBe(positions);
    expect(positions.getX(glowStart)).toBeCloseTo(13, 5);
    expect(positions.getX(glowStart + 6 * 4 + 2)).toBeCloseTo(20, 5);
    expect(positions.getX(headStart)).toBeCloseTo(18, 5);
    expect(positions.getX(headEnd)).toBeCloseTo(20, 5);
    // The fire moved with the window in the same sync, not a frame later: the
    // window uniforms follow and the newly lit yards' sprites are placed, while
    // the sprites already placed keep their spot (a spot never moves).
    expect(fireMeshOf(root)).toBe(mesh);
    expect(mesh.material.uniforms.uTail.value).toBe(3);
    expect(mesh.material.uniforms.uHead.value).toBe(10);
    const placedAfter = placed.reduce((sum, flag) => sum + flag, 0);
    expect(placedAfter).toBeGreaterThan(placedBefore);
    expect(placedAfter).toBe(
      litSpriteCount(moved) +
        (litSpriteCount(LINE) - litSpriteCount({ ...LINE, tail: 3, head: 8 })),
    );
  });

  it('caches one-yard ground samples until the head reaches a new yard', () => {
    const scene = new THREE.Scene();
    const groundY = vi.fn((x: number) => x * 0.1);
    const visuals = new NythraxisGravefireVisuals(scene, groundY);
    const early = { ...LINE, tail: 0, head: 2.4 };
    visuals.sync([early]);
    const initialCalls = groundY.mock.calls.length;
    expect(initialCalls).toBe(4);

    visuals.sync([{ ...early, head: 2.8 }]);
    expect(groundY).toHaveBeenCalledTimes(initialCalls);
    visuals.sync([{ ...early, head: 3.2 }]);
    expect(groundY).toHaveBeenCalledTimes(initialCalls + 1);
  });

  it('syncs rows by id and disposes each row, sparing the shared flame atlas', () => {
    const scene = new THREE.Scene();
    const visuals = new NythraxisGravefireVisuals(scene, () => 0);
    visuals.syncWorld({ activeNythraxisGravefires: [LINE, { ...LINE, id: '42:gfl:4' }] });
    expect(scene.children).toHaveLength(2);
    const first = scene.children.find((child) => child.userData.gravefireId === LINE.id);
    const strip = stripOf(first as THREE.Object3D);
    const fire = fireOf(first as THREE.Object3D);
    const geometryDispose = vi.spyOn(strip.geometry, 'dispose');
    const materialDisposes = strip.material.map((material) => vi.spyOn(material, 'dispose'));
    const fireGeometryDispose = vi.spyOn(fire.geometry, 'dispose');
    const fireMaterialDispose = vi.spyOn(fire.material, 'dispose');
    const atlasDispose = vi.spyOn(getFlameTex(), 'dispose');

    visuals.syncWorld({ activeNythraxisGravefires: [{ ...LINE, id: '42:gfl:4' }] });

    expect(scene.children).toHaveLength(1);
    expect(geometryDispose).toHaveBeenCalledOnce();
    for (const dispose of materialDisposes) expect(dispose).toHaveBeenCalledOnce();
    expect(fireGeometryDispose).toHaveBeenCalledOnce();
    expect(fireMaterialDispose).toHaveBeenCalledOnce();
    expect(atlasDispose).not.toHaveBeenCalled();
    visuals.dispose();
    expect(scene.children).toHaveLength(0);
    expect(atlasDispose).not.toHaveBeenCalled();
  });

  it('runs the fire clock every frame and holds it under reduced motion, edges legible', () => {
    const scene = new THREE.Scene();
    const visuals = new NythraxisGravefireVisuals(scene, () => 0);
    visuals.sync([LINE]);
    const root = scene.children[0];
    const mesh = fireMeshOf(root);
    const edge = stripOf(root).material[nythraxisGravefireVisualInternalsForTest.edgeMaterial];
    expect(mesh.material.uniforms.uTime.value).toBe(0);
    visuals.update(0.25, false);
    expect(mesh.material.uniforms.uTime.value).toBeCloseTo(0.25, 9);
    visuals.update(0.25, false);
    expect(mesh.material.uniforms.uTime.value).toBeCloseTo(0.5, 9);
    // Reduced motion: the pulse settles and the fire clock holds, edges legible.
    visuals.update(0.5, true);
    const settledEdge = edge.opacity;
    const heldTime = mesh.material.uniforms.uTime.value;
    visuals.update(0.5, true);
    expect(edge.opacity).toBe(settledEdge);
    expect(mesh.material.uniforms.uTime.value).toBe(heldTime);
    expect(settledEdge).toBeGreaterThanOrEqual(0.9);
    visuals.update(0.5, false);
    expect(edge.opacity).toBeGreaterThanOrEqual(0.9);
    expect(mesh.material.uniforms.uTime.value).toBeGreaterThan(heldTime);
  });

  it('is driven by the shared renderer facade and staged at crypt attach with its fire', () => {
    const renderer = readSource('../src/render/renderer.ts');
    expect(
      renderer.match(/this\.nythraxisMechanicVisuals\?\.syncWorld\(this\.sim\);/g),
    ).toHaveLength(2);
    expect(renderer.match(/this\.nythraxisMechanicVisuals\?\.dispose\(\)/g)).toHaveLength(2);
    const facade = readSource('../src/render/nythraxis_mechanic_visuals.ts');
    expect(facade).toContain('this.gravefires.syncWorld(world)');
    expect(facade).toContain('this.gravefires.dispose()');
    expect(INTERIOR_ENCOUNTER_PREWARM.nythraxis.nythraxisGraveVisuals).toBe(true);
    const pass = readSource('../src/render/interior_encounter_prewarm_pass.ts');
    expect(pass).toContain('buildNythraxisGravePrewarmVisual()');
    const prewarm = buildNythraxisGravePrewarmVisual();
    expect(prewarm.name).toBe(NYTHRAXIS_GRAVE_PREWARM_NAME);
    const line = prewarm.getObjectByName(NYTHRAXIS_GRAVEFIRE_VISUAL_NAME);
    expect(line).toBeDefined();
    expect(line?.getObjectByName(NYTHRAXIS_GRAVEFIRE_FIRE_NAME)).toBeDefined();
  });
});

describe('Nythraxis Gravefire core', () => {
  it('projects segment endpoints and the two-yard head cap', () => {
    const out = planOf(LINE);
    expect(out).toEqual({
      tail: 2,
      head: 8,
      tailX: 12,
      tailZ: 20,
      headX: 18,
      headZ: 20,
      headCapTail: LINE.head - NYTHRAXIS_GRAVEFIRE_HEAD_CAP_YARDS,
      length: 6,
      halfWidth: 1.5,
    });
    expect(nythraxisGravefirePlanInto(out, { ...LINE, tail: 7.2 }).headCapTail).toBeCloseTo(7.2, 8);
  });

  it('keeps the legible edges above the actionable opacity floor through the pulse', () => {
    const pulse = { edge: 0, glow: 0, head: 0, tongue: 0 };
    for (const phase of [0, 1, 2, 3, 4, 5, 6]) {
      nythraxisGravefirePulseInto(pulse, phase, false);
      expect(pulse.edge).toBeGreaterThanOrEqual(0.9);
      expect(pulse.glow).toBeLessThanOrEqual(0.4);
      expect(pulse.tongue).toBeGreaterThan(0.5);
    }
    expect(nythraxisGravefirePulseInto(pulse, 1.7, true).edge).toBeCloseTo(0.95, 5);
    expect(NYTHRAXIS_GRAVEFIRE_LAYER_OPACITY.edge).toBeGreaterThan(
      NYTHRAXIS_GRAVEFIRE_LAYER_OPACITY.underlay,
    );
    expect(NYTHRAXIS_GRAVEFIRE_HEAD_TONGUE_BOOST).toBeGreaterThan(1);
  });

  it('registers Gravefire as a shadow beam and line cue', () => {
    expect(abilityVfxFullSpecFor(NYTHRAXIS_GRAVEFIRE_CAST_ID)).toMatchObject({
      archetype: 'beam',
      palette: 'shadow',
      filler: true,
      beam: { dur: 0.8, ticks: 1 },
    });
  });
});
