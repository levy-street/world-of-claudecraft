// The sun glyphs of Zulgar's hunt (src/sim/encounters/wildheart_basin/
// zulgar_glyphs.ts, the 2026-10-13 rework): they start dark, the players who
// are NOT the Prey light them by standing on them (the Prey only when nobody
// else stands free), a lit glyph the avatar crosses leaves him Sunstruck (the
// slow and the 25 percent damage window) and goes dark and cold, he is wary of
// the sun for a moment after, and a hunt's end puts every glyph out. On a real
// claimed Basin with a real party (tests/helpers/wildheart_fight.ts).

import { describe, expect, it } from 'vitest';
import { SUN_GLYPHS } from '../src/sim/content/wildheart_basin_layout';
import {
  glyphsLit,
  ZULGAR_TUNING as T,
  WILDHEART_GLYPH_COLD,
  WILDHEART_GLYPH_KINDLE,
  WILDHEART_GLYPH_LIT_FX,
  WILDHEART_SUN_GLYPH_DARK,
  WILDHEART_SUN_GLYPH_LIT,
  ZULGAR_ID,
  ZULGAR_PREY,
  ZULGAR_SUN_WARY,
  ZULGAR_SUNSTRUCK,
  ZULGAR_SUNSTRUCK_EXPOSED,
} from '../src/sim/encounters/wildheart_basin';
import type { Entity, ZulgarFightState } from '../src/sim/types';
import {
  aura,
  boss,
  engage,
  type Fight,
  fight,
  objects,
  put,
  run,
  tick,
} from './helpers/wildheart_fight';

/** Where the fight is held: Zulgar at the terrace's heart, off every glyph. */
const HOLD = { x: 0, z: 218 } as const;
/** Out of his reach and off every glyph. */
const SAFE: readonly [number, number][] = [
  [0, 206],
  [-22, 212],
  [22, 212],
  [0, 232],
];

