import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  insideMeadowScopeRect,
  MEADOW_PATCH_ZONE_ID,
  MEADOW_SCOPE_FEATHER,
  MEADOW_SCOPE_WANDER,
  meadowScopeDecorations,
  meadowScopeFor,
  meadowScopeWeight,
} from '../src/render/meadow_scope_core';
import { BUILTIN_WORLD, setActiveWorldContent, touchActiveWorldContent } from '../src/sim/data';
import type { WorldContent } from '../src/sim/types';
import { generateDecorationsInBounds } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

afterEach(() => setActiveWorldContent(null));

/** A copy of the built-in world that is NOT the built-in world (an authored map). */
function authoredCopy(): WorldContent {
  return { ...BUILTIN_WORLD, zones: [...BUILTIN_WORLD.zones] };
}

describe('meadow scope core', () => {
  it('scopes the painted meadow to Eastbrook Vale on the built-in world only', () => {
    const scope = meadowScopeFor(WORLD_SEED, BUILTIN_WORLD);
    expect(scope).not.toBeNull();
    expect(scope?.zoneId).toBe('eastbrook_vale');
    expect(MEADOW_PATCH_ZONE_ID).toBe('eastbrook_vale');
    expect([scope?.minX, scope?.maxX, scope?.minZ, scope?.maxZ]).toEqual([-180, 180, -180, 180]);
    // the hub is the town the town-ground mask grows from
    expect(scope?.hub).toEqual({ x: -14, z: -100, radius: 26 });
    // an authored map keeps the shipped carpet: no scope at all
    expect(meadowScopeFor(WORLD_SEED, authoredCopy())).toBeNull();
    expect(meadowScopeWeight(meadowScopeFor(WORLD_SEED, authoredCopy()), 0, 0)).toBe(0);
  });

  it('caches one scope object per world, generation and seed', () => {
    const a = meadowScopeFor(WORLD_SEED, BUILTIN_WORLD);
    expect(meadowScopeFor(WORLD_SEED, BUILTIN_WORLD)).toBe(a);
    touchActiveWorldContent();
    const b = meadowScopeFor(WORLD_SEED, BUILTIN_WORLD);
    expect(b).not.toBe(a);
    expect(b).toEqual(a);
    expect(meadowScopeFor(WORLD_SEED + 1, BUILTIN_WORLD)?.seed).toBe(WORLD_SEED + 1);
  });

  it('weighs 1 deep inside, 0 outside and at a shared border, feathering in between', () => {
    const scope = meadowScopeFor(WORLD_SEED, BUILTIN_WORLD);
    expect(meadowScopeWeight(scope, 0, 0)).toBe(1);
    expect(meadowScopeWeight(scope, 60, -40)).toBe(1);
    // outside the rect, in the neighbouring zones
    expect(meadowScopeWeight(scope, -181, 0)).toBe(0);
    expect(meadowScopeWeight(scope, 181, 0)).toBe(0);
    expect(meadowScopeWeight(scope, 0, 181)).toBe(0);
    expect(insideMeadowScopeRect(scope, -181, 0)).toBe(false);
    // a shared border fades to exactly zero ON the line: no step into the
    // neighbour's full carpet
    for (let z = -170; z < 170; z += 7) {
      expect(meadowScopeWeight(scope, -179.999, z)).toBe(0);
      expect(meadowScopeWeight(scope, 179.999, z)).toBe(0);
    }
    for (let x = -170; x < 170; x += 7) expect(meadowScopeWeight(scope, x, 179.999)).toBe(0);
    // past the feather and both wanders, fully inside
    const depth = MEADOW_SCOPE_FEATHER + 2 * MEADOW_SCOPE_WANDER;
    for (let z = -150; z < 140; z += 11) {
      expect(meadowScopeWeight(scope, -180 + depth + 0.01, z)).toBe(1);
    }
  });

  it('does not feather the side that is the world rim', () => {
    const scope = meadowScopeFor(WORLD_SEED, BUILTIN_WORLD);
    expect(scope?.featherMinZ).toBe(false);
    expect(scope?.featherMinX).toBe(true);
    expect(scope?.featherMaxX).toBe(true);
    expect(scope?.featherMaxZ).toBe(true);
    // the south shore of the vale is the world's edge: full weight up to it
    expect(meadowScopeWeight(scope, 0, -179)).toBe(1);
  });

  it('feathers smoothly along a line that wanders, never a straight edge', () => {
    const scope = meadowScopeFor(WORLD_SEED, BUILTIN_WORLD);
    // walking in from the west border: no jump between half-yard steps
    let maxStep = 0;
    const halfWay: number[] = [];
    for (let z = -150; z <= 150; z += 6) {
      let prev = meadowScopeWeight(scope, -180, z);
      let crossed = Number.NaN;
      for (let x = -179.5; x < -120; x += 0.5) {
        const w = meadowScopeWeight(scope, x, z);
        maxStep = Math.max(maxStep, Math.abs(w - prev));
        if (Number.isNaN(crossed) && w >= 0.5) crossed = x;
        prev = w;
      }
      halfWay.push(crossed);
    }
    expect(maxStep).toBeLessThan(0.05);
    // where the fade reaches half strength wanders along the border
    expect(Math.max(...halfWay) - Math.min(...halfWay)).toBeGreaterThan(4);
  });

  it('builds the scope decorations once from the sim field', () => {
    const scope = meadowScopeFor(WORLD_SEED, BUILTIN_WORLD);
    if (!scope) throw new Error('scope expected');
    const decorations = meadowScopeDecorations(scope);
    expect(meadowScopeDecorations(scope)).toBe(decorations);
    const field = generateDecorationsInBounds(WORLD_SEED, {
      minX: -186,
      maxX: 186,
      minZ: -186,
      maxZ: 186,
    });
    expect(decorations.rocks).toEqual(field.filter((d) => d.kind === 'rock'));
    expect(decorations.trees).toEqual(field.filter((d) => d.kind !== 'rock'));
    expect(decorations.rocks.length).toBeGreaterThan(10);
    expect(decorations.trees.length).toBeGreaterThan(50);
  });

  it('reads nothing a graphics tier sets', () => {
    const src = readFileSync(
      new URL('../src/render/meadow_scope_core.ts', import.meta.url),
      'utf8',
    );
    expect(src).not.toMatch(/from '\.\/gfx'/);
    expect(src).not.toMatch(/\bGFX\./);
  });
});
