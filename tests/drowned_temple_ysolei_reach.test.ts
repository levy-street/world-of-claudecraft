// Playtest fixes for Ysolei's arena: the Moon Altar in the island's centre no
// longer blocks line of sight to her (it sits inside her body), and her body
// is wider, so melee reaches her from further out while every mechanic that
// hangs off the body keeps its margin.

import { describe, expect, it } from 'vitest';
import { lineOfSightClear } from '../src/sim/colliders';
import { bodyEdgeMeleeRange } from '../src/sim/combat/player_attack_reach';
import { ALTAR_STONE, MOON_ALTAR, YSOLEI_DAIS } from '../src/sim/content/drowned_temple_layout';
import { MOBS } from '../src/sim/data';
import { YSOLEI_TUNING } from '../src/sim/encounters/drowned_temple/ids';
import { boss, fight } from './helpers/temple_fight';

const YSOLEI_ID = 'ysolei';

describe('Ysolei arena: the Moon Altar and her reach', () => {
  it('sees across the Moon Altar from the far side of the island', () => {
    const f = fight();
    const b = boss(f, YSOLEI_ID);
    const seed = f.sim.cfg.seed;
    // A caster on the altar's west face, the stone between them and her coil.
    const caster = { x: f.ox + ALTAR_STONE.x - ALTAR_STONE.r - 4, z: f.oz + ALTAR_STONE.z };
    expect(lineOfSightClear(seed, caster, b.pos)).toBe(true);
    // Both flanks along the island's long axis too.
    for (const dz of [-2, 2]) {
      const flank = { x: caster.x, z: caster.z + dz };
      expect(lineOfSightClear(seed, flank, b.pos)).toBe(true);
    }
  });

  it('keeps the drawn-only altar wholly inside her body', () => {
    const f = fight();
    const b = boss(f, YSOLEI_ID);
    const body = MOBS[YSOLEI_ID]?.bodyRadius ?? 0;
    const far =
      Math.hypot(b.pos.x - (f.ox + ALTAR_STONE.x), b.pos.z - (f.oz + ALTAR_STONE.z)) +
      ALTAR_STONE.r;
    expect(far).toBeLessThanOrEqual(body);
  });

  it('widens her body, and her mechanics move out with it', () => {
    const body = MOBS[YSOLEI_ID]?.bodyRadius ?? 0;
    expect(body).toBe(10);
    // Melee reaches her body's edge plus three.
    expect(bodyEdgeMeleeRange(YSOLEI_ID)).toBe(13);
    // The Undertow drags players to her edge; the Crash still leaves four yards to run.
    expect(YSOLEI_TUNING.crashRadius - body).toBe(4);
    // The Lunar Tide still covers the melee ring standing on her edge.
    expect(YSOLEI_TUNING.lunarRadius).toBeGreaterThan(bodyEdgeMeleeRange(YSOLEI_ID));
    // The melee ring stands on her dais, and the dais stays on the island.
    expect(YSOLEI_DAIS.r).toBeGreaterThanOrEqual(body + 3);
    const daisFar =
      Math.hypot(YSOLEI_DAIS.x - MOON_ALTAR.x, YSOLEI_DAIS.z - MOON_ALTAR.z) + YSOLEI_DAIS.r;
    expect(daisFar).toBeLessThan(MOON_ALTAR.r);
  });
});
