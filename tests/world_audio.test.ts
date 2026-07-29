import { afterEach, describe, expect, it } from 'vitest';
import {
  buildWorldAmbientSources,
  crowdAmbienceAt,
  footstepSurfaceAt,
  isOnDockDeck,
} from '../src/render/world_audio';
import { clonePropsWithoutEastbrookLayout } from '../src/sim/custom_world_props';
import { BUILTIN_WORLD, DUNGEON_X_THRESHOLD, PROPS, setActiveWorldContent } from '../src/sim/data';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import { SOWFIELD_CENTER } from '../src/sim/vale_cup_layout';
import { groundHeight } from '../src/sim/world';

const SEED = 20061;

afterEach(() => {
  setActiveWorldContent(null);
});

function dockWorld(
  dock: (typeof PROPS.docks)[number],
  localX: number,
  localZ: number,
): { x: number; z: number } {
  const cos = Math.cos(dock.rot);
  const sin = Math.sin(dock.rot);
  return {
    x: dock.x + localX * cos + localZ * sin,
    z: dock.z - localX * sin + localZ * cos,
  };
}

describe('world audio routing', () => {
  it('routes both rotated dock decks to wood without widening into nearby terrain', () => {
    for (const dock of PROPS.docks) {
      const deck = dockWorld(dock, 0, -3.18);
      const beside = dockWorld(dock, 1.05, -3.18);
      expect(isOnDockDeck(deck.x, deck.z)).toBe(true);
      expect(
        footstepSurfaceAt(SEED, deck.x, groundHeight(deck.x, deck.z, SEED), deck.z, true),
      ).toBe('wood');
      expect(isOnDockDeck(beside.x, beside.z)).toBe(false);
      expect(
        footstepSurfaceAt(SEED, beside.x, groundHeight(beside.x, beside.z, SEED), beside.z, true),
      ).not.toBe('wood');
    }
  });

  it('routes dock footsteps from the active world after content swaps', () => {
    const builtinDock = PROPS.docks[0];
    const builtinDeck = dockWorld(builtinDock, 0, -3.18);
    const customDock = { ...builtinDock, x: 120, z: 140 };
    const customDeck = dockWorld(customDock, 0, -3.18);

    setActiveWorldContent({
      ...BUILTIN_WORLD,
      props: { ...BUILTIN_WORLD.props, docks: [customDock] },
    });

    expect(isOnDockDeck(builtinDeck.x, builtinDeck.z)).toBe(false);
    expect(isOnDockDeck(customDeck.x, customDeck.z)).toBe(true);

    setActiveWorldContent({
      ...BUILTIN_WORLD,
      props: { ...BUILTIN_WORLD.props, docks: [] },
    });
    expect(isOnDockDeck(customDeck.x, customDeck.z)).toBe(false);
  });

  it('keeps dungeon floors stone', () => {
    expect(footstepSurfaceAt(SEED, DUNGEON_X_THRESHOLD + 1, 0, 0, true)).toBe('stone');
  });

  it('preserves the Sowfield crowd bed and live-match swell', () => {
    expect(crowdAmbienceAt(SOWFIELD_CENTER.x, SOWFIELD_CENTER.z, false, false)).toBe(0.4);
    expect(crowdAmbienceAt(SOWFIELD_CENTER.x, SOWFIELD_CENTER.z, false, true)).toBe(1);
    expect(crowdAmbienceAt(SOWFIELD_CENTER.x, SOWFIELD_CENTER.z, true, true)).toBe(0);
    expect(crowdAmbienceAt(0, 0, false, true)).toBe(0);
  });

  it('builds stable point sources for every campfire and both built-in smithies', () => {
    const sources = buildWorldAmbientSources(SEED);
    const campfires = sources.filter((source) => source.kind === 'campfire');
    const forges = sources.filter((source) => source.kind === 'forge');

    expect(campfires).toHaveLength(PROPS.campfires.length);
    expect(new Set(sources.map((source) => source.id)).size).toBe(sources.length);
    for (const [x, z] of PROPS.campfires) {
      expect(campfires).toContainEqual({
        id: `world:campfire:${x}:${z}`,
        kind: 'campfire',
        x,
        y: groundHeight(x, z, SEED) + 0.6,
        z,
      });
    }

    const eastbrookSmithy = EASTBROOK_LAYOUT.buildings.find(
      (building) => building.id === 'eastbrook_smithy',
    );
    expect(eastbrookSmithy).toBeDefined();
    expect(PROPS.stalls.filter((stall) => stall.smithy)).toHaveLength(1);
    expect(forges.map(({ x, z }) => [x, z])).toEqual([
      [eastbrookSmithy?.position.x, eastbrookSmithy?.position.z],
      [-4.5, 673.5],
    ]);
  });

  it('uses active custom props without leaking Eastbrook ambient anchors', () => {
    const props = clonePropsWithoutEastbrookLayout(BUILTIN_WORLD.props);
    setActiveWorldContent({ ...BUILTIN_WORLD, props });

    const sources = buildWorldAmbientSources(SEED);
    const campfires = sources.filter((source) => source.kind === 'campfire');
    const forges = sources.filter((source) => source.kind === 'forge');

    expect(campfires).toHaveLength(props.campfires.length);
    expect(campfires.map(({ x, z }) => [x, z])).toEqual(props.campfires);
    expect(forges.map(({ x, z }) => [x, z])).toEqual([[-4.5, 673.5]]);
    expect(sources.some((source) => source.id === 'world:forge:4.5:18.5')).toBe(false);
  });
});
