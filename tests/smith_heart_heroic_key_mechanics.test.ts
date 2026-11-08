// The Smith's Heart Heroic key mechanics must matter (the second Heroic pass,
// E:/woc/entregas/raid_corazon/heroico/NOTAS.md "Segunda vuelta"): an unhidden
// Mountain's Wrath on Heroic kills a Heroic-geared cloth body (about 110
// percent of its health), and the Quench's shatter lands twice as hard on
// Heroic. Normal and Mythic keep their numbers. Over REAL Sim claims.

import { describe, expect, it } from 'vitest';
import { HAMMER_PIT } from '../src/sim/content/smith_heart_layout';
import {
  COUNCIL_DIFFICULTY,
  COUNCIL_NAMES,
  COUNCIL_TUNING,
  councilFillSeconds,
  QUENCH_DIFFICULTY,
  QUENCH_NAMES,
  QUENCH_TUNING,
} from '../src/sim/encounters/smith_heart';
import { DT, type Entity, type SimEvent } from '../src/sim/types';
import { type CouncilFight, councilFight, hitsOf } from './helpers/council_fight';
import { quenchFight } from './helpers/quench_fight';

/** A Heroic-geared (previous tier's best) level-20 cloth body in the raid,
 *  talents and buffs in: the bot raid's mage 1,395, warlock 1,437 and
 *  priest 1,523 at the pull, about 1,450. */
const HEROIC_CLOTH = 1450;
const ticks = (s: number) => Math.round(s / DT);

function council(tier?: 'heroic' | 'mythic'): CouncilFight {
  const f = councilFight(3, 17);
  f.dev('/dev heart council pull');
  f.tick();
  if (tier) expect(f.dev(`/dev heart council ${tier} on`)).toBe(true);
  const st = f.state();
  if (!st) throw new Error('the council did not pull');
  st.weightTimer = 999;
  st.wakeTimer = 999;
  st.rockTimer = 999;
  st.boltTimer = 999;
  st.songTimer = 999;
  st.rushTimer = 999;
  st.songDue = null;
  return f;
}

/** Every player in the open by the Guardian at the pit's middle, at the cloth
 *  body's health, through one landed Wrath. */
function openWrath(f: CouncilFight): { ev: SimEvent[]; open: Entity[] } {
  const g = f.bodies().guardian as Entity;
  const w = f.world(HAMMER_PIT.x, HAMMER_PIT.z);
  g.pos.x = w.x;
  g.pos.z = w.z;
  g.pos.y = f.sim.ctx.groundPos(w.x, w.z).y;
  g.prevPos = { ...g.pos };
  f.sim.ctx.rebucket(g);
  for (const p of f.pillars()) f.sim.ctx.dropEntity(p.e.id);
  f.inst.objectIds = f.inst.objectIds.filter((id) => f.sim.ctx.entities.has(id));
  // Warriors in the open (plate: the cloth body's health on more armor, so a
  // kill here is a kill on cloth).
  const open = f.players.slice(0, 3);
  open.forEach((p, i) => {
    f.put(p, HAMMER_PIT.x + 6 + i, HAMMER_PIT.z + 4);
    p.maxHp = HEROIC_CLOTH;
    p.hp = HEROIC_CLOTH;
  });
  expect(f.dev('/dev heart council wrath')).toBe(true);
  // The plain sim tick (the helper's tick tops the raid back up).
  const ev: SimEvent[] = [];
  for (let i = 0; i < ticks(COUNCIL_TUNING.wrathCast) + 2; i++) ev.push(...f.sim.tick());
  return { ev, open };
}

