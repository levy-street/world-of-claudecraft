// The Cornice's climb stands clear (Jose's playtest of 2026-11-25: "going up
// to the Breath by the ramp there are like two walls in the middle of the
// path"): the Cornice Mouth gate, whose two standing stones and threshold
// stood across the ramp near its head, is gone. A body walks from the climb's
// foot to the landing along any line of it, and no gate stands on the climb.

import { describe, expect, it } from 'vitest';
import { SMITH_HEART_GATES } from '../src/sim/content/smith_heart';
import { CORNICE_LANDING } from '../src/sim/content/smith_heart_layout';
import { breathFight } from './helpers/breath_fight';

/** The climb's long leg (smith_heart_layout.ts cornice_climb). */
const FOOT = { x: -104, z: 179 };
const HEAD = { x: -64, z: 193 };

describe("the Breath's climb", () => {
  it('holds no gate between its foot and the landing', () => {
    const ux = HEAD.x - FOOT.x;
    const uz = HEAD.z - FOOT.z;
    const len = Math.hypot(ux, uz);
    for (const g of SMITH_HEART_GATES) {
      const t = ((g.x - FOOT.x) * ux + (g.z - FOOT.z) * uz) / len;
      const n = Math.abs((g.x - FOOT.x) * uz - (g.z - FOOT.z) * ux) / len;
      expect(t > -4 && t < len + CORNICE_LANDING.r && n < 12, g.id).toBe(false);
    }
  });

  it('walks a body from its foot onto the landing along either edge and the middle', () => {
    const ux = HEAD.x - FOOT.x;
    const uz = HEAD.z - FOOT.z;
    const len = Math.hypot(ux, uz);
    const nx = -uz / len;
    const nz = ux / len;
    for (const off of [-4, 0, 4]) {
      // A fresh claim: the Breath's packs still stand (no gate waits on them).
      const f = breathFight(1, 23);
      const p = f.players[0];
      f.put(p, FOOT.x + nx * off, FOOT.z + nz * off);
      const meta = f.sim.players.get(p.id);
      if (!meta) throw new Error('meta');
      const to = { x: HEAD.x + nx * off * 0.5, z: HEAD.z + nz * off * 0.5 };
      for (let i = 0; i < 160; i++) {
        const at = f.local(p);
        p.facing = Math.atan2(to.x - at.x, to.z - at.z);
        meta.moveInput.forward = true;
        f.tick(1);
      }
      const at = f.local(p);
      expect(
        Math.hypot(at.x - CORNICE_LANDING.x, at.z - CORNICE_LANDING.z),
        `offset ${off}`,
      ).toBeLessThan(CORNICE_LANDING.r);
    }
  });
});
