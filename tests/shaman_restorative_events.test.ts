import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  shamanCurrentHeal,
  shamanCurrentSpell,
} from '../src/render/ability_vfx/shaman_restorative_events';

function fixture() {
  return {
    anchorOf: vi.fn(
      (_id: number, _fraction: number): THREE.Vector3 | null => new THREE.Vector3(3, 1, 7),
    ),
    burstAt: vi.fn(),
  };
}
const heal = { sourceId: 1, targetId: 2, ability: 'Mending Current', amount: 35 };
const spell = {
  sourceId: 1,
  targetId: 2,
  school: 'nature',
  fx: 'wardBloom',
  ability: 'shaman_mending_current',
};
describe('Mending Current water ownership', () => {
  it('silently claims audio-only applications and gives real healing just a small runoff', () => {
    const fx = fixture();
    expect(
      shamanCurrentHeal(fx, {
        ...heal,
        abilityId: 'shaman_mending_current',
        cueOnly: true,
        amount: 0,
      }),
    ).toBe(true);
    expect(fx.burstAt).not.toHaveBeenCalled();
    expect(shamanCurrentHeal(fx, heal, (id) => id === 1)).toBe(true);
    expect(fx.burstAt).toHaveBeenCalledExactlyOnceWith(
      3,
      1,
      7,
      0xbdece0,
      7,
      0.2,
      'shaman_runoff',
      0.42,
    );
    expect(fx.anchorOf).toHaveBeenCalledWith(2, 0.58);
  });
  it('does not fall back by name over conflicting attribution or unknown legacy sources', () => {
    const fx = fixture();
    expect(shamanCurrentHeal(fx, { ...heal, abilityId: 'healing_wave' }, () => true)).toBe(false);
    expect(shamanCurrentHeal(fx, heal, () => false)).toBe(false);
    expect(shamanCurrentHeal(fx, heal)).toBe(false);
    expect(fx.burstAt).not.toHaveBeenCalled();
  });
  it('owns only the precisely tagged reservoir fill and harvest, preserving unrelated wards', () => {
    const fx = fixture();
    expect(shamanCurrentSpell(fx, spell)).toBe(true);
    expect(fx.burstAt).toHaveBeenCalledOnce();
    fx.burstAt.mockClear();
    expect(shamanCurrentSpell(fx, { ...spell, fx: 'echoBurst' })).toBe(true);
    expect(shamanCurrentSpell(fx, { ...spell, ability: undefined })).toBe(false);
    expect(shamanCurrentSpell(fx, { ...spell, ability: 'stoneward' })).toBe(false);
    expect(fx.burstAt).not.toHaveBeenCalled();
  });
  it('never redirects missing receivers to the caster', () => {
    const fx = fixture();
    fx.anchorOf.mockReturnValue(null);
    expect(shamanCurrentSpell(fx, spell)).toBe(true);
    expect(shamanCurrentHeal(fx, heal, () => true)).toBe(true);
    expect(fx.burstAt).not.toHaveBeenCalled();
    expect(fx.anchorOf.mock.calls.every((call) => call[0] === 2)).toBe(true);
  });
});
