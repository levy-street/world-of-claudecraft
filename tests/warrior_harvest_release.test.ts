import { expect, it, vi } from 'vitest';
import { drawHarvestRelease } from '../src/render/ability_vfx/fury_release';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';

function fixture(sprite: boolean | undefined = true) {
  const anchorOf = vi.fn((_id: number, _height: number, out: { x: number; y: number; z: number }) =>
    Object.assign(out, { x: 10, y: 2, z: 20 }),
  );
  const host = {
    anchorOf,
    bakedAt: sprite === undefined ? undefined : vi.fn(() => sprite),
    pathRibbon: vi.fn(() => true),
    countPrimitive: vi.fn(),
  };
  const slot = { abilityId: 'red_harvest', casterId: 1, targetId: 2, tier: 0 };
  return {
    host,
    slot,
    draw: () => drawHarvestRelease(host as unknown as SequencerHost, slot as SeqSlot),
  };
}

it('loads only the caster weapons and clears anticipation before the first .15s contact', () => {
  const h = fixture();
  h.draw();
  expect(h.host.anchorOf.mock.calls.every(([id]) => id === 1)).toBe(true);
  expect(h.host.bakedAt).toHaveBeenCalledTimes(2);
  for (const args of h.host.bakedAt!.mock.calls as unknown as unknown[][]) {
    expect(args[7]).toBeLessThan(0.15);
    expect(args[11]).toBe(true);
  }
  expect(h.host.pathRibbon).toHaveBeenCalledTimes(2);
  for (const args of h.host.pathRibbon.mock.calls as unknown as unknown[][])
    expect(args[2]).toBeLessThan(0.15);
});

it.each(['twinstrike', 'secondary'])('does not duplicate the Harvest load for %s', (kind) => {
  const h = fixture();
  if (kind === 'secondary') Object.assign(h.slot, { physicalSecondary: true });
  else h.slot.abilityId = kind;
  h.draw();
  expect(h.host.anchorOf).not.toHaveBeenCalled();
  expect(h.host.pathRibbon).not.toHaveBeenCalled();
});

it('retains the inward weapon gesture when the sprite budget refuses admission', () => {
  const h = fixture(false);
  h.draw();
  expect(h.host.pathRibbon).toHaveBeenCalledTimes(2);
  expect(h.host.countPrimitive).toHaveBeenCalledWith('red_harvest', 2);
});
