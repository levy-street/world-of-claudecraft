import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { abilityVfxFullSpecFor } from '../src/render/ability_vfx/encounter_specs';
import { INTERIOR_ENCOUNTER_PREWARM } from '../src/render/interior_encounter_prewarm';
import { NYTHRAXIS_FLAME_TONGUE_GEOMETRY } from '../src/render/nythraxis_flame_tongue';
import {
  buildNythraxisGravePrewarmVisual,
  NYTHRAXIS_GRAVE_PREWARM_NAME,
} from '../src/render/nythraxis_grave_flame_visual';
import {
  NYTHRAXIS_GRAVEFIRE_EDGE_WIDTH,
  NYTHRAXIS_GRAVEFIRE_HEAD_CAP_YARDS,
  NYTHRAXIS_GRAVEFIRE_HEAD_TONGUE_BOOST,
  NYTHRAXIS_GRAVEFIRE_LAYER_OPACITY,
  NYTHRAXIS_GRAVEFIRE_PALETTE,
  NYTHRAXIS_GRAVEFIRE_TONGUE_UPDATE_SECONDS,
  NYTHRAXIS_GRAVEFIRE_TONGUES_PER_YARD,
  type NythraxisGravefirePlan,
  type NythraxisGravefireTonguePose,
  nythraxisGravefirePlanInto,
  nythraxisGravefirePulseInto,
  nythraxisGravefireTongueCount,
  nythraxisGravefireTonguePoseInto,
} from '../src/render/nythraxis_gravefire_core';
import {
  buildNythraxisGravefireStrip,
  NYTHRAXIS_GRAVEFIRE_STRIP_NAME,
  NYTHRAXIS_GRAVEFIRE_TONGUES_NAME,
  NYTHRAXIS_GRAVEFIRE_VISUAL_NAME,
  NythraxisGravefireVisuals,
  nythraxisGravefireVisualInternalsForTest,
} from '../src/render/nythraxis_gravefire_visual';
import {
  type ActiveNythraxisGravefire,
  NYTHRAXIS_GRAVEFIRE_CAST_ID,
  NYTHRAXIS_GRAVEFIRE_LENGTH,
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

function tonguesOf(root: THREE.Object3D): THREE.InstancedMesh {
  return root.getObjectByName(NYTHRAXIS_GRAVEFIRE_TONGUES_NAME) as THREE.InstancedMesh;
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

const freshPose = (): NythraxisGravefireTonguePose => ({
  along: 0,
  across: 0,
  y: 0,
  height: 0,
  width: 0,
  yaw: 0,
  visible: false,
});

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

  it('carries a fixed budget of instanced flame tongues on the shared tongue geometry', () => {
    const root = buildNythraxisGravefireStrip(LINE, () => 0);
    const tongues = tonguesOf(root);
    expect(tongues).toBeInstanceOf(THREE.InstancedMesh);
    expect(tongues.count).toBe(nythraxisGravefireTongueCount());
    expect(nythraxisGravefireTongueCount()).toBe(
      NYTHRAXIS_GRAVEFIRE_TONGUES_PER_YARD * NYTHRAXIS_GRAVEFIRE_LENGTH,
    );
    expect(NYTHRAXIS_GRAVEFIRE_TONGUES_PER_YARD).toBe(3);
    expect(tongues.geometry).toBe(NYTHRAXIS_FLAME_TONGUE_GEOMETRY);
    const material = tongues.material as THREE.MeshBasicMaterial;
    expect(material.color.getHex()).toBe(NYTHRAXIS_GRAVEFIRE_PALETTE.tongue);
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.depthWrite).toBe(false);
    // Only the tongues inside the lit window are posed; the rest are scaled away.
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    let visible = 0;
    for (let index = 0; index < tongues.count; index++) {
      tongues.getMatrixAt(index, matrix);
      position.setFromMatrixPosition(matrix);
      scale.setFromMatrixScale(matrix);
      if (scale.y === 0) continue;
      visible++;
      expect(position.x).toBeGreaterThanOrEqual(LINE.x + LINE.tail);
      expect(position.x).toBeLessThanOrEqual(LINE.x + LINE.head);
      expect(Math.abs(position.z - LINE.z)).toBeLessThanOrEqual(LINE.halfWidth);
      expect(position.y).toBeGreaterThan(0);
    }
    expect(visible).toBe((LINE.head - LINE.tail) * NYTHRAXIS_GRAVEFIRE_TONGUES_PER_YARD);
  });

  it('keeps one preallocated geometry and rewrites the moving window in place, tongues following', () => {
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
    const tongues = tonguesOf(root);
    const before = tongues.instanceMatrix.array.slice();

    visuals.sync([{ ...LINE, tail: 3, head: 10, remaining: 4.8 }]);

    expect(scene.children[0]).toBe(root);
    expect(strip.geometry).toBe(geometry);
    expect(strip.geometry.getAttribute('position')).toBe(positions);
    expect(positions.getX(glowStart)).toBeCloseTo(13, 5);
    expect(positions.getX(glowStart + 6 * 4 + 2)).toBeCloseTo(20, 5);
    expect(positions.getX(headStart)).toBeCloseTo(18, 5);
    expect(positions.getX(headEnd)).toBeCloseTo(20, 5);
    // The fire moved with the window in the same sync, not a frame later.
    expect(tongues.instanceMatrix.array).not.toEqual(before);
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

  it('syncs rows by id and disposes each row, sparing the shared tongue geometry', () => {
    const scene = new THREE.Scene();
    const visuals = new NythraxisGravefireVisuals(scene, () => 0);
    visuals.syncWorld({ activeNythraxisGravefires: [LINE, { ...LINE, id: '42:gfl:4' }] });
    expect(scene.children).toHaveLength(2);
    const first = scene.children.find((child) => child.userData.gravefireId === LINE.id);
    const strip = stripOf(first as THREE.Object3D);
    const tongues = tonguesOf(first as THREE.Object3D);
    const geometryDispose = vi.spyOn(strip.geometry, 'dispose');
    const materialDisposes = strip.material.map((material) => vi.spyOn(material, 'dispose'));
    const tongueDispose = vi.spyOn(tongues, 'dispose');
    const tongueMaterialDispose = vi.spyOn(tongues.material as THREE.Material, 'dispose');
    const sharedGeometryDispose = vi.spyOn(NYTHRAXIS_FLAME_TONGUE_GEOMETRY, 'dispose');

    visuals.syncWorld({ activeNythraxisGravefires: [{ ...LINE, id: '42:gfl:4' }] });

    expect(scene.children).toHaveLength(1);
    expect(geometryDispose).toHaveBeenCalledOnce();
    for (const dispose of materialDisposes) expect(dispose).toHaveBeenCalledOnce();
    expect(tongueDispose).toHaveBeenCalledOnce();
    expect(tongueMaterialDispose).toHaveBeenCalledOnce();
    expect(sharedGeometryDispose).not.toHaveBeenCalled();
    visuals.dispose();
    expect(scene.children).toHaveLength(0);
    expect(sharedGeometryDispose).not.toHaveBeenCalled();
  });

  it('flickers the tongues at 20 Hz and holds them still under reduced motion', () => {
    const scene = new THREE.Scene();
    const visuals = new NythraxisGravefireVisuals(scene, () => 0);
    visuals.sync([LINE]);
    const root = scene.children[0];
    const tongues = tonguesOf(root);
    const edge = stripOf(root).material[nythraxisGravefireVisualInternalsForTest.edgeMaterial];
    const start = tongues.instanceMatrix.array.slice();
    // Under the re-pose cadence nothing moves yet; past it the fire flickers.
    visuals.update(NYTHRAXIS_GRAVEFIRE_TONGUE_UPDATE_SECONDS / 2, false);
    expect(tongues.instanceMatrix.array).toEqual(start);
    visuals.update(NYTHRAXIS_GRAVEFIRE_TONGUE_UPDATE_SECONDS, false);
    expect(tongues.instanceMatrix.array).not.toEqual(start);
    // Reduced motion: the pulse and the tongues settle and stay put, edges legible.
    visuals.update(0.5, true);
    const settledEdge = edge.opacity;
    const settled = tongues.instanceMatrix.array.slice();
    visuals.update(0.5, true);
    expect(edge.opacity).toBe(settledEdge);
    expect(tongues.instanceMatrix.array).toEqual(settled);
    expect(settledEdge).toBeGreaterThanOrEqual(0.9);
    visuals.update(0.5, false);
    expect(edge.opacity).toBeGreaterThanOrEqual(0.9);
  });

  it('is driven by the shared renderer facade and staged at crypt attach with its tongues', () => {
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
    expect(line?.getObjectByName(NYTHRAXIS_GRAVEFIRE_TONGUES_NAME)).toBeDefined();
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
    }
    expect(nythraxisGravefirePulseInto(pulse, 1.7, true).edge).toBeCloseTo(0.95, 5);
    expect(NYTHRAXIS_GRAVEFIRE_LAYER_OPACITY.edge).toBeGreaterThan(
      NYTHRAXIS_GRAVEFIRE_LAYER_OPACITY.underlay,
    );
  });

  it('poses every tongue inside its yard and the half-width, hiding the ones outside the window', () => {
    const plan = planOf(LINE);
    const pose = freshPose();
    let visible = 0;
    for (let index = 0; index < nythraxisGravefireTongueCount(); index++) {
      nythraxisGravefireTonguePoseInto(pose, index, plan, 1.3, false, 0.45);
      const yard = Math.floor(index / NYTHRAXIS_GRAVEFIRE_TONGUES_PER_YARD);
      expect(pose.along).toBeGreaterThanOrEqual(yard);
      expect(pose.along).toBeLessThan(yard + 1);
      expect(Math.abs(pose.across)).toBeLessThanOrEqual(plan.halfWidth * 0.8);
      expect(pose.visible).toBe(pose.along >= plan.tail && pose.along <= plan.head);
      expect(pose.height).toBeGreaterThan(0);
      expect(pose.width).toBeGreaterThan(0);
      if (pose.visible) visible++;
    }
    expect(visible).toBe(6 * NYTHRAXIS_GRAVEFIRE_TONGUES_PER_YARD);
  });

  it('burns taller in the head cap, deterministically, and stands still under reduced motion', () => {
    const plan = planOf(LINE);
    // Yard 7 sits in the two-yard head cap; yard 3 does not: same index modulo,
    // same flicker, so the only difference is the boost.
    const capIndex = 7 * NYTHRAXIS_GRAVEFIRE_TONGUES_PER_YARD;
    const bodyIndex = 3 * NYTHRAXIS_GRAVEFIRE_TONGUES_PER_YARD;
    const cap = nythraxisGravefireTonguePoseInto(freshPose(), capIndex, plan, 0, true, 0.45);
    const body = nythraxisGravefireTonguePoseInto(freshPose(), bodyIndex, plan, 0, true, 0.45);
    expect(cap.height / body.height).toBeCloseTo(NYTHRAXIS_GRAVEFIRE_HEAD_TONGUE_BOOST, 6);
    // Deterministic: the same index gives the same spot.
    const again = nythraxisGravefireTonguePoseInto(freshPose(), capIndex, plan, 0, true, 0.45);
    expect(again).toEqual(cap);
    // Reduced motion: no phase dependence at all.
    const later = nythraxisGravefireTonguePoseInto(freshPose(), capIndex, plan, 4.2, true, 0.45);
    expect(later).toEqual(cap);
    // Live: the flicker and the spin move with the phase, the spot does not.
    const live0 = nythraxisGravefireTonguePoseInto(freshPose(), capIndex, plan, 0, false, 0.45);
    const live1 = nythraxisGravefireTonguePoseInto(freshPose(), capIndex, plan, 1, false, 0.45);
    expect(live1.along).toBe(live0.along);
    expect(live1.across).toBe(live0.across);
    expect(live1.yaw).not.toBe(live0.yaw);
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
