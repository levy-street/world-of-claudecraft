// The Masterless Strength's Overload ring in the room's centre
// (src/render/smith_heart_fx/final_overload_ring_core.ts; Jose's brief of
// 2026-11-20): the HUD's four bars moved into the world. The ring fills in
// the colour of the quarter the boss drinks, warns from four fifths, turns
// red when the boss stands in the centre (no floating text since Jose's
// playtest of 2026-11-20: the state carries no label to draw), holds
// through an intermission, and is off out of the fight and in the final
// phase. It is read off the boss's own auras, so a Sim body and a
// ClientWorld-mirrored one read the same.
import { describe, expect, it } from 'vitest';
import { FINAL_OVERLOAD_RISING } from '../src/game/smith_heart_final_audio_core';
import {
  HEART_QUARTER_PALETTE,
  HEART_RING_LOOK,
} from '../src/render/smith_heart/heart_quarters_core';
import {
  easeSweep,
  newOverloadBurstLook,
  newOverloadRingLook,
  newOverloadRingState,
  OVERLOAD_BURST,
  OVERLOAD_RING,
  type OverloadRingAura,
  overloadBurstLook,
  overloadBurstPieces,
  overloadRingLook,
  overloadRingState,
  ringWarnBeat,
} from '../src/render/smith_heart_fx/final_overload_ring_core';
import { HEART_ROOM } from '../src/sim/content/smith_heart_layout';
import {
  FINAL_AURAS,
  FINAL_ZONE_CODES,
  overloadAuraId,
} from '../src/sim/encounters/smith_heart/final_ids';
import {
  FINAL_PHASE_AURAS,
  FINAL_STAGE_CODES,
} from '../src/sim/encounters/smith_heart/final_phase_ids';

const state = (zone: keyof typeof FINAL_ZONE_CODES): OverloadRingAura => ({
  id: FINAL_AURAS.state,
  value: FINAL_ZONE_CODES[zone],
});
const bar = (vein: 'heat' | 'quench' | 'breath' | 'hammer', v: number): OverloadRingAura => ({
  id: overloadAuraId(vein),
  value: v,
});
const stage = (s: keyof typeof FINAL_STAGE_CODES): OverloadRingAura => ({
  id: FINAL_PHASE_AURAS.phase,
  value: FINAL_STAGE_CODES[s],
});
const read = (auras: OverloadRingAura[], engaged = true, dead = false) =>
  overloadRingState({ dead, auras }, engaged, newOverloadRingState());

describe('the Overload ring: what it shows', () => {
  it("fills with the quarter's own bar in that quarter's colour", () => {
    const s = read([state('hammer'), bar('hammer', 62), bar('heat', 30)]);
    expect(s.mode).toBe('fill');
    expect(s.vein).toBe('hammer');
    expect(s.pct).toBe(62);
    expect(s.fill).toBeCloseTo(0.62);
    expect(s.color).toBe(HEART_QUARTER_PALETTE.hammer.color);
    expect(s.warn).toBe(false);
  });

  it('a quarter change shows that quarter, its colour and its own percent', () => {
    const auras = [bar('hammer', 62), bar('heat', 30)];
    const a = read([state('hammer'), ...auras]);
    const b = read([state('heat'), ...auras]);
    expect(b.vein).toBe('heat');
    expect(b.pct).toBe(30);
    expect(b.color).toBe(HEART_QUARTER_PALETTE.heat.color);
    expect(b.color).not.toBe(a.color);
    // Four colours, all apart.
    const colors = (['heat', 'quench', 'breath', 'hammer'] as const).map(
      (v) => read([state(v), bar(v, 10)]).color,
    );
    expect(new Set(colors).size).toBe(4);
  });

  it('warns from four fifths full, never below', () => {
    expect(OVERLOAD_RING.warnAt).toBe(0.8);
    expect(read([state('quench'), bar('quench', 79)]).warn).toBe(false);
    expect(read([state('quench'), bar('quench', 80)]).warn).toBe(true);
    expect(read([state('quench'), bar('quench', 100)]).warn).toBe(true);
  });

  it('turns red in the centre ring, nothing filling, before and after Heart Unbound lands', () => {
    const s = read([state('ring'), bar('hammer', 55), { id: FINAL_AURAS.unbound }]);
    expect(s.mode).toBe('centre');
    expect(s.vein).toBeNull();
    expect(s.fill).toBe(0);
    expect(s.color).toBe(OVERLOAD_RING.centreColor);
    expect(read([state('ring')])).toEqual(s);
  });

  it('carries no floating label: the state is the ring alone', () => {
    // The percent, the quarter's name and Heart Unbound's count over the
    // well were removed (Jose's playtest of 2026-11-20).
    const s = read([state('heat'), bar('heat', 60)]);
    expect(Object.keys(s).sort()).toEqual(['color', 'fill', 'mode', 'pct', 'vein', 'warn']);
    expect(Object.keys(OVERLOAD_RING)).not.toContain('labelY');
  });

  it('holds the bar dimmed through an intermission, with no warning', () => {
    for (const st of ['call', 'leap', 'finalLeap'] as const) {
      const s = read([state('breath'), bar('breath', 91), stage(st)]);
      expect(s.mode).toBe('held');
      expect(s.pct).toBe(91);
      expect(s.warn).toBe(false);
    }
    // No red centre through a leap either.
    expect(read([state('ring'), stage('leap')]).mode).toBe('off');
  });

  it('is off out of the fight, dead, and from the final phase on', () => {
    expect(overloadRingState(null, true, newOverloadRingState()).mode).toBe('off');
    expect(read([state('hammer'), bar('hammer', 50)], false).mode).toBe('off');
    expect(read([state('hammer'), bar('hammer', 50)], true, true).mode).toBe('off');
    expect(read([bar('hammer', 50)]).mode).toBe('off');
    for (const st of ['final', 'kneel', 'rebirth', 'collapse'] as const) {
      expect(read([state('hammer'), bar('hammer', 50), stage(st)]).mode).toBe('off');
      expect(read([state('ring'), stage(st)]).mode).toBe('off');
    }
  });

  it('reads the same off a Sim-shaped and a ClientWorld-shaped body', () => {
    // The mirror carries the same aura ids and fields (and extra ones).
    const sim = read([state('heat'), bar('heat', 85)]);
    const mirrored = [
      { ...state('heat'), stacks: 1, value2: 0 },
      { ...bar('heat', 85), stacks: 1, value2: 1 },
    ];
    const mirror = overloadRingState(
      { dead: false, auras: mirrored },
      true,
      newOverloadRingState(),
    );
    expect(mirror).toEqual(sim);
  });
});

