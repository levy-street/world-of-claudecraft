import { afterEach, describe, expect, it } from 'vitest';
import { placementsToPlayAssets } from '../src/editor/custom_map';
import { layoutDockDecks } from '../src/editor/world_layout_docks';
import { compileLayoutProps, layoutPropPlacements } from '../src/editor/world_layout_props';
import { footstepSurfaceAt, isOnDockDeck } from '../src/render/world_audio';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { deckCeilingAt } from '../src/sim/deck_ceiling';
import {
  DOCK_SECTION_LOCAL_Z,
  dockSectionWorldCenter,
  dockSurfaceLine,
  dockSurfaceYAt,
} from '../src/sim/dock_layout';
import type { MapDoc } from '../src/sim/map_doc';
import { emptyZoneProps } from '../src/sim/types';
import { groundHeight, groundHeightAtBody, terrainHeight } from '../src/sim/world';
import { layoutDeckFloorAt } from '../src/sim/world_layout/decks';
import { placeLayoutProps } from '../src/sim/world_layout/props';
import { placeLayoutScenery } from '../src/sim/world_layout/scenery';
import { WORLD_SEED } from '../src/sim/world_seed';

afterEach(() => setActiveWorldContent(null));
const terrain = (x: number, z: number) => terrainHeight(x, z, WORLD_SEED);

describe('authored dock walk surfaces', () => {
  it('preserves the original analytic pitched surface before moving the models', () => {
    for (const dock of BUILTIN_WORLD.props.docks) {
      const children = layoutPropPlacements(BUILTIN_WORLD.props, { family: 'docks', source: dock });
      const decks = layoutDockDecks(dock, children, placementsToPlayAssets(children));
      const line = dockSurfaceLine(dock, terrain);
      for (let index = 0; index < 3; index++) {
        const center = dockSectionWorldCenter(dock, index);
        for (const offset of [-0.6, 0, 0.6]) {
          const ds = dock.scale ?? 1;
          const x = center.x + Math.sin(dock.rot) * offset * ds;
          const z = center.z + Math.cos(dock.rot) * offset * ds;
          expect(layoutDeckFloorAt(decks, x, z, terrain)).toBeCloseTo(
            dockSurfaceYAt(line, DOCK_SECTION_LOCAL_Z[index] + offset),
            8,
          );
        }
      }
    }
  });

  it('moves walkable support and wood footsteps with detached planks, removing the original deck', () => {
    const dock = BUILTIN_WORLD.props.docks[0];
    const props = { ...emptyZoneProps(), docks: [dock] };
    const record = { family: 'docks' as const, source: dock };
    const children = layoutPropPlacements(props, record);
    const moved = children.map((p, index) => ({
      ...p,
      uid: `dock-${index}`,
      x: p.x + 40,
      z: p.z + 30,
      detached: true,
      groundY: terrain(p.x, p.z) + 8,
    }));
    const errors: string[] = [];
    const result = compileLayoutProps(
      { placements: moved } as MapDoc,
      [
        {
          record,
          parts: children.map((source, index) => ({ source, uid: `dock-${index}` })),
          reason: 'Relocate the complete fishing dock and its support.',
        },
      ],
      props,
      children,
      new Set(),
      new Set(),
      (id) => errors.push(id),
    );
    expect(errors).toEqual([]);
    expect(result.decks).toHaveLength(3);
    const line = dockSurfaceLine(dock, terrain);
    const world = placeLayoutScenery(
      { ...BUILTIN_WORLD, props: placeLayoutProps(props, result.propRemovals) },
      result,
    );
    setActiveWorldContent(world);
    expect(world.props.docks).toEqual([]);
    for (let index = 0; index < 3; index++) {
      const center = dockSectionWorldCenter(dock, index);
      const x = center.x + 40,
        z = center.z + 30;
      const expected = dockSurfaceYAt(line, DOCK_SECTION_LOCAL_Z[index]) + 8;
      expect(layoutDeckFloorAt(result.decks, x, z, terrain)).toBeCloseTo(expected, 8);
      expect(groundHeight(x, z, WORLD_SEED)).toBeGreaterThanOrEqual(expected - 1e-8);
      expect(isOnDockDeck(x, z)).toBe(true);
      expect(footstepSurfaceAt(WORLD_SEED, x, expected, z, false)).toBe('wood');
      expect(isOnDockDeck(center.x, center.z)).toBe(false);
      // An elevated deck supports a body on it, but does not pull a body up
      // from underneath. Its underside remains a ceiling when jumping below it.
      const below = expected - 8;
      expect(groundHeightAtBody(x, z, WORLD_SEED, below)).toBeLessThan(expected - 2.5);
      expect(groundHeightAtBody(x, z, WORLD_SEED, expected)).toBeCloseTo(expected, 8);
      expect(deckCeilingAt(WORLD_SEED, x, z, below)).toBeCloseTo(expected, 8);
    }
    // Runtime collision-off removes support, ceiling, and wood footsteps.
    for (const deck of world.sceneryDecks ?? []) deck.placement.collideRadius = 0;
    const center = dockSectionWorldCenter(dock, 1);
    const x = center.x + 40,
      z = center.z + 30;
    const expected = dockSurfaceYAt(line, DOCK_SECTION_LOCAL_Z[1]) + 8;
    expect(layoutDeckFloorAt(world.sceneryDecks, x, z, terrain)).toBe(-Infinity);
    expect(groundHeight(x, z, WORLD_SEED)).toBeLessThan(expected - 2.5);
    expect(deckCeilingAt(WORLD_SEED, x, z, expected - 8)).toBe(Infinity);
    expect(isOnDockDeck(x, z)).toBe(false);
    expect(footstepSurfaceAt(WORLD_SEED, x, expected, z, false)).not.toBe('wood');
  });
});
