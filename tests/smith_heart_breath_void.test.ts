// The Storm Cornice's void and the Breath guardian's tether, directly
// (src/sim/encounters/smith_heart/breath_void.ts over a REAL Sim, on
// tests/helpers/breath_fight.ts, and its pure geometry in breath_geometry.ts):
// a body come down in the void dies whatever shields it (but a game master is
// set back on the floor), its body is laid back on the Cornice so a
// resurrection never lands in the void again, only this claim's own field
// counts, and the guardian keeps a target on its floor or its climb, drops
// one in the void, and is put back where it stood when a step takes it off.

import { describe, expect, it } from 'vitest';
import { BREATH, CORNICE_GAPS, SMITH_HEART_FIELD } from '../src/sim/content/smith_heart_layout';
import {
  fellFromCornice,
  gapAt,
  inBreathArena,
  inClaimBand,
  onCorniceApproach,
  voidCorpseSpot,
} from '../src/sim/encounters/smith_heart';
import { authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';
import { breathFight } from './helpers/breath_fight';

const C = BREATH.cornice;

/** Walk `who` out through `gap` until it is dead or `seconds` pass. */
function walkOut(
  f: ReturnType<typeof breathFight>,
  who: number,
  gap: (typeof CORNICE_GAPS)[number],
  seconds = 15,
  until: () => boolean = () => f.players[who].dead,
) {
  const w = f.players[who];
  const a = (gap.deg * Math.PI) / 180;
  f.put(w, gap.x - Math.sin(a) * 4, gap.z - Math.cos(a) * 4);
  w.facing = a;
  const meta = f.sim.players.get(w.id);
  if (!meta) throw new Error('meta');
  meta.moveInput.forward = true;
  for (let i = 0; i < 20 * seconds && !until(); i++) f.tick(1, false);
  meta.moveInput.forward = false;
}

/** A point on the Cornice's climb outside the fight's gate (x < -66). */
function lowClimb(): { x: number; z: number } {
  for (let t = 0; t <= 1; t += 0.02) {
    const x = -110 + 44 * t;
    const z = 171 + 22 * t;
    if (x < -70 && authoredFieldSurfaceAt(SMITH_HEART_FIELD, x, z)?.id === 'cornice_climb')
      return { x, z };
  }
  throw new Error('no climb');
}

describe('the void: pure geometry', () => {
  it('a body under the void floor is the void, wherever it walked; a landing is not', () => {
    expect(fellFromCornice(300, 0, SMITH_HEART_FIELD.voidHeight + 1, true)).toBe(true);
    expect(fellFromCornice(C.x, C.z, C.h, true)).toBe(false);
    // The lake, the lowest floor, is never the void.
    expect(fellFromCornice(198, -2, -30, true)).toBe(false);
  });

  it("spares the next claim's floors within the Cornice's reach (slots 500 yd apart in z)", () => {
    expect(inClaimBand(C.z)).toBe(true);
    // The next claim's Hammer Pit and lower Gallery, in this claim's frame:
    // never this claim's warnings, and a body standing there is no fall.
    for (const [x, z, y] of [
      [8, -200 + 500, 14],
      [-66, -206 + 500, 28],
    ]) {
      expect(inClaimBand(z)).toBe(false);
      expect(fellFromCornice(x, z, y, true)).toBe(false);
    }
  });

  it('lays a fallen body back on the floor by its gap, clear of every gap', () => {
    for (const g of CORNICE_GAPS) {
      const a = (g.deg * Math.PI) / 180;
      const spot = voidCorpseSpot(g.x + Math.sin(a) * 12, g.z + Math.cos(a) * 12);
      expect(inBreathArena(spot.x, spot.z)).toBe(true);
      expect(gapAt(spot.x, spot.z)).toBeNull();
      expect(Math.hypot(spot.x - g.x, spot.z - g.z)).toBeLessThan(25);
    }
  });

  it('the climb is the way up: a target there may be kept', () => {
    const c = lowClimb();
    expect(inBreathArena(c.x, c.z)).toBe(false);
    expect(onCorniceApproach(c.x, c.z)).toBe(true);
    expect(onCorniceApproach(C.x, C.z)).toBe(true);
    expect(onCorniceApproach(C.x + C.rx + 20, C.z)).toBe(false);
  });
});

describe('the void over a real Sim', () => {
  it('a god-mode body dies, its corpse lies on the Cornice, and a resurrection there holds', () => {
    const f = breathFight(2, 23);
    const w = f.players[1];
    w.devGod = true;
    const gap = CORNICE_GAPS[0];
    walkOut(f, 1, gap);
    expect(w.dead).toBe(true);
    const at = f.local(w);
    expect(inBreathArena(at.x, at.z)).toBe(true);
    expect(w.pos.y).toBeGreaterThan(C.h - 1);
    // A battle resurrection where the body lies: alive, and it stays so.
    f.sim.revivePlayerAt(w.id, { ...w.pos }, 0.5);
    expect(w.dead).toBe(false);
    f.tick(40, false);
    expect(w.dead).toBe(false);
  });

  it('a game master is never killed: set back on the floor by its gap', () => {
    const f = breathFight(2, 23);
    const w = f.players[1];
    w.gm = true;
    const gap = CORNICE_GAPS[2];
    let wentDown = false;
    walkOut(f, 1, gap, 15, () => {
      if (w.pos.y < C.h - 10) wentDown = true;
      return wentDown && w.pos.y > C.h - 1;
    });
    expect(wentDown).toBe(true);
    expect(w.dead).toBe(false);
    const at = f.local(w);
    expect(inBreathArena(at.x, at.z)).toBe(true);
    expect(gapAt(at.x, at.z)).toBeNull();
  });
});

describe('the tether over a real Sim', () => {
  it('keeps a target on the climb, drops one in the void, puts a stray step back', () => {
    const f = breathFight(3, 23);
    f.dev('/dev heart breath pull');
    f.tick(2);
    const boss = f.boss();
    const [, onClimb, fallen] = f.players;
    const c = lowClimb();
    f.put(onClimb, c.x, c.z);
    boss.threat.set(onClimb.id, 5);
    f.put(fallen, C.x + C.rx + 25, C.z);
    fallen.pos.y = SMITH_HEART_FIELD.voidHeight;
    boss.threat.set(fallen.id, 5);
    f.tick(1, false);
    expect(boss.threat.has(onClimb.id)).toBe(true);
    expect(boss.threat.has(fallen.id)).toBe(false);
    // A step off the floor (the mob AI chasing over a gap) is undone, and
    // drawn as the jump back it is (prevPos with it).
    const home = { ...boss.pos };
    const gap = CORNICE_GAPS[3];
    const o = f.world(0, 0);
    boss.pos.x = o.x + gap.x + Math.sin((gap.deg * Math.PI) / 180) * 20;
    boss.pos.z = o.z + gap.z + Math.cos((gap.deg * Math.PI) / 180) * 20;
    boss.pos.y = SMITH_HEART_FIELD.voidHeight;
    f.tick(1, false);
    const at = f.local(boss);
    expect(inBreathArena(at.x, at.z)).toBe(true);
    expect(boss.pos.y).toBeGreaterThan(C.h - 1);
    expect(boss.prevPos).toEqual(boss.pos);
    expect(Math.hypot(boss.pos.x - home.x, boss.pos.z - home.z)).toBeLessThan(10);
  });
});
