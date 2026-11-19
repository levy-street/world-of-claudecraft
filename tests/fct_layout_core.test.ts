// The pure collision-aware FCT placement (src/ui/fct_layout_core.ts): lane travel
// interpolation, the lane preference per role, and the property the whole module exists
// for, that a placed number never overlaps a live one while there is room for it.

import { describe, expect, it } from 'vitest';
import {
  FCT_LAYOUT_DESKTOP,
  FCT_LAYOUT_MOBILE,
  FCT_PAD_PX,
  FCT_SAMPLES,
  FCT_SOLID_F,
  type FctLane,
  type FctPlaced,
  type FctPlaceRequest,
  fctBoxSize,
  fctFontPx,
  fctLanePrefs,
  laneOffset,
  placeFct,
} from '../src/ui/fct_layout_core';

const P = FCT_LAYOUT_DESKTOP;
const DUR = 1250;
const LANES: readonly FctLane[] = ['c', 'l', 'r', 'll', 'rr'];

function req(over: Partial<FctPlaceRequest> = {}): FctPlaceRequest {
  const box = fctBoxSize('123', fctFontPx(P, 'lane', 1));
  return { x: 0, y: 0, w: box.w, h: box.h, crit: false, durMs: DUR, lanes: ['l'], ...over };
}

/** Place `r` against `live` and record it as a new live floater born at `now`. */
function placeInto(live: FctPlaced[], r: FctPlaceRequest, now: number): FctPlaced {
  const at = placeFct(P, r, live, now);
  const placed: FctPlaced = {
    x: at.x,
    y: at.y,
    w: r.w,
    h: r.h,
    lane: at.lane,
    crit: r.crit,
    bornAt: now,
    durMs: r.durMs,
  };
  live.push(placed);
  return placed;
}

/** Whether two placed floaters' boxes ever overlap over their shared readable life. */
function everOverlap(a: FctPlaced, b: FctPlaced): boolean {
  const from = Math.max(a.bornAt, b.bornAt);
  const to = Math.min(a.bornAt + a.durMs * FCT_SOLID_F, b.bornAt + b.durMs * FCT_SOLID_F);
  for (let t = from; t <= to; t += 10) {
    const fa = (t - a.bornAt) / a.durMs;
    const fb = (t - b.bornAt) / b.durMs;
    // Only the stretch the core samples is guaranteed; past it a number is fading out.
    if (fa > FCT_SAMPLES[FCT_SAMPLES.length - 1] && fb > FCT_SAMPLES[FCT_SAMPLES.length - 1])
      continue;
    const oa = laneOffset(P, a.lane, fa);
    const ob = laneOffset(P, b.lane, fb);
    const ox = (a.w + b.w) / 2 + FCT_PAD_PX - Math.abs(a.x + oa.dx - (b.x + ob.dx));
    const oy = (a.h + b.h) / 2 + FCT_PAD_PX - Math.abs(a.y + oa.dy - (b.y + ob.dy));
    if (ox > 0.5 && oy > 0.5) return true;
  }
  return false;
}

describe('laneOffset: the travel the lane keyframes run', () => {
  it('starts every lane at its start offset and ends at its last waypoint', () => {
    for (const lane of LANES) {
      expect(laneOffset(P, lane, 0)).toEqual({ dx: 0, dy: 0 });
      const end = P.path[lane][P.path[lane].length - 1];
      expect(laneOffset(P, lane, 1)).toEqual({ dx: end.dx, dy: end.dy });
    }
  });

  it('interpolates linearly between waypoints and clamps outside the life', () => {
    const mid = laneOffset(P, 'c', 0.15);
    expect(mid.dx).toBe(0);
    expect(mid.dy).toBeCloseTo(P.path.c[1].dy / 2);
    expect(laneOffset(P, 'l', -1)).toEqual({ dx: 0, dy: 0 });
    expect(laneOffset(P, 'l', 2)).toEqual(laneOffset(P, 'l', 1));
  });

  it('gives every lane the same vertical profile, so stacked numbers keep their gap', () => {
    for (const profile of [FCT_LAYOUT_DESKTOP, FCT_LAYOUT_MOBILE])
      for (let f = 0; f <= 1; f += 0.05)
        for (const lane of LANES)
          expect(laneOffset(profile, lane, f).dy).toBeCloseTo(laneOffset(profile, 'c', f).dy);
  });

  it('starts the centre lane on the anchor and mirrors the side lanes', () => {
    for (const profile of [FCT_LAYOUT_DESKTOP, FCT_LAYOUT_MOBILE]) {
      expect(profile.start.c).toEqual({ x: 0, y: 0 });
      expect(profile.start.l.x).toBe(-profile.start.r.x);
      expect(profile.start.ll.x).toBe(-profile.start.rr.x);
      expect(profile.start.l.y).toBe(profile.start.r.y);
    }
  });
});

