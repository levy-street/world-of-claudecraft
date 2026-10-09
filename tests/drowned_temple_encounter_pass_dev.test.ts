// The encounter pass's playtest triggers (/dev temple trigger ..., the
// Temple's dev helper, src/sim/encounters/drowned_temple/index.ts): each new
// mechanic can be fired on an engaged boss, and the Moonmantle Ray can be
// spawned by its new name and pushed into its cocoon.

import { describe, expect, it } from 'vitest';
import { ALTAR_STONE, MOON_ALTAR } from '../src/sim/content/drowned_temple_layout';
import {
  HYDRA_CENTER_ID,
  HYDRA_FROSTLOCKED_TORRENT,
  HYDRA_LEFT_ID,
  HYDRA_RIGHT_ID,
  HYDRA_TOXIC_RIME,
  HYDRA_VENOM_CURRENT,
  POOL,
  YSOLEI_BECKONING_MOON,
  YSOLEI_FALLING_MOON,
  YSOLEI_ID,
  YSOLEI_PLENILUNE_WARD,
} from '../src/sim/encounters/drowned_temple';
import { TEMPLE_CARAPACE_AURA } from '../src/sim/mob/trash_kit/temple_kit';
import { aura, boss, engage, fight, put, run } from './helpers/temple_fight';

describe('the encounter pass dev triggers', () => {
  it('fires each Combined Breath by name on an engaged Hydra', () => {
    const f = fight();
    const heads = [HYDRA_LEFT_ID, HYDRA_CENTER_ID, HYDRA_RIGHT_ID].map((id) => boss(f, id));
    put(f, f.tank, POOL.x, POOL.z - 2);
    put(f, f.others[0], POOL.x + 8, POOL.z - 14);
    put(f, f.others[1], POOL.x - 8, POOL.z - 14);
    for (const h of heads) engage(f, h);
    run(f, 0.1);
    for (const [word, castId] of [
      ['frostlock', HYDRA_FROSTLOCKED_TORRENT],
      ['current', HYDRA_VENOM_CURRENT],
      ['rime', HYDRA_TOXIC_RIME],
    ] as const) {
      f.sim.chat(`/dev temple trigger ${word}`, f.tank.id);
      run(f, 0.1);
      expect(heads.some((h) => h.castingAbility === castId)).toBe(true);
      run(f, 2.2);
    }
  });

  it('beckons the moon and brings the Full Moon down on an engaged Ysolei', () => {
    const f = fight();
    const b = boss(f, YSOLEI_ID);
    put(f, f.tank, ALTAR_STONE.x + 8, MOON_ALTAR.z);
    engage(f, b);
    run(f, 0.2);
    f.sim.chat('/dev temple trigger tears', f.tank.id);
    expect(b.castingAbility).toBe(YSOLEI_BECKONING_MOON);
    run(f, 3.3);
    f.sim.chat('/dev temple trigger fullmoon', f.tank.id);
    expect(b.castingAbility).toBe(YSOLEI_FALLING_MOON);
    expect(aura(b, YSOLEI_PLENILUNE_WARD)).toBeDefined();
  });

  it('spawns a Moonmantle Ray by name and folds it into its cocoon', () => {
    const f = fight();
    f.sim.chat('/dev temple spawn manta', f.tank.id);
    const ray = f.inst.mobIds
      .map((id) => f.sim.ctx.entities.get(id))
      .find((e) => e && !e.dead && e.templateId === 'pearlguard_sentinel' && e.inCombat);
    expect(ray).toBeDefined();
    f.sim.chat('/dev temple trigger cocoon', f.tank.id);
    run(f, 0.2);
    expect(ray && aura(ray, TEMPLE_CARAPACE_AURA)?.kind).toBe('absorb');
  });
});
