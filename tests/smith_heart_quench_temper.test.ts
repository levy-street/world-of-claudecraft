// The Guardian of the Quench's tank swap, Rime-Tempered (encounters/
// smith_heart/quench_temper.ts; docs/design/raid/smith_heart.md 7.3): the
// rows per tier, a stack per Tempering Strike off the real swing kernel, the
// cold floor and its freeze (Heroic and Mythic) or its cap (Normal), the
// stacks lapsing on a tank the guardian stops striking, the immunity rule,
// and the tier damage of the pass that came with it (every Heroic hit at
// least Normal's).

import { describe, expect, it } from 'vitest';
import { quenchScopeForDev } from '../src/sim/encounters/smith_heart';
import { isFrozen } from '../src/sim/encounters/smith_heart/quench_cold';
import {
  QUENCH_AURAS,
  QUENCH_DIFFICULTY,
  QUENCH_TUNING as T,
  temperFloor,
} from '../src/sim/encounters/smith_heart/quench_ids';
import { temper } from '../src/sim/encounters/smith_heart/quench_temper';
import { DT, type Entity } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { buildQuenchAlertView } from '../src/ui/hud/dungeon/quench_alert_view';
import { t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { type QuenchFight, quenchFight } from './helpers/quench_fight';

const ticks = (seconds: number) => Math.round(seconds / DT);
const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);
const stacks = (e: Entity) => aura(e, QUENCH_AURAS.tempered)?.stacks ?? 0;

function pulled(tier: 'normal' | 'heroic' | 'mythic' = 'normal', n = 4): QuenchFight {
  const f = quenchFight(n);
  if (tier !== 'normal') expect(f.dev(`/dev heart quench ${tier}`)).toBe(true);
  expect(f.dev('/dev heart quench pull')).toBe(true);
  f.tick(ticks(T.rimRise) + 2);
  const st = f.state();
  if (!st) throw new Error('no fight');
  expect(st.difficulty).toBe(tier);
  st.breathTimer = 999;
  st.slashTimer = 999;
  st.rimeTimer = 999;
  return f;
}

function scope(f: QuenchFight) {
  const s = quenchScopeForDev(f.sim.ctx, f.inst);
  if (!s) throw new Error('no scope');
  return s;
}

/** Everyone but `e` huddled round it (their bars fall; its own would). */
function huddleRound(f: QuenchFight, e: Entity): void {
  const at = f.local(e);
  const others = f.players.filter((p) => p.id !== e.id);
  for (const [i, p] of others.entries())
    f.put(p, at.x + Math.sin(i * 2.1) * 2.5, at.z + Math.cos(i * 2.1) * 2.5);
}

describe('Rime-Tempered: the rows', () => {
  it('Heroic freezes on the fifth stack (15 a stack), Normal caps at 72 (12 x 6)', () => {
    const N = QUENCH_DIFFICULTY.normal;
    const H = QUENCH_DIFFICULTY.heroic;
    expect(N).toMatchObject({ temperCold: 12, temperMax: 6, temperSwap: 4, temperFrost: 0.06 });
    expect(H).toMatchObject({
      temperCold: 15,
      temperMax: 5,
      temperSwap: 3,
      temperFrost: 0.12,
      temperFreezes: true,
    });
    expect(N.temperFreezes).toBe(false);
    expect(N.temperCold * N.temperMax).toBeLessThan(T.coldMax);
    // Mythic is Heroic's swap whole.
    for (const k of [
      'temperCold',
      'temperFrost',
      'temperMax',
      'temperSwap',
      'temperFreezes',
    ] as const)
      expect(QUENCH_DIFFICULTY.mythic[k]).toBe(H[k]);
    expect(temperFloor([{ id: QUENCH_AURAS.tempered, stacks: 3 }], 20)).toBe(60);
    expect(temperFloor([], 20)).toBe(0);
  });

  it('every Heroic hit is at least Normal (1.75 each), the shatter 1.15 and 2.5 in all', () => {
    const N = QUENCH_DIFFICULTY.normal;
    const H = QUENCH_DIFFICULTY.heroic;
    expect(N.damageMult).toBe(1.75);
    expect(N.swingMult).toBe(1.75);
    expect(H.damageMult).toBeGreaterThanOrEqual(N.damageMult);
    expect(H.swingMult).toBeGreaterThanOrEqual(N.swingMult);
    expect(N.damageMult * N.shatterMult).toBeCloseTo(1.15, 6);
    expect(H.damageMult * H.shatterMult).toBeCloseTo(2.5, 6);
    expect(H.damageMult * H.shatterMult).toBeGreaterThanOrEqual(N.damageMult * N.shatterMult);
    expect(QUENCH_DIFFICULTY.mythic).toMatchObject({
      damageMult: H.damageMult,
      swingMult: H.swingMult,
      shatterMult: H.shatterMult,
    });
  });
});

