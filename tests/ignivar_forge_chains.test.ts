import { describe, expect, it } from 'vitest';
import {
  IGNIVAR_FORGE_CHAINS_BREAK_DISTANCE,
  IGNIVAR_FORGE_CHAINS_WARNING_DISTANCE,
  movementCrossesIgnivarForgeChain,
} from '../src/sim/ignivar_forge_chains';

describe('Ignivar Forge Chains crossing geometry', () => {
  const first = { x: -5, y: 0, z: 0 };
  const second = { x: 5, y: 0, z: 0 };

  it('starts the visual danger warning two yards before the chain can break', () => {
    expect(IGNIVAR_FORGE_CHAINS_WARNING_DISTANCE).toBe(8);
    expect(IGNIVAR_FORGE_CHAINS_BREAK_DISTANCE).toBe(10);
  });

  it('catches a fast player movement that tunnels across the chain', () => {
    expect(
      movementCrossesIgnivarForgeChain(
        { x: 0, y: 0, z: -20 },
        { x: 0, y: 0, z: 20 },
        first,
        second,
      ),
    ).toBe(true);
  });

  it('catches a player who lands on the middle of the chain before continuing through it', () => {
    expect(
      movementCrossesIgnivarForgeChain({ x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: 0 }, first, second),
    ).toBe(true);
  });

  it('does not punish a player who moves beside the chain without crossing it', () => {
    expect(
      movementCrossesIgnivarForgeChain({ x: -4, y: 0, z: 1 }, { x: 4, y: 0, z: 1 }, first, second),
    ).toBe(false);
  });

  it('does not punish an unmoving player already standing on the chain', () => {
    const middle = { x: 0, y: 0, z: 0 };
    expect(movementCrossesIgnivarForgeChain(middle, middle, first, second)).toBe(false);
  });

  it('does not treat grazing a linked player at the chain endpoint as a crossing', () => {
    expect(
      movementCrossesIgnivarForgeChain(
        { x: -5, y: 0, z: -2 },
        { x: -5, y: 0, z: 2 },
        first,
        second,
      ),
    ).toBe(false);
  });
});
