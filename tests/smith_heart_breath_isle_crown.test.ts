// The Islands of the Wind's east chain over the Heart's crown (Jose's call of
// 2026-11-18: the two groups across the Cornice from each other, the boss
// between; the south-west chain kept where it was). The east chain hangs
// over the crown's rock, about fifteen yards higher than before, so:
//   - it carves no sky out of the crown (the chamber would open): the rock
//     under each isle is capped under its crag's point instead;
//   - the crown climbs into a ridge on the chamber's rim toward the Cornice,
//     so no reachable eye (the Cornice's east rim, each isle's floor and its
//     adds' spots, every ride of the chain and the air over each isle) sees
//     into the open Heart chamber;
//   - a body walked off an isle is the void's in a band under its floor,
//     long before it would sink into that rock or drift out of the claim.

import { describe, expect, it } from 'vitest';
import { heartMountainHeight } from '../src/render/smith_heart/heart_mountain_core';
import {
  heartRockSolids,
  heartSightlineHits,
  heartWallSolids,
} from '../src/render/smith_heart/heart_sightline_core';
import {
  HEART_ISLE_HANG,
  HEART_ISLE_ROCK_GAP,
  heartIsleOverCrown,
  heartOpenAir,
} from '../src/render/smith_heart/heart_walls_core';
import { ISLE_KIT } from '../src/render/smith_heart_fx/breath_isles_fx_core';
import {
  BREATH,
  BREATH_ISLE_REACH,
  BREATH_ISLES,
  HEART_ROOM,
} from '../src/sim/content/smith_heart_layout';
import {
  fellFromIsle,
  gapAt,
  ISLE_FALL,
  inBreathArena,
  lipDistance,
} from '../src/sim/encounters/smith_heart/breath_geometry';
import {
  cornicePads,
  HOME_LIP_CLEAR,
  isleSpots,
  rideArc,
} from '../src/sim/encounters/smith_heart/breath_isle_geometry';

const C = BREATH.cornice;
type P = { x: number; y: number; z: number };

