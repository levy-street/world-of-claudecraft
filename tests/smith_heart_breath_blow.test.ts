// The Guardian of the Breath's tank swap (encounters/smith_heart/
// breath_blow.ts; docs/design/raid/smith_heart.md 7.2): Bellows Blow in the
// Wind (a throw that grows with Wind-Battered: Heroic's fifth goes off the
// Cornice, Normal's never does), Thunder Lash in the Storm (Thunder-Laden:
// more magic damage taken, the Leaping Bolt drawn on to it), the stacks
// lapsing, the storm spending the Wind's, the anchored keeping their feet,
// and the guardian's own clock casting both at its tank.

import { describe, expect, it } from 'vitest';
import {
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_DIFFICULTY,
  BREATH_NAMES,
  breathScopeForDev,
  inBreathArena,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import {
  blowRuinous,
  blowThrow,
  drawBolts,
  landBlow as landBlowRaw,
  landThunder as landThunderRaw,
  safeThrowReach,
} from '../src/sim/encounters/smith_heart/breath_blow';
import { DT, type Entity, type SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { buildKnotAlertView } from '../src/ui/hud/dungeon/knot_alert_view';
import { t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { type BreathFight, breathFight } from './helpers/breath_fight';

const ticks = (seconds: number) => Math.round(seconds / DT);

/** A level-20 body would die to a few hits: every raider topped up first
 *  (an aura's stat recalc gives a test body its real pool back). */
function topUp(e: Entity): void {
  e.maxHp = 50000;
  e.hp = 50000;
}
type Scope = Parameters<typeof landBlowRaw>[0];
const landBlow = (s: Scope, id: number) => {
  for (const p of s.players) topUp(p);
  return landBlowRaw(s, id);
};
const landThunder = (s: Scope, id: number) => {
  for (const p of s.players) topUp(p);
  return landThunderRaw(s, id);
};
const stacksOf = (e: Entity, id: string) => e.auras.find((a) => a.id === id)?.stacks ?? 0;

function pulled(tier: 'normal' | 'heroic' = 'normal', n = 4): BreathFight {
  const f = breathFight(n);
  if (tier === 'heroic') expect(f.dev('/dev heart breath heroic')).toBe(true);
  expect(f.dev('/dev heart breath pull')).toBe(true);
  f.tick(2);
  const st = f.state();
  if (!st) throw new Error('no fight');
  expect(st.difficulty).toBe(tier);
  // Only the swap runs on its own clock where a test asks for it.
  st.blowTimer = 999;
  st.inhaleTimer = 999;
  st.circleTimer = 999;
  st.heartTimer = 999;
  // The blows across the Cornice (much stronger since 2026-11-17: an idle
  // body goes off the edge) and the sky strikes keep to their own tests.
  st.wind.phase = 'calm';
  st.wind.remaining = 999;
  st.skyTimer = 999;
  return f;
}

function scope(f: BreathFight) {
  const s = breathScopeForDev(f.sim.ctx, f.inst);
  if (!s) throw new Error('no scope');
  return s;
}

function tankOf(f: BreathFight): Entity {
  const id = f.boss().aggroTargetId;
  const t = f.players.find((p) => p.id === id);
  if (!t) throw new Error('no tank');
  return t;
}

/** The guardian at local (x, z), the tank `off` yards east of it. */
function stage(f: BreathFight, x: number, z: number, off: number): Entity {
  const b = f.boss();
  const w = f.world(x, z);
  b.pos.x = w.x;
  b.pos.z = w.z;
  b.prevPos = { ...b.pos };
  f.sim.ctx.rebucket(b);
  const t = tankOf(f);
  f.put(t, x + off, z);
  return t;
}

describe('Bellows Blow and Thunder Lash: the rows', () => {
  it('Heroic and Mythic throw 6, 10, 15, 22, then 60 yd (ruinous); Normal is safe', () => {
    const N = BREATH_DIFFICULTY.normal;
    const H = BREATH_DIFFICULTY.heroic;
    expect(H.blowThrow).toEqual([6, 10, 15, 22, 60]);
    expect([0, 1, 2, 3, 4, 9].map((k) => blowThrow(H, k))).toEqual([6, 10, 15, 22, 60, 60]);
    expect(blowRuinous(H, 3)).toBe(false);
    expect(blowRuinous(H, 4)).toBe(true);
    expect(H).toMatchObject({ blowSafe: false, blowSwap: 3, thunderSwap: 3, thunderDraw: 3 });
    expect(N).toMatchObject({ blowSafe: true, blowSwap: 4, thunderSwap: 4, thunderDraw: 4 });
    expect(blowRuinous(N, 9)).toBe(false);
    for (const k of ['blowThrow', 'blowSafe', 'blowMax', 'blowSwap', 'thunderPct'] as const)
      expect(BREATH_DIFFICULTY.mythic[k]).toEqual(H[k]);
    // The ruinous throw is longer than the Cornice is wide from its middle.
    expect(blowThrow(H, 4)).toBeGreaterThan(50);
  });

  it('the safe reach stops short of the lip, and is the whole throw in the middle', () => {
    expect(safeThrowReach(0, 196, 1, 0, 11)).toBe(11);
    const r = safeThrowReach(40, 196, 1, 0, 30);
    expect(r).toBeLessThan(10);
    expect(inBreathArena(40 + r, 196)).toBe(true);
  });
});

describe('Bellows Blow: the Wind', () => {
  it('the guardian casts it at its tank on its clock: a telegraph, then a throw and a stack', () => {
    const f = pulled('heroic');
    const st = f.state();
    if (!st) throw new Error('no fight');
    const t = stage(f, 0, 196, 3);
    st.blowTimer = 0;
    st.gap = 0;
    f.tick(1);
    expect(f.boss().castingAbility).toBe(BREATH_CASTS.blow);
    expect(f.boss().castTargetId).toBe(t.id);
    const mark = t.auras.find((a) => a.id === BREATH_AURAS.blowMark);
    expect(mark?.value).toBe(6);
    expect(mark?.value2).toBe(0);
    const ev: SimEvent[] = f.tick(ticks(T.blowCast) + 2);
    expect(stacksOf(t, BREATH_AURAS.battered)).toBe(1);
    expect(t.auras.some((a) => a.id === BREATH_AURAS.blowMark)).toBe(false);
    expect(
      ev.some(
        (e) => e.type === 'damage' && (e as { ability?: string }).ability === BREATH_NAMES.blow,
      ),
    ).toBe(true);
    // Its next comes round again.
    expect(st.blowTimer).toBeGreaterThan(T.blowEvery - 3);
  });

  it('each stack throws the next blow further; the slide carries the tank away from it', () => {
    const f = pulled('heroic');
    const s = scope(f);
    const t = stage(f, -10, 196, 2);
    const before = f.local(t);
    expect(landBlow(s, t.id)).toBe(6);
    f.tick(ticks(T.roarSlide) + 2);
    const after = f.local(t);
    expect(after.x - before.x).toBeGreaterThan(4);
    stage(f, -10, 196, 2);
    landBlow(s, t.id);
    stage(f, -10, 196, 2);
    expect(landBlow(s, t.id)).toBe(15);
    expect(stacksOf(t, BREATH_AURAS.battered)).toBe(3);
  });

  it('Heroic: the fifth blow (four stacks on) throws the tank off the Cornice to its death', () => {
    const f = pulled('heroic');
    const s = scope(f);
    const t = stage(f, 0, 196, 3);
    for (let k = 0; k < 4; k++) {
      stage(f, 0, 196, 3);
      landBlow(s, t.id);
      f.tick(ticks(T.roarSlide) + 2);
      expect(t.dead).toBe(false);
    }
    expect(stacksOf(t, BREATH_AURAS.battered)).toBe(4);
    stage(f, 0, 196, 3);
    // Past the floor's edge on its line (the edge east of the middle, 4 yd on).
    const sent = landBlow(s, t.id);
    expect(sent).toBeGreaterThan(40);
    expect(sent).toBeLessThanOrEqual(60);
    f.tick(ticks(8));
    expect(t.dead).toBe(true);
  });

  it('Normal: however many stacks, the blow displaces and never throws off the Cornice', () => {
    const f = pulled('normal');
    const s = scope(f);
    const t = stage(f, 30, 196, 6);
    for (let k = 0; k < 8; k++) {
      stage(f, 30, 196, 6);
      landBlow(s, t.id);
      f.tick(ticks(T.roarSlide) + 4);
      const at = f.local(t);
      expect(t.dead).toBe(false);
      expect(inBreathArena(at.x, at.z)).toBe(true);
    }
    expect(stacksOf(t, BREATH_AURAS.battered)).toBe(BREATH_DIFFICULTY.normal.blowMax);
  });

  it('the anchored keep their feet (the blow still lands and stacks)', () => {
    const f = pulled('heroic');
    const s = scope(f);
    const t = stage(f, 0, 196, 3);
    t.auras.push({
      id: BREATH_AURAS.anchor,
      name: 'Anchored in Calm',
      kind: 'internal_cd',
      remaining: 10,
      duration: 10,
      value: 0,
      sourceId: f.boss().id,
      school: 'nature',
    });
    expect(landBlow(s, t.id)).toBe(0);
    expect(stacksOf(t, BREATH_AURAS.battered)).toBe(1);
  });

  it('the stacks lapse on a tank no blow strikes again, and the storm spends them', () => {
    const f = pulled('heroic');
    const s = scope(f);
    const t = stage(f, 0, 196, 3);
    landBlow(s, t.id);
    landBlow(s, t.id);
    expect(stacksOf(t, BREATH_AURAS.battered)).toBe(2);
    f.tick(ticks(T.blowStackSeconds + 1));
    expect(stacksOf(t, BREATH_AURAS.battered)).toBe(0);
    landBlow(s, t.id);
    expect(stacksOf(t, BREATH_AURAS.battered)).toBe(1);
    f.dev('/dev heart breath phase2');
    f.tick(ticks(T.stormCast) + 2);
    expect(stacksOf(t, BREATH_AURAS.battered)).toBe(0);
  });
});

describe('Thunder Lash: the Storm', () => {
  function storm(tier: 'normal' | 'heroic'): BreathFight {
    const f = pulled(tier, 6);
    f.dev('/dev heart breath phase2');
    f.tick(ticks(T.stormCast + T.barrageSeconds) + 4);
    const st = f.state();
    if (!st) throw new Error('no fight');
    expect(st.half).toBe('storm');
    st.forkTimer = 999;
    st.cradleTimer = 999;
    st.drawnTimer = 999;
    st.thunderTimer = 999;
    return f;
  }

  it('the guardian lashes its tank on its clock; each stack adds magic damage taken', () => {
    const f = storm('heroic');
    const st = f.state();
    if (!st) throw new Error('no fight');
    const t = tankOf(f);
    st.thunderTimer = 0;
    st.gap = 0;
    f.tick(1);
    expect(f.boss().castingAbility).toBe(BREATH_CASTS.thunder);
    f.tick(ticks(T.thunderCast) + 2);
    const a = t.auras.find((x) => x.id === BREATH_AURAS.thunderLaden);
    expect(a?.stacks).toBe(1);
    expect(a?.kind).toBe('spellvuln');
    expect(a?.value).toBeCloseTo(0.2, 6);
    const s = scope(f);
    landThunder(s, t.id);
    landThunder(s, t.id);
    expect(t.auras.find((x) => x.id === BREATH_AURAS.thunderLaden)?.value).toBeCloseTo(0.6, 6);
    // No throw in the Storm: the Wind's stacks stay away.
    expect(stacksOf(t, BREATH_AURAS.battered)).toBe(0);
  });

  it('at the draw count every Leaping Bolt leaps on to the Thunder-Laden, below it never', () => {
    const f = storm('heroic');
    const s = scope(f);
    const t = tankOf(f);
    const other = f.players.find((p) => p.id !== t.id) as Entity;
    landThunder(s, t.id);
    landThunder(s, t.id);
    expect(drawBolts(s, [other], T.forkMin, T.forkMax)).toEqual([]);
    landThunder(s, t.id);
    expect(drawBolts(s, [other], T.forkMin, T.forkMax).map((p) => p.id)).toEqual([t.id]);
    // One already struck is not struck twice.
    expect(drawBolts(s, [other, t], T.forkMin, T.forkMax)).toEqual([]);
  });

  it('Normal draws later (4) and adds less (8 percent a stack)', () => {
    const f = storm('normal');
    const s = scope(f);
    const t = tankOf(f);
    const other = f.players.find((p) => p.id !== t.id) as Entity;
    for (let k = 0; k < 3; k++) landThunder(s, t.id);
    expect(t.auras.find((x) => x.id === BREATH_AURAS.thunderLaden)?.value).toBeCloseTo(0.24, 6);
    expect(drawBolts(s, [other], T.forkMin, T.forkMax)).toEqual([]);
    landThunder(s, t.id);
    expect(drawBolts(s, [other], T.forkMin, T.forkMax).map((p) => p.id)).toEqual([t.id]);
  });

  it('a wipe takes every swap mark', () => {
    const f = storm('heroic');
    const s = scope(f);
    const t = tankOf(f);
    landThunder(s, t.id);
    expect(f.dev('/dev heart breath reset')).toBe(true);
    f.tick(1);
    expect(stacksOf(t, BREATH_AURAS.thunderLaden)).toBe(0);
  });
});

describe('The Breath swap: what the tank reads', () => {
  const alert = (auras: Parameters<typeof buildKnotAlertView>[0]['auras']) =>
    buildKnotAlertView({ auras, pos: { x: 0, z: 0 }, interactKey: 'F', touch: false });

  it('the tooltips read the live throw, stacks and draw, and the tiers', () => {
    const f = pulled('heroic');
    const s = scope(f);
    const t0 = stage(f, -10, 196, 2);
    landBlow(s, t0.id);
    landBlow(s, t0.id);
    const bat = t0.auras.find((a) => a.id === BREATH_AURAS.battered);
    if (!bat) throw new Error('no aura');
    expect([bat.value, bat.value2, bat.value3]).toEqual([15, 0, 3]);
    const d = auraEffectDescriptor(bat);
    const text = t(d?.key as never, d?.nums as never);
    expect(text).toContain('Your next Bellows Blow throws you 15 yd');
    expect(text).toContain('(2 stacks');
    expect(text).toContain(`resets this to ${T.blowStackSeconds} sec`);
    expect(text).toContain('Swap tanks at 3 stacks');
    expect(text).toContain('the blow at 4 stacks throws you off the Cornice');
    const mark = auraEffectDescriptor({
      id: BREATH_AURAS.blowMark,
      kind: 'internal_cd',
      value: 22,
      value2: 0,
    });
    expect(t(mark?.key as never, mark?.nums as never)).toContain('throws you 22 yd');
    const ruin = auraEffectDescriptor({
      id: BREATH_AURAS.blowMark,
      kind: 'internal_cd',
      value: 60,
      value2: 1,
    });
    expect(t(ruin?.key as never, ruin?.nums as never)).toContain('off the Cornice');
    const laden = auraEffectDescriptor({
      id: BREATH_AURAS.thunderLaden,
      kind: 'spellvuln',
      value: 0.6,
      value2: 3,
      value3: 3,
      stacks: 3,
    });
    const lt = t(laden?.key as never, laden?.nums as never);
    expect(lt).toContain('60% more Nature and other magic damage (20% for each of 3 stacks)');
    expect(lt).toContain('From 3 stacks, every Leaping Bolt also leaps to you');
    for (const n of ['Bellows Blow', 'Wind-Battered', 'Thunder Lash', 'Thunder-Laden'])
      expect(localizeSimAuraName(n), n).toBe(n);
    for (const id of [BREATH_CASTS.blow, BREATH_CASTS.thunder])
      expect(t(`abilityUi.cast.${id}` as never)).not.toContain('abilityUi');
  });

  it('the knot alert keeps the ruinous blow only (the swap is the shared tank swap alert)', () => {
    // Wind-Battered and Thunder-Laden at their count paint nothing here now
    // (tests/smith_heart_tank_swap_alert.test.ts owns the swap's cue).
    const due = alert([
      { id: BREATH_AURAS.battered, remaining: 20, duration: 25 },
      { id: BREATH_AURAS.thunderLaden, remaining: 5, duration: 25 },
    ]);
    expect(due.visible).toBe(false);
    const ruin = alert([
      { id: BREATH_AURAS.battered, remaining: 20, duration: 25 },
      { id: BREATH_AURAS.blowMark, value2: 1, remaining: 1, duration: 1.7 },
    ]);
    if (!ruin.visible) throw new Error('hidden');
    expect(ruin.kind).toBe('ruin');
    expect(ruin.title).toBe('Bellows Blow throws you off the edge!');
    // A blow that is not ruinous asks nothing.
    const safe = alert([{ id: BREATH_AURAS.blowMark, value2: 0, remaining: 1, duration: 1.7 }]);
    expect(safe.visible).toBe(false);
    // The Knotted Gale's marks still come first.
    const carry = alert([
      { id: BREATH_AURAS.blowMark, value2: 1, remaining: 1, duration: 1.7 },
      { id: BREATH_AURAS.laden, remaining: 8, duration: 15 },
    ]);
    expect(carry.visible && carry.kind).toBe('carry');
  });
});
