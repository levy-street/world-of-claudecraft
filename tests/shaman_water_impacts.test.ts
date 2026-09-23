import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { shamanWaterContact } from '../src/render/ability_vfx/shaman_water_impacts';
import { SHAMAN_VFX_FULL_SPECS } from '../src/render/shaman_vfx_specs';

function capture(id: string, tier = 0) {
  const paths: THREE.Vector3[][] = [];
  const host = {
    groundYAt: () => 0.2,
    waterVolume: vi.fn<NonNullable<SequencerHost['waterVolume']>>(),
    burstAt: vi.fn<SequencerHost['burstAt']>(),
    pathRibbon: vi.fn<SequencerHost['pathRibbon']>((_color, _width, _life, fill) => {
      const points = Array.from({ length: 12 }, () => new THREE.Vector3());
      paths.push(points.slice(0, fill(points)));
      return true;
    }),
  };
  const shape = SHAMAN_VFX_FULL_SPECS[id].shaman!;
  const at = { x: 12, y: 1.2, z: 8 };
  shamanWaterContact(
    host as unknown as SequencerHost,
    { abilityId: id, tier, sourceX: 0, sourceZ: 0 } as SeqSlot,
    shape,
    at,
    0x288d9d,
    0xbdece0,
  );
  return { host, paths, at };
}

describe('Shaman distinct receiving water', () => {
  it('separates the rising fast tide, descending broad heal and inward unleashed water', () => {
    const tide = capture('tidecall').host.waterVolume.mock.calls;
    const heal = capture('healing_wave').host.waterVolume.mock.calls;
    const unleash = capture('unleash_weapon_water').host.waterVolume.mock.calls;
    expect(tide[0][1].y).toBeGreaterThan(tide[0][0].y);
    expect(heal[0][0].y - heal[0][1].y).toBeGreaterThan(2.5);
    expect(tide[0][5]).toBeLessThan(heal[0][5]!);
    expect(heal[0][4]).toBeGreaterThan(heal[1][4] * 2);
    for (const [from, to] of unleash)
      expect(Math.hypot(from.x - 12, from.z - 8)).toBeGreaterThan(Math.hypot(to.x - 12, to.z - 8));
  });
  it.each(['healing_wave', 'chain_heal', 'tidecall', 'unleash_weapon_water', 'lifespring_weapon'])(
    '%s uses bounded Shaman-only sheets and finite open foam on both tiers',
    (id) => {
      for (const tier of [0, 1]) {
        const h = capture(id, tier);
        const sheets = h.host.waterVolume.mock.calls;
        expect(sheets.length).toBeGreaterThan(0);
        expect(sheets.length).toBeLessThanOrEqual(id === 'chain_heal' ? 2 : tier ? 1 : 2);
        for (const [from, to, , , width, , priority, flow] of sheets) {
          expect([...Object.values(from), ...Object.values(to)].every(Number.isFinite)).toBe(true);
          expect(width).toBeGreaterThan(0);
          expect(width).toBeLessThanOrEqual(0.4);
          expect(priority).toBe(0);
          expect(flow).toBe(1);
        }
        expect(h.paths.length).toBeLessThanOrEqual(2);
        for (const path of h.paths) {
          expect(path[0].distanceTo(path.at(-1)!)).toBeGreaterThan(2);
          expect(path.every((p) => p.toArray().every(Number.isFinite))).toBe(true);
        }
      }
    },
  );
  it('gathers Lifespring on the weapon rather than dumping water onto terrain', () => {
    const h = capture('lifespring_weapon');
    const [from, to] = h.host.waterVolume.mock.calls[0];
    expect(from.y).toBeGreaterThan(h.at.y);
    expect(to.y).toBeGreaterThan(0.9);
    expect(h.paths).toHaveLength(0);
  });
});
