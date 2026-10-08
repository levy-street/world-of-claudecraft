import { describe, expect, it } from 'vitest';
import { planDecorTorches } from '../src/render/decor_torch_fx';
import { objectDisplayName } from '../src/render/entity_labels';
import {
  MUSTER_KIT_PROP_DEFS,
  MUSTER_LOW_TIER_KIT_KEYS,
  MUSTER_TORCH_FLAME_HEIGHT,
  musterCampDecor,
  renderDecorProps,
} from '../src/render/muster_camps';
import { nameplatePlanInto, newNameplatePlan } from '../src/render/nameplate_view';
import {
  buildPickOnlyObjectBody,
  isPickOnlyObjectTemplate,
  PICK_ONLY_OBJECT_TEMPLATE_IDS,
} from '../src/render/pick_only_objects';
import { propPreloadInternalsForTest } from '../src/render/props';
import {
  MUSTER_CAMPS,
  MUSTER_CIRCUIT,
  MUSTER_RACK,
  MUSTER_RACK_TEMPLATE_ID,
  type MusterCampDef,
} from '../src/sim/content/mirefen_muster';
import { BUILTIN_WORLD } from '../src/sim/data';
import {
  angleGap,
  bearingTo,
  MUSTER_CLUTTER_KEYS,
  MUSTER_MAX_TILT,
  MUSTER_OPENING_HALF_ANGLE,
  MUSTER_PICKET_CLEAR_RADIUS,
  MUSTER_RACK_CLEARANCE,
  MUSTER_SLOT_CLEARANCE,
  MUSTER_TOWER_WALKWAY,
  type MusterKitKey,
  type MusterPlacement,
  musterCampOpenings,
  musterFootprintCorners,
  musterFootprintDistance,
  musterPlacementsForTier,
  planMusterCamps,
} from '../src/sim/muster_camp_layout';
import { musterCampPlan } from '../src/sim/muster_camp_plan';
import { INTERACT_RANGE, type WorldContent } from '../src/sim/types';
import { generateDecorationsInBounds, terrainHeight } from '../src/sim/world';
import { WORLD_BOSSES } from '../src/sim/world_boss';
import { WORLD_SEED } from '../src/sim/world_seed';
import { t } from '../src/ui/i18n';

// The Mirefen muster camps' layout core (src/sim/muster_camp_layout.ts), driven on
// the REAL camp records, the real heightfield and the real tree/rock scatter, exactly
// as src/render/muster_camps.ts feeds it in game.

const plan = musterCampPlan(WORLD_SEED);
const pickets = MUSTER_CAMPS.filter((c) => c.onCircuit);
const command = MUSTER_CAMPS.find((c) => !c.onCircuit) as MusterCampDef;
const lair = WORLD_BOSSES.find((b) => b.templateId === 'balgath_cyclops')?.pos as {
  x: number;
  z: number;
};
const WALLS: ReadonlySet<MusterKitKey> = new Set(['musterPalisade', 'musterBarricade']);

function of(campId: string): MusterPlacement[] {
  return plan.filter((p) => p.campId === campId);
}

/** Points along a placement's footprint outline, ten to an edge. */
function footprintEdge(p: MusterPlacement): [number, number][] {
  const c = musterFootprintCorners(p.key, p.x, p.z, p.rot);
  const out: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const a = c[i];
    const b = c[(i + 1) % 4];
    for (let k = 0; k < 10; k++) {
      out.push([a[0] + ((b[0] - a[0]) * k) / 10, a[1] + ((b[1] - a[1]) * k) / 10]);
    }
  }
  return out;
}

