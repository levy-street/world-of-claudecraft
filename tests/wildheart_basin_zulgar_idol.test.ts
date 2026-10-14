// Zulgar's final phase, The Idol Wakes (src/sim/encounters/wildheart_basin/
// zulgar.ts and zulgar_idol.ts, the 2026-10-13 rework): at 30 percent the
// template enrage is gone and the stone jaguar wakes instead: he is the
// Jaguar Avatar until he dies, switching Prey every 8 s (the tank included),
// while the Idol's Breath marks one half of the terrace for 5 s and then lands
// on it, alternating halves; the hunt's protections still hold; heroic snuffs
// the lit glyphs of the breathed half. On a real claimed Basin with a real
// party (tests/helpers/wildheart_fight.ts).

import { describe, expect, it } from 'vitest';
import { SHRINE_TERRACE, SUN_GLYPHS } from '../src/sim/content/wildheart_basin_layout';
import { MOBS } from '../src/sim/data';
import {
  glyphsLit,
  IDOL_BREATH_FIELD,
  idolBreathFacing,
  idolBreathSideOf,
  inIdolBreathHalf,
  ZULGAR_TUNING as T,
  WILDHEART_IDOL_BREATH,
  WILDHEART_IDOL_BREATH_WARNING,
  WILDHEART_SUN_GLYPH_DARK,
  WILDHEART_SUN_GLYPH_LIT,
  ZULGAR_AVATAR,
  ZULGAR_ID,
  ZULGAR_IDOL_AWAKE,
  ZULGAR_IDOL_WAKES,
  ZULGAR_IDOLS_BREATH,
  ZULGAR_MAULED,
  ZULGAR_PREY,
  ZULGAR_SPIRIT_HUNT,
} from '../src/sim/encounters/wildheart_basin';
import { type Aura, DT, type Entity, type ZulgarFightState } from '../src/sim/types';
import {
  aura,
  boss,
  engage,
  type Fight,
  fight,
  hitsOn,
  objects,
  put,
  run,
  tick,
  until,
  wipe,
} from './helpers/wildheart_fight';

/** Zulgar is held at the terrace's heart, off every glyph, on the centre line. */
const HOLD = { x: 0, z: 218 } as const;
/** Four spots out of his reach and off every glyph: two east, two west. */
const SPOTS: readonly [number, number][] = [
  [10, 208],
  [-10, 208],
  [22, 224],
  [-22, 224],
];

function pull(f: Fight): Entity {
  const z = boss(f, ZULGAR_ID);
  put(f, z, HOLD.x, HOLD.z);
  [f.tank, ...f.others].forEach((p, i) => {
    put(f, p, SPOTS[i][0], SPOTS[i][1]);
  });
  engage(f, z);
  tick(f);
  return z;
}

function dev(f: Fight, what: string): void {
  f.sim.chat(`/dev wildheart trigger ${what}`, f.tank.id);
}

function st(z: Entity): ZulgarFightState {
  if (z.wildheartFight?.kind !== 'zulgar') throw new Error('no zulgar fight');
  return z.wildheartFight;
}

function everyone(f: Fight): Entity[] {
  return [f.tank, ...f.others];
}

function prey(f: Fight): Entity[] {
  return everyone(f).filter((p) => aura(p, ZULGAR_PREY));
}

/** He stays at the heart, everyone on their spot (nobody is ever in reach). */
function hold(f: Fight, z: Entity): () => void {
  return () => {
    put(f, z, HOLD.x, HOLD.z);
    everyone(f).forEach((p, i) => {
      put(f, p, SPOTS[i][0], SPOTS[i][1]);
    });
  };
}

function breathObjects(f: Fight): Entity[] {
  return [...objects(f, WILDHEART_IDOL_BREATH_WARNING), ...objects(f, WILDHEART_IDOL_BREATH)];
}

