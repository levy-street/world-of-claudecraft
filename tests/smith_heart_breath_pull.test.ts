// The indrawn breath's pull (encounters/smith_heart/breath_gale.ts, the
// kernel's WIND_PULL_AURA), Jose's playtest of 2026-11-18: "the whirlwind he
// does in the centre barely pulls me" (5.5 yd a second on every tier). Now a
// tier's `pullSpeed`: a body that stands is drawn far in, a run straight
// away still gains ground but only just, Normal gentler than Heroic. Online
// it stays the kernel's predicted drift (no per-tick displacement, the same
// path as every wind: tests/wind_drift_online.test.ts).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  INHALE_SWIRL,
  inhaleSwirlAngle,
  windFieldLook,
} from '../src/render/smith_heart_fx/breath_fight_fx_core';
import {
  BREATH_CASTS,
  BREATH_DIFFICULTY,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart/breath_ids';
import { DT, type Entity, RUN_SPEED } from '../src/sim/types';
import { WIND_PULL_AURA } from '../src/sim/wind_drift';
import { type BreathFight, breathFight } from './helpers/breath_fight';

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe('the indrawn breath pulls hard, by tier', () => {
  it('pins the tier speeds: stronger than the old 5.5, escapable at a run only just', () => {
    expect(BREATH_DIFFICULTY.normal.pullSpeed).toBe(6.2);
    expect(BREATH_DIFFICULTY.heroic.pullSpeed).toBe(6.7);
    expect(BREATH_DIFFICULTY.mythic.pullSpeed).toBe(BREATH_DIFFICULTY.heroic.pullSpeed);
    for (const tier of ['normal', 'heroic', 'mythic'] as const) {
      const net = RUN_SPEED - BREATH_DIFFICULTY[tier].pullSpeed;
      expect(net, tier).toBeGreaterThan(0.2);
      expect(net, tier).toBeLessThan(1);
    }
    // A body left standing through the bar is drawn some 30 yards.
    expect(BREATH_DIFFICULTY.normal.pullSpeed * T.inhaleCast).toBeGreaterThan(30);
  });

  /** The inhale started; `p` set 24 yd out on the guardian's flank. */
  function drawing(tier: '' | 'heroic'): { f: BreathFight; p: Entity; out: number } {
    const f = breathFight(4, 23);
    f.dev('/dev heart breath pull');
    if (tier) f.dev(`/dev heart breath ${tier}`);
    f.tick(2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.skyTimer = 9999;
    st.blowTimer = 9999;
    st.heartTimer = 9999;
    st.circleTimer = 9999;
    f.dev('/dev heart breath inhale');
    f.tick(1);
    const boss = f.boss();
    expect(boss.castingAbility).toBe(BREATH_CASTS.inhale);
    const p = f.players[3];
    const b = f.local(boss);
    // Beside the mouth's line (the vortex aside), on the Cornice.
    const side = boss.facing + Math.PI / 2;
    f.put(p, b.x + Math.sin(side) * 16, b.z + Math.cos(side) * 16);
    f.tick(1);
    return { f, p, out: dist(f.local(p), b) };
  }

  for (const tier of ['', 'heroic'] as const) {
    const name = tier || 'normal';
    const speed = BREATH_DIFFICULTY[name].pullSpeed;

    it(`${name}: the pull aura carries the tier's speed; a body that stands is dragged in`, () => {
      const { f, p, out } = drawing(tier);
      const a = p.auras.find((x) => x.id === WIND_PULL_AURA);
      expect(a?.value3).toBe(speed);
      f.tick(Math.round(1.5 / DT));
      const moved = out - dist(f.local(p), f.local(f.boss()));
      // 1.5 s of pull (walls aside): at least nine yards in.
      expect(moved).toBeGreaterThan(speed * 1.5 * 0.9);
    });

    it(`${name}: a run straight away gains ground, but only slowly`, () => {
      const { f, p, out } = drawing(tier);
      const meta = f.sim.players.get(p.id);
      if (!meta) throw new Error('no meta');
      const b = f.local(f.boss());
      const me = f.local(p);
      p.facing = Math.atan2(me.x - b.x, me.z - b.z);
      const secs = 1.5;
      for (let i = 0; i < Math.round(secs / DT); i++) {
        meta.moveInput.forward = true;
        f.tick(1);
      }
      meta.moveInput.forward = false;
      const gained = dist(f.local(p), f.local(f.boss())) - out;
      expect(gained).toBeGreaterThan(0);
      expect(gained).toBeLessThan((RUN_SPEED - speed) * secs + 0.6);
    });
  }
});

describe('the indrawn breath reads as a whirl', () => {
  it('every inward stream curls the same way on one log spiral, tighter near the maw', () => {
    expect(INHALE_SWIRL.twist).toBeGreaterThan(0.5);
    const far = inhaleSwirlAngle(0, 40, 30);
    const mid = inhaleSwirlAngle(0, 40, 12);
    const near = inhaleSwirlAngle(0, 40, 3);
    expect(far).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(mid);
    // Tighter: the last 9 yards turn more than the 18 before them.
    expect(near - mid).toBeGreaterThan(mid - far);
    expect(inhaleSwirlAngle(1, 40, 40)).toBeCloseTo(1, 9);
  });

  it('the floor dust, the air streaks and the ropes into the maw all ride it', () => {
    const fight = readFileSync('src/render/smith_heart_fx/breath_fight_fx.ts', 'utf8');
    expect(fight).toContain('across = (atan(off.y, off.x) - uSwirl * log(max(r, 1.0))) * 9.0;');
    expect(fight).toContain('uSwirl: { value: INHALE_SWIRL.twist }');
    const streaks = readFileSync('src/render/smith_heart_fx/breath_wind_streaks.ts', 'utf8');
    expect(streaks).toContain('float ang = aSeed.x * 3.14159265 - uSwirl * log(max(rr, 1.0));');
    expect(streaks).toContain('uSwirl: { value: INHALE_SWIRL.twist }');
    const ropes = readFileSync('src/render/smith_heart_fx/breath_inhale_streams.ts', 'utf8');
    expect(ropes).toContain('inhaleSwirlAngle(a0, reach, r)');
  });

  it('the floor reads the draw hard from its first instant', () => {
    const start = windFieldLook('inhale', 0);
    expect(start.inward).toBe(true);
    expect(start.dust).toBeGreaterThanOrEqual(0.75);
    expect(start.strength).toBeGreaterThanOrEqual(0.6);
    expect(windFieldLook('inhale', 1).speed).toBeGreaterThan(20);
  });
});
