// The Wind Bridge stands clear (Jose's playtest of 2026-11-25: "going up to
// the Breath by the ramp there are like two walls in the middle of the
// path"): the two low wind-shelter slabs that stood on the bridge's floor
// are gone, both their look (a field prop) and their collision (the prop's
// footprint), and a body walks the whole bridge along either side.

import { describe, expect, it } from 'vitest';
import { SMITH_HEART_FIELD, WIND_BRIDGE } from '../src/sim/content/smith_heart_layout';
import { authoredFieldColliders } from '../src/sim/instances/authored_field';
import { breathFight } from './helpers/breath_fight';

const W = WIND_BRIDGE;
const LEN = Math.hypot(W.toX - W.fromX, W.toZ - W.fromZ);
const UX = (W.toX - W.fromX) / LEN;
const UZ = (W.toZ - W.fromZ) / LEN;
/** (along, across) of (x, z) on the bridge's line. */
const rel = (x: number, z: number) => ({
  t: (x - W.fromX) * UX + (z - W.fromZ) * UZ,
  n: -(x - W.fromX) * UZ + (z - W.fromZ) * UX,
});

describe('the Wind Bridge', () => {
  it('holds no prop and no collider on its floor (only its parapets)', () => {
    for (const p of SMITH_HEART_FIELD.props) {
      const r = rel(p.x, p.z);
      expect(r.t > 0 && r.t < LEN && Math.abs(r.n) < W.halfWidth, p.kind).toBe(false);
    }
    for (const c of authoredFieldColliders(SMITH_HEART_FIELD, 0)) {
      const r = rel(c.x, c.z);
      if (r.t < 2 || r.t > LEN - 2) continue;
      // Every collider along the bridge is a parapet at its edge.
      expect(Math.abs(r.n), `collider at ${c.x}, ${c.z}`).toBeGreaterThan(W.halfWidth - 1);
    }
  });

  it('walks a body the whole way up along either side and the middle', () => {
    for (const off of [-3, 0, 3]) {
      const f = breathFight(1, 23);
      const p = f.players[0];
      const nx = -UZ;
      const nz = UX;
      f.put(p, W.fromX + UX * 2 + nx * off, W.fromZ + UZ * 2 + nz * off);
      const meta = f.sim.players.get(p.id);
      if (!meta) throw new Error('meta');
      const to = { x: W.toX + nx * off, z: W.toZ + nz * off };
      for (let i = 0; i < 160; i++) {
        const at = f.local(p);
        p.facing = Math.atan2(to.x - at.x, to.z - at.z);
        meta.moveInput.forward = true;
        f.tick(1);
      }
      const at = f.local(p);
      expect(rel(at.x, at.z).t, `offset ${off}`).toBeGreaterThan(LEN - 3);
    }
  });
});