function pull(f: Fight): Entity {
  const z = boss(f, ZULGAR_ID);
  put(f, z, HOLD.x, HOLD.z);
  [f.tank, ...f.others].forEach((p, i) => {
    put(f, p, SAFE[i][0], SAFE[i][1]);
  });
  put(f, f.tank, 0, 214);
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

function glyph(f: Fight, z: Entity, i: number): Entity {
  const obj = f.sim.ctx.entities.get(st(z).glyphs[i].objectId);
  if (!obj) throw new Error(`no glyph ${i}`);
  return obj;
}

function everyone(f: Fight): Entity[] {
  return [f.tank, ...f.others];
}

function prey(f: Fight): Entity[] {
  return everyone(f).filter((p) => aura(p, ZULGAR_PREY));
}

function free(f: Fight): Entity[] {
  return everyone(f).filter((p) => !aura(p, ZULGAR_PREY));
}

/** Keep him at the heart and the Prey out of his reach (nobody is mauled). */
function hold(f: Fight, z: Entity): () => void {
  return () => {
    put(f, z, HOLD.x, HOLD.z);
    for (const p of prey(f)) {
      if (Math.hypot(p.pos.x - z.pos.x, p.pos.z - z.pos.z) < 9) put(f, p, 0, 232);
    }
  };
}

function onGlyph(f: Fight, p: Entity, i: number): void {
  put(f, p, SUN_GLYPHS[i].x, SUN_GLYPHS[i].z);
}

describe('the sun glyphs start dark', () => {
  it('six dark glyphs at the pull, and standing on one outside a hunt lights nothing', () => {
    const f = fight();
    const z = pull(f);
    expect(objects(f, WILDHEART_SUN_GLYPH_DARK)).toHaveLength(SUN_GLYPHS.length);
    expect(objects(f, WILDHEART_SUN_GLYPH_LIT)).toHaveLength(0);
    onGlyph(f, f.others[0], 0);
    run(f, T.glyphKindleSeconds + 1, () => put(f, z, HOLD.x, HOLD.z));
    expect(glyphsLit(st(z))).toBe(0);
    expect(glyph(f, z, 0).castingAbility).toBeNull();
  });
});

describe('lighting a glyph', () => {
  it('a player who is not the Prey lights it in 2 s; the bar rides the glyph; stepping off resets it', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'prey');
    const keep = hold(f, z);
    const [lighter] = free(f);
    onGlyph(f, lighter, 0);
    run(f, 1, keep);
    const obj = glyph(f, z, 0);
    expect(obj.templateId).toBe(WILDHEART_SUN_GLYPH_DARK);
    expect(obj.castingAbility).toBe(WILDHEART_GLYPH_KINDLE);
    expect(obj.castTotal).toBe(T.glyphKindleSeconds);
    expect(obj.castRemaining).toBeCloseTo(T.glyphKindleSeconds - 1, 5);
    expect(obj.castTargetId).toBe(lighter.id);
    // Stepping off resets it: nothing carries over.
    put(f, lighter, 22, 212);
    tick(f, keep);
    expect(obj.castingAbility).toBeNull();
    expect(st(z).glyphs[0].kindle).toBe(0);
    onGlyph(f, lighter, 0);
    run(f, T.glyphKindleSeconds - 0.1, keep);
    expect(obj.templateId).toBe(WILDHEART_SUN_GLYPH_DARK);
    const from = f.fx.length;
    run(f, 0.15, keep);
    expect(obj.templateId).toBe(WILDHEART_SUN_GLYPH_LIT);
    expect(obj.castingAbility).toBeNull();
    expect(f.fx.slice(from)).toContain(WILDHEART_GLYPH_LIT_FX);
    expect(glyphsLit(st(z))).toBe(1);
  });

  it('two players on one glyph light it no faster', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'prey');
    const keep = hold(f, z);
    const [a, b] = free(f);
    onGlyph(f, a, 1);
    onGlyph(f, b, 1);
    run(f, T.glyphKindleSeconds - 0.1, keep);
    expect(glyphsLit(st(z))).toBe(0);
    // The bar names the lower id of the two.
    expect(glyph(f, z, 1).castTargetId).toBe(Math.min(a.id, b.id));
  });

  it('the Prey lights nothing while anyone else stands free on the terrace', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'prey');
    const [marked] = prey(f);
    onGlyph(f, marked, 2);
    run(f, T.glyphKindleSeconds + 1, () => put(f, z, HOLD.x, HOLD.z));
    expect(aura(marked, ZULGAR_PREY)).toBeDefined();
    expect(glyphsLit(st(z))).toBe(0);
    expect(glyph(f, z, 2).castingAbility).toBeNull();
  });

  it('alone, the Prey lights for themself, in 1 s', () => {
    const f = fight('normal', 0);
    const z = pull(f);
    dev(f, 'prey');
    expect(aura(f.tank, ZULGAR_PREY)).toBeDefined();
    const keep = () => put(f, z, HOLD.x, HOLD.z);
    onGlyph(f, f.tank, 0);
    run(f, T.glyphKindleAloneSeconds - 0.1, keep);
    const obj = glyph(f, z, 0);
    expect(obj.castTotal).toBe(T.glyphKindleAloneSeconds);
    expect(obj.templateId).toBe(WILDHEART_SUN_GLYPH_DARK);
    run(f, 0.15, keep);
    expect(obj.templateId).toBe(WILDHEART_SUN_GLYPH_LIT);
  });

  it('heroic final phase with only the two marked on the terrace: either lights, in 1 s', () => {
    // In a hunt the tank is never Prey while anyone else stands, so a pair
    // always keeps a free lighter; the final phase hunts the tank too.
    const f = fight('heroic', 1);
    const z = pull(f);
    dev(f, 'idol');
    expect(prey(f)).toHaveLength(2);
    const keep = hold(f, z);
    onGlyph(f, f.others[0], 4);
    run(f, T.glyphKindleAloneSeconds + 0.1, keep);
    expect(glyph(f, z, 4).templateId).toBe(WILDHEART_SUN_GLYPH_LIT);
  });
});