describe('the pure half', () => {
  it('a side and its facing round-trip; the centre line is safe', () => {
    expect(idolBreathSideOf(idolBreathFacing(1))).toBe(1);
    expect(idolBreathSideOf(idolBreathFacing(-1))).toBe(-1);
    expect(inIdolBreathHalf(0.01, 1)).toBe(true);
    expect(inIdolBreathHalf(-0.01, 1)).toBe(false);
    expect(inIdolBreathHalf(0, 1)).toBe(false);
    expect(inIdolBreathHalf(0, -1)).toBe(false);
    expect(inIdolBreathHalf(-5, -1)).toBe(true);
  });

  it('the field is the terrace: its centre line, its length and its reach', () => {
    const xs = SHRINE_TERRACE.points.map(([x]) => Math.abs(x));
    const zs = SHRINE_TERRACE.points.map(([, z]) => z);
    expect(IDOL_BREATH_FIELD.x).toBe(0);
    expect(IDOL_BREATH_FIELD.reach).toBe(Math.max(...xs));
    expect(IDOL_BREATH_FIELD.minZ).toBe(Math.min(...zs));
    expect(IDOL_BREATH_FIELD.maxZ).toBe(Math.max(...zs));
    // Three glyphs in each half.
    expect(SUN_GLYPHS.filter((g) => inIdolBreathHalf(g.x, 1))).toHaveLength(3);
    expect(SUN_GLYPHS.filter((g) => inIdolBreathHalf(g.x, -1))).toHaveLength(3);
    // The warning outlasts a run from the far rim to the centre line (7 yd a second).
    expect(T.breathWarning).toBeGreaterThan(IDOL_BREATH_FIELD.reach / 7);
  });
});

describe('The Idol Wakes at 30 percent', () => {
  it('replaces the template enrage: a 2 s bar from a plain phase, then the avatar until he dies', () => {
    expect(MOBS[ZULGAR_ID].enrage).toBeUndefined();
    expect(MOBS[ZULGAR_ID].yells?.enrage).toBeUndefined();
    const f = fight();
    const z = pull(f);
    const swing = { ...z.weapon };
    z.hp = Math.floor(z.maxHp * (T.idolAtHpPct - 0.01));
    tick(f);
    expect(z.castingAbility).toBe(ZULGAR_IDOL_WAKES);
    expect(z.castTotal).toBe(T.idolWakeCast);
    expect(st(z).phase).toBe('fight');
    run(f, T.idolWakeCast + 0.1, hold(f, z));
    expect(st(z).phase).toBe('final');
    expect(aura(z, ZULGAR_IDOL_AWAKE)?.permanent).toBe(true);
    const avatar = aura(z, ZULGAR_AVATAR);
    expect(avatar?.permanent).toBe(true);
    expect(avatar?.value).toBe(T.huntSpeedMult);
    expect(prey(f)).toHaveLength(1);
    // No enrage of any kind: his swing is what it was, and he is not flagged.
    expect(z.enraged).toBe(false);
    expect(z.weapon).toEqual(swing);
    // It outlasts a hunt's 20 s by far, and never throws another bar.
    const keep = hold(f, z);
    for (let t = 0; t < T.huntSeconds + 10; t += DT) {
      tick(f, keep);
      expect(z.castingAbility).toBeNull();
    }
    expect(st(z).phase).toBe('final');
    expect(aura(z, ZULGAR_AVATAR)).toBeDefined();
  }, 60_000);

  it('skips the hunts it overtakes: no Spirit of the Hunt bar under 30 percent', () => {
    const f = fight();
    const z = pull(f);
    z.hp = Math.floor(z.maxHp * 0.2);
    tick(f);
    expect(z.castingAbility).toBe(ZULGAR_IDOL_WAKES);
    run(f, T.idolWakeCast + 0.1, hold(f, z));
    expect(st(z).huntsFired).toBe(T.huntAtHpPct.length);
    expect(z.castingAbility).not.toBe(ZULGAR_SPIRIT_HUNT);
  });

  it('over a hunt in flight: no bar, the hunt simply never ends, its Prey and respites kept', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'prey');
    const keep = hold(f, z);
    const [marked] = prey(f);
    // A respite from this hunt must survive the wake.
    st(z).respite.push({ id: f.tank.id, left: 3 });
    z.hp = Math.floor(z.maxHp * (T.idolAtHpPct - 0.01));
    tick(f, keep);
    expect(st(z).phase).toBe('final');
    expect(z.castingAbility).toBeNull();
    expect(aura(marked, ZULGAR_PREY)).toBeDefined();
    expect(st(z).respite.some((r) => r.id === f.tank.id)).toBe(true);
    expect(aura(z, ZULGAR_AVATAR)?.permanent).toBe(true);
    run(f, T.huntSeconds + 2, keep);
    expect(st(z).phase).toBe('final');
  }, 60_000);
});