describe("Smith's Heart Heroic: Mountain's Wrath kills whoever does not hide", () => {
  it('the tier factor: Heroic 2.8, Normal and Mythic untouched', () => {
    expect(COUNCIL_DIFFICULTY.normal.wrathMult).toBe(1);
    expect(COUNCIL_DIFFICULTY.heroic.wrathMult).toBe(2.8);
    expect(COUNCIL_DIFFICULTY.mythic.wrathMult).toBe(1);
    const H = COUNCIL_DIFFICULTY.heroic;
    const lo = COUNCIL_TUNING.wrathMin * H.damageMult * H.wrathMult;
    const hi = COUNCIL_TUNING.wrathMax * H.damageMult * H.wrathMult;
    // About 110 percent of the cloth body, its lowest roll still past it.
    expect(lo).toBeGreaterThan(HEROIC_CLOTH * 0.95);
    expect((lo + hi) / 2).toBeGreaterThan(HEROIC_CLOTH * 1.05);
    expect((lo + hi) / 2).toBeLessThan(HEROIC_CLOTH * 1.2);
  });

  it('Heroic: an unhidden cloth body dies to the landed Wrath', () => {
    const f = council('heroic');
    const { ev, open } = openWrath(f);
    for (const p of open) {
      expect(hitsOf(ev, COUNCIL_NAMES.wrath, p.id).length).toBe(1);
      expect(p.dead, p.name).toBe(true);
    }
  });

  it('Normal: the same body lives through it', () => {
    const f = council();
    const { ev, open } = openWrath(f);
    for (const p of open) {
      expect(hitsOf(ev, COUNCIL_NAMES.wrath, p.id).length).toBe(1);
      expect(p.dead, p.name).toBe(false);
    }
  });
});

describe("Smith's Heart Heroic: the Council's soft enrage comes after the lethal Wraths' window", () => {
  it('Normal and Mythic speed up after 4 Wraths, Heroic after 8', () => {
    expect(COUNCIL_DIFFICULTY.normal.enrageAfterWraths).toBe(COUNCIL_TUNING.enrageAfterWraths);
    expect(COUNCIL_DIFFICULTY.mythic.enrageAfterWraths).toBe(COUNCIL_TUNING.enrageAfterWraths);
    expect(COUNCIL_DIFFICULTY.heroic.enrageAfterWraths).toBe(8);
    const fill = COUNCIL_TUNING.energyFillSeconds;
    const fast = fill / COUNCIL_TUNING.enrageFillMult;
    expect(councilFillSeconds(false, 4)).toBe(fast);
    expect(councilFillSeconds(false, 7, COUNCIL_TUNING.heirFillSeconds, 8)).toBe(fill);
    expect(councilFillSeconds(false, 8, COUNCIL_TUNING.heirFillSeconds, 8)).toBe(fast);
  });

  it('a Heroic pull keeps the Guardian on its plain fill through its fifth Wrath', () => {
    const f = council('heroic');
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.wraths = 5;
    st.energy = 0;
    f.tick(20);
    const plain = (COUNCIL_TUNING.energyMax / COUNCIL_TUNING.energyFillSeconds) * 1;
    expect(st.energy).toBeGreaterThan(plain * 0.8);
    expect(st.energy).toBeLessThan(plain * 1.3);
  });
});

describe("Smith's Heart Heroic: the Quench's shatter lands twice as hard", () => {
  it('the tier factor: Heroic 2, Normal and Mythic untouched', () => {
    expect(QUENCH_DIFFICULTY.normal.shatterMult).toBe(1);
    expect(QUENCH_DIFFICULTY.heroic.shatterMult).toBe(2);
    expect(QUENCH_DIFFICULTY.mythic.shatterMult).toBe(1);
  });

  for (const tier of ['normal', 'heroic'] as const) {
    it(`${tier}: the shatter's roll on the plain body`, () => {
      const f = quenchFight(6, 29);
      if (tier === 'heroic') expect(f.dev('/dev heart quench heroic')).toBe(true);
      expect(f.dev('/dev heart quench pull')).toBe(true);
      f.tick(ticks(QUENCH_TUNING.rimRise) + 2);
      const st = f.state();
      if (!st) throw new Error('no fight');
      st.breathTimer = 999;
      st.slashTimer = 999;
      const a = f.players[2];
      f.put(a, 182, 14);
      f.tick(1);
      f.dev('/dev heart quench burst', a.id);
      a.maxHp = 5000;
      a.hp = 5000;
      const out: SimEvent[] = [];
      for (let i = 0; i < ticks(QUENCH_TUNING.freezeSeconds) + 2; i++) out.push(...f.sim.tick());
      const dealt = hitsOf(out, QUENCH_NAMES.shatter, a.id);
      expect(dealt.length).toBe(1);
      const R = QUENCH_DIFFICULTY[tier];
      const k = R.damageMult * R.shatterMult;
      expect(dealt[0]).toBeGreaterThanOrEqual(Math.floor(QUENCH_TUNING.shatterMin * k) - 1);
      expect(dealt[0]).toBeLessThanOrEqual(Math.ceil(QUENCH_TUNING.shatterMax * k) + 1);
    });
  }
});
