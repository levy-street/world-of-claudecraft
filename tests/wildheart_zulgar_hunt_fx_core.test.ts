// The pure plan behind the visuals of Zulgar's hunt rework (src/render/
// wildheart_basin/zulgar_hunt_fx_core.ts): a sun glyph's four looks never
// share a read, the Sunstruck ring drains with the window, the Hunting Spear
// drives in and quivers, and the Idol's Breath marks exactly the half of the
// terrace the sim burns (the same centre line, the same polygon).

import { describe, expect, it } from 'vitest';
import { TELEGRAPH_THREAT_COLORS } from '../src/render/floor_telegraph/telegraph_look_core';
import {
  avatarGold,
  basinOriginInto,
  breathPour,
  clockLeft,
  GLYPH_SHAFT_HEIGHT,
  type GlyphPhase,
  glyphLookInto,
  glyphPhase,
  IDOL_BREATH_COLORS,
  IDOL_MAW_MOUTH,
  idolBreathFan,
  idolBreathHalf,
  idolBreathLane,
  idolBreathSpotInto,
  idolEyesBurn,
  idolThroatGlow,
  newGlyphLook,
  PINNED_RING,
  SPEAR_LOOK,
  SUNSTRUCK_RING_RADIUS,
  spearAxisInto,
  spearDrive,
  sunstruckRing,
} from '../src/render/wildheart_basin/zulgar_hunt_fx_core';
import { JAGUAR_MAW, SHRINE_TERRACE, SUN_GLYPHS } from '../src/sim/content/wildheart_basin_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  IDOL_BREATH_FIELD,
  inIdolBreathHalf,
  ZULGAR_TUNING as T,
  WILDHEART_GLYPH_COLD,
  WILDHEART_GLYPH_KINDLE,
  WILDHEART_SUN_GLYPH_DARK,
  WILDHEART_SUN_GLYPH_LIT,
} from '../src/sim/encounters/wildheart_basin';

