// Tempering Strike read before it lands (encounters/smith_heart/
// quench_strike_windup.ts) over a REAL Sim: the template's swing cleave fires
// its cue on the hit, so the fight cues the guardian's wind-up on her once the
// swing under way is the cleaving one and `strikeWindup` seconds out. Every
// cleave the tank eats in steady melee is preceded by exactly one wind-up cue,
// that second before it; no other swing is; the rule itself reads the count,
// the swing timer, the reach and the bar.

import { describe, expect, it } from 'vitest';
import {
  QUENCH_CUES,
  strikeSpentDue,
  strikeWindupDue,
  QUENCH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { DT, type SimEvent } from '../src/sim/types';
import { quenchFight } from './helpers/quench_fight';

const ticks = (s: number) => Math.round(s / DT);
const isCue = (ev: SimEvent, ability: string, src: number) =>
  ev.type === 'spellfx' && ev.fx === 'windup' && ev.ability === ability && ev.sourceId === src;

describe('Guardian of the Quench: Tempering Strike wind-up', () => {
  it('cues her wind-up once, a second before every cleaving swing', () => {
    const f = quenchFight(3);
    expect(f.dev('/dev heart quench pull')).toBe(true);
    f.tick(ticks(T.rimRise) + 2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.breathTimer = 999;
    const boss = f.boss();
    // The tank in her reach, the others well out of the strike's arc.
    const b = f.local(boss);
    f.put(f.players[0], b.x, b.z + 3);
    f.put(f.players[1], b.x + 14, b.z - 10);
    f.put(f.players[2], b.x - 14, b.z - 10);
    const ready: number[] = [];
    const cleave: number[] = [];
    for (let i = 0; i < ticks(45); i++) {
      st.breathTimer = 999;
      for (const ev of f.tick(1)) {
        if (isCue(ev, QUENCH_CUES.strikeReady, boss.id)) ready.push(i);
        if (isCue(ev, 'brood_cleave', boss.id)) cleave.push(i);
      }
    }
    expect(cleave.length).toBeGreaterThanOrEqual(2);
    // Each cleave has its one wind-up, `strikeWindup` (one tick's slack) before it.
    for (const c of cleave) {
      const before = ready.filter((r) => r < c && r >= c - ticks(T.strikeWindup) - 2);
      expect(before.length, `cleave at tick ${c}`).toBe(1);
      expect(c - before[0]).toBeGreaterThanOrEqual(ticks(T.strikeWindup) - 1);
    }
    // And no wind-up is cued for a swing that is not a cleave: at most one
    // stray (a dodged cleaving swing waits for the next, cued again).
    expect(ready.length).toBeLessThanOrEqual(cleave.length + 2);
  });

  it('cues the held swing afresh when a bar takes the window', () => {
    const f = quenchFight(3);
    expect(f.dev('/dev heart quench pull')).toBe(true);
    f.tick(ticks(T.rimRise) + 2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.breathTimer = 999;
    const boss = f.boss();
    const b = f.local(boss);
    f.put(f.players[0], b.x, b.z + 3);
    f.put(f.players[1], b.x + 14, b.z - 10);
    f.put(f.players[2], b.x - 14, b.z - 10);
    // Wait for a wind-up cue, then let the breath's bar start in its second.
    let cued = -1;
    for (let i = 0; i < ticks(40) && cued < 0; i++) {
      st.breathTimer = 999;
      for (const ev of f.tick(1)) if (isCue(ev, QUENCH_CUES.strikeReady, boss.id)) cued = i;
    }
    expect(cued).toBeGreaterThanOrEqual(0);
    st.breathTimer = 0;
    const ready: number[] = [];
    const cleave: number[] = [];
    for (let i = 0; i < ticks(12); i++) {
      if (i > 2) st.breathTimer = 999;
      for (const ev of f.tick(1)) {
        if (isCue(ev, QUENCH_CUES.strikeReady, boss.id)) ready.push(i);
        if (isCue(ev, 'brood_cleave', boss.id)) cleave.push(i);
      }
    }
    // Whatever the bar held, the cleave that lands after it had its own cue.
    for (const c of cleave) {
      const before = ready.filter((r) => r < c && r >= c - ticks(T.strikeWindup) - 2);
      expect(before.length, `cleave at tick ${c}`).toBe(1);
    }
  });

  it('tells an avoided cleaving swing once (her fists come down as a plain swing), never a landed one', () => {
    const f = quenchFight(3);
    expect(f.dev('/dev heart quench pull')).toBe(true);
    f.tick(ticks(T.rimRise) + 2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.breathTimer = 999;
    const boss = f.boss();
    const b = f.local(boss);
    const tank = f.players[0];
    f.put(tank, b.x, b.z + 3);
    f.put(f.players[1], b.x + 14, b.z - 10);
    f.put(f.players[2], b.x - 14, b.z - 10);
    // Wait for a wind-up, then make the tank dodge everything until it resolves.
    let cued = false;
    for (let i = 0; i < ticks(40) && !cued; i++) {
      st.breathTimer = 999;
      for (const ev of f.tick(1)) if (isCue(ev, QUENCH_CUES.strikeReady, boss.id)) cued = true;
    }
    expect(cued).toBe(true);
    const spent: number[] = [];
    const cleave: number[] = [];
    const ready: number[] = [];
    let dodged = 0;
    for (let i = 0; i < ticks(1.5); i++) {
      st.breathTimer = 999;
      tank.dodgeChance = 1;
      for (const ev of f.tick(1)) {
        if (isCue(ev, QUENCH_CUES.strikeSpent, boss.id)) spent.push(i);
        if (isCue(ev, 'brood_cleave', boss.id)) cleave.push(i);
        if (
          ev.type === 'damage' &&
          ev.sourceId === boss.id &&
          (ev.kind === 'dodge' || ev.kind === 'miss' || ev.kind === 'parry')
        )
          dodged++;
      }
    }
    expect(dodged).toBeGreaterThanOrEqual(1);
    expect(cleave).toEqual([]);
    expect(spent.length).toBe(1);
    // Back to a plain tank: the held swing is cued again and lands its cleave,
    // with no spent cue for it.
    const spentAfter: number[] = [];
    for (let i = 0; i < ticks(8); i++) {
      st.breathTimer = 999;
      tank.dodgeChance = 0;
      for (const ev of f.tick(1)) {
        if (isCue(ev, QUENCH_CUES.strikeSpent, boss.id)) spentAfter.push(i);
        if (isCue(ev, QUENCH_CUES.strikeReady, boss.id)) ready.push(i);
        if (isCue(ev, 'brood_cleave', boss.id)) cleave.push(i);
      }
    }
    expect(cleave.length).toBeGreaterThanOrEqual(1);
    expect(ready.length).toBeGreaterThanOrEqual(1);
    const firstCleave = cleave[0];
    expect(spentAfter.filter((t) => t <= firstCleave)).toEqual([]);
  });

  it('calls a swing spent only when the count still waits after a fresh swing wait began', () => {
    const at = (o: Partial<Parameters<typeof strikeSpentDue>[0]>) =>
      strikeSpentDue({
        swingCleaveCount: T.strikeEvery - 1,
        autoAttack: true,
        swingTimer: T.strikeWindup + 1.5,
        castingAbility: null,
        ...o,
      });
    expect(at({})).toBe(true);
    // A landed swing moved the count on (the cleave fired).
    expect(at({ swingCleaveCount: 0 })).toBe(false);
    // Still counting down to the cued swing: nothing was thrown yet.
    expect(at({ swingTimer: T.strikeWindup * 0.5 })).toBe(false);
    // A bar started on the swing's own tick still tells it; a lost reach is
    // no swing.
    expect(at({ castingAbility: 'heart_quench_breath' })).toBe(true);
    expect(at({ autoAttack: false })).toBe(false);
  });

  it('is due only for the cleaving swing, in reach, under a second out, with no bar', () => {
    const at = (o: Partial<Parameters<typeof strikeWindupDue>[0]>) =>
      strikeWindupDue({
        swingCleaveCount: T.strikeEvery - 1,
        autoAttack: true,
        swingTimer: T.strikeWindup * 0.9,
        castingAbility: null,
        ...o,
      });
    expect(at({})).toBe(true);
    expect(at({ swingCleaveCount: T.strikeEvery - 2 })).toBe(false);
    expect(at({ swingCleaveCount: undefined })).toBe(false);
    expect(at({ autoAttack: false })).toBe(false);
    expect(at({ swingTimer: T.strikeWindup + 0.1 })).toBe(false);
    // Waiting at zero (her target out of reach): the swing is not counting down.
    expect(at({ swingTimer: 0 })).toBe(false);
    expect(at({ castingAbility: 'heart_quench_breath' })).toBe(false);
  });
});
