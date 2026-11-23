import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GFX, gfxInternalsForTest } from '../src/render/gfx';
import {
  HIGHWATCH_TOWN_ROOT_NAME,
  highwatchTownInternalsForTest,
  isHighwatchRebuildBuilding,
} from '../src/render/highwatch_town';
import { setDitherFadeEnabledForTest } from '../src/render/occluder_dither_fade';
import { createRevealGateCore } from '../src/render/reveal_gate_core';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { HIGHWATCH_LAYOUT } from '../src/sim/highwatch_layout';
import type { WorldContent } from '../src/sim/types';

// Highwatch's view is the shared placed-town view (render/placed_town_buildings.ts)
// over HIGHWATCH_LAYOUT: five painted buildings and the adventurers' guild, each its
// own fade target and reveal root, gated like the other towns' buildings.

const KIT = highwatchTownInternalsForTest.kit;
const REVEAL_KEY = 'highwatch-town-static';

beforeEach(() => setDitherFadeEnabledForTest(false));

const ORIGINAL_GFX = {
  standardMaterials: GFX.standardMaterials,
  dynamicShadows: GFX.dynamicShadows,
};

afterEach(() => {
  gfxInternalsForTest.overrideSettings(ORIGINAL_GFX);
  setActiveWorldContent(null);
});

/** A painted model stand-in: a footing below its ground line, a shell off
 *  the origin, one interior mesh (the shape the Fenbridge suite stands). */
function placedSourceAsset(): THREE.Group {
  const source = new THREE.Group();
  const walls = new THREE.MeshStandardMaterial({ color: 0x8899aa, map: new THREE.Texture() });
  walls.name = 'PlacedWalls';
  const shell = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 4).translate(1, 1.75, 0), walls);
  shell.name = 'shell';
  source.add(shell);
  const interior = new THREE.Group();
  interior.name = 'G_INT_furniture';
  const props = new THREE.MeshStandardMaterial({ color: 0x664422 });
  const table = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), props);
  interior.add(table);
  source.add(interior);
  return source;
}

function fixtureSources(): Map<string, THREE.Object3D> {
  return new Map(KIT.urls.map((url) => [url, placedSourceAsset()]));
}

function buildingGroup(root: THREE.Object3D, id: string): THREE.Object3D {
  const group = root.getObjectByName(`highwatchBuilding:${id}`);
  if (!group) throw new Error(`renderer fixture lost ${id}`);
  return group;
}