describe('a sun glyph reads as exactly one of four things', () => {
  it('its phase comes off the object: its template, then its own clock', () => {
    expect(glyphPhase(WILDHEART_SUN_GLYPH_LIT, null)).toBe('lit');
    // A lit glyph carries no clock; one left on it would not change the read.
    expect(glyphPhase(WILDHEART_SUN_GLYPH_LIT, WILDHEART_GLYPH_KINDLE)).toBe('lit');
    expect(glyphPhase(WILDHEART_SUN_GLYPH_DARK, null)).toBe('dark');
    expect(glyphPhase(WILDHEART_SUN_GLYPH_DARK, undefined)).toBe('dark');
    expect(glyphPhase(WILDHEART_SUN_GLYPH_DARK, WILDHEART_GLYPH_KINDLE)).toBe('kindling');
    expect(glyphPhase(WILDHEART_SUN_GLYPH_DARK, WILDHEART_GLYPH_COLD)).toBe('cold');
    expect(glyphPhase('wildheart_seedpod', null)).toBeNull();
  });

  it('a clock reads its share left, and nothing at all without a bar', () => {
    expect(clockLeft(1, 2)).toBe(0.5);
    expect(clockLeft(2, 2)).toBe(1);
    expect(clockLeft(0, 2)).toBe(0);
    expect(clockLeft(5, 2)).toBe(1);
    expect(clockLeft(undefined, undefined)).toBe(0);
    expect(clockLeft(1, 0)).toBe(0);
  });

  it('lit is light and dark is none: only a lit glyph has the gold disc under a full shaft', () => {
    const look = newGlyphLook();
    for (let t = 0; t < 8; t += 0.37) {
      const lit = { ...glyphLookInto(look, 'lit', 0, t) };
      expect(lit.lit).toBe(1);
      expect(lit.veil).toBe(0);
      expect(lit.shaft).toBeGreaterThan(0.3);
      expect(lit.shaftRise).toBe(1);
      expect(lit.halo).toBeGreaterThan(0.5);
      const dark = { ...glyphLookInto(look, 'dark', 0, t) };
      expect(dark.lit).toBe(0);
      expect(dark.veil).toBe(1);
      expect(dark.shaft).toBe(0);
      expect(dark.halo).toBe(0);
      expect(dark.arc).toBe(0);
      expect(dark.sparks).toBe(0);
    }
  });

  it('being lit: the ring fills with the 2 s, a pillar climbs, the ash thins, and it is never the lit look', () => {
    const look = newGlyphLook();
    let lastArc = -1;
    let lastRise = -1;
    for (let done = 0; done <= 1.0001; done += 0.1) {
      const k = { ...glyphLookInto(look, 'kindling', 1 - done, 0) };
      expect(k.arc).toBeCloseTo(done, 9);
      expect(k.arcEmber).toBe(0);
      expect(k.lit).toBe(0);
      expect(k.arc).toBeGreaterThan(lastArc);
      expect(k.shaftRise).toBeGreaterThan(lastRise);
      // Short of a lit glyph's pillar the whole way.
      expect(k.shaftRise).toBeLessThan(1);
      expect(k.veil).toBeLessThanOrEqual(1);
      lastArc = k.arc;
      lastRise = k.shaftRise;
    }
    expect(glyphLookInto(look, 'kindling', 0, 0).veil).toBeLessThan(0.5);
    expect(GLYPH_SHAFT_HEIGHT).toBeGreaterThan(10);
  });

  it('cold: an ember ring burns down, under full ash, with no shaft', () => {
    const look = newGlyphLook();
    const fresh = { ...glyphLookInto(look, 'cold', 1, 0) };
    const spent = { ...glyphLookInto(look, 'cold', 0.1, 0) };
    expect(fresh.arc).toBe(1);
    expect(spent.arc).toBeCloseTo(0.1, 9);
    for (const c of [fresh, spent]) {
      expect(c.arcEmber).toBe(1);
      expect(c.haloEmber).toBe(1);
      expect(c.veil).toBe(1);
      expect(c.shaft).toBe(0);
      expect(c.lit).toBe(0);
      expect(c.sparks).toBe(0);
    }
    expect(fresh.smoke).toBeGreaterThan(spent.smoke);
  });

  it('one reused look carries nothing over from the phase before', () => {
    const look = newGlyphLook();
    const phases: GlyphPhase[] = ['lit', 'cold', 'kindling', 'dark', 'lit', 'dark'];
    for (const phase of phases) {
      const reused = { ...glyphLookInto(look, phase, 0.4, 1.3) };
      expect(reused, phase).toEqual(glyphLookInto(newGlyphLook(), phase, 0.4, 1.3));
    }
  });
});

describe('the Sunstruck window', () => {
  it('the ring drains with the 3 s and beats faster as it closes', () => {
    expect(sunstruckRing(T.sunstruckSeconds, T.sunstruckSeconds, 0).fill).toBe(1);
    expect(sunstruckRing(T.sunstruckSeconds / 2, T.sunstruckSeconds, 0).fill).toBe(0.5);
    expect(sunstruckRing(0, T.sunstruckSeconds, 0).fill).toBe(0);
    expect(sunstruckRing(1, 0, 0).fill).toBe(0);
    for (let t = 0; t < 4; t += 0.05) {
      const fade = sunstruckRing(1, T.sunstruckSeconds, t).fade;
      expect(fade).toBeGreaterThan(0.5);
      expect(fade).toBeLessThanOrEqual(1);
    }
    expect(SUNSTRUCK_RING_RADIUS).toBeGreaterThan(4);
  });

  it('the spirit jaguar turns gold within a fifth of a second, and back', () => {
    let gold = 0;
    for (let t = 0; t < 0.2; t += 1 / 60) gold = avatarGold(gold, true, 1 / 60);
    expect(gold).toBe(1);
    for (let t = 0; t < 0.2; t += 1 / 60) gold = avatarGold(gold, false, 1 / 60);
    expect(gold).toBe(0);
  });
});

