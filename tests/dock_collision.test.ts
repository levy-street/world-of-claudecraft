import { afterEach, describe, expect, it } from 'vitest';
import { isBlocked, resolveMovement, resolvePosition } from '../src/sim/colliders';
import { BUILTIN_WORLD, PROPS, setActiveWorldContent } from '../src/sim/data';
import { dockLocalPoint } from '../src/sim/dock_layout';
import { Sim } from '../src/sim/sim';
import type { WorldContent } from '../src/sim/types';
import { groundHeight, terrainHeight } from '../src/sim/world';

// Issue #1500: fishing docks are raised surfaces, not walls. buildProps renders
// three `dockPlatform` sections with their plank surface about 0.36yd above each
// section base. The sim must expose that same surface through groundHeight while
// leaving the footprint out of the movement-blocker set, so players can stand on
// and cross the visible deck in all three hosts.

const SEED = 4242;
const PRODUCTION_SEED = 20061;

function world(extra: Partial<WorldContent>): WorldContent {
  // A fresh object per test: the collider grid cache is keyed per content.
  return { ...BUILTIN_WORLD, ...extra };
}

afterEach(() => {
  setActiveWorldContent(null);
});

describe('fishing dock deck collision', () => {
  const d = PROPS.docks.find((dock) => Math.round(dock.x) === -66 && Math.round(dock.z) === 305);
  if (!d) throw new Error('Deepfen Shallows dock missing from the built-in world');
  const dock = d;

  // Deck union center in the dock's local frame. buildProps steps three sections
  // out along local -z, centred at -1.05, -3.18, and -5.31.
  const deckLz = (-6.38 + 0.02) / 2;
  const cx = d.x + deckLz * Math.sin(d.rot);
  const cz = d.z + deckLz * Math.cos(d.rot);

  function renderedDeckY(localZ: number, seed: number): number {
    const anchorY = terrainHeight(dock.x, dock.z, seed);
    const sectionY = (sectionLocalZ: number): number => {
      const x = dock.x + sectionLocalZ * Math.sin(dock.rot);
      const z = dock.z + sectionLocalZ * Math.cos(dock.rot);
      return anchorY + Math.min(0, terrainHeight(x, z, seed) - anchorY + 0.15) + 0.36;
    };
    const nearLocalZ = -1.05;
    const farLocalZ = -5.31;
    const nearY = sectionY(nearLocalZ);
    const slope = (sectionY(farLocalZ) - nearY) / (farLocalZ - nearLocalZ);
    return nearY + (localZ - nearLocalZ) * slope;
  }

  it('raises the walkable ground to the rendered plank surface', () => {
    setActiveWorldContent(world({ props: { ...BUILTIN_WORLD.props, docks: [] } }));
    const withoutDock = groundHeight(cx, cz, SEED);

    setActiveWorldContent(world({}));
    expect(groundHeight(cx, cz, SEED)).toBeCloseTo(renderedDeckY(deckLz, SEED), 2);
    expect(groundHeight(cx, cz, SEED)).toBeGreaterThan(withoutDock + 0.3);
  });

  it('keeps all three rendered sections walkable', () => {
    setActiveWorldContent(world({}));
    for (const localZ of [-1.05, -3.18, -5.31]) {
      const x = d.x + localZ * Math.sin(d.rot);
      const z = d.z + localZ * Math.cos(d.rot);
      expect(groundHeight(x, z, SEED)).toBeCloseTo(renderedDeckY(localZ, SEED), 2);
      expect(isBlocked(SEED, x, z, 0.5)).toBe(false);
    }
  });

  it('does not push a mover off the deck surface', () => {
    setActiveWorldContent(world({}));
    const res = resolvePosition(SEED, cx, cz, 0.5);
    expect(res.x).toBeCloseTo(cx, 8);
    expect(res.z).toBeCloseTo(cz, 8);
  });

  it('allows movement straight across the deck instead of treating it as a wall', () => {
    setActiveWorldContent(world({}));
    const nx = Math.cos(d.rot);
    const nz = -Math.sin(d.rot);
    const fromX = cx - nx * 3;
    const fromZ = cz - nz * 3;
    const toX = cx + nx * 3;
    const toZ = cz + nz * 3;
    const res = resolveMovement(SEED, fromX, fromZ, toX, toZ, 0.5);
    expect(res.x).toBeCloseTo(toX, 8);
    expect(res.z).toBeCloseTo(toZ, 8);
  });

  it('allows normal movement along the full deck in both directions', () => {
    setActiveWorldContent(world({}));

    const walk = (startLocalZ: number, facing: number): number => {
      const sim = new Sim({ seed: PRODUCTION_SEED, playerClass: 'warrior', autoEquip: true });
      const p = sim.player;
      p.pos.x = d.x + startLocalZ * Math.sin(d.rot);
      p.pos.z = d.z + startLocalZ * Math.cos(d.rot);
      p.pos.y = groundHeight(p.pos.x, p.pos.z, PRODUCTION_SEED);
      p.prevPos = { ...p.pos };
      p.spawnPos = { ...p.pos };
      p.facing = facing;
      p.hp = 1_000_000;
      p.maxHp = 1_000_000;
      sim.moveInput.forward = true;
      for (let i = 0; i < 16; i++) sim.tick();
      return dockLocalPoint(d, p.pos.x, p.pos.z).z;
    };

    expect(walk(-5.8, d.rot)).toBeGreaterThan(-1);
    expect(walk(-0.5, d.rot + Math.PI)).toBeLessThan(-5.8);
  });

  it('does not raise open shore off to the side of the deck', () => {
    setActiveWorldContent(world({ props: { ...BUILTIN_WORLD.props, docks: [] } }));
    const nx = Math.cos(d.rot);
    const nz = -Math.sin(d.rot);
    const x = cx + nx * 5;
    const z = cz + nz * 5;
    const withoutDock = groundHeight(x, z, SEED);

    setActiveWorldContent(world({}));
    expect(groundHeight(x, z, SEED)).toBe(withoutDock);
  });
});