describe('the east chain over the crown', () => {
  it('only the east chain floats over the crown, each a stride higher than the last', () => {
    BREATH_ISLES.forEach((isle, i) => {
      expect(heartIsleOverCrown(i), isle.id).toBe(isle.side === 0);
    });
    const east = BREATH_ISLES.filter((b) => b.side === 0);
    const west = BREATH_ISLES.filter((b) => b.side === 1);
    // The opposite group: east of the guardian's spot, the kept chain west.
    for (const b of east) expect(b.x).toBeGreaterThan(C.x + C.rx);
    for (const b of west) expect(b.x).toBeLessThan(C.x);
    // About fifteen yards over the old chain (22, 29, 36 over the Cornice).
    expect(east.map((b) => b.h - C.h)).toEqual([37, 44, 51]);
  });

  it('carves no sky: the rock under each stays capped under its crag point', () => {
    expect(Math.max(...ISLE_KIT.map((k) => k.depth))).toBeLessThanOrEqual(HEART_ISLE_HANG);
    BREATH_ISLES.forEach((isle, i) => {
      if (!heartIsleOverCrown(i)) return;
      expect(heartOpenAir(isle.x, isle.z, 0), isle.id).toBe(false);
      const point = isle.h - ISLE_KIT[i].depth;
      for (let a = 0; a < 360; a += 30)
        for (const r of [0, 6, BREATH_ISLE_REACH[i]]) {
          const x = isle.x + Math.sin((a * Math.PI) / 180) * r;
          const z = isle.z + Math.cos((a * Math.PI) / 180) * r;
          expect(heartMountainHeight(x, z), `${isle.id} ${a} ${r}`).toBeLessThanOrEqual(
            point - HEART_ISLE_ROCK_GAP + 1e-6,
          );
        }
    });
  });

  it('no reachable eye sees into the open Heart chamber', () => {
    const eyes: (P & { name: string })[] = [];
    // The Cornice's east rim, at a standing eye and a jump's height.
    for (let deg = 30; deg <= 150; deg += 10) {
      const a = (deg * Math.PI) / 180;
      const r = 1 / Math.hypot(Math.sin(a) / C.rx, Math.cos(a) / C.rz) - 1;
      for (const up of [1.7, 6])
        eyes.push({
          name: `rim ${deg}`,
          x: C.x + Math.sin(a) * r,
          y: C.h + up,
          z: C.z + Math.cos(a) * r,
        });
    }
    const sp = isleSpots();
    BREATH_ISLES.forEach((isle, i) => {
      if (isle.side !== 0) return;
      for (const [dx, dz] of [
        [0, 0],
        [8, 0],
        [-8, 0],
        [0, 8],
        [0, -8],
      ])
        eyes.push({ name: isle.id, x: isle.x + dx, y: isle.h + 1.7, z: isle.z + dz });
      eyes.push({ name: `${isle.id} air`, x: isle.x, y: isle.h + 14, z: isle.z });
      for (const a of sp[i].adds)
        eyes.push({ name: `${isle.id} adds`, x: a.x, y: isle.h + 1.7, z: a.z });
    });
    const pad = cornicePads()[0];
    const legs: [P, P][] = [
      [
        { x: pad.x, y: C.h, z: pad.z },
        { x: sp[0].land.x, y: sp[0].h, z: sp[0].land.z },
      ],
    ];
    for (let i = 0; i < 2; i++) {
      const from = sp[i].pad;
      if (!from) throw new Error('no pad');
      legs.push([
        { x: from.x, y: sp[i].h, z: from.z },
        { x: sp[i + 1].land.x, y: sp[i + 1].h, z: sp[i + 1].land.z },
      ]);
    }
    legs.push([
      { x: sp[2].x, y: sp[2].h, z: sp[2].z },
      { x: sp[2].back.x, y: C.h, z: sp[2].back.z },
    ]);
    legs.forEach(([a, b], li) => {
      for (let k = 0; k <= 1 + 1e-9; k += 0.1) {
        const p = rideArc(a, b, k);
        eyes.push({ name: `ride ${li}`, x: p.x, y: p.y + 1.7, z: p.z });
      }
    });
    const targets: P[] = [];
    for (let r = 0; r <= 84; r += 12)
      for (let a = 0; a < 360; a += 20)
        for (const up of [1, 12])
          targets.push({
            x: HEART_ROOM.x + Math.sin((a * Math.PI) / 180) * r,
            y: HEART_ROOM.h + up,
            z: HEART_ROOM.z + Math.cos((a * Math.PI) / 180) * r,
          });
    const solids = [...heartWallSolids(5), ...heartRockSolids()];
    const seen: string[] = [];
    for (const e of eyes)
      for (const t of targets) {
        const d = Math.hypot(t.x - e.x, t.z - e.z);
        let blocked = false;
        for (let s = 2; s < d - 2 && !blocked; s += 1.5) {
          const k = s / d;
          if (
            heartMountainHeight(e.x + (t.x - e.x) * k, e.z + (t.z - e.z) * k) >
            e.y + (t.y - e.y) * k
          )
            blocked = true;
        }
        if (!blocked && heartSightlineHits(e, t, solids, 1).length === 0)
          seen.push(`${e.name} -> (${t.x.toFixed(0)}, ${t.z.toFixed(0)})`);
      }
    expect(seen.slice(0, 8)).toEqual([]);
  }, 60_000);

  it('a body walked off an isle is the void’s in the band under its floor', () => {
    BREATH_ISLES.forEach((isle, i) => {
      const x = isle.x + BREATH_ISLE_REACH[i] + 3;
      const z = isle.z;
      // On its floor's height and just under: not yet.
      expect(fellFromIsle(x, z, isle.h), isle.id).toBe(false);
      expect(fellFromIsle(x, z, isle.h - ISLE_FALL.drop + 1), isle.id).toBe(false);
      // Well under its floor: the void's.
      expect(fellFromIsle(x, z, isle.h - ISLE_FALL.drop - 2), isle.id).toBe(true);
      // Caught before the crown's rock under it (its cap).
      expect(isle.h - ISLE_FALL.band).toBeGreaterThan(
        isle.h - HEART_ISLE_HANG - HEART_ISLE_ROCK_GAP,
      );
    });
    // A body walked off the Cornice under an isle is never caught here.
    const e3 = BREATH_ISLES[2];
    expect(fellFromIsle(e3.x - BREATH_ISLE_REACH[2] - 2, e3.z, C.h - 1)).toBe(false);
    // Standing on the Cornice: never.
    expect(fellFromIsle(C.x + 10, C.z, C.h)).toBe(false);
  });
});

describe('the ride home sets every body down clear of the edge', () => {
  it('never in a gap, at least HOME_LIP_CLEAR in from every open lip', () => {
    for (const s of isleSpots()) {
      expect(inBreathArena(s.back.x, s.back.z)).toBe(true);
      expect(gapAt(s.back.x, s.back.z)).toBeNull();
      expect(lipDistance(s.back.x, s.back.z)).toBeGreaterThanOrEqual(HOME_LIP_CLEAR);
    }
  });
});