describe('the Highwatch town view', () => {
  it('stands the five painted buildings and the guild as individual fade targets and reveal roots', () => {
    gfxInternalsForTest.overrideSettings({ standardMaterials: false, dynamicShadows: false });
    const view = KIT.buildFromSources(fixtureSources(), () => 9, true);
    expect(view.group.name).toBe(HIGHWATCH_TOWN_ROOT_NAME);
    expect(view.group.userData.layoutId).toBe(HIGHWATCH_LAYOUT.id);
    expect(view.group.userData.buildingIds).toEqual(HIGHWATCH_LAYOUT.buildings.map((b) => b.id));
    expect(view.group.userData.buildingFadeTargetCount).toBe(6);
    expect(KIT.urls).toEqual(HIGHWATCH_LAYOUT.buildings.map((b) => b.assetId));
    for (const building of HIGHWATCH_LAYOUT.buildings) {
      const group = buildingGroup(view.group, building.id);
      expect(view.staticRevealRoots()).toContain(group);
      // stood at the model's own anchor, turned as the record says
      expect(group.position.x).toBeCloseTo(building.placement.x, 9);
      expect(group.position.z).toBeCloseTo(building.placement.z, 9);
      expect(group.rotation.y).toBeCloseTo(building.placement.rotation, 9);
    }
    expect(view.staticRevealRoots()).toHaveLength(6);
  });

  it('holds the buildings on a cold approach and reveals each as its own compile lands', () => {
    gfxInternalsForTest.overrideSettings({ standardMaterials: false, dynamicShadows: false });
    const view = KIT.buildFromSources(fixtureSources(), () => 9, true);
    const gate = createRevealGateCore((key) => gate.noteRoots(key, view.staticRevealRoots()));
    view.setRevealGate(gate);
    const hub = HIGHWATCH_LAYOUT.hub.center;
    const approachX = hub.x + KIT.cullRadius + 20;
    const [first, second] = HIGHWATCH_LAYOUT.buildings;
    const firstGroup = buildingGroup(view.group, first.id);
    const secondGroup = buildingGroup(view.group, second.id);
    view.update(approachX, 12, hub.z, approachX - 5, 12, hub.z, 400, 0.05);
    expect(gate.state(REVEAL_KEY)).toBe('compiling');
    expect(firstGroup.visible).toBe(false);
    expect(secondGroup.visible).toBe(false);
    gate.settleRoot(REVEAL_KEY, firstGroup);
    view.update(approachX, 12, hub.z, approachX - 5, 12, hub.z, 400, 0.05);
    expect(firstGroup.visible).toBe(true);
    expect(secondGroup.visible).toBe(false);
    // a revealed root is never taken back while the key is still held
    view.update(approachX, 12, hub.z, approachX - 5, 12, hub.z, 400, 0.05);
    expect(firstGroup.visible).toBe(true);
  });

  it('draws every building with no gate, and none past the fog', () => {
    gfxInternalsForTest.overrideSettings({ standardMaterials: false, dynamicShadows: false });
    const view = KIT.buildFromSources(fixtureSources(), () => 9, true);
    const hub = HIGHWATCH_LAYOUT.hub.center;
    view.update(hub.x + 60, 14, hub.z, hub.x + 55, 12, hub.z, 400, 0.05);
    for (const building of HIGHWATCH_LAYOUT.buildings) {
      expect(buildingGroup(view.group, building.id).visible, building.id).toBe(true);
    }
    view.update(hub.x + 900, 14, hub.z, hub.x + 895, 12, hub.z, 200, 0.05);
    for (const building of HIGHWATCH_LAYOUT.buildings) {
      expect(buildingGroup(view.group, building.id).visible, building.id).toBe(false);
    }
  });

  it('stands its buildings down for a document that owns them as placements', () => {
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      promotedScenery: { highwatchTown: true },
    } as WorldContent);
    const view = KIT.buildFromSources(fixtureSources(), () => 9, true);
    expect(view.group.userData.buildingIds).toEqual([]);
    expect(view.staticRevealRoots()).toEqual([]);
    // the other towns' family does not reach Highwatch's buildings
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      promotedScenery: { authoredTowns: true },
    } as WorldContent);
    const kept = KIT.buildFromSources(fixtureSources(), () => 9, true);
    expect(kept.group.userData.buildingIds).toHaveLength(6);
  });

  it('holds every building in the town circle: the smithy past its far corner in thick fog', () => {
    gfxInternalsForTest.overrideSettings({ standardMaterials: false, dynamicShadows: false });
    const view = KIT.buildFromSources(fixtureSources(), () => 9, true);
    const hub = HIGHWATCH_LAYOUT.hub.center;
    // every reach corner lies inside the circle the fog test and the reveal read
    for (const building of HIGHWATCH_LAYOUT.buildings) {
      const { center, halfWidth, halfDepth, rotation } = building.reach;
      for (const [sx, sz] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const lx = sx * halfWidth;
        const lz = sz * halfDepth;
        const x = center.x + lx * Math.cos(rotation) + lz * Math.sin(rotation);
        const z = center.z - lx * Math.sin(rotation) + lz * Math.cos(rotation);
        expect(Math.hypot(x - hub.x, z - hub.z), building.id).toBeLessThan(KIT.cullRadius);
      }
    }
    // the smithy stands on its terrace about 44 yards out: a camera just past
    // its far corner, in fog 20 yards deep, is 57 yards from the hub, where a
    // circle of the hub ring plus its margin (32) answered hidden
    const smithy = HIGHWATCH_LAYOUT.buildings.find((b) => b.id === 'highwatch_smithy');
    if (!smithy) throw new Error('missing smithy');
    const camX = smithy.reach.center.x + smithy.reach.halfWidth + 0.7;
    const camZ = smithy.reach.center.z + smithy.reach.halfDepth + 1.5;
    expect(Math.hypot(camX - hub.x, camZ - hub.z)).toBeGreaterThan(20 + 32);
    view.update(camX, 12, camZ, camX - 1, 11, camZ - 1, 20, 0.05);
    expect(buildingGroup(view.group, smithy.id).visible).toBe(true);
  });

  it('builds an empty root for a world that does not carry the town', () => {
    const view = KIT.buildFromSources(new Map(), () => 0, false);
    expect(view.group.children).toHaveLength(0);
    expect(view.staticRevealRoots()).toEqual([]);
    expect(() => view.update(0, 0, 0, 0, 0, 0, 100, 0.05)).not.toThrow();
  });

  it('matches its records by stable id, and the props view skips exactly those', () => {
    for (const building of HIGHWATCH_LAYOUT.buildings) {
      const record = BUILTIN_WORLD.props.buildings.find(
        (candidate) => candidate.id === building.id,
      );
      if (!record) throw new Error(`missing built-in ${building.id}`);
      expect(isHighwatchRebuildBuilding(record)).toBe(true);
      expect(isHighwatchRebuildBuilding({ ...record, id: `${record.id}_custom` })).toBe(false);
    }
    expect(isHighwatchRebuildBuilding({ kind: 'inn', x: 352, z: 598, w: 10, d: 8, rot: 2.7 })).toBe(
      false,
    );
    // The kit building loop (buildProps) and the far-sprite pass
    // (collectBuildingImpostors) both skip the painted records, for every
    // painted town. The sprite pass needs every prop model loaded, which a
    // Node test cannot afford, so this reads each function's own body with the
    // comments stripped, and asks for the skip to `continue` there.
    const propsSource = readFileSync(path.join(__dirname, '..', 'src/render/props.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const bodyOf = (name: string) => {
      const start = propsSource.indexOf(`export function ${name}(`);
      expect(start, name).toBeGreaterThanOrEqual(0);
      const next = propsSource.indexOf('\nexport ', start + 1);
      return propsSource.slice(start, next === -1 ? undefined : next);
    };
    for (const name of ['buildProps', 'collectBuildingImpostors']) {
      const body = bodyOf(name);
      for (const town of ['Eastbrook', 'Fenbridge', 'Highwatch']) {
        const flag = `${town.toLowerCase()}Town`;
        expect(body, `${name} ${town}`).toContain(
          `const ${flag} = activeWorldHasAuthoredTown(is${town}RebuildBuilding);`,
        );
        expect(body, `${name} ${town}`).toContain(
          `if (${flag} && is${town}RebuildBuilding(b)) continue;`,
        );
      }
    }
    const view = KIT.buildFromSources(fixtureSources(), () => 9, true);
    expect(view.update.toString()).not.toMatch(/\bnew\s+/);
  });
});
