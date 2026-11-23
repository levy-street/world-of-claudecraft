// The Hollow Crypt's stairs say where the route goes (docs/design/dungeon-rework/
// hollow_crypt.md, "Route map"). A playtest found a white bone stair that
// assembled on a boss death (the old Bridge of Bone off the Bell Yard) and
// read as the way on, while it only led back into an arena already cleared.
// It is gone: no gate may reveal a hidden walkway, and the one stair the crypt
// builds for the finale, the Bone Stair, is the real, continuous, walkable way
// from the Stair Landing up to the Rite Ring, closed until its guard dies.

import { describe, expect, it } from 'vitest';
import { HOLLOW_CRYPT_GATES } from '../src/sim/content/hollow_crypt';
import { HOLLOW_CRYPT_FIELD, HOLLOW_CRYPT_RING } from '../src/sim/content/hollow_crypt_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { authoredFieldHeight } from '../src/sim/instances/authored_field';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { MoveInput } from '../src/sim/types';

const IDLE: MoveInput = {
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  dive: false,
  surface: false,
};

function boneStair(): [number, number, number][] {
  const s = HOLLOW_CRYPT_FIELD.surfaces.find((f) => f.id === 'bone_stair');
  if (!s || s.kind !== 'path') throw new Error('no bone stair');
  return s.points as [number, number, number][];
}

function surfaceHeight(id: string): number {
  const s = HOLLOW_CRYPT_FIELD.surfaces.find((f) => f.id === id);
  if (!s || s.kind === 'path') throw new Error(`no surface ${id}`);
  return s.h;
}

/** Walk a player along waypoints (instance-local) for up to `seconds`. */
function walk(
  sim: Sim,
  ox: number,
  oz: number,
  route: [number, number][],
  seconds: number,
): number {
  const meta = sim.players.get(sim.player.id);
  if (!meta) throw new Error('no meta');
  const p = sim.player;
  let next = 0;
  for (let t = 0; t < seconds * 20 && next < route.length; t++) {
    const [wx, wz] = route[next];
    const dx = ox + wx - p.pos.x;
    const dz = oz + wz - p.pos.z;
    if (Math.hypot(dx, dz) < 1.5) {
      next++;
      continue;
    }
    p.facing = Math.atan2(dx, dz);
    Object.assign(meta.moveInput, IDLE, { forward: true });
    sim.tick();
  }
  Object.assign(meta.moveInput, IDLE);
  return next;
}

function crypt(openGates: boolean): { sim: Sim; ox: number; oz: number } {
  const sim = new Sim({ seed: 17, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat('/dev god', sim.player.id);
  sim.chat('/dev noaggro', sim.player.id);
  sim.chat('/dev crypt enter', sim.player.id);
  if (openGates) sim.chat('/dev crypt gates', sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('no claim');
  const o = instanceOrigin(DUNGEONS.hollow_crypt.index, inst.slot);
  sim.chat('/dev crypt tp stair', sim.player.id);
  for (let i = 0; i < 10; i++) sim.tick();
  return { sim, ox: o.x, oz: o.z };
}

describe('Hollow Crypt stairs lead where the route goes', () => {
  it('no gate reveals a hidden walkway, and no stair assembles out of nothing', () => {
    expect(HOLLOW_CRYPT_FIELD.surfaces.filter((s) => s.hidden).map((s) => s.id)).toEqual([]);
    expect(HOLLOW_CRYPT_GATES.map((g) => g.id)).not.toContain('yard_bridge');
    expect(HOLLOW_CRYPT_FIELD.surfaces.map((s) => s.id)).not.toContain('west_postern');
  });

  it('the Bone Stair climbs without a break from the Stair Landing to the Rite Ring', () => {
    const pts = boneStair();
    expect(pts[0][2]).toBe(surfaceHeight('stair_landing'));
    expect(pts[pts.length - 1][2]).toBe(HOLLOW_CRYPT_RING.h);
    let prev: number | null = null;
    let worst = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az, ah] = pts[i];
      const [bx, bz, bh] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (let d = 0; d <= len; d += 0.25) {
        const t = d / len;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        const floor = authoredFieldHeight(HOLLOW_CRYPT_FIELD, x, z);
        // The floor under the centreline IS the stair: never the void, never a
        // wall top, always within a step of the authored rise.
        expect(
          Math.abs(floor - (ah + (bh - ah) * t)),
          `${x.toFixed(1)},${z.toFixed(1)}`,
        ).toBeLessThan(0.75);
        if (prev !== null) worst = Math.max(worst, Math.abs(floor - prev));
        prev = floor;
      }
    }
    // A quarter yard never climbs more than a low step.
    expect(worst).toBeLessThan(0.6);
  });

  it('a player walks up the Bone Stair into the Rite Ring once its gate is open', () => {
    const { sim, ox, oz } = crypt(true);
    const route = boneStair().map(([x, z]) => [x, z] as [number, number]);
    const reached = walk(sim, ox, oz, route, 90);
    expect(reached).toBe(route.length);
    const p = sim.player;
    expect(
      Math.hypot(p.pos.x - ox - HOLLOW_CRYPT_RING.x, p.pos.z - oz - HOLLOW_CRYPT_RING.z),
    ).toBeLessThan(HOLLOW_CRYPT_RING.r);
    expect(p.pos.y).toBeGreaterThan(HOLLOW_CRYPT_RING.h - 1);
  });

  it('with the Stair Gate still closed the same walk stops at the landing', () => {
    const { sim, ox, oz } = crypt(false);
    const route = boneStair().map(([x, z]) => [x, z] as [number, number]);
    walk(sim, ox, oz, route, 30);
    const gate = HOLLOW_CRYPT_GATES.find((g) => g.id === 'stair_gate');
    if (!gate) throw new Error('no stair gate');
    // Never past the gate's line, never up the stair.
    expect(sim.player.pos.x - ox).toBeLessThan(gate.x + 1);
    expect(sim.player.pos.y).toBeLessThan(surfaceHeight('stair_landing') + 1.5);
  });
});
