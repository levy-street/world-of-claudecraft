// Ysolei's sixth pass (the Codex-built serpent, src/sim/encounters/drowned_temple/
// ysolei.ts): she is a colossal serpent coiled on the Moon Altar, so she never
// leaves it (her reach is a giant's), and her Moonspawn and her enrage each
// open with a roar on a real cast bar (Moonspawn Call, Drowned Wrath) that the
// renderer plays as her Summon and Enrage clips.

import { describe, expect, it } from 'vitest';
import { DROWNED_TEMPLE_SPAWNS } from '../src/sim/content/drowned_temple';
import { ALTAR_STONE, MOON_ALTAR } from '../src/sim/content/drowned_temple_layout';
import { MOBS } from '../src/sim/data';
import {
  MOONSPAWN_ID,
  YSOLEI_CALL,
  YSOLEI_ID,
  YSOLEI_WRATH,
} from '../src/sim/encounters/drowned_temple';
import { boss, engage, fight, local, put, run, until } from './helpers/temple_fight';

describe('Ysolei: a colossal serpent coiled on the Moon Altar', () => {
  it('coils against the altar stone on the causeway line and never leaves it', () => {
    const spawn = DROWNED_TEMPLE_SPAWNS.find((s) => s.mobId === YSOLEI_ID);
    expect(Math.abs((spawn?.x ?? 0) - ALTAR_STONE.x)).toBeLessThan(ALTAR_STONE.r + 1);
    expect(spawn?.z).toBe(MOON_ALTAR.z);
    expect(MOBS[YSOLEI_ID].moveSpeed).toBe(0);
    // A giant's reach: the tank stands at the edge of her coils.
    expect(MOBS[YSOLEI_ID].scale).toBeGreaterThanOrEqual(2.5);
  });

  it('holds the altar however far the tank runs', () => {
    const f = fight();
    const b = boss(f, YSOLEI_ID);
    put(f, f.tank, ALTAR_STONE.x + 8, MOON_ALTAR.z);
    engage(f, b);
    const at = local(f, b);
    run(f, 4, () => put(f, f.tank, ALTAR_STONE.x + 20, MOON_ALTAR.z + 4));
    const now = local(f, b);
    expect(Math.hypot(now.x - at.x, now.z - at.z)).toBeLessThan(0.01);
  });

  it('roars Moonspawn Call as her Moonspawn rise, and Drowned Wrath as she enrages', () => {
    const f = fight();
    const b = boss(f, YSOLEI_ID);
    put(f, f.tank, ALTAR_STONE.x + 8, MOON_ALTAR.z);
    engage(f, b);
    run(f, 1);
    b.hp = Math.floor(b.maxHp * 0.59);
    expect(until(f, () => b.castingAbility === YSOLEI_CALL, 3)).toBe(true);
    const spawn = [...f.sim.ctx.entities.values()].filter(
      (e) => e.templateId === MOONSPAWN_ID && !e.dead,
    );
    expect(spawn.length).toBeGreaterThan(0);
    run(f, 3);
    b.hp = Math.floor(b.maxHp * 0.29);
    // The roar waits for her to be free: the Beckoning Moon her drop to 59
    // percent queued (ysolei_moon.ts, a 3 s bar) may still be running.
    expect(until(f, () => b.castingAbility === YSOLEI_WRATH, 6)).toBe(true);
  });
});
