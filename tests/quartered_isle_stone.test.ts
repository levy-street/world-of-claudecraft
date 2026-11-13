// The Quartered Isle's generated stone (content/quartered_spires.ts): the
// Hoarshelf's snow floes and outcrops round its dark lakes, and the Heavestone
// Wilds' sandstone stacks and slabs.

import { describe, expect, it } from 'vitest';
import { PROP_ASSET_DEFS } from '../src/render/props';
import {
  ISLE_KIT,
  OUTCROP_DEPTH,
  QUARTERED_ISLE_SPIRES,
} from '../src/sim/content/quartered_spires';
import { QUARTERED_FROZEN_LAKES } from '../src/sim/quartered_landmarks';
import { dominantQuarterAt } from '../src/sim/quartered_quarters';

const stone = QUARTERED_ISLE_SPIRES;
const of = (...keys: string[]) => stone.filter((s) => keys.includes(s.key));
const lakeOf = (x: number, z: number) =>
  QUARTERED_FROZEN_LAKES.find((l) => Math.hypot(x - l.x, z - l.z) <= l.blendR + 1);

describe('the isle kit', () => {
  it('registers every generated piece in the prop catalogue at its pipeline footprint', () => {
    for (const key of Object.keys(ISLE_KIT)) {
      expect(PROP_ASSET_DEFS[key], key).toBeDefined();
      expect(PROP_ASSET_DEFS[key].url).toMatch(/^\/models\/props\/[a-z_]+\.glb$/);
    }
  });

  it('sizes every piece from the kit: height and a collider inside its outline', () => {
    for (const s of stone) {
      const kit = ISLE_KIT[s.key as keyof typeof ISLE_KIT];
      if (!kit) continue;
      const scale = s.scale ?? 1;
      expect(s.h, s.key).toBeCloseTo(kit.h * scale, 1);
      if ((s.r ?? 0) > 0) expect(s.r).toBeLessThanOrEqual((kit.w * scale) / 2 + 0.6);
    }
  });
});

describe('the Hoarshelf', () => {
  it('stands a floe or two wholly on every frozen lake, as stepping stones', () => {
    const floes = of('frostFloeSlab', 'frostFloeBroad');
    QUARTERED_FROZEN_LAKES.forEach((lake, li) => {
      const mine = floes.filter((f) => Math.hypot(f.x - lake.x, f.z - lake.z) < lake.r);
      expect(mine.length, `lake ${li}`).toBeGreaterThanOrEqual(1);
      expect(mine.length).toBeLessThanOrEqual(2);
      for (const f of mine) {
        const half = (ISLE_KIT[f.key as keyof typeof ISLE_KIT].w * (f.scale ?? 1)) / 2;
        expect(Math.hypot(f.x - lake.x, f.z - lake.z) + half).toBeLessThanOrEqual(lake.r);
        // a player steps up onto a floe instead of walking into a wall
        expect(f.standableTop).toBeGreaterThan(0);
        expect(f.standableTop).toBeLessThanOrEqual(f.h ?? 0);
      }
    });
    expect(floes.every((f) => lakeOf(f.x, f.z))).toBe(true);
  });

  it('rims the lakes with snow outcrops in back-to-back pairs, so no flat back shows', () => {
    const heaps = of('frostSnowOutcrop');
    expect(heaps.length % 2).toBe(0);
    expect(heaps.length).toBeGreaterThanOrEqual(2 * (QUARTERED_FROZEN_LAKES.length - 1));
    // the model's flat back is its local -x face; rotation.y = rot turns it
    // to (-cos rot, sin rot)
    const back = (h: (typeof heaps)[number]) => ({
      x: -Math.cos(h.rot ?? 0),
      z: Math.sin(h.rot ?? 0),
    });
    for (const h of heaps) {
      // the pair stands on its lake's bank: the outer heap a pair's depth out
      const lake = QUARTERED_FROZEN_LAKES.find(
        (l) => Math.hypot(h.x - l.x, h.z - l.z) <= l.r + 2 * OUTCROP_DEPTH * (h.scale ?? 1) + 2,
      );
      expect(lake, `outcrop at ${h.x},${h.z}`).toBeDefined();
      expect(Math.hypot(h.x - (lake?.x ?? 0), h.z - (lake?.z ?? 0))).toBeGreaterThan(lake?.r ?? 0);
      // its partner: same size, its back pointing straight back at this one's
      const b = back(h);
      const partner = heaps.find((o) => {
        if (o === h || o.scale !== h.scale) return false;
        const ob = back(o);
        if (b.x * ob.x + b.z * ob.z > -0.99) return false;
        // the partner sits behind this heap, along its back
        const dx = o.x - h.x;
        const dz = o.z - h.z;
        const d = Math.hypot(dx, dz);
        return (dx * b.x + dz * b.z) / d > 0.99;
      });
      expect(partner, `outcrop at ${h.x},${h.z} has a back-to-back partner`).toBeDefined();
      if (!partner) continue;
      // close enough that the two flat backs overlap: under one full depth apart
      const gap = Math.hypot(partner.x - h.x, partner.z - h.z);
      expect(gap).toBeLessThan(2 * OUTCROP_DEPTH * (h.scale ?? 1));
      expect(gap).toBeGreaterThan(OUTCROP_DEPTH * (h.scale ?? 1));
    }
  });
});

describe('the Heavestone Wilds', () => {
  it('stands a few great sandstone mesas, well apart, with fallen pieces at their feet', () => {
    const mesas = of('heaveStrataLarge');
    const earth = of('heaveStrataLarge', 'heaveStrataSmall', 'heaveStrataRubble');
    // few and big: the inspiration is one great stack on open sand
    expect(mesas.length).toBeGreaterThanOrEqual(4);
    expect(mesas.length).toBeLessThanOrEqual(6);
    expect(earth.length).toBeLessThanOrEqual(18);
    for (const m of mesas) expect(m.h).toBeGreaterThan(25);
    for (const [i, a] of mesas.entries()) {
      for (const b of mesas.slice(i + 1)) {
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(70);
      }
    }
    for (const s of earth) expect(dominantQuarterAt(s.x, s.z)).toBe('earth');
    // every lesser piece lies at the foot of a mesa, and the slabs are low
    for (const s of of('heaveStrataSmall', 'heaveStrataRubble')) {
      const near = Math.min(...mesas.map((m) => Math.hypot(s.x - m.x, s.z - m.z) - (m.r ?? 0)));
      expect(near).toBeLessThan(20);
    }
    for (const s of of('heaveStrataRubble')) expect(s.standableTop).toBeGreaterThan(0);
  });

  it('keeps the old kit boulders out of the Wilds', () => {
    const kit = of('rockTallA', 'rockLargeD', 'rockLargeF');
    expect(kit).toEqual([]);
  });
});