describe('the Overload ring: how it looks', () => {
  const look = (s: ReturnType<typeof read>, sweep: number, low = false, reduced = false) =>
    overloadRingLook(s, sweep, 1.234, low, reduced, newOverloadRingLook());

  it('sits round the well, outside its raised rim', () => {
    expect(OVERLOAD_RING.inner).toBeGreaterThan(HEART_RING_LOOK.rimOut);
    expect(OVERLOAD_RING.outer - OVERLOAD_RING.inner).toBeGreaterThan(3);
  });

  it('the sweep, the well and the column rise with the fill', () => {
    const s = read([state('hammer'), bar('hammer', 25)]);
    const a = look(s, 0.25);
    const b = look(s, 0.6);
    expect(a.sweep).toBeCloseTo(0.25);
    expect(b.sweep).toBeCloseTo(0.6);
    expect(b.well).toBeGreaterThan(a.well);
    expect(b.column).toBeGreaterThan(a.column);
    expect(b.light).toBeGreaterThan(a.light);
    expect(a.warn).toBe(0);
    expect(a.sparks).toBe(0);
  });

  it('flickers and sparks once warning; the low tier sheds the sparks only', () => {
    const s = read([state('hammer'), bar('hammer', 90)]);
    const hi = look(s, 0.9);
    const lo = look(s, 0.9, true);
    expect(hi.warn).toBeGreaterThan(0);
    expect(hi.sparks).toBeGreaterThan(0);
    expect(lo.sparks).toBe(0);
    // Everything actionable draws the same on the low tier.
    expect(lo.shown).toBe(hi.shown);
    expect(lo.sweep).toBe(hi.sweep);
    expect(lo.warn).toBe(hi.warn);
    expect(lo.light).toBe(hi.light);
    // Some frame of the flicker dips the light (never to dark).
    let min = 1;
    for (let t = 0; t < 2; t += 0.01)
      min = Math.min(min, overloadRingLook(s, 0.9, t, false, false, newOverloadRingLook()).flicker);
    expect(min).toBeLessThan(0.9);
    expect(min).toBeGreaterThan(0.5);
  });

  it('reduced motion: no flicker and no pulse, the fill and the warning kept', () => {
    const warn = read([state('heat'), bar('heat', 95)]);
    for (let t = 0; t < 2; t += 0.05) {
      const l = overloadRingLook(warn, 0.95, t, false, true, newOverloadRingLook());
      expect(l.flicker).toBe(1);
      expect(l.sweep).toBeCloseTo(0.95);
      expect(l.warn).toBeGreaterThan(0);
    }
    const centre = read([state('ring')]);
    const p = new Set<number>();
    for (let t = 0; t < 2; t += 0.05)
      p.add(overloadRingLook(centre, 1, t, false, true, newOverloadRingLook()).pulse);
    expect(p.size).toBe(1);
  });

  it('the centre lights the whole ring and pulses', () => {
    const s = read([state('ring')]);
    const p = new Set<number>();
    for (let t = 0; t < 2; t += 0.1) {
      const l = overloadRingLook(s, 0, t, false, false, newOverloadRingLook());
      expect(l.sweep).toBe(1);
      p.add(Math.round(l.pulse * 100));
    }
    expect(p.size).toBeGreaterThan(3);
  });

  it('is hidden when off', () => {
    const l = look(read([], false), 0.5);
    expect(l.shown).toBe(0);
  });
});

