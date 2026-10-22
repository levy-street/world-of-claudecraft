import { describe, expect, it, vi } from 'vitest';

// Compile/composition fixtures start from the canonical world, just like the
// exporter. The real activated migration is covered by world_layout_candidate.
vi.mock('../src/sim/world_layout/active', () => ({
  WORLD_LAYOUT: {
    version: 1,
    buildings: {},
    npcs: {},
    camps: [],
    groundObjects: {},
    objectMoves: {},
  },
}));

import { authoredTownDressingPlacements } from '../src/editor/authored_town_dressing_placements';
import { eastbrookVaultPlacements } from '../src/editor/feature_prop_placements';
import { type CivicLayoutBinding, compileLayoutCivic } from '../src/editor/world_layout_civic';
import type { MapDoc, MapPlacement } from '../src/sim/map_doc';
import { WORLD_SEED } from '../src/sim/world_seed';

const current = authoredTownDressingPlacements(WORLD_SEED);
const source = current.find((p) => p.name === 'Fenbridge provision stall')!;
const target: MapPlacement = {
  ...source,
  uid: 'stall',
  x: -7,
  z: 288,
  rotY: 3.8,
  y: 0.2,
  detached: true,
  groundY: 1.2,
};
const binding: CivicLayoutBinding = {
  id: 'fenbridge_provision_stall',
  uid: 'stall',
  source,
  reason: 'Bind the native stall to the authored position.',
};
function compile(p: MapPlacement = target, bindings = [binding]) {
  const errors: string[] = [],
    used = new Set<string>(),
    reserved = new Set<number>();
  const civic = compileLayoutCivic(
    { placements: [p] } as MapDoc,
    bindings,
    current,
    used,
    reserved,
    (_id, reason) => errors.push(reason),
  );
  return { civic, errors, used, reserved };
}

describe('civic layout export', () => {
  it('requires a fixed vault seat so its native terrain pad cannot compound the lift', () => {
    const vault = eastbrookVaultPlacements(WORLD_SEED)[0];
    const target = { ...vault, uid: 'vault', y: 0 };
    const errors: string[] = [];
    const used = new Set<string>(),
      reserved = new Set<number>();
    const bindings: CivicLayoutBinding[] = [
      {
        id: 'eastbrook_weekly_vault',
        uid: 'vault',
        source: vault,
        reason: 'Move the vault.',
      },
    ];
    const run = (p: MapPlacement) =>
      compileLayoutCivic(
        { placements: [p] } as MapDoc,
        bindings,
        [vault],
        used,
        reserved,
        (_id, reason) => errors.push(reason),
      );
    expect(run(target)).toEqual({});
    expect(errors).toEqual([expect.stringContaining('fixed ground seat')]);
    expect(used.size).toBe(0);
    expect(reserved.size).toBe(0);
    errors.length = 0;
    expect(run({ ...target, detached: true, groundY: 3 })).toMatchObject({
      eastbrook_weekly_vault: { groundY: 3, lift: 0 },
    });
    expect(errors).toEqual([]);
  });
  it('binds only spatial fields to the native civic identity', () => {
    const result = compile();
    expect(result.errors).toEqual([]);
    expect(result.civic).toEqual({
      fenbridge_provision_stall: { x: -7, z: 288, rotation: 3.8, lift: 0.2, groundY: 1.2 },
    });
    expect(result.used.has('stall')).toBe(true);
    expect(result.reserved.size).toBe(1);
  });
  it.each([
    { scale: 3 },
    { rotX: 0.2 },
    { tint: 0xff0000 },
    { collide: false, collisionMode: 'none' as const },
  ])('rejects native model changes without consuming the placement: %j', (patch) => {
    const result = compile({ ...target, ...patch });
    expect(result.errors).toHaveLength(1);
    expect(result.civic).toEqual({});
    expect(result.used.size).toBe(0);
    expect(result.reserved.size).toBe(0);
  });
  it('rejects stale source geometry and mismatched gameplay identities', () => {
    expect(
      compile(target, [{ ...binding, source: { ...source, x: source.x + 1 } }]).errors,
    ).toHaveLength(1);
    expect(
      compile(target, [{ ...binding, id: 'eastbrook_market_stall_provisions' }]).errors,
    ).toHaveLength(1);
  });
});