describe('Sunstruck', () => {
  function struck(f: Fight, z: Entity, i: number): void {
    put(f, z, SUN_GLYPHS[i].x, SUN_GLYPHS[i].z);
    tick(f, () => put(f, z, SUN_GLYPHS[i].x, SUN_GLYPHS[i].z));
  }

  it('crossing a lit glyph: 60 percent slower and 25 percent more damage for 3 s; the glyph goes dark and cold', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'prey');
    dev(f, 'glyphs');
    expect(glyphsLit(st(z))).toBe(SUN_GLYPHS.length);
    // Unstruck, a blow lands for what it is.
    const blow = () => {
      const before = z.hp;
      f.sim.ctx.dealDamage(f.tank, z, 1000, false, 'physical', 'Test', 'hit', true);
      return before - z.hp;
    };
    const plain = blow();
    struck(f, z, 0);
    const slow = aura(z, ZULGAR_SUNSTRUCK);
    expect(slow?.kind).toBe('slow');
    expect(slow?.value).toBeCloseTo(1 - T.sunstruckSlow, 6);
    const window = aura(z, ZULGAR_SUNSTRUCK_EXPOSED);
    expect(window?.kind).toBe('vulnerability');
    expect(window?.value).toBe(T.sunstruckVuln);
    expect(window?.duration).toBe(T.sunstruckSeconds);
    expect(aura(z, ZULGAR_SUN_WARY)).toBeDefined();
    expect(blow()).toBe(Math.round(plain * (1 + T.sunstruckVuln)));
    // The glyph that struck him is spent: dark, with its cold clock on it.
    const obj = glyph(f, z, 0);
    expect(obj.templateId).toBe(WILDHEART_SUN_GLYPH_DARK);
    expect(obj.castingAbility).toBe(WILDHEART_GLYPH_COLD);
    expect(obj.castTotal).toBe(T.glyphColdSeconds);
    expect(glyphsLit(st(z))).toBe(SUN_GLYPHS.length - 1);
    // The window closes on its own.
    run(f, T.sunstruckSeconds + 0.1, hold(f, z));
    expect(aura(z, ZULGAR_SUNSTRUCK_EXPOSED)).toBeUndefined();
    expect(blow()).toBe(plain);
  });

  it('a cold glyph cannot be lit for 8 s, then lights again', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'prey');
    dev(f, 'glyphs');
    struck(f, z, 0);
    const keep = hold(f, z);
    const [lighter] = free(f);
    onGlyph(f, lighter, 0);
    run(f, T.glyphColdSeconds - 0.3, keep);
    const obj = glyph(f, z, 0);
    expect(obj.templateId).toBe(WILDHEART_SUN_GLYPH_DARK);
    expect(obj.castingAbility).toBe(WILDHEART_GLYPH_COLD);
    expect(st(z).glyphs[0].kindle).toBe(0);
    // Cold over: the lighter still standing there lights it in the usual 2 s.
    run(f, 0.3 + T.glyphKindleSeconds - 0.2, keep);
    expect(obj.templateId).toBe(WILDHEART_SUN_GLYPH_DARK);
    expect(obj.castingAbility).toBe(WILDHEART_GLYPH_KINDLE);
    run(f, 0.4, keep);
    expect(obj.templateId).toBe(WILDHEART_SUN_GLYPH_LIT);
  });

  it('wary of the sun: a second lit glyph crossed within 5 s stays lit and does not strike', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'prey');
    dev(f, 'glyphs');
    struck(f, z, 0);
    const onOne = () => {
      put(f, z, SUN_GLYPHS[1].x, SUN_GLYPHS[1].z);
      for (const p of prey(f)) put(f, p, 0, 200);
    };
    run(f, T.sunWarySeconds - 0.3, onOne);
    expect(glyph(f, z, 1).templateId).toBe(WILDHEART_SUN_GLYPH_LIT);
    expect(aura(z, ZULGAR_SUNSTRUCK_EXPOSED)).toBeUndefined();
    // The wariness ends with him still standing on it: it strikes.
    run(f, 0.5, onOne);
    expect(glyph(f, z, 1).templateId).toBe(WILDHEART_SUN_GLYPH_DARK);
    expect(aura(z, ZULGAR_SUNSTRUCK_EXPOSED)).toBeDefined();
  });

  it('a lit glyph never strikes him outside a hunt', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'glyphs');
    struck(f, z, 0);
    expect(aura(z, ZULGAR_SUNSTRUCK)).toBeUndefined();
    expect(glyphsLit(st(z))).toBe(SUN_GLYPHS.length);
  });
});

describe('the end of a hunt', () => {
  it('normal: every glyph goes dark and every clock stops', () => {
    const f = fight();
    const z = pull(f);
    dev(f, 'prey');
    dev(f, 'glyphs');
    put(f, z, SUN_GLYPHS[0].x, SUN_GLYPHS[0].z);
    tick(f);
    expect(glyph(f, z, 0).castingAbility).toBe(WILDHEART_GLYPH_COLD);
    dev(f, 'endhunt');
    expect(glyphsLit(st(z))).toBe(0);
    expect(objects(f, WILDHEART_SUN_GLYPH_LIT)).toHaveLength(0);
    expect(objects(f, WILDHEART_SUN_GLYPH_DARK)).toHaveLength(SUN_GLYPHS.length);
    for (let i = 0; i < SUN_GLYPHS.length; i++) expect(glyph(f, z, i).castingAbility).toBeNull();
  });

  it('heroic: the glyphs stay lit through the Ambush, and a pounce onto a lit one leaves him Sunstruck', () => {
    const f = fight('heroic');
    const z = pull(f);
    // The farthest player stands on a glyph; the others close in.
    onGlyph(f, f.others[0], 3);
    put(f, f.others[1], 3, 222);
    put(f, f.others[2], -3, 222);
    dev(f, 'prey');
    dev(f, 'glyphs');
    dev(f, 'ambush');
    expect(st(z).phase).toBe('ambush');
    expect(glyphsLit(st(z))).toBe(SUN_GLYPHS.length);
    run(f, T.ambushSeconds + 0.1);
    expect(st(z).phase).toBe('fight');
    const at = { x: z.pos.x - f.ox, z: z.pos.z - f.oz };
    expect(Math.hypot(at.x - SUN_GLYPHS[3].x, at.z - SUN_GLYPHS[3].z)).toBeLessThan(0.5);
    expect(aura(z, ZULGAR_SUNSTRUCK_EXPOSED)?.value).toBe(T.sunstruckVuln);
    // He has landed: the hunt is over and the glyphs are out.
    expect(glyphsLit(st(z))).toBe(0);
    expect(objects(f, WILDHEART_SUN_GLYPH_LIT)).toHaveLength(0);
  });
});