describe('Rime-Tempered: the stacks', () => {
  it('Heroic: each stack lifts the floor and the magic damage taken; the fifth freezes', () => {
    const f = pulled('heroic');
    const s = scope(f);
    const p = f.players[0];
    huddleRound(f, p);
    for (let k = 1; k <= 4; k++) {
      expect(temper(s, p)).toBe(k);
      const a = aura(p, QUENCH_AURAS.tempered);
      expect(a?.kind).toBe('spellvuln');
      expect(a?.value).toBeCloseTo(0.12 * k, 6);
      expect(a?.undispellable).toBe(true);
      expect(f.cold(p)).toBeGreaterThanOrEqual(15 * k);
    }
    // A huddle warms no lower than the floor (60 at four stacks).
    f.tick(ticks(5));
    expect(f.cold(p)).toBeGreaterThanOrEqual(60);
    expect(isFrozen(s, p.id)).toBe(false);
    temper(s, p);
    expect(isFrozen(s, p.id)).toBe(true);
    expect(aura(p, QUENCH_AURAS.frozen)).toBeDefined();
    // The freeze spends the stacks.
    expect(stacks(p)).toBe(0);
  });

  it('Normal: six stacks at most, the bar held at 72, never a freeze from them', () => {
    const f = pulled('normal');
    const s = scope(f);
    const p = f.players[0];
    huddleRound(f, p);
    for (let k = 0; k < 9; k++) temper(s, p);
    expect(stacks(p)).toBe(6);
    expect(aura(p, QUENCH_AURAS.tempered)?.value).toBeCloseTo(0.36, 6);
    f.tick(ticks(6));
    const c = f.cold(p) ?? 0;
    expect(c).toBeGreaterThanOrEqual(72);
    expect(c).toBeLessThan(T.coldMax);
    expect(isFrozen(s, p.id)).toBe(false);
  });

  it('the stacks lapse on a tank the guardian stops striking (the swap clears them)', () => {
    const f = pulled('heroic');
    const s = scope(f);
    const st = f.state();
    if (!st) throw new Error('no fight');
    const p = f.players[1];
    temper(s, p);
    temper(s, p);
    expect(stacks(p)).toBe(2);
    // Every bar held low by hand (no freeze, no huddle on the ice): only the
    // floor lifts this one, until the stacks lapse.
    let floorSeen = 0;
    for (let i = 0; i < T.temperSeconds + 1; i++) {
      for (const q of f.players) st.chill[q.id] = { cold: 0, frozen: 0 };
      f.tick(ticks(1));
      if (i === 5) floorSeen = f.cold(p) ?? 0;
    }
    expect(floorSeen).toBeGreaterThanOrEqual(30);
    expect(stacks(p)).toBe(0);
    st.chill[p.id] = { cold: 0, frozen: 0 };
    f.tick(1);
    expect(f.cold(p) ?? 0).toBeLessThan(5);
  });

  it('immunities are no warmth: the stack lands on a warded tank, and the freeze bites through', () => {
    const f = pulled('heroic');
    const s = scope(f);
    const p = f.players[0];
    for (let k = 0; k < 4; k++) temper(s, p);
    expect(f.dev('/dev heart quench immune', p.id)).toBe(true);
    expect(p.auras.some((a) => a.kind === 'stasis')).toBe(true);
    temper(s, p);
    expect(isFrozen(s, p.id)).toBe(true);
    expect(p.auras.some((a) => a.kind === 'stasis')).toBe(false);
  });

  it('a landed Tempering Strike (the swing kernel resetting its count) tempers its target', () => {
    const f = pulled('heroic');
    const b = f.boss();
    const st = f.state();
    if (!st) throw new Error('no fight');
    const tankId = b.aggroTargetId;
    expect(tankId).not.toBeNull();
    const tank = f.players.find((p) => p.id === tankId) as Entity;
    const before = stacks(tank);
    b.swingCleaveCount = T.strikeEvery - 1;
    f.tick(1);
    b.swingCleaveCount = 0;
    f.tick(1);
    expect(stacks(tank)).toBe(before + 1);
    // A count that never reset is no strike.
    f.tick(2);
    expect(stacks(tank)).toBe(before + 1);
  });

  it('the guardian really strikes: a held tank builds stacks over a fight', () => {
    const f = pulled('heroic');
    const b = f.boss();
    const tankId = b.aggroTargetId as number;
    const tank = f.players.find((p) => p.id === tankId) as Entity;
    // The tank stands at her gown; the rest huddle on it so nobody freezes alone.
    const at = f.local(b);
    f.put(tank, at.x, at.z - 4);
    huddleRound(f, tank);
    let peak = 0;
    for (let i = 0; i < ticks(30); i++) {
      f.tick(1);
      peak = Math.max(peak, stacks(tank));
      if (isFrozen(scope(f), tank.id)) break;
    }
    expect(peak).toBeGreaterThanOrEqual(2);
  });

  it('a wipe takes every stack', () => {
    const f = pulled('heroic');
    const s = scope(f);
    const p = f.players[0];
    temper(s, p);
    expect(f.dev('/dev heart quench reset')).toBe(true);
    f.tick(1);
    expect(stacks(p)).toBe(0);
  });
});

