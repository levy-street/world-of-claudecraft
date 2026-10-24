// The trash engine's visuals pick up the second wave by data alone
// (src/render/trash_engine_fx/trash_engine_fx_core.ts): the Gravecaller
// Adept's volley draws as an engine nova (its sight field and kick glyph), and
// the two new walkers draw as engine orbs in their own looks, with every aura
// they leave glowing on its body.

import { describe, expect, it } from 'vitest';
import {
  engineCatalog,
  isTrashEngineObject,
  ORB_HOVER,
  orbHover,
  SCHOOL_TINT,
  walkerHover,
  walkerTint,
} from '../src/render/trash_engine_fx/trash_engine_fx_core';
import { MOBS } from '../src/sim/data';
import {
  BASTION_DROWNED_SURGE,
  BASTION_THROATLIGHT,
  BASTION_THROATLIGHT_ORB,
} from '../src/sim/mob/trash_kit/bastion_cast_ids';
import { CRYPT_GRAVESPARK_VOLLEY } from '../src/sim/mob/trash_kit/cast_ids';
import {
  TEMPLE_HEARTPEARL,
  TEMPLE_HEARTPEARL_ORB,
  TEMPLE_HEARTPEARL_WARD,
  TEMPLE_NACRE_MANTLE,
} from '../src/sim/mob/trash_kit/temple_cast_ids';

describe('the second wave in the engine catalog', () => {
  const c = engineCatalog();

  it('the adept volley is an engine nova (sight field, kick glyph)', () => {
    expect(c.novas.get(CRYPT_GRAVESPARK_VOLLEY)).toBe(MOBS.crypt_gravecaller_adept.trashKit?.nova);
  });

  it('both orbs are engine walkers keyed by template and launch', () => {
    expect(c.walkers.get(BASTION_THROATLIGHT_ORB)).toBe(MOBS.bastion_revenant.trashKit?.walker);
    expect(c.walkerCasts.get(BASTION_THROATLIGHT)?.objectTemplate).toBe(BASTION_THROATLIGHT_ORB);
    expect(c.walkers.get(TEMPLE_HEARTPEARL_ORB)).toBe(MOBS.pearlguard_sentinel.trashKit?.walker);
    expect(c.walkerCasts.get(TEMPLE_HEARTPEARL)?.objectTemplate).toBe(TEMPLE_HEARTPEARL_ORB);
    expect(isTrashEngineObject(BASTION_THROATLIGHT_ORB)).toBe(true);
    expect(isTrashEngineObject(TEMPLE_HEARTPEARL_ORB)).toBe(true);
  });

  it('every aura they leave glows: the heroic surge, the ward, the mantle', () => {
    expect(c.empowerAuras.has(BASTION_DROWNED_SURGE)).toBe(true);
    expect(c.empowerAuras.has(TEMPLE_HEARTPEARL_WARD)).toBe(true);
    expect(c.empowerAuras.has(TEMPLE_NACRE_MANTLE)).toBe(true);
  });

  it('each orb has its own look: the green sea-light, the low nacre pearl', () => {
    const throat = c.walkers.get(BASTION_THROATLIGHT_ORB);
    const pearl = c.walkers.get(TEMPLE_HEARTPEARL_ORB);
    if (!throat || !pearl) throw new Error('walkers');
    expect(walkerTint(throat)).not.toBe(SCHOOL_TINT[throat.school]);
    expect(walkerTint(pearl)).not.toBe(SCHOOL_TINT[pearl.school]);
    expect(walkerTint(pearl)).not.toBe(walkerTint(throat));
    // The pearl rolls low (step on it); the sea-light floats at the chest.
    expect(walkerHover(pearl)).toBeLessThan(0.6);
    expect(walkerHover(throat)).toBeGreaterThan(1.2);
    expect(walkerHover(undefined)).toBe(ORB_HOVER);
    // The bob scales with the float: never under the floor.
    for (let t = 0; t < 4; t += 0.1)
      expect(orbHover(t, 0, walkerHover(pearl))).toBeGreaterThan(0.3);
  });
});