describe('the Hunting Spear', () => {
  it('stands well over a player and ties its cord above their head', () => {
    const drawn = SPEAR_LOOK.length * SPEAR_LOOK.scale;
    const standing = (drawn - SPEAR_LOOK.buried) * Math.cos(SPEAR_LOOK.lean);
    // Twice a player's 2.6 yd and more, upright enough to read as planted.
    expect(standing).toBeGreaterThan(5);
    expect(SPEAR_LOOK.lean).toBeLessThan(0.6);
    expect(SPEAR_LOOK.tieAt).toBeGreaterThan(2.6);
    expect(SPEAR_LOOK.tieAt).toBeLessThan(drawn);
    expect(SPEAR_LOOK.cord).toBeLessThan(1);
  });

  it('drives in along its own line, then quivers and comes to rest', () => {
    expect(spearDrive(0).rise).toBe(SPEAR_LOOK.dropFrom);
    expect(spearDrive(SPEAR_LOOK.dropSeconds / 2).rise).toBeGreaterThan(0);
    expect(spearDrive(SPEAR_LOOK.dropSeconds).rise).toBe(0);
    let swayed = 0;
    for (let q = 0; q < SPEAR_LOOK.quiverSeconds; q += 0.01) {
      const d = spearDrive(SPEAR_LOOK.dropSeconds + q);
      expect(d.rise).toBe(0);
      expect(Math.abs(d.sway)).toBeLessThanOrEqual(SPEAR_LOOK.quiverLean);
      swayed = Math.max(swayed, Math.abs(d.sway));
    }
    expect(swayed).toBeGreaterThan(SPEAR_LOOK.quiverLean * 0.5);
    expect(spearDrive(SPEAR_LOOK.dropSeconds + SPEAR_LOOK.quiverSeconds + 1)).toEqual({
      rise: 0,
      sway: 0,
    });
  });

  it('its shaft is a unit line leaning toward where it was thrown from', () => {
    const out = { x: 0, y: 0, z: 0 };
    spearAxisInto(out, Math.PI / 2, SPEAR_LOOK.lean);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 9);
    expect(out.x).toBeGreaterThan(0);
    expect(out.z).toBeCloseTo(0, 9);
    expect(out.y).toBeCloseTo(Math.cos(SPEAR_LOOK.lean), 9);
    spearAxisInto(out, 0, 0);
    expect(out).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('the Pinned ring is the palette control colour (a root)', () => {
    expect(PINNED_RING.color).toBe(TELEGRAPH_THREAT_COLORS.control);
  });
});

describe("the Idol's Breath marks the half the sim burns", () => {
  it('each half is the terrace cut on the centre line, and the two make the whole', () => {
    const area = (pts: readonly (readonly [number, number])[]) => {
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x1, z1] = pts[i];
        const [x2, z2] = pts[(i + 1) % pts.length];
        a += x1 * z2 - x2 * z1;
      }
      return Math.abs(a) / 2;
    };
    const east = idolBreathHalf(1);
    const west = idolBreathHalf(-1);
    for (const [x] of east) expect(x).toBeGreaterThanOrEqual(0);
    for (const [x] of west) expect(x).toBeLessThanOrEqual(0);
    // Both carry the centre line's two ends.
    for (const half of [east, west]) {
      const onLine = half.filter(([x]) => x === 0).map(([, z]) => z);
      expect(onLine.sort((a, b) => a - b)).toEqual([
        IDOL_BREATH_FIELD.minZ,
        IDOL_BREATH_FIELD.maxZ,
      ]);
    }
    expect(area(east) + area(west)).toBeCloseTo(area(SHRINE_TERRACE.points), 6);
    expect(area(east)).toBeCloseTo(area(west), 6);
  });

  it('a spot scattered over a half is always inside the half the sim tests', () => {
    const out = { x: 0, z: 0 };
    for (const side of [1, -1] as const) {
      const fan = idolBreathFan(side);
      expect(fan.cumulative[fan.cumulative.length - 1]).toBeCloseTo(1, 9);
      let seed = 11;
      const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      for (let i = 0; i < 400; i++) {
        idolBreathSpotInto(out, fan, rand(), rand(), rand());
        expect(out.x * side).toBeGreaterThanOrEqual(0);
        expect(Math.abs(out.x)).toBeLessThanOrEqual(IDOL_BREATH_FIELD.reach + 1e-9);
        expect(out.z).toBeGreaterThanOrEqual(IDOL_BREATH_FIELD.minZ - 1e-9);
        expect(out.z).toBeLessThanOrEqual(IDOL_BREATH_FIELD.maxZ + 1e-9);
        if (out.x !== 0) expect(inIdolBreathHalf(out.x, side)).toBe(true);
      }
    }
  });

  it('the lane the warning fills runs from the maw to the stair, the whole length of the terrace', () => {
    for (const side of [1, -1] as const) {
      const lane = idolBreathLane(side);
      expect(lane.z).toBe(IDOL_BREATH_FIELD.maxZ);
      expect(lane.length).toBe(IDOL_BREATH_FIELD.maxZ - IDOL_BREATH_FIELD.minZ);
      expect(lane.half).toBe(IDOL_BREATH_FIELD.reach / 2);
      // Its inner edge is the centre line.
      expect(lane.x - side * lane.half).toBe(IDOL_BREATH_FIELD.x);
    }
    // Three glyphs lie in each half the floor paints.
    expect(SUN_GLYPHS.filter((g) => g.x > 0)).toHaveLength(3);
  });

  it('is the signature threat colour, and the breath leaves the open maw', () => {
    expect(IDOL_BREATH_COLORS.color).toBe(TELEGRAPH_THREAT_COLORS.lethal);
    expect(IDOL_MAW_MOUTH.y).toBeGreaterThan(JAGUAR_MAW.jawY);
    expect(IDOL_MAW_MOUTH.y).toBeLessThan(JAGUAR_MAW.roofY);
    expect(IDOL_MAW_MOUTH.z).toBeGreaterThanOrEqual(JAGUAR_MAW.minZ);
    expect(IDOL_MAW_MOUTH.halfWidth).toBeLessThan(JAGUAR_MAW.halfWidth);
  });

  it('the pour flashes, races out, and is gone by the time the sim drops its object', () => {
    const start = breathPour(0);
    expect(start.flash).toBe(1);
    expect(start.front).toBe(0);
    expect(start.alpha).toBe(1);
    const mid = breathPour(T.breathLinger * 0.4);
    expect(mid.front).toBe(1);
    expect(mid.flash).toBe(0);
    expect(mid.alpha).toBe(1);
    const end = breathPour(T.breathLinger);
    expect(end.alpha).toBeCloseTo(0, 9);
    let last = 2;
    for (let age = T.breathLinger * 0.55; age <= T.breathLinger; age += 0.05) {
      const a = breathPour(age).alpha;
      expect(a).toBeLessThanOrEqual(last);
      last = a;
    }
  });

  it('the idol: asleep it adds nothing; awake its eyes never sink; it swells and blasts', () => {
    expect(idolEyesBurn('asleep', 0, 3)).toBe(0);
    expect(idolThroatGlow('asleep', 0, 3)).toBe(0);
    for (let t = 0; t < 6; t += 0.11) {
      expect(idolEyesBurn('awake', 0, t)).toBeGreaterThan(0.85);
      expect(idolEyesBurn('inhale', 0.5, t)).toBeGreaterThan(0.75);
      expect(idolThroatGlow('awake', 0, t)).toBeGreaterThan(0.1);
      expect(idolThroatGlow('awake', 0, t)).toBeLessThan(0.35);
      expect(idolThroatGlow('inhale', 1, t)).toBeGreaterThan(idolThroatGlow('inhale', 0, t));
    }
    expect(idolEyesBurn('exhale', 1, 0)).toBe(1);
    expect(idolThroatGlow('exhale', 1, 0)).toBe(1);
  });

  it('reads a claim origin off any spot of that claim', () => {
    const def = DUNGEONS.wildheart_basin;
    for (const slot of [0, 1, 3]) {
      const o = instanceOrigin(def.index, slot);
      const out = { x: 0, z: 0 };
      basinOriginInto(out, { x: o.x + 7, z: o.z + IDOL_BREATH_FIELD.z });
      expect(out).toEqual(o);
      basinOriginInto(out, { x: o.x - 20, z: o.z + 204 });
      expect(out).toEqual(o);
    }
  });
});
