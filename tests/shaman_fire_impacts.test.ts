import { expect, it, vi } from 'vitest';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { shamanFireContact } from '../src/render/ability_vfx/shaman_fire_impacts';
import type { ShamanComposition } from '../src/render/shaman_vfx_specs';

function draw(id: string, action: ShamanComposition['action'], tier = 0) {
  const host = { flipbookAt: vi.fn(), burstAt: vi.fn(), bakedAt: vi.fn(), pathRibbon: vi.fn() };
  shamanFireContact(
    host as unknown as SequencerHost,
    { abilityId: id, tier, sourceX: -4, sourceZ: 0 } as SeqSlot,
    { element: 'fire', action, radius: 2, height: 2, weight: 1 },
    { x: 0, y: 1, z: 0 },
    0xee6611,
    0xffffaa,
  );
  return host;
}
it('gives ignition, weapon inscription, cutting and stored blast different silhouettes and emission paths', () => {
  const cases = [
    draw('flame_shock', 'jolt'),
    draw('flametongue_weapon', 'imbue'),
    draw('weapon_test', 'strike'),
    draw('unleash_weapon_fire', 'strike'),
  ];
  expect(cases.map((h) => h.flipbookAt.mock.calls[0][5])).toEqual([
    'shaman_ember',
    'shaman_fire_forge',
    'shaman_fire_cleave',
    'shaman_fire_detonation',
  ]);
  for (const h of cases) {
    expect(h.flipbookAt).toHaveBeenCalledTimes(1);
    expect(h.flipbookAt.mock.calls[0].slice(0, 3)).toEqual([0, 1, 0]);
    expect(h.flipbookAt.mock.calls[0][3]).toBeGreaterThanOrEqual(10.6);
    expect(h.burstAt.mock.calls.reduce((n, c) => n + c[4], 0)).toBeLessThanOrEqual(92);
  }
  expect(cases[1].bakedAt).not.toHaveBeenCalled();
  expect(cases[1].pathRibbon).not.toHaveBeenCalled();
  expect(cases[2].pathRibbon).toHaveBeenCalledTimes(2);
  expect(cases[0].burstAt.mock.calls.map((c) => c.slice(0, 3))).not.toEqual(
    cases[3].burstAt.mock.calls.map((c) => c.slice(0, 3)),
  );
});
it('retains the hero silhouette while thinning fine ejecta on lower tiers', () => {
  const full = draw('unleash_weapon_fire', 'strike'),
    lite = draw('unleash_weapon_fire', 'strike', 1);
  expect(lite.flipbookAt.mock.calls).toEqual(full.flipbookAt.mock.calls);
  expect(lite.burstAt.mock.calls.reduce((n, c) => n + c[4], 0)).toBeLessThan(
    full.burstAt.mock.calls.reduce((n, c) => n + c[4], 0),
  );
});
