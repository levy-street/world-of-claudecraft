import { expect, it, vi } from 'vitest';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { drawWarriorGuardCast } from '../src/render/ability_vfx/warrior_guard_cast';

function fixture() {
  const host = {
    anchorOf: vi.fn((_id, _height, out) => Object.assign(out, { x: 10, y: 2, z: 20 })),
    facingAt: vi.fn(() => Math.PI / 2),
    weaponFace: vi.fn((_id, _hand, out, normal) => {
      Object.assign(out, { x: -3, y: 4, z: 7 });
      Object.assign(normal, { x: -0.6, y: 0, z: 0.8 });
      return true;
    }),
    burstAt: vi.fn(),
    fragmentsAt: vi.fn(),
    pulseLight: vi.fn(),
    countPrimitive: vi.fn(),
    contact: vi.fn(),
    flipbookAt: vi.fn(),
  };
  const slot = (abilityId: string, tier = 0, physicalSecondary = false) =>
    ({ abilityId, casterId: 1, targetId: 9, tier, physicalSecondary }) as SeqSlot;
  return { calls: host, host: host as unknown as SequencerHost, slot };
}

it.each([
  ['raised_guard', 1],
  ['die_by_sword', 0],
] as const)('%s locks its activation to the real equipped face on hand %s', (id, hand) => {
  const h = fixture();
  expect(drawWarriorGuardCast(h.host, h.slot(id), 0)).toBe(true);
  expect(h.calls.weaponFace).toHaveBeenCalledExactlyOnceWith(
    1,
    hand,
    expect.any(Object),
    expect.any(Object),
  );
  expect(h.calls.burstAt).toHaveBeenCalledExactlyOnceWith(
    -3,
    4,
    7,
    0xc5e0ee,
    14,
    0.65,
    'sparks',
    0.18,
  );
  const debris = h.calls.fragmentsAt.mock.calls[0];
  expect(debris.slice(0, 7)).toEqual(['metal_splinter', -3, 4, 7, 0xc1cdd4, 6, 0.45]);
  expect(debris[7]).toBeCloseTo(-0.6);
  expect(debris[8]).toBeCloseTo(0.8);
  expect(debris[9]).toBe(0.2);
  expect(h.calls.pulseLight).toHaveBeenCalledExactlyOnceWith(1, 'physical', 0.55, 0.045, 1.8);
  expect(h.calls.contact).not.toHaveBeenCalled();
  expect(h.calls.flipbookAt).not.toHaveBeenCalled();
});

it.each([
  ['raised_guard', 20.5],
  ['die_by_sword', 19.6],
] as const)('%s retains the safe caster fallback when equipment is unavailable', (id, z) => {
  for (const missing of [true, false]) {
    const h = fixture();
    if (missing) h.host.weaponFace = undefined;
    else h.calls.weaponFace.mockReturnValue(false);
    drawWarriorGuardCast(h.host, h.slot(id), 0);
    const burst = h.calls.burstAt.mock.calls[0];
    expect(burst[0]).toBeCloseTo(10.45);
    expect(burst[1]).toBe(2);
    expect(burst[2]).toBeCloseTo(z);
    expect(h.calls.fragmentsAt.mock.calls[0][7]).toBeCloseTo(1);
    expect(h.calls.fragmentsAt.mock.calls[0][8]).toBeCloseTo(0);
  }
});

it('keeps Iron Resolve centered on its existing caster placement and warm activation', () => {
  const h = fixture();
  drawWarriorGuardCast(h.host, h.slot('iron_resolve'), 0);
  expect(h.calls.weaponFace).not.toHaveBeenCalled();
  expect(h.calls.burstAt).toHaveBeenCalledExactlyOnceWith(
    10.45,
    2,
    20,
    0xe2b681,
    14,
    0.65,
    'sparks',
    0.18,
  );
  expect(h.calls.fragmentsAt.mock.calls[0][4]).toBe(0xc1cdd4);
  expect(h.calls.contact).not.toHaveBeenCalled();
});

it('keeps the real equipment flash at lower detail while shedding metal fragments', () => {
  const h = fixture();
  drawWarriorGuardCast(h.host, h.slot('raised_guard', 1), 0);
  expect(h.calls.burstAt).toHaveBeenCalledExactlyOnceWith(
    -3,
    4,
    7,
    0xc5e0ee,
    5,
    0.65,
    'sparks',
    0.18,
  );
  expect(h.calls.fragmentsAt).not.toHaveBeenCalled();
  expect(h.calls.countPrimitive).toHaveBeenCalledExactlyOnceWith('raised_guard', 2);
});

it.each(['raised_guard', 'die_by_sword', 'iron_resolve'])(
  '%s ignores repeated beats and secondary recipients without another activation',
  (id) => {
    const h = fixture();
    expect(drawWarriorGuardCast(h.host, h.slot(id), 1)).toBe(true);
    expect(drawWarriorGuardCast(h.host, h.slot(id, 0, true), 0)).toBe(true);
    expect(h.calls.anchorOf).not.toHaveBeenCalled();
    expect(h.calls.weaponFace).not.toHaveBeenCalled();
    expect(h.calls.burstAt).not.toHaveBeenCalled();
    expect(h.calls.fragmentsAt).not.toHaveBeenCalled();
    expect(h.calls.pulseLight).not.toHaveBeenCalled();
    expect(h.calls.contact).not.toHaveBeenCalled();
  },
);

it('leaves unrelated actions unclaimed and missing casters without activation', () => {
  const h = fixture();
  expect(drawWarriorGuardCast(h.host, h.slot('shield_slam'), 0)).toBe(false);
  h.host.anchorOf = () => null;
  expect(drawWarriorGuardCast(h.host, h.slot('raised_guard'), 0)).toBe(true);
  expect(h.calls.weaponFace).not.toHaveBeenCalled();
  expect(h.calls.burstAt).not.toHaveBeenCalled();
});
