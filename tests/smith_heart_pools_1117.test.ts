// Every Smith's Heart boss's pool per tier (the pass of 2026-11-17): set for a
// human raid of ten at about 1,400 DPS (the Varkhul parses), Normal about 4
// to 4.5 minutes of uptime, Heroic about 5, Mythic about 7, each fight's own
// downtime (isles, overflows, intermissions, the Mythic rebirth) taken off.
// And a boss at rest shows its tier's real pool from the start, never the
// template's until the pull (tier_health.ts showTierHealth).

import { describe, expect, it } from 'vitest';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import {
  BREATH_DIFFICULTY,
  COUNCIL_DIFFICULTY,
  QUENCH_DIFFICULTY,
} from '../src/sim/encounters/smith_heart';
import { FINAL_DIFFICULTY } from '../src/sim/encounters/smith_heart/final_ids';
import { HEAT_DIFFICULTY } from '../src/sim/encounters/smith_heart/heat_ids';
import {
  applyTierHealth,
  restoreTierHealth,
  showTierHealth,
} from '../src/sim/encounters/smith_heart/tier_health';
import type { Entity } from '../src/sim/types';

const ELITE = 2.3;
const pool = (ids: string[]) => ids.reduce((t, id) => t + SMITH_HEART_MOBS[id].hpBase * ELITE, 0);
const DPS = 1400;

const BOSSES = [
  {
    name: 'council',
    ids: ['heart_hammer_guardian', 'heart_seam_singer'],
    rows: COUNCIL_DIFFICULTY,
    down: [0, 0, 0],
  },
  { name: 'breath', ids: ['heart_breath_guardian'], rows: BREATH_DIFFICULTY, down: [24, 44, 44] },
  { name: 'quench', ids: ['heart_quench_guardian'], rows: QUENCH_DIFFICULTY, down: [0, 0, 0] },
  { name: 'heat', ids: ['heart_heat_guardian'], rows: HEAT_DIFFICULTY, down: [51, 51, 51] },
  { name: 'final', ids: ['heart_masterless_strength'], rows: FINAL_DIFFICULTY, down: [28, 42, 54] },
] as const;

describe("the Smith's Heart's pools for a 1,400 DPS raid", () => {
  for (const b of BOSSES) {
    it(`${b.name}: about 4.25, 5 and 7 minutes of fight`, () => {
      const base = pool([...b.ids]);
      const tiers = ['normal', 'heroic', 'mythic'] as const;
      const target = [255, 300, 420];
      tiers.forEach((t, i) => {
        // The final's Mythic rebirth (1 to 20 percent) is a fifth more pool.
        const extra = b.name === 'final' && t === 'mythic' ? 1.19 : 1;
        const seconds = (base * b.rows[t].healthMult * extra) / DPS + b.down[i];
        expect(seconds, `${b.name} ${t}`).toBeGreaterThan(target[i] * 0.95);
        expect(seconds, `${b.name} ${t}`).toBeLessThan(target[i] * 1.05);
      });
    });
  }

  it("the Heroic Quench is about 420,000 (the owner's anchor)", () => {
    const hp = pool(['heart_quench_guardian']) * QUENCH_DIFFICULTY.heroic.healthMult;
    expect(hp).toBeGreaterThan(400000);
    expect(hp).toBeLessThan(440000);
  });
});

describe('a boss at rest shows its real pool from the start', () => {
  const body = (maxHp: number) => ({ maxHp, hp: maxHp, dead: false, inCombat: false }) as Entity;

  it('shows the tier pool before the pull; the pull and the reset never compound it', () => {
    const e = body(100000);
    showTierHealth(e, 2);
    expect(e.maxHp).toBe(200000);
    expect(e.hp).toBe(200000);
    // The pull at the same tier changes nothing (the base is the template's).
    const base = applyTierHealth(e, 2);
    expect(base).toBe(100000);
    expect(e.maxHp).toBe(200000);
    e.hp = 150000;
    restoreTierHealth(e, base);
    expect(e.maxHp).toBe(100000);
    showTierHealth(e, 2);
    expect(e.maxHp).toBe(200000);
    expect(e.hp).toBe(200000);
  });

  it('never touches a body in combat or dead', () => {
    const e = body(100000);
    e.inCombat = true;
    showTierHealth(e, 2);
    expect(e.maxHp).toBe(100000);
    const d = body(100000);
    d.dead = true;
    showTierHealth(d, 2);
    expect(d.maxHp).toBe(100000);
  });
});