describe('the final hunt', () => {
  it('he switches Prey every 8 s, never to the same one twice running, and hunts the tank too', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'idol');
    const keep = hold(f, z);
    const turns: { id: number; at: number }[] = [];
    for (let t = 0; t < 96; t += DT) {
      tick(f, keep);
      const [p] = prey(f);
      if (p && turns[turns.length - 1]?.id !== p.id) turns.push({ id: p.id, at: t });
    }
    expect(turns.length).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < turns.length; i++) {
      expect(turns[i].id).not.toBe(turns[i - 1].id);
      // To the tick (the first turn was already one tick old when read).
      const turn = turns[i].at - turns[i - 1].at;
      expect(Math.abs(turn - T.finalPreySeconds)).toBeLessThan(DT + 1e-6);
    }
    expect(turns.some((turn) => turn.id === f.tank.id)).toBe(true);
    // The mark shows the turn it has left.
    const [now] = prey(f);
    expect(aura(now, ZULGAR_PREY)?.duration).toBe(T.finalPreySeconds);
  }, 120_000);

  it('a switch never catches the new Prey where it stands: he turns on it for 1.5 s first', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'idol');
    tick(f, hold(f, z));
    const first = prey(f)[0];
    expect(first).toBeDefined();
    // The Prey keeps away; everyone else stands at his feet, as a melee does.
    const crowd = () => {
      put(f, z, HOLD.x, HOLD.z);
      for (const p of everyone(f)) {
        if (p.id === first.id) put(f, p, 0, 236);
        else put(f, p, HOLD.x + 1, HOLD.z);
      }
    };
    const from = f.hits.length;
    expect(until(f, () => prey(f)[0]?.id !== first.id, T.finalPreySeconds + 1, crowd)).toBe(true);
    const next = prey(f)[0];
    expect(next).toBeDefined();
    // Marked within his reach, and it does not move: the turn is its head start.
    run(f, T.finalSwitchPause - DT * 2, crowd);
    expect(aura(next, ZULGAR_MAULED)).toBeUndefined();
    expect(hitsOn(f, next, 'Mauled', from)).toHaveLength(0);
    // He stood where the switch found him, and he already faces the new Prey.
    expect(z.aggroTargetId).toBe(next.id);
    // The turn over, a Prey that never ran is caught.
    expect(until(f, () => !!aura(next, ZULGAR_MAULED), 0.5, crowd)).toBe(true);
    expect(hitsOn(f, next, 'Mauled', from)).toHaveLength(1);
    // Short of the Pulse-to-spear lead a reaction needs, long enough to clear
    // his reach at a run (7 yd a second) with time to spare.
    expect(T.finalSwitchPause).toBe(1.5);
    expect(T.finalSwitchPause).toBeLessThan(T.finalPreySeconds / 2);
  });

  it('heroic Twin Prey: two marks, six seconds on each, then a fresh pair', () => {
    const f = fight('heroic');
    const z = pull(f);
    dev(f, 'idol');
    const keep = hold(f, z);
    const chased = () => prey(f).find((p) => aura(p, ZULGAR_PREY)?.value2 === 1);
    tick(f, keep);
    const pair = prey(f).map((p) => p.id);
    expect(pair).toHaveLength(2);
    expect(aura(prey(f)[0], ZULGAR_PREY)?.duration).toBe(T.twinSwitch * 2);
    const first = chased();
    expect(first).toBeDefined();
    run(f, T.twinSwitch, keep);
    // The same pair, the other one chased.
    expect(prey(f).map((p) => p.id)).toEqual(pair);
    expect(chased()?.id).not.toBe(first?.id);
    run(f, T.twinSwitch, keep);
    // Twelve seconds: the marks moved (four stand on the terrace, so at
    // least one of the pair is new).
    const next = prey(f).map((p) => p.id);
    expect(next).toHaveLength(2);
    expect(next).not.toEqual(pair);
    // The turn he takes on a fresh pair comes out of the first twin's six
    // seconds: the chase still passes to the other six seconds after the marks.
    const second = chased();
    run(f, T.twinSwitch - 0.5, keep);
    expect(prey(f).map((p) => p.id)).toEqual(next);
    expect(chased()?.id).toBe(second?.id);
    run(f, 1, keep);
    expect(prey(f).map((p) => p.id)).toEqual(next);
    expect(chased()?.id).not.toBe(second?.id);
  });

  it('a group that leaves the terrace is hunted wherever it stands in the run', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'idol');
    const away = () => {
      put(f, z, HOLD.x, HOLD.z);
      everyone(f).forEach((p, i) => {
        put(f, p, -6 + i * 4, 150);
      });
    };
    run(f, 2, away);
    expect(st(z).phase).toBe('final');
    expect(prey(f)).toHaveLength(1);
    expect(z.aggroTargetId).toBe(prey(f)[0].id);
  });

  it('the protections hold: a Mauled player is never Prey again for 5 s, and stuns land for half', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'idol');
    // Every chased Prey walks into him: mauls come as fast as the rules allow.
    const windows = new Map<number, number[][]>();
    let t = 0;
    const feed = () => {
      put(f, z, HOLD.x, HOLD.z);
      for (const p of everyone(f)) {
        if (aura(p, ZULGAR_PREY)) put(f, p, HOLD.x + 1, HOLD.z);
        else if (!aura(p, ZULGAR_MAULED)) put(f, p, 0, 236);
      }
    };
    for (; t < 30; t += DT) {
      tick(f, feed);
      for (const p of everyone(f)) {
        if (!aura(p, ZULGAR_MAULED)) continue;
        const list = windows.get(p.id) ?? [];
        const last = list[list.length - 1];
        if (last && t - last[1] < 0.06) last[1] = t;
        else list.push([t, t]);
        windows.set(p.id, list);
      }
    }
    let mauls = 0;
    for (const list of windows.values()) {
      mauls += list.length;
      for (let i = 1; i < list.length; i++)
        expect(list[i][0] - list[i - 1][1]).toBeGreaterThanOrEqual(
          T.preyRespite - T.maulStun - 0.1,
        );
    }
    expect(mauls).toBeGreaterThanOrEqual(4);
    // A stun still lands for half, a sheep still slides off.
    const stun = (kind: Aura['kind'], id: string): Aura => ({
      id,
      name: id,
      kind,
      remaining: 4,
      duration: 4,
      value: 0,
      sourceId: f.others[0].id,
      school: 'frost',
    });
    f.sim.ctx.applyAura(z, stun('stun', 'test_final_stun'));
    expect(aura(z, 'test_final_stun')?.remaining).toBe(4 * T.huntStunScale);
    f.sim.ctx.applyAura(z, stun('polymorph', 'test_final_sheep'));
    expect(aura(z, 'test_final_sheep')).toBeUndefined();
    f.sim.ctx.applyAura(z, stun('root', 'test_final_root'));
    expect(aura(z, 'test_final_root')).toBeDefined();
  }, 120_000);
});