describe('Rime-Tempered: what the tank reads', () => {
  it('the tooltip reads the live stacks, floor and Frost damage, and every tier', () => {
    const f = pulled('heroic');
    const s = scope(f);
    const p = f.players[0];
    temper(s, p);
    temper(s, p);
    const a = p.auras.find((x) => x.id === QUENCH_AURAS.tempered);
    if (!a) throw new Error('no aura');
    const d = auraEffectDescriptor(a);
    expect(d?.key).toBe('hudChrome.auraEffect.quenchGuardian.tempered');
    const text = t(d?.key as never, d?.nums as never);
    expect(text).toContain('tempered you 2 times');
    expect(text).toContain('cannot fall below 30');
    expect(text).toContain('24% more Frost damage');
    expect(text).toContain('(15 cold and 12% Frost damage each)');
    expect(text).toContain(`resets this to ${T.temperSeconds} sec`);
    expect(text).toContain('Swap tanks at 3 stacks');
    expect(text).toContain('stack 5 fills your cold to 100 and you freeze solid');
    expect(text).toContain('Normal stops at 6 stacks (72 cold)');
    expect(localizeSimAuraName('Rime-Tempered')).toBe('Rime-Tempered');
  });

  it('the alert calls the swap at the tier count over the cold bar, and not before', () => {
    const cold = { id: QUENCH_AURAS.cold, value: 60, value2: 1 };
    const two = buildQuenchAlertView({
      auras: [cold, { id: QUENCH_AURAS.tempered, stacks: 2, value2: 20, value3: 3 }],
    });
    expect(two.visible && two.kind).toBe('cold');
    const three = buildQuenchAlertView({
      auras: [cold, { id: QUENCH_AURAS.tempered, stacks: 3, value2: 20, value3: 3 }],
    });
    if (!three.visible) throw new Error('hidden');
    expect(three.kind).toBe('tempered');
    expect(three.title).toBe('Rime-Tempered x3: swap tanks!');
    // The bar stays the cold.
    expect(three.progress).toBeCloseTo(0.6);
    // The freeze still outranks it.
    const frozen = buildQuenchAlertView({
      auras: [
        cold,
        { id: QUENCH_AURAS.tempered, stacks: 4, value3: 3 },
        { id: QUENCH_AURAS.frozen, remaining: 3, duration: 6 },
      ],
    });
    expect(frozen.visible && frozen.kind).toBe('frozen');
  });
});