/** Points spread over a placement's footprint (corners, edge midpoints, centre). */
function footprintSamples(p: MusterPlacement): [number, number][] {
  const c = musterFootprintCorners(p.key, p.x, p.z, p.rot);
  const out: [number, number][] = [...c, [p.x, p.z]];
  for (let i = 0; i < 4; i++) {
    const a = c[i];
    const b = c[(i + 1) % 4];
    out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return out;
}

describe('muster camps: the picket rules', () => {
  it('keeps every footprint outside the squad-and-slam circle of every picket', () => {
    for (const camp of pickets) {
      for (const p of of(camp.id)) {
        const d = musterFootprintDistance(p.key, p.x, p.z, p.rot, camp.center.x, camp.center.z);
        expect(d, `${camp.id} ${p.key}`).toBeGreaterThanOrEqual(MUSTER_PICKET_CLEAR_RADIUS);
      }
    }
  });

  it('leaves his approach and exit open: no footprint inside an opening cone', () => {
    for (const camp of pickets) {
      const openings = musterCampOpenings(camp, {
        camps: MUSTER_CAMPS,
        circuit: MUSTER_CIRCUIT,
        lair,
      });
      expect(openings.length).toBeGreaterThanOrEqual(2);
      for (const p of of(camp.id)) {
        for (const [x, z] of footprintSamples(p)) {
          const b = bearingTo(camp.center.x, camp.center.z, x, z);
          for (const o of openings) {
            expect(
              angleGap(b, o),
              `${camp.id} ${p.key} blocks bearing ${o.toFixed(2)}`,
            ).toBeGreaterThan(MUSTER_OPENING_HALF_ANGLE - 0.08);
          }
        }
      }
    }
  });

  it('keeps the walking line clear: the last 18 yd of every leg into and out of a picket', () => {
    const at = (id: string) => (MUSTER_CAMPS.find((c) => c.id === id) as MusterCampDef).center;
    const legs: { from: { x: number; z: number }; to: MusterCampDef }[] = [];
    MUSTER_CIRCUIT.forEach((id, i) => {
      const camp = MUSTER_CAMPS.find((c) => c.id === id) as MusterCampDef;
      const prev = at(MUSTER_CIRCUIT[(i - 1 + MUSTER_CIRCUIT.length) % MUSTER_CIRCUIT.length]);
      const next = at(MUSTER_CIRCUIT[(i + 1) % MUSTER_CIRCUIT.length]);
      legs.push({ from: prev, to: camp }, { from: next, to: camp });
      if (i === 0) legs.push({ from: lair, to: camp });
    });
    for (const { from, to } of legs) {
      const dx = from.x - to.center.x;
      const dz = from.z - to.center.z;
      const len = Math.hypot(dx, dz);
      for (let s = 0; s <= 18; s += 0.5) {
        const x = to.center.x + (dx / len) * s;
        const z = to.center.z + (dz / len) * s;
        for (const p of of(to.id)) {
          const d = musterFootprintDistance(p.key, p.x, p.z, p.rot, x, z);
          expect(d, `${to.id} ${p.key} on the leg at ${s} yd`).toBeGreaterThan(2);
        }
      }
    }
  });

  it('stands nothing on a sentry slot', () => {
    for (const camp of pickets) {
      const sentries = camp.soldiers.filter(
        (s) => Math.hypot(s.dx, s.dz) > MUSTER_PICKET_CLEAR_RADIUS,
      );
      expect(sentries).toHaveLength(2);
      for (const s of sentries) {
        for (const p of of(camp.id)) {
          const d = musterFootprintDistance(
            p.key,
            p.x,
            p.z,
            p.rot,
            camp.center.x + s.dx,
            camp.center.z + s.dz,
          );
          expect(d, `${camp.id} ${p.key} on a sentry`).toBeGreaterThanOrEqual(
            MUSTER_SLOT_CLEARANCE,
          );
        }
      }
    }
  });

  it('frames every picket: wall sections behind the squad, a tent, supplies', () => {
    for (const camp of pickets) {
      const here = of(camp.id);
      expect(here.filter((p) => WALLS.has(p.key)).length, camp.id).toBeGreaterThanOrEqual(2);
      expect(
        here.some((p) => p.key === 'musterTentLarge' || p.key === 'musterTentSmall'),
        camp.id,
      ).toBe(true);
      expect(
        here.some((p) => MUSTER_CLUTTER_KEYS.has(p.key)),
        camp.id,
      ).toBe(true);
      // the wall stands BEHIND the soldiers (the half away from where they face)
      for (const p of here.filter((q) => WALLS.has(q.key))) {
        const b = bearingTo(camp.center.x, camp.center.z, p.x, p.z);
        expect(angleGap(b, camp.facing), `${camp.id} wall in front of the squad`).toBeGreaterThan(
          Math.PI / 2 - 0.4,
        );
      }
      // walls face out, tents face in
      for (const p of here) {
        const out = bearingTo(camp.center.x, camp.center.z, p.x, p.z);
        if (WALLS.has(p.key)) expect(angleGap(p.rot, out)).toBeLessThan(0.2);
        if (p.key === 'musterTentLarge' || p.key === 'musterTentSmall') {
          expect(angleGap(p.rot, out + Math.PI)).toBeLessThan(0.05);
        }
      }
    }
  });
});

describe('muster camps: the command camp', () => {
  const here = of(command.id);

  it('holds the weapon rack exactly at MUSTER_RACK, facing its facing', () => {
    const racks = plan.filter((p) => p.key === 'musterWeaponRack');
    expect(racks).toHaveLength(1);
    expect(racks[0].campId).toBe(command.id);
    expect(racks[0].x).toBeCloseTo(MUSTER_RACK.x, 3);
    expect(racks[0].z).toBeCloseTo(MUSTER_RACK.z, 3);
    expect(racks[0].rot).toBeCloseTo(MUSTER_RACK.facing, 3);
    expect(racks[0].tierClass).toBe('structure');
  });

  it('is the fullest camp: gate, watchtower, tents, a full wall, the lantern and gate torches', () => {
    const count = (key: MusterKitKey) => here.filter((p) => p.key === key).length;
    expect(count('musterGate')).toBe(1);
    expect(count('musterWatchtower')).toBe(1);
    expect(count('musterTentLarge') + count('musterTentSmall')).toBeGreaterThanOrEqual(3);
    expect(count('musterPalisade') + count('musterBarricade')).toBeGreaterThanOrEqual(8);
    expect(count('musterLanternPost')).toBe(1);
    const gateTorches = here.filter((p) => p.key === 'musterTorch' && p.tierClass === 'structure');
    expect(gateTorches).toHaveLength(2);
    for (const other of pickets) expect(of(other.id).length).toBeLessThan(here.length);
    // the gate is on the camp's front, toward the fight
    const gate = here.find((p) => p.key === 'musterGate') as MusterPlacement;
    const b = bearingTo(command.center.x, command.center.z, gate.x, gate.z);
    expect(angleGap(b, command.facing)).toBeLessThan(0.8);
  });

  it('stands the watchtower on a front corner in the open, a walkway past each flank', () => {
    const tower = here.find((p) => p.key === 'musterWatchtower') as MusterPlacement;
    const gate = here.find((p) => p.key === 'musterGate') as MusterPlacement;
    const at = (p: MusterPlacement) => bearingTo(command.center.x, command.center.z, p.x, p.z);
    // on the front (toward the crater), off to the side of the gate, not beside it
    expect(angleGap(at(tower), command.facing)).toBeLessThan(Math.PI / 2);
    expect(angleGap(at(tower), at(gate))).toBeGreaterThan(0.6);
    expect(Math.hypot(tower.x - MUSTER_RACK.x, tower.z - MUSTER_RACK.z)).toBeGreaterThan(10);
    // every other piece keeps at least the walkway off the tower's footprint
    for (const p of here) {
      if (p === tower) continue;
      const gap = Math.min(
        ...footprintEdge(tower).map(([x, z]) =>
          musterFootprintDistance(p.key, p.x, p.z, p.rot, x, z),
        ),
      );
      expect(gap, `${p.key} crowds the tower`).toBeGreaterThanOrEqual(MUSTER_TOWER_WALKWAY);
    }
  });

  it('stands nothing on a soldier or on the rack (the rack alone is forced)', () => {
    for (const p of here) {
      if (p.key === 'musterWeaponRack') continue;
      for (const s of command.soldiers) {
        const d = musterFootprintDistance(
          p.key,
          p.x,
          p.z,
          p.rot,
          command.center.x + s.dx,
          command.center.z + s.dz,
        );
        expect(d, `${p.key} on a soldier`).toBeGreaterThanOrEqual(MUSTER_SLOT_CLEARANCE);
      }
      expect(
        musterFootprintDistance(p.key, p.x, p.z, p.rot, MUSTER_RACK.x, MUSTER_RACK.z),
      ).toBeGreaterThanOrEqual(MUSTER_RACK_CLEARANCE);
    }
  });
});

describe('muster camps: the ground and the scatter', () => {
  it('stands no piece in a tree trunk or a boulder', () => {
    for (const camp of MUSTER_CAMPS) {
      const scatter = generateDecorationsInBounds(WORLD_SEED, {
        minX: camp.center.x - 26,
        maxX: camp.center.x + 26,
        minZ: camp.center.z - 26,
        maxZ: camp.center.z + 26,
      });
      for (const p of of(camp.id)) {
        if (p.key === 'musterWeaponRack') continue;
        for (const d of scatter) {
          const r = (d.kind === 'rock' ? 1.0 : 0.9) * d.scale;
          expect(
            musterFootprintDistance(p.key, p.x, p.z, p.rot, d.x, d.z),
            `${camp.id} ${p.key}`,
          ).toBeGreaterThanOrEqual(r);
        }
      }
    }
  });

  it('seats every piece: bounded lean, the low edge on the ground, and no piece overlaps another', () => {
    for (const p of plan) {
      expect(Math.abs(p.pitch)).toBeLessThanOrEqual(MUSTER_MAX_TILT + 1e-9);
      expect(Math.abs(p.roll)).toBeLessThanOrEqual(MUSTER_MAX_TILT + 1e-9);
      expect(p.sink).toBeGreaterThanOrEqual(0);
      expect(p.sink).toBeLessThan(2);
      if (
        p.key === 'musterWatchtower' ||
        p.key === 'musterTorch' ||
        p.key === 'musterLanternPost'
      ) {
        expect(p.pitch).toBe(0);
        expect(p.roll).toBe(0);
      }
    }
    for (const camp of MUSTER_CAMPS) {
      const here = of(camp.id);
      for (let i = 0; i < here.length; i++) {
        for (let j = i + 1; j < here.length; j++) {
          // centres never sit inside each other's footprint
          const a = here[i];
          const b = here[j];
          expect(
            musterFootprintDistance(a.key, a.x, a.z, a.rot, b.x, b.z),
            `${a.key}/${b.key}`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it('is deterministic: the same input plans the same camps', () => {
    const input = {
      camps: MUSTER_CAMPS,
      circuit: MUSTER_CIRCUIT,
      lair,
      rack: MUSTER_RACK,
      heightAt: (x: number, z: number) => terrainHeight(x, z, WORLD_SEED),
      obstacles: [],
      minGroundY: -100,
    };
    expect(planMusterCamps(input)).toEqual(planMusterCamps(input));
  });
});

describe('muster camps: graphics tiers', () => {
  it('draws the structure on EVERY preset and sheds only clutter on low', () => {
    const low = musterPlacementsForTier(plan, true);
    const high = musterPlacementsForTier(plan, false);
    expect(high).toEqual([...plan]);
    expect(low).toEqual(plan.filter((p) => p.tierClass === 'structure'));
    for (const p of low)
      expect(['musterCrate', 'musterBarrel', 'musterSacks', 'musterCartWheel']).not.toContain(
        p.key,
      );
    for (const key of [
      'musterPalisade',
      'musterBarricade',
      'musterGate',
      'musterWatchtower',
      'musterTentLarge',
      'musterTentSmall',
      'musterWeaponRack',
      'musterLanternPost',
    ] as MusterKitKey[]) {
      expect(
        low.some((p) => p.key === key),
        key,
      ).toBe(true);
    }
    expect(high.length).toBeGreaterThan(low.length);
    expect(high.filter((p) => p.tierClass === 'clutter').length).toBeGreaterThanOrEqual(15);
  });

  it('hands the props pass the live share, only in the built-in world', () => {
    expect(musterCampDecor(BUILTIN_WORLD, WORLD_SEED, true)).toHaveLength(
      musterPlacementsForTier(plan, true).length,
    );
    expect(musterCampDecor(BUILTIN_WORLD, WORLD_SEED, false)).toHaveLength(plan.length);
    const editorDoc: WorldContent = { ...BUILTIN_WORLD };
    expect(musterCampDecor(editorDoc, WORLD_SEED, false)).toEqual([]);
    const walked = renderDecorProps(BUILTIN_WORLD, WORLD_SEED, false);
    const authored = BUILTIN_WORLD.props.decorProps ?? [];
    expect(walked.slice(0, authored.length)).toEqual(authored);
    expect(walked.length).toBe(authored.length + plan.length);
    // the tall pieces get a camera-ghost circle, the small ones none
    const tower = walked.find((d) => d.key === 'musterWatchtower');
    expect(tower?.r).toBeGreaterThan(0);
    expect(walked.find((d) => d.key === 'musterCrate')?.r).toBeUndefined();
  });

  it('registers the kit with the props pass: every key preloads, the low preset keeps the structure', () => {
    const { allPropKeys, lowTierPropKeys, propAssetUrl } = propPreloadInternalsForTest;
    for (const [key, def] of Object.entries(MUSTER_KIT_PROP_DEFS)) {
      expect(allPropKeys).toContain(key);
      expect(propAssetUrl[key]).toBe(def.url);
    }
    expect([...MUSTER_LOW_TIER_KIT_KEYS].sort()).toEqual(
      [
        'musterBarricade',
        'musterGate',
        'musterLanternPost',
        'musterPalisade',
        'musterTentLarge',
        'musterTentSmall',
        'musterTorch',
        'musterWatchtower',
        'musterWeaponRack',
      ].sort(),
    );
    for (const key of MUSTER_LOW_TIER_KIT_KEYS) expect(lowTierPropKeys).toContain(key);
    for (const key of ['musterCrate', 'musterBarrel', 'musterSacks', 'musterCartWheel']) {
      expect(lowTierPropKeys).not.toContain(key);
    }
  });

  it('lights every placed torch through the decor torch pass, at the cup', () => {
    const sites = planDecorTorches(WORLD_SEED);
    const torches = renderDecorProps(BUILTIN_WORLD, WORLD_SEED, false).filter(
      (d) => d.key === 'musterTorch',
    );
    expect(torches.length).toBeGreaterThanOrEqual(10);
    for (const d of torches) {
      const site = sites.find((s) => s.x === d.x && s.z === d.z);
      expect(site, `torch at ${d.x},${d.z}`).toBeDefined();
      expect(site?.y).toBeCloseTo(
        terrainHeight(d.x, d.z, WORLD_SEED) - (d.sink ?? 0) + MUSTER_TORCH_FLAME_HEIGHT,
        5,
      );
    }
  });
});

describe('muster camps: the weapon rack entity', () => {
  it('is a pick volume only, through the one pick-only table the monument shares', () => {
    expect([...PICK_ONLY_OBJECT_TEMPLATE_IDS].sort()).toEqual([
      'muster_weapon_rack',
      'realm_builder_monument',
    ]);
    expect(isPickOnlyObjectTemplate(MUSTER_RACK_TEMPLATE_ID)).toBe(true);
    expect(isPickOnlyObjectTemplate('muster_footman')).toBe(false);
    expect(isPickOnlyObjectTemplate(undefined)).toBe(false);
    const built = buildPickOnlyObjectBody(MUSTER_RACK_TEMPLATE_ID);
    const meshes: { visible: boolean }[] = [];
    built.group.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) meshes.push(o);
    });
    expect(meshes).toHaveLength(1);
    expect(meshes[0].visible).toBe(false);
    expect(built.height).toBeGreaterThan(2.6);
    expect(() => buildPickOnlyObjectBody('wolf')).toThrow();
  });

  it('labels as the rack, never as the pike it lends', () => {
    const rack = {
      kind: 'object',
      templateId: MUSTER_RACK_TEMPLATE_ID,
      objectItemId: 'muster_shardpike',
      name: 'Muster Weapon Rack',
    } as unknown as Parameters<typeof objectDisplayName>[0];
    expect(objectDisplayName(rack)).toBe(t('worldContent.musterRackName'));
  });

  it('names itself up close like the delve interactables, and stays quiet from afar', () => {
    const rackAt = (d: number) =>
      nameplatePlanInto(
        newNameplatePlan(),
        {
          id: 2,
          kind: 'object',
          pos: { x: d, y: 0, z: 0 },
          dead: false,
          lootable: true,
          templateId: MUSTER_RACK_TEMPLATE_ID,
          dungeonId: null,
          scale: 1,
          overheadEmoteId: null,
          castingAbility: null,
          aggroTargetId: null,
          ownerId: null,
        } as never,
        {
          id: 1,
          kind: 'player',
          pos: { x: 0, y: 0, z: 0 },
          dead: false,
          targetId: null,
          comboPoints: 0,
        } as never,
        2,
        true,
        false,
        true,
        false,
      );
    expect(rackAt(INTERACT_RANGE).hidden).toBe(false);
    expect(rackAt(INTERACT_RANGE + 4).hidden).toBe(true);
  });
});