describe("the Idol's Breath", () => {
  it('warns one half for 5 s, lands on that half alone, plays out, then takes the other half', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'idol');
    const keep = hold(f, z);
    run(f, T.breathFirst - 0.2, keep);
    expect(breathObjects(f)).toHaveLength(0);
    run(f, 0.3, keep);
    const [warning] = objects(f, WILDHEART_IDOL_BREATH_WARNING);
    expect(warning).toBeDefined();
    expect(warning.castingAbility).toBe(ZULGAR_IDOLS_BREATH);
    expect(warning.castTotal).toBe(T.breathWarning);
    expect(warning.scale).toBe(IDOL_BREATH_FIELD.reach);
    expect(warning.pos.x - f.ox).toBeCloseTo(IDOL_BREATH_FIELD.x, 5);
    expect(warning.pos.z - f.oz).toBeCloseTo(IDOL_BREATH_FIELD.z, 5);
    const side = idolBreathSideOf(warning.facing);
    // Nothing lands while the warning stands.
    const from = f.hits.length;
    run(f, T.breathWarning - 0.3, keep);
    expect(warning.templateId).toBe(WILDHEART_IDOL_BREATH_WARNING);
    expect(f.hits.slice(from).some((h) => h.ability === "Idol's Breath")).toBe(false);
    run(f, 0.4, keep);
    // It landed: the same body is the breath now, on its own clock.
    expect(warning.templateId).toBe(WILDHEART_IDOL_BREATH);
    expect(warning.castTotal).toBe(T.breathLinger);
    for (const p of everyone(f)) {
      const hits = hitsOn(f, p, "Idol's Breath", from);
      const inHalf = inIdolBreathHalf(p.pos.x - f.ox, side);
      expect(hits, `player at x ${p.pos.x - f.ox}`).toHaveLength(inHalf ? 1 : 0);
      for (const h of hits) {
        expect(h.amount).toBeGreaterThanOrEqual(T.breathMin);
        expect(h.amount).toBeLessThanOrEqual(T.breathMax);
        expect(h.school).toBe('nature');
      }
    }
    // Two stand in each half: exactly two were hit.
    expect(f.hits.slice(from).filter((h) => h.ability === "Idol's Breath")).toHaveLength(2);
    run(f, T.breathLinger + 0.1, keep);
    expect(breathObjects(f)).toHaveLength(0);
    // The next exhale: 10 s after the first warning began, on the other half.
    run(f, T.breathEvery - T.breathWarning - T.breathLinger - 0.3, keep);
    expect(breathObjects(f)).toHaveLength(0);
    run(f, 0.4, keep);
    const [next] = objects(f, WILDHEART_IDOL_BREATH_WARNING);
    expect(next).toBeDefined();
    expect(idolBreathSideOf(next.facing)).toBe(-side);
  }, 60_000);

  it('spares the centre line and whoever crossed in time', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'breath');
    const [warning] = objects(f, WILDHEART_IDOL_BREATH_WARNING);
    const side = idolBreathSideOf(warning.facing);
    const from = f.hits.length;
    // One on the line, one a step inside, one a step outside, one deep inside.
    const keep = () => {
      put(f, z, HOLD.x, HOLD.z);
      put(f, f.tank, 0, 204);
      put(f, f.others[0], side * 0.5, 232);
      put(f, f.others[1], -side * 0.5, 204);
      put(f, f.others[2], side * 28, 214);
    };
    run(f, T.breathWarning + 0.1, keep);
    expect(hitsOn(f, f.tank, "Idol's Breath", from)).toHaveLength(0);
    expect(hitsOn(f, f.others[0], "Idol's Breath", from)).toHaveLength(1);
    expect(hitsOn(f, f.others[1], "Idol's Breath", from)).toHaveLength(0);
    expect(hitsOn(f, f.others[2], "Idol's Breath", from)).toHaveLength(1);
  });

  it('heroic: it snuffs the lit glyphs of its half; normal leaves them lit', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const f = fight(difficulty);
      const z = pull(f);
      dev(f, 'breath');
      dev(f, 'glyphs');
      expect(glyphsLit(st(z))).toBe(SUN_GLYPHS.length);
      const [warning] = objects(f, WILDHEART_IDOL_BREATH_WARNING);
      const side = idolBreathSideOf(warning.facing);
      run(f, T.breathWarning + 0.1, hold(f, z));
      const lit = st(z).glyphs.map((g) => g.lit);
      SUN_GLYPHS.forEach((g, i) => {
        const washed = inIdolBreathHalf(g.x, side);
        expect(lit[i], `${difficulty} glyph ${i}`).toBe(difficulty === 'normal' || !washed);
      });
      expect(objects(f, WILDHEART_SUN_GLYPH_LIT)).toHaveLength(difficulty === 'normal' ? 6 : 3);
      expect(objects(f, WILDHEART_SUN_GLYPH_DARK)).toHaveLength(difficulty === 'normal' ? 0 : 3);
    }
  }, 60_000);
});