describe('the Overload ring: its sweep and its warning beats', () => {
  it('snaps to a new quarter at once, follows a filling bar smoothly, drops fast', () => {
    expect(easeSweep(0.7, 0.2, 0.05, true)).toBe(0.2);
    const up = easeSweep(0.2, 0.3, 0.05, false);
    expect(up).toBeGreaterThan(0.2);
    expect(up).toBeLessThan(0.3);
    const down = easeSweep(0.9, 0, 0.05, false);
    expect(0.9 - down).toBeGreaterThan(up - 0.2);
  });

  it("sounds its own beat at nine tenths (four fifths is the fight's own), in the same quarter only", () => {
    expect(FINAL_OVERLOAD_RISING.at / 100).toBe(OVERLOAD_RING.warnAt);
    expect(ringWarnBeat('heat', 0.79, 'heat', 0.8)).toBe(false);
    expect(ringWarnBeat('heat', 0.85, 'heat', 0.9)).toBe(true);
    expect(ringWarnBeat('heat', 0.8, 'heat', 0.85)).toBe(false);
    expect(ringWarnBeat('heat', 0.5, 'heat', 0.7)).toBe(false);
    // Into a quarter already past it: the recolour is the cue, no sound.
    expect(ringWarnBeat('hammer', 0.2, 'heat', 0.85)).toBe(false);
    expect(ringWarnBeat(null, 0, null, 0)).toBe(false);
  });
});

describe('the Overload ring: the 100 percent explosion', () => {
  const at = (age: number, reduced = false) =>
    overloadBurstLook(age, reduced, newOverloadBurstLook());

  it('is not live before the cue or past its span', () => {
    expect(at(-0.01).live).toBe(false);
    expect(at(OVERLOAD_BURST.span).live).toBe(false);
    expect(at(OVERLOAD_BURST.span + 3).flash).toBe(0);
    expect(at(0).live).toBe(true);
  });

  it('flashes at once and fades inside its first second', () => {
    expect(at(OVERLOAD_BURST.flashRise).flash).toBeCloseTo(1);
    expect(at(0.3).flash).toBeLessThan(at(0.1).flash);
    expect(at(OVERLOAD_BURST.flashRise + OVERLOAD_BURST.flashSpan).flash).toBe(0);
  });

  it("races a shockwave from the ring's outer edge to the platform's rim", () => {
    expect(OVERLOAD_BURST.shockFrom).toBe(OVERLOAD_RING.outer);
    expect(OVERLOAD_BURST.shockTo).toBe(HEART_ROOM.r);
    let last = 0;
    for (let a = 0; a < OVERLOAD_BURST.shockSpan; a += 0.05) {
      const l = at(a);
      expect(l.shockR).toBeGreaterThanOrEqual(last);
      last = l.shockR;
    }
    expect(at(0.1).shockAlpha).toBeGreaterThan(0.8);
    expect(at(OVERLOAD_BURST.shockSpan * 0.999).shockR).toBeGreaterThan(HEART_ROOM.r - 1);
    expect(at(OVERLOAD_BURST.shockSpan + 0.01).shockAlpha).toBe(0);
    // The thin ring runs ahead of the main one.
    expect(at(0.3).shock2R).toBeGreaterThan(at(0.3).shockR);
  });

  it('surges the column up, then lets it settle', () => {
    expect(at(OVERLOAD_BURST.surgeRise).surge).toBeCloseTo(1);
    expect(at(OVERLOAD_BURST.surgeRise * 1.6).surgeFront).toBeCloseTo(1);
    expect(at(OVERLOAD_BURST.surgeSpan + 0.01).surge).toBe(0);
  });

  it('holds the ring full a breath, then drains it back to empty', () => {
    expect(at(0.1).drain).toBe(1);
    const mid = at(OVERLOAD_BURST.hold + OVERLOAD_BURST.drain / 2).drain;
    expect(mid).toBeGreaterThan(0.1);
    expect(mid).toBeLessThan(0.9);
    expect(at(OVERLOAD_BURST.hold + OVERLOAD_BURST.drain + 0.01).drain).toBe(0);
  });

  it('reduced motion caps the flash only; every other beat is the same', () => {
    for (let a = 0; a < OVERLOAD_BURST.span; a += 0.07) {
      const n = at(a);
      const r = at(a, true);
      expect(r.flash).toBeCloseTo(n.flash * OVERLOAD_BURST.flashCalm);
      expect({ ...r, flash: 0 }).toEqual({ ...n, flash: 0 });
    }
  });

  it('the low tier sheds the debris and sparks only (the look has no tier input)', () => {
    expect(overloadBurstPieces(true, 1)).toEqual({ debris: 0, sparks: 0 });
    const hi = overloadBurstPieces(false, 1);
    expect(hi.debris).toBe(OVERLOAD_BURST.debris);
    expect(hi.sparks).toBe(OVERLOAD_BURST.sparks);
    expect(overloadBurstPieces(false, 0.5).sparks).toBe(Math.round(OVERLOAD_BURST.sparks / 2));
  });
});
