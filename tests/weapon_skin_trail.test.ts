// Weapon-skin swing trails (src/render/weapon_skin_trail_core.ts): the Blade of Lantern Hall
// traces a lantern-fire ribbon through every melee swing; every other skin, a wand's bolt and an
// unskinned weapon swing exactly as before.
import { describe, expect, it, vi } from 'vitest';
import {
  playSkinSwingTrail,
  WEAPON_SKIN_TRAILS,
  weaponSkinSwingTrail,
} from '../src/render/weapon_skin_trail_core';
import { WEAPON_SKINS } from '../src/sim/content/weapon_skins';

describe('weapon skin swing trails', () => {
  it("draws the Lantern Hall blade's lantern-fire streak on a melee swing", () => {
    expect(weaponSkinSwingTrail('lantern_hall_sword')).toEqual({
      color: 0xff9a3c,
      width: 0.34,
      duration: 0.32,
    });
    expect(weaponSkinSwingTrail('lantern_hall_sword', 'melee')).not.toBeNull();
  });

  it('draws nothing for a wand bolt, no skin, an unknown id, or a skin without a trail', () => {
    expect(weaponSkinSwingTrail('lantern_hall_sword', 'wand')).toBeNull();
    expect(weaponSkinSwingTrail(null)).toBeNull();
    expect(weaponSkinSwingTrail(undefined)).toBeNull();
    expect(weaponSkinSwingTrail('')).toBeNull();
    expect(weaponSkinSwingTrail('not_a_skin')).toBeNull();
    expect(weaponSkinSwingTrail('__proto__')).toBeNull();
    expect(weaponSkinSwingTrail('cinderbrand_sword')).toBeNull();
  });

  it('keys every trail by a shipped skin model', () => {
    const models = new Set(Object.values(WEAPON_SKINS).map((s) => s.model));
    for (const model of Object.keys(WEAPON_SKIN_TRAILS))
      expect(models.has(model), model).toBe(true);
  });

  it('feeds the ribbon sink off the main hand only when the wearer carries a trail', () => {
    const sink = { weaponTrail: vi.fn() };
    playSkinSwingTrail(sink, 7, { weaponSkinId: 'lantern_hall_sword' }, 'melee');
    expect(sink.weaponTrail).toHaveBeenCalledWith(7, 0, 0xff9a3c, 0.34, 0.32);
    sink.weaponTrail.mockClear();
    playSkinSwingTrail(sink, 7, { weaponSkinId: null });
    playSkinSwingTrail(sink, 7, undefined);
    playSkinSwingTrail(sink, 7, { weaponSkinId: 'lantern_hall_sword' }, 'wand');
    expect(sink.weaponTrail).not.toHaveBeenCalled();
  });
});
