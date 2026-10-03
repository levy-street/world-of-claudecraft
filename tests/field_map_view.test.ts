// The painted map of an authored open-air dungeon field (src/ui/field_map_view.ts):
// derived from the same record the sim walks, generic for every field, and the
// dungeon map's markers ride it (a shut gate or seal marks the way).
import { describe, expect, it } from 'vitest';
import { HOLLOW_CRYPT_FIELD } from '../src/sim/content/hollow_crypt_layout';
import { SUNKEN_BASTION_GATES } from '../src/sim/content/sunken_bastion';
import { FOGBEACON, SUNKEN_BASTION_FIELD } from '../src/sim/content/sunken_bastion_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { authoredFieldCliffRuns } from '../src/sim/instances/authored_field';
import { buildDungeonWorldMapModel } from '../src/ui/dungeon_map_view';
import {
  FIELD_MAP_MARGIN,
  fieldMapForInterior,
  fieldMapHeightShare,
  fieldMapPlan,
} from '../src/ui/field_map_view';
import type { IWorld } from '../src/world_api';

describe('the painted field map plan', () => {
  it('draws every surface in the sim order, framed by the field bounds', () => {
    const plan = fieldMapPlan(SUNKEN_BASTION_FIELD);
    // A hidden surface (the raised drawbridge) is not promised as ground.
    const shown = SUNKEN_BASTION_FIELD.surfaces.filter((s) => !s.hidden);
    expect(shown.length).toBeLessThan(SUNKEN_BASTION_FIELD.surfaces.length);
    expect(plan.surfaces).toHaveLength(shown.length);
    shown.forEach((s, i) => {
      expect(plan.surfaces[i].path).toBe(s.kind === 'path');
    });
    const b = SUNKEN_BASTION_FIELD.bounds;
    expect(plan.bounds.minX).toBe(b.minX - FIELD_MAP_MARGIN);
    expect(plan.bounds.maxZ).toBe(b.maxZ + FIELD_MAP_MARGIN);
    for (const s of plan.surfaces) {
      for (const [x, z] of s.points) {
        expect(x).toBeGreaterThan(plan.bounds.minX);
        expect(x).toBeLessThan(plan.bounds.maxX);
        expect(z).toBeGreaterThan(plan.bounds.minZ);
        expect(z).toBeLessThan(plan.bounds.maxZ);
      }
    }
  });

  it('inks exactly the cliffs the sim collides with, surf only into the sea', () => {
    const plan = fieldMapPlan(SUNKEN_BASTION_FIELD);
    expect(plan.cliffs).toHaveLength(authoredFieldCliffRuns(SUNKEN_BASTION_FIELD).length);
    expect(plan.cliffs.some((c) => c.intoVoid)).toBe(true);
    expect(plan.cliffs.some((c) => !c.intoVoid)).toBe(true);
    expect(plan.void).toBe('sea');
    expect(fieldMapPlan(HOLLOW_CRYPT_FIELD).void).toBe('mist');
  });

  it('marks the Bastion landmarks, stairs and every gate', () => {
    const plan = fieldMapForInterior('sunken_bastion');
    expect(plan).not.toBeNull();
    if (!plan) return;
    const beacon = plan.landmarks.find((m) => m.kind === 'beacon');
    expect(beacon).toMatchObject({ x: FOGBEACON.x, z: FOGBEACON.z });
    expect(plan.landmarks.some((m) => m.kind === 'chapel')).toBe(true);
    expect(plan.treads.length).toBeGreaterThan(40);
    expect(plan.gates).toHaveLength(SUNKEN_BASTION_GATES.length);
    expect(plan.gates.filter((g) => g.seal)).toHaveLength(
      SUNKEN_BASTION_GATES.filter((g) => g.kind === 'fog_wall').length,
    );
    // A gate bar spans its passage, centred on the gate.
    SUNKEN_BASTION_GATES.forEach((g, i) => {
      const bar = plan.gates[i];
      expect((bar.ax + bar.bx) / 2).toBeCloseTo(g.x, 6);
      expect((bar.az + bar.bz) / 2).toBeCloseTo(g.z, 6);
      expect(Math.hypot(bar.bx - bar.ax, bar.bz - bar.az)).toBeCloseTo(g.hw * 2, 6);
    });
  });

  it('is generic: any authored field gets a plan, a room interior none', () => {
    expect(fieldMapForInterior('hollow_crypt')?.key).toBe('hollow_crypt');
    expect(fieldMapForInterior('crypt')).toBeNull();
    expect(fieldMapForInterior('sanctum')).toBeNull();
    const plan = fieldMapPlan(HOLLOW_CRYPT_FIELD);
    expect(fieldMapHeightShare(plan, plan.heightMin)).toBe(0);
    expect(fieldMapHeightShare(plan, plan.heightMax)).toBe(1);
  });

  it('shows a shut gate or seal on the map, an open one not at all', () => {
    const origin = instanceOrigin(DUNGEONS.sunken_bastion.index, 2);
    const gate = (id: number, templateId: string, z: number) => ({
      id,
      kind: 'object',
      templateId,
      name: templateId,
      pos: { x: origin.x, y: 0, z: origin.z + z },
      hostile: false,
      dead: false,
      lootable: false,
      aggroTargetId: null,
    });
    const player = {
      id: 1,
      kind: 'player',
      templateId: 'warrior',
      name: 'Mapper',
      pos: { x: origin.x, y: 0, z: origin.z },
      facing: 0,
    };
    const world = {
      player,
      entities: new Map<number, unknown>([
        [1, player],
        [2, gate(2, 'dungeon_gate_closed', -20)],
        [3, gate(3, 'dungeon_gate_sealed', 20)],
        [4, gate(4, 'dungeon_gate_open', 40)],
      ]),
      partyInfo: null,
      riftFloor: null,
      delveRun: null,
    } as unknown as IWorld;
    const model = buildDungeonWorldMapModel(world, 560, 34);
    expect(model?.markers.filter((m) => m.kind === 'gate')).toHaveLength(2);
  });
});
