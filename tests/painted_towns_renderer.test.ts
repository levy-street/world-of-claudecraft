import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GFX, gfxInternalsForTest } from '../src/render/gfx';
import { setDitherFadeEnabledForTest } from '../src/render/occluder_dither_fade';
import {
  buildPaintedTownViews,
  isPaintedTownRebuildBuilding,
  paintedTownsInternalsForTest,
} from '../src/render/painted_towns';
import { placedTownCameraInterior } from '../src/render/placed_town_interior_core';
import { createRevealGateCore } from '../src/render/reveal_gate_core';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { PAINTED_TOWNS } from '../src/sim/painted_towns';
import type { WorldContent } from '../src/sim/types';

// Every painted town's view (render/painted_towns.ts) is the shared placed-town
// view over its layout: each building its own fade target and reveal root, gated
// like Highwatch's, standing down under the paintedTowns family, and the props
// view's kit loop and far sprites skip its records.

const { kits } = paintedTownsInternalsForTest;

beforeEach(() => setDitherFadeEnabledForTest(false));

const ORIGINAL_GFX = {
  standardMaterials: GFX.standardMaterials,
  dynamicShadows: GFX.dynamicShadows,
};

afterEach(() => {
  gfxInternalsForTest.overrideSettings(ORIGINAL_GFX);
  setActiveWorldContent(null);
});

/** A painted model stand-in: a shell off the origin and one interior mesh. */
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
  interior.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), props));
  source.add(interior);
  return source;
}

describe('the painted town views', () => {
  it('makes one kit per painted town, in the list order', () => {
    expect(kits).toHaveLength(PAINTED_TOWNS.length);
    PAINTED_TOWNS.forEach((town, index) => {
      expect(kits[index].urls).toEqual([...new Set(town.buildings.map((b) => b.assetId))]);
    });
    expect(buildPaintedTownViews).toBeTypeOf('function');
  });

  it('skips every painted record in the props kit loop and the far-sprite pass', () => {
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
      expect(body, name).toContain(
        'const paintedTowns = activeWorldHasAuthoredTown(isPaintedTownRebuildBuilding);',
      );
      expect(body, name).toContain(
        'if (paintedTowns && isPaintedTownRebuildBuilding(b)) continue;',
      );
    }
  });
});

PAINTED_TOWNS.forEach((town, index) => {
  describe(`the ${town.id} town view`, () => {
    if (town.buildings.length === 0) {
      it.skip('stands no painted buildings yet', () => undefined);
      return;
    }
    const kit = kits[index];
    const revealKey = `${town.id}-town-static`;
    const sources = () => new Map(kit.urls.map((url) => [url, placedSourceAsset()]));
    const groupOf = (root: THREE.Object3D, id: string) => {
      const group = root.getObjectByName(`${town.id}Building:${id}`);
      if (!group) throw new Error(`renderer fixture lost ${id}`);
      return group;
    };

    it('stands every painted building as its own fade target and reveal root', () => {
      gfxInternalsForTest.overrideSettings({ standardMaterials: false, dynamicShadows: false });
      const view = kit.buildFromSources(sources(), () => 5, true);
      expect(view.group.name).toBe(`${town.id}TownRebuild`);
      expect(view.group.userData.layoutId).toBe(town.layoutId);
      expect(view.group.userData.buildingIds).toEqual(town.buildings.map((b) => b.id));
      expect(view.group.userData.buildingFadeTargetCount).toBe(town.buildings.length);
      for (const building of town.buildings) {
        const group = groupOf(view.group, building.id);
        expect(view.staticRevealRoots()).toContain(group);
        expect(group.position.x).toBeCloseTo(building.placement.x, 9);
        expect(group.position.z).toBeCloseTo(building.placement.z, 9);
        expect(group.rotation.y).toBeCloseTo(building.placement.rotation, 9);
      }
      expect(view.update.toString()).not.toMatch(/\bnew\s+/);
    });

    it('gives every walk-in building its indoor camera air, and no sealed one', () => {
      for (const building of town.buildings) {
        const air = placedTownCameraInterior(building, 5);
        if (building.walkIn) {
          expect(air, building.id).not.toBeNull();
          expect(air?.openings.length, building.id).toBeGreaterThan(0);
        } else {
          expect(air, building.id).toBeNull();
        }
      }
    });

    it('holds its buildings on a cold approach and reveals each as its compile lands', () => {
      gfxInternalsForTest.overrideSettings({ standardMaterials: false, dynamicShadows: false });
      const view = kit.buildFromSources(sources(), () => 5, true);
      const gate = createRevealGateCore((key) => gate.noteRoots(key, view.staticRevealRoots()));
      view.setRevealGate(gate);
      const hub = town.hub.center;
      const approachX = hub.x + kit.cullRadius + 20;
      view.update(approachX, 12, hub.z, approachX - 5, 12, hub.z, 400, 0.05);
      expect(gate.state(revealKey)).toBe('compiling');
      const first = groupOf(view.group, town.buildings[0].id);
      expect(first.visible).toBe(false);
      gate.settleRoot(revealKey, first);
      view.update(approachX, 12, hub.z, approachX - 5, 12, hub.z, 400, 0.05);
      expect(first.visible).toBe(true);
    });

    it('stands its buildings down for a document that owns them as placements', () => {
      setActiveWorldContent({
        ...BUILTIN_WORLD,
        promotedScenery: { paintedTowns: true },
      } as WorldContent);
      expect(kit.buildFromSources(sources(), () => 5, true).group.userData.buildingIds).toEqual([]);
      setActiveWorldContent({
        ...BUILTIN_WORLD,
        promotedScenery: { authoredTowns: true, highwatchTown: true },
      } as WorldContent);
      expect(
        kit.buildFromSources(sources(), () => 5, true).group.userData.buildingIds,
      ).toHaveLength(town.buildings.length);
    });

    it('matches its records by stable id', () => {
      for (const building of town.buildings) {
        const record = BUILTIN_WORLD.props.buildings.find((b) => b.id === building.id);
        if (!record) throw new Error(`missing built-in ${building.id}`);
        expect(isPaintedTownRebuildBuilding(record)).toBe(true);
        expect(isPaintedTownRebuildBuilding({ ...record, id: `${record.id}_custom` })).toBe(false);
      }
    });
  });
});
