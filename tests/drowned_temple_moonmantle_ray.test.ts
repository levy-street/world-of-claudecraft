// The Moonmantle Ray (the Temple encounter pass): the Pearlguard Sentinel's
// clam golem becomes a sacred manta, DISPLAY ONLY. The id is frozen, and its
// numbers and its three moves are unchanged inside; the moves only take
// manta names (Lunar Glide, Tidal Wingbeat, Nacre Cocoon), and the combat
// log, the cast bar and Laverock's line follow.

import { describe, expect, it } from 'vitest';
import { CANTOR_GUIDE } from '../src/sim/content/drowned_temple_cantor';
import { MOBS } from '../src/sim/data';
import { TEMPLE_PEARL_SLAM } from '../src/sim/mob/trash_kit/temple_cast_ids';
import { TEMPLE_CARAPACE_AURA } from '../src/sim/mob/trash_kit/temple_kit';
import { en } from '../src/ui/i18n.resolved.generated/en';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

const RAY = MOBS.pearlguard_sentinel;

describe('the Moonmantle Ray keeps the Pearlguard Sentinel underneath', () => {
  it('shows its new name on the frozen id', () => {
    expect(RAY.id).toBe('pearlguard_sentinel');
    expect(RAY.name).toBe('Moonmantle Ray');
    expect(en.entities.mobs.pearlguard_sentinel.name).toBe('Moonmantle Ray');
  });

  it('keeps every number the sentinel had', () => {
    expect([RAY.minLevel, RAY.maxLevel, RAY.elite, RAY.family]).toEqual([
      17,
      18,
      true,
      'elemental',
    ]);
    expect([RAY.hpBase, RAY.hpPerLevel, RAY.dmgBase, RAY.dmgPerLevel]).toEqual([64, 23, 12, 2.7]);
    expect([RAY.attackSpeed, RAY.armorPerLevel, RAY.moveSpeed, RAY.scale]).toEqual([
      2.2, 22, 6.5, 1.15,
    ]);
  });

  it('Lunar Glide is the old Onrush: a 5 to 30 yd charge with a half-second stun', () => {
    expect(RAY.charge).toMatchObject({
      name: 'Lunar Glide',
      minRange: 5,
      maxRange: 30,
      cooldown: 12,
      stunDuration: 0.5,
      school: 'physical',
    });
  });

  it('Tidal Wingbeat is the old Pearl Slam: the same bar, ring and shove', () => {
    expect(RAY.trashKit?.wingGust).toMatchObject({
      castId: TEMPLE_PEARL_SLAM,
      name: 'Tidal Wingbeat',
      castTime: 1.5,
      every: 15,
      first: 7,
      school: 'physical',
      radius: 7,
      knockback: 6,
      min: 50,
      max: 60,
    });
    expect(en.abilityUi.cast.temple_pearl_slam).toBe('Tidal Wingbeat');
  });

  it('Nacre Cocoon is the old Pearl Carapace: once under 30 percent, a quarter of its health for 8 s', () => {
    expect(RAY.trashKit?.carapace).toEqual({
      belowHpPct: 0.3,
      shieldPct: 0.25,
      seconds: 8,
      name: 'Nacre Cocoon',
    });
    // The ward's aura id is frozen: the renderer's cocoon stance keys on it.
    expect(TEMPLE_CARAPACE_AURA).toBe('temple_pearl_carapace_ward');
  });

  it('its moves localize through the client matcher', () => {
    for (const name of ['Lunar Glide', 'Tidal Wingbeat', 'Nacre Cocoon'])
      expect(localizeSimAuraName(name)).toBe(name);
  });

  it('Laverock speaks of moon rays, not clams', () => {
    const line = CANTOR_GUIDE.lines.find((l) => l.key === 'sight.sentinel');
    expect(line?.text).toMatch(/moon rays/);
    expect(line?.text).not.toMatch(/clam/i);
    expect(en.dungeonGuide.drownedTemple.sight.sentinel).toBe(line?.text);
  });
});