describe('placeFct: a new number lands clear of every live one', () => {
  it('takes the first preferred lane, unnudged, on an empty screen', () => {
    const at = placeFct(P, req({ lanes: ['r', 'l'] }), [], 0);
    expect(at).toEqual({ lane: 'r', x: P.start.r.x, y: P.start.r.y, nudge: 0 });
  });

  it('moves to the next lane rather than nudging while any lane is free', () => {
    const live: FctPlaced[] = [];
    placeInto(live, req({ lanes: ['l', 'r'] }), 0);
    const second = placeFct(P, req({ lanes: ['l', 'r'] }), live, 0);
    expect(second.lane).toBe('r');
    expect(second.nudge).toBe(0);
  });

  it('nudges down once every lane is taken, never back on top', () => {
    const live: FctPlaced[] = [];
    placeInto(live, req({ lanes: ['l'] }), 0);
    const at = placeFct(P, req({ lanes: ['l'] }), live, 0);
    expect(at.lane).toBe('l');
    expect(at.nudge).toBe(1);
    expect(at.y).toBe(P.start.l.y + P.nudgePx);
  });

  it('ignores a floater past its solid life (it is fading out)', () => {
    const live: FctPlaced[] = [];
    placeInto(live, req({ lanes: ['l'] }), 0);
    const at = placeFct(P, req({ lanes: ['l'] }), live, DUR);
    expect(at.nudge).toBe(0);
  });

  it('scales lane starts and the nudge with Combat Text Size', () => {
    const live: FctPlaced[] = [];
    placeInto(live, req({ lanes: ['l'], textScale: 1.5 }), 0);
    const at = placeFct(P, req({ lanes: ['l'], textScale: 1.5 }), live, 0);
    expect(live[0].x).toBe(P.start.l.x * 1.5);
    expect(at.y).toBe(P.start.l.y * 1.5 + P.nudgePx * 1.5);
  });

  it('keeps a realistic burst overlap-free: dual wield, abilities, crits and a pet', () => {
    // A deterministic pseudo-random stream of outgoing numbers at combat pace (one every
    // 60 to 200 ms), mixing widths and crits. Every placed pair must stay apart.
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const live: FctPlaced[] = [];
    let now = 0;
    let ordinal = 0;
    for (let i = 0; i < 40; i++) {
      now += 60 + Math.floor(rnd() * 140);
      for (let j = live.length - 1; j >= 0; j--)
        if (now - live[j].bornAt >= live[j].durMs) live.splice(j, 1);
      const crit = rnd() < 0.2;
      const pet = !crit && rnd() < 0.25;
      const text = `${100 + Math.floor(rnd() * 900)}${crit ? '!' : ''}`;
      const box = fctBoxSize(text, fctFontPx(P, crit ? 'crit' : pet ? 'minor' : 'lane', 1));
      const r = req({
        w: box.w,
        h: box.h,
        crit,
        lanes: fctLanePrefs(pet ? 'pet' : 'out', crit, ordinal++),
      });
      const placed = placeInto(live, r, now);
      for (const other of live) {
        if (other === placed) continue;
        expect(everOverlap(placed, other), `hit ${i} vs a live number`).toBe(false);
      }
    }
  });

  it('still places a number when nothing is clear (it is never refused)', () => {
    const live: FctPlaced[] = [];
    for (let i = 0; i < 40; i++) placeInto(live, req({ lanes: ['c'] }), 0);
    expect(live).toHaveLength(40);
    expect(Number.isFinite(live[39].y)).toBe(true);
  });

  it('is pure: the same request and live set give the same answer', () => {
    const live: FctPlaced[] = [];
    placeInto(live, req({ lanes: ['l'] }), 0);
    const a = placeFct(P, req({ lanes: ['l', 'r'] }), live, 100);
    const b = placeFct(P, req({ lanes: ['l', 'r'] }), live, 100);
    expect(a).toEqual(b);
  });
});

describe('fctLanePrefs: where each kind of number wants to rise', () => {
  it('alternates outgoing sides by ordinal and keeps the centre for last', () => {
    expect(fctLanePrefs('out', false, 0)).toEqual(['l', 'r', 'll', 'rr', 'c']);
    expect(fctLanePrefs('out', false, 1)).toEqual(['r', 'll', 'rr', 'l', 'c']);
    expect(fctLanePrefs('out', false, -1)[0]).toBe('rr');
  });

  it('gives an outgoing crit the centre first', () => {
    expect(fctLanePrefs('out', true, 2)[0]).toBe('c');
  });

  it("sends a pet's hit to the far lanes first, alternating sides", () => {
    expect(fctLanePrefs('pet', false, 0).slice(0, 2)).toEqual(['ll', 'rr']);
    expect(fctLanePrefs('pet', false, 1).slice(0, 2)).toEqual(['rr', 'll']);
  });

  it('splits what happens to you: damage centre, heals right, protection left', () => {
    expect(fctLanePrefs('in', false, 0)[0]).toBe('c');
    expect(fctLanePrefs('heal', false, 0)[0]).toBe('r');
    expect(fctLanePrefs('guard', false, 0)[0]).toBe('l');
    expect(fctLanePrefs('info', false, 0)[0]).toBe('c');
  });

  it('lists every lane at most once for every role', () => {
    for (const role of ['out', 'pet', 'in', 'heal', 'guard', 'info'] as const)
      for (const crit of [false, true])
        for (let o = 0; o < 4; o++) {
          const prefs = fctLanePrefs(role, crit, o);
          expect(new Set(prefs).size).toBe(prefs.length);
        }
  });
});