describe('the reset', () => {
  it('a wipe in the final phase drops the breath, the idol and the avatar; the next pull starts fresh', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'breath');
    expect(breathObjects(f)).toHaveLength(1);
    wipe(f, z);
    tick(f);
    expect(z.wildheartFight).toBeUndefined();
    expect(breathObjects(f)).toHaveLength(0);
    expect(aura(z, ZULGAR_IDOL_AWAKE)).toBeUndefined();
    expect(aura(z, ZULGAR_AVATAR)).toBeUndefined();
    expect(prey(f)).toHaveLength(0);
    expect(z.ccImmune).toBe(true);
    // He walks home; pulled again: a plain phase, dark glyphs, the threshold
    // armed anew.
    expect(until(f, () => z.aiState === 'idle', 20)).toBe(true);
    z.hp = z.maxHp;
    const again = pull(f);
    expect(st(again).phase).toBe('fight');
    expect(st(again).idolFired).toBe(false);
    expect(st(again).idol).toBeNull();
    expect(objects(f, WILDHEART_SUN_GLYPH_DARK)).toHaveLength(SUN_GLYPHS.length);
  });

  it('his death in the final phase clears it all the same', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'breath');
    f.sim.ctx.dealDamage(f.tank, z, 1e7, false, 'physical', 'Test', 'hit', false);
    run(f, 0.1);
    expect(z.dead).toBe(true);
    expect(breathObjects(f)).toHaveLength(0);
    expect(objects(f, WILDHEART_SUN_GLYPH_DARK)).toHaveLength(0);
    expect(prey(f)).toHaveLength(0);
  });
});
