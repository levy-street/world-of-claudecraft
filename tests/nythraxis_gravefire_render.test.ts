import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { abilityVfxFullSpecFor } from '../src/render/ability_vfx/encounter_specs';
import { INTERIOR_ENCOUNTER_PREWARM } from '../src/render/interior_encounter_prewarm';
import {
  buildNythraxisGravePrewarmVisual,
  NYTHRAXIS_GRAVE_PREWARM_NAME,
} from '../src/render/nythraxis_grave_flame_visual';
import {
  NYTHRAXIS_GRAVEFIRE_HEAD_CAP_YARDS,
  NYTHRAXIS_GRAVEFIRE_PALETTE,
  nythraxisGravefirePlanInto,
  nythraxisGravefirePulseInto,
} from '../src/render/nythraxis_gravefire_core';
import {
  buildNythraxisGravefireStrip,
  NYTHRAXIS_GRAVEFIRE_STRIP_NAME,
  NYTHRAXIS_GRAVEFIRE_VISUAL_NAME,
  NythraxisGravefireVisuals,
  nythraxisGravefireVisualInternalsForTest,
} from '../src/render/nythraxis_gravefire_visual';
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

describe('Nythraxis Gravefire rendering', () => {
  it('builds one tier-independent actionable strip at the authored width', () => {
    expect(readSource('../src/render/nythraxis_gravefire_visual.ts')).not.toMatch(/from '\.\/gfx'/);
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
      expect(strip.geometry.groups).toHaveLength(
        nythraxisGravefireVisualInternalsForTest.layerCount,
      );
      expect(strip.material[0].color.getHex()).toBe(NYTHRAXIS_GRAVEFIRE_PALETTE.underlay);
      expect(strip.material[1].color.getHex()).toBe(NYTHRAXIS_GRAVEFIRE_PALETTE.core);
      expect(strip.material[2].blending).toBe(THREE.AdditiveBlending);
      expect(strip.material[3].color.getHex()).toBe(NYTHRAXIS_GRAVEFIRE_PALETTE.head);
      expect(strip.material[1].opacity).toBeGreaterThanOrEqual(0.8);

      const positions = strip.geometry.getAttribute('position');
      const underlayStart = 0;
      expect(
        Math.hypot(
          positions.getX(underlayStart) - positions.getX(underlayStart + 1),
          positions.getZ(underlayStart) - positions.getZ(underlayStart + 1),
        ),
      ).toBeCloseTo(LINE.halfWidth * 2, 5);
    }
    expect(stripOf(first).geometry.getAttribute('position').count).toBe(
      stripOf(second).geometry.getAttribute('position').count,
    );
  });

  it('keeps one preallocated geometry and rewrites the moving window in place', () => {
    const scene = new THREE.Scene();
    const visuals = new NythraxisGravefireVisuals(scene, () => 0);
    visuals.sync([LINE]);
    const root = scene.children[0];
    const strip = stripOf(root);
    const geometry = strip.geometry;
    const positions = geometry.getAttribute('position');
    const verticesPerLayer = nythraxisGravefireVisualInternalsForTest.maxSegments * 4;
    const coreStart = nythraxisGravefireVisualInternalsForTest.coreLayer * verticesPerLayer;
    const coreEnd = coreStart + 5 * 4 + 2;
    const headStart = nythraxisGravefireVisualInternalsForTest.headLayer * verticesPerLayer;
    const headEnd = headStart + 4 + 2;
    expect(positions.getX(coreStart)).toBeCloseTo(12, 5);
    expect(positions.getX(coreEnd)).toBeCloseTo(18, 5);
    expect(positions.getX(headStart)).toBeCloseTo(16, 5);
    expect(positions.getX(headEnd)).toBeCloseTo(18, 5);

    visuals.sync([{ ...LINE, tail: 3, head: 10, remaining: 4.8 }]);

    expect(scene.children[0]).toBe(root);
    expect(strip.geometry).toBe(geometry);
    expect(strip.geometry.getAttribute('position')).toBe(positions);
    expect(positions.getX(coreStart)).toBeCloseTo(13, 5);
    expect(positions.getX(coreStart + 6 * 4 + 2)).toBeCloseTo(20, 5);
    expect(positions.getX(headStart)).toBeCloseTo(18, 5);
    expect(positions.getX(headEnd)).toBeCloseTo(20, 5);
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

  it('syncs rows by id and disposes their geometry and materials on removal', () => {
    const scene = new THREE.Scene();
    const visuals = new NythraxisGravefireVisuals(scene, () => 0);
    visuals.syncWorld({ activeNythraxisGravefires: [LINE, { ...LINE, id: '42:gfl:4' }] });
    expect(scene.children).toHaveLength(2);
    const first = scene.children.find((child) => child.userData.gravefireId === LINE.id);
    const strip = stripOf(first as THREE.Object3D);
    const geometryDispose = vi.spyOn(strip.geometry, 'dispose');
    const materialDisposes = strip.material.map((material) => vi.spyOn(material, 'dispose'));

    visuals.syncWorld({ activeNythraxisGravefires: [{ ...LINE, id: '42:gfl:4' }] });

    expect(scene.children).toHaveLength(1);
    expect(geometryDispose).toHaveBeenCalledOnce();
    for (const dispose of materialDisposes) expect(dispose).toHaveBeenCalledOnce();
    visuals.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('holds the pulse midpoint under reduced motion and keeps the strip readable', () => {
    const scene = new THREE.Scene();
    const visuals = new NythraxisGravefireVisuals(scene, () => 0);
    visuals.sync([LINE]);
    const material = stripOf(scene.children[0]).material[1];
    visuals.update(0.5, true);
    const settled = material.opacity;
    visuals.update(0.5, true);
    expect(material.opacity).toBe(settled);
    expect(settled).toBeGreaterThanOrEqual(0.8);
    visuals.update(0.5, false);
    expect(material.opacity).toBeGreaterThanOrEqual(0.8);
  });

  it('is driven by the shared renderer facade and staged at crypt attach', () => {
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
    expect(prewarm.getObjectByName(NYTHRAXIS_GRAVEFIRE_VISUAL_NAME)).toBeDefined();
  });
});

describe('Nythraxis Gravefire core', () => {
  it('projects segment endpoints and the two-yard head cap', () => {
    const out = {
      tail: 0,
      head: 0,
      tailX: 0,
      tailZ: 0,
      headX: 0,
      headZ: 0,
      headCapTail: 0,
      length: 0,
      halfWidth: 0,
    };
    expect(nythraxisGravefirePlanInto(out, LINE)).toEqual({
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

  it('keeps every pulse above the actionable opacity floor', () => {
    const pulse = { core: 0, rim: 0, head: 0 };
    for (const phase of [0, 1, 2, 3, 4, 5, 6]) {
      nythraxisGravefirePulseInto(pulse, phase, false);
      expect(pulse.core).toBeGreaterThanOrEqual(0.8);
    }
    expect(nythraxisGravefirePulseInto(pulse, 1.7, true).core).toBeCloseTo(0.87, 5);
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
