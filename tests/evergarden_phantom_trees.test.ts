// The Evergarden curates its scatter: no wild pines on the lawns and nothing
// beside a parterre bed. The renderer used to apply that rule alone, so the
// sim kept a trunk collider for every pine nobody could see (player report:
// an invisible wall beside the green-roofed house in Hedgewick). The rule now
// lives in the sim's generator, so neither host ever has those decorations.

import { describe, expect, it } from 'vitest';
import { resolvePosition } from '../src/sim/colliders';
import { isCuratedGardenScatter } from '../src/sim/decoration_exclusions';
import { inParterrePlot, PARTERRE_PLOTS } from '../src/sim/garden_parterre_plots';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import type { BiomeId } from '../src/sim/types';
import { generateDecorations, terrainHeight, zoneBiomeAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

describe('Evergarden phantom scatter', () => {
  it('lets a player walk the lawn beside the Hedgewick house (the reported wall)', () => {
    // x = 322 runs north past hexHomeA (328, 838, r 5.2) a yard clear of its
    // collider; a hidden pine trunk at (322.48, 841.82) used to close it.
    let maxDeflection = 0;
    for (let z = 834; z <= 848; z += 0.2) {
      const pos = resolvePosition(WORLD_SEED, 322, z, PLAYER_BODY_RADIUS);
      maxDeflection = Math.max(maxDeflection, Math.hypot(pos.x - 322, pos.z - z));
    }
    expect(maxDeflection).toBe(0);
  });

  it('walks a live player straight past the house on the real movement kernel', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const p = sim.player;
    p.pos.x = 322;
    p.pos.z = 834;
    p.pos.y = terrainHeight(322, 834, WORLD_SEED);
    p.prevPos = { ...p.pos };
    p.facing = 0; // due north (+z)
    sim.moveInput.forward = true;
    for (let i = 0; i < 20 * 4 && p.pos.z < 846; i++) sim.tick();
    expect(p.pos.z).toBeGreaterThan(846);
    expect(Math.abs(p.pos.x - 322)).toBeLessThan(0.05);
  });

  it('generates no garden pine and nothing within the parterre margin', () => {
    const offenders = generateDecorations(WORLD_SEED).filter(
      (d) =>
        (d.kind === 'tree' && zoneBiomeAt(d.x, d.z) === 'garden') || inParterrePlot(d.x, d.z, 6),
    );
    expect(offenders).toEqual([]);
  });

  it('decides on the kind, the biome at the final position, and the plot margin', () => {
    const garden = (): BiomeId => 'garden';
    const elsewhere = (): BiomeId => 'vale';
    expect(isCuratedGardenScatter('tree', 340, 800, garden)).toBe(true);
    expect(isCuratedGardenScatter('tree2', 340, 800, garden)).toBe(false);
    expect(isCuratedGardenScatter('rock', 340, 800, garden)).toBe(false);
    expect(isCuratedGardenScatter('tree', 340, 800, elsewhere)).toBe(false);
    // diagonal off the grand square bed, clear of its four axis satellites
    const plot = PARTERRE_PLOTS[0];
    const at = (d: number): [number, number] => [plot.x + d / Math.SQRT2, plot.z + d / Math.SQRT2];
    expect(isCuratedGardenScatter('rock', ...at(plot.r + 5.9), elsewhere)).toBe(true);
    expect(isCuratedGardenScatter('rock', ...at(plot.r + 6.1), elsewhere)).toBe(false);
  });
});
