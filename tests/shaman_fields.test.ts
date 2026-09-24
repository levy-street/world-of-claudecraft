import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ShamanFields } from '../src/render/ability_vfx/shaman_fields';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { tickGroundAoEs } from '../src/sim/entity_roster';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function harness() {
  const fields = new ShamanFields();
  const paths: { points: number[][]; width: number; light: number; color: number }[] = [];
  const buffers: THREE.Vector3[][] = [];
  const ground = (x: number, z: number) => x * 0.1 + z * 0.07;
  const ribbons = {
    appendHeld(
      points: THREE.Vector3[],
      count: number,
      width: number,
      color: number,
      light: number,
    ) {
      paths.push({ points: points.slice(0, count).map((p) => p.toArray()), width, light, color });
      buffers.push(points);
    },
  };
  const overlay = { push() {} };
  const host = {
    anchorOf(_id: number, _fraction: number, out: THREE.Vector3) {
      return out.set(0, 0, 0);
    },
    groundYAt: vi.fn(ground),
  };
  const draw = (frame = 1, time = 10, quality = 1, reduced = false) => {
    paths.length = 0;
    buffers.length = 0;
    fields.draw(frame, time, reduced, quality, host, ribbons, overlay);
    return paths;
  };
  return { fields, paths, draw, ground, host, buffers };
}
const quake = {
  ability: 'earthquake',
  fx: 'nova',
  sourceId: 7,
  x: 12,
  z: -5,
  radius: 8,
  duration: 6,
};
const root = { id: 'earthbind_root', kind: 'root', remaining: 0.01 };
const slow = { id: 'earthbind_slow', kind: 'slow', remaining: 5 };

describe('Shaman authoritative field dressing', () => {
  it.each([0, 1])(
    'builds inner fractures gradually without hiding any true-radius boundary at quality %s',
    (quality) => {
      const h = harness();
      h.fields.quake(quake, 10);
      const opening = structuredClone(h.draw(1, 10, quality));
      const middle = structuredClone(h.draw(2, 10.35, quality));
      const peak = structuredClone(h.draw(3, 10.85, quality));
      const boundary = (paths: typeof h.paths) => paths.filter((p) => p.color === 0x85918e);
      expect(boundary(opening)).toHaveLength(12);
      expect(boundary(middle)).toEqual(boundary(opening));
      expect(boundary(peak)).toEqual(boundary(opening));
      const reach = (paths: typeof h.paths) =>
        Math.max(
          ...paths
            .filter((p) => p.color === 0x6c7777)
            .flatMap((p) => p.points.map(([x, , z]) => Math.hypot(x - quake.x, z - quake.z))),
        );
      expect(reach(opening)).toBeLessThan(quake.radius * 0.1);
      expect(reach(middle)).toBeGreaterThan(reach(opening) * 3);
      expect(reach(middle)).toBeLessThan(reach(peak) * 0.7);
      expect(reach(peak)).toBeGreaterThan(quake.radius * 0.95);
      expect(peak.length).toBe(opening.length);
    },
  );

  it('keeps travelling pressure on the actual fracture segments on sloped ground', () => {
    const h = harness();
    h.fields.quake(quake, 10);
    for (const time of [10.38, 10.8, 12.3]) {
      const paths = h.draw(1, time, 1);
      const seams = paths.filter((p) => p.color === 0x6c7777);
      const fronts = paths.filter((p) => p.color === 0xe2c391);
      expect(fronts).toHaveLength(seams.length);
      for (let n = 0; n < fronts.length; n++) {
        for (const [x, y, z] of fronts[n].points) {
          const distance = Math.min(
            ...seams[n].points.slice(1).map((b, k) => {
              const a = seams[n].points[k];
              const dx = b[0] - a[0],
                dz = b[2] - a[2];
              const u = Math.max(
                0,
                Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz)),
              );
              return Math.hypot(x - a[0] - u * dx, z - a[2] - u * dz);
            }),
          );
          expect(distance).toBeLessThan(1e-8);
          expect(y).toBeCloseTo(h.ground(x, z) + 0.055, 8);
        }
      }
    }
  });

  it('keeps Faultwake until its supplied expiry, including a paused clock, without accepting pulse refresh', () => {
    const h = harness();
    expect(h.fields.quake(quake, 10)).toBe(true);
    expect(h.draw(1, 10)).not.toHaveLength(0);
    expect(h.draw(80, 10)).not.toHaveLength(0);
    expect(h.fields.quake({ ...quake, fx: 'tick' }, 15)).toBe(false);
    expect(h.draw(81, 15.999)).not.toHaveLength(0);
    expect(h.draw(82, 16)).toHaveLength(0);
  });

  it('rejects missing duration, wrong ability and invalid geometry instead of guessing a lifetime', () => {
    const h = harness();
    expect(h.fields.quake({ ...quake, duration: undefined }, 10)).toBe(false);
    expect(h.fields.quake({ ...quake, ability: 'blizzard' }, 10)).toBe(false);
    expect(h.fields.quake({ ...quake, radius: NaN }, 10)).toBe(false);
    expect(h.fields.quake({ ...quake, duration: -1 }, 10)).toBe(false);
    expect(h.fields.quake({ ...quake, x: Infinity }, 10)).toBe(false);
    expect(h.draw()).toHaveLength(0);
  });

  it.each([0, 1])(
    'drapes fractures on terrain and never exceeds the real radius at quality %s',
    (quality) => {
      const h = harness();
      h.fields.quake(quake, 10);
      h.draw(1, 11, quality);
      expect(h.paths.length).toBeGreaterThanOrEqual(4);
      const reaches = new Set<number>();
      for (const path of h.paths)
        for (const [x, y, z] of path.points) {
          expect(y).toBeCloseTo(h.ground(x, z) + 0.055, 8);
          expect(Math.hypot(x - quake.x, z - quake.z)).toBeLessThanOrEqual(quake.radius);
          reaches.add(Math.round(Math.hypot(x - quake.x, z - quake.z) * 100));
        }
      expect(reaches.size).toBeGreaterThan(12);
    },
  );

  it('does not move or pulse ground detail under reduced motion', () => {
    const h = harness();
    h.fields.quake(quake, 10);
    const first = structuredClone(h.draw(1, 10, 1, true));
    expect(h.draw(2, 12, 1, true)).toEqual(first);
  });

  it.each([0, 1])(
    'keeps twelve unequal boundary brackets at the true radius through expiry at quality %s',
    (quality) => {
      const h = harness();
      h.fields.quake(quake, 10);
      for (const time of [10, 12, 15.999]) {
        const rim = h.draw(1, time, quality, true).filter((p) => p.color === 0x85918e);
        expect(rim).toHaveLength(12);
        expect(new Set(rim.map((p) => p.width)).size).toBe(12);
        for (const path of rim) {
          expect(path.points).toHaveLength(5);
          expect(path.width).toBeGreaterThan(0.2);
          for (const [x, , z] of path.points)
            expect(Math.hypot(x - quake.x, z - quake.z) + path.width / 2).toBeLessThanOrEqual(
              quake.radius + 1e-8,
            );
          const middle = path.points[2];
          expect(Math.hypot(middle[0] - quake.x, middle[2] - quake.z) + path.width / 2).toBeCloseTo(
            quake.radius,
            8,
          );
        }
        // One bracket in every 30-degree sector; gaps are intentional, never
        // so large that the silhouette implies a smaller or one-sided hazard.
        for (let i = 0; i < 12; i++) {
          const a = rim[i].points[2],
            b = rim[(i + 1) % 12].points[2];
          const delta =
            (Math.atan2(b[2] - quake.z, b[0] - quake.x) -
              Math.atan2(a[2] - quake.z, a[0] - quake.x) +
              Math.PI * 2) %
            (Math.PI * 2);
          expect(delta).toBeCloseTo(Math.PI / 6, 8);
        }
        const mineral = h.paths.filter((p) => p.color === 0xc4a675);
        expect(mineral).toHaveLength(quality > 0 ? 12 : 0);
        for (const path of mineral) expect(path.width).toBeLessThan(0.06);
      }
      expect(h.draw(1, 16, quality)).toHaveLength(0);
    },
  );

  it('prepares boundary terrain only once and reuses buffers until a slot is recycled', () => {
    const h = harness();
    h.fields.quake(quake, 10);
    h.draw(1, 10, 0);
    expect(h.host.groundYAt).toHaveBeenCalledTimes(1 + 12 * 8 + 4 * 7);
    const boundaryBuffers = h.buffers.slice(0, 12);
    h.host.groundYAt.mockClear();
    h.draw(2, 11, 0);
    expect(h.host.groundYAt).toHaveBeenCalledTimes(4 * 7);
    for (let i = 0; i < 12; i++) expect(h.buffers[i]).toBe(boundaryBuffers[i]);
    h.fields.quake({ ...quake, x: 40 }, 16);
    h.host.groundYAt.mockClear();
    h.draw(3, 16, 0);
    expect(h.host.groundYAt).toHaveBeenCalledTimes(1 + 12 * 8 + 4 * 7);
    expect(h.paths[0].points[2][0]).toBeGreaterThan(30);
  });

  it('keeps the boundary finite and visible when terrain samples are unavailable', () => {
    const h = harness();
    h.host.groundYAt.mockReturnValue(NaN);
    h.fields.quake(quake, 10);
    const paths = h.draw(1, 10, 0, true);
    expect(paths.filter((p) => p.color === 0x85918e)).toHaveLength(12);
    for (const path of paths)
      for (const point of path.points) expect(point.every(Number.isFinite)).toBe(true);
  });

  it('follows live root duration, dispel and slow independently without inventing a zone', () => {
    const h = harness();
    h.fields.syncEntity(1, { id: 4, auras: [root, slow] });
    h.draw();
    expect(h.paths.some((p) => p.points.some(([x, y, z]) => y > h.ground(x, z) + 0.3))).toBe(true);
    h.fields.syncEntity(2, { id: 4, auras: [{ ...root, remaining: 0 }, slow] });
    h.draw(2);
    expect(h.paths.length).toBeGreaterThan(0);
    for (const p of h.paths)
      for (const [x, y, z] of p.points) expect(y).toBeCloseTo(h.ground(x, z) + 0.04, 8);
    h.fields.syncEntity(3, { id: 4, auras: [] });
    expect(h.draw(3)).toHaveLength(0);
  });

  it('drops dead, missing and wrong-kind bindings immediately, including on low quality', () => {
    const h = harness();
    h.fields.syncEntity(1, { id: 4, auras: [root] });
    expect(h.draw(1, 10, 0).length).toBeGreaterThan(0);
    expect(h.draw(2)).toHaveLength(0);
    h.fields.syncEntity(2, { id: 4, auras: [root], dead: true });
    expect(h.draw(2)).toHaveLength(0);
    h.fields.syncEntity(3, { id: 4, auras: [{ ...root, kind: 'buff_haste' }] });
    expect(h.draw(3)).toHaveLength(0);
  });

  it('caps crowd dressing, reclaims expired slots and clears both state families', () => {
    const h = harness();
    for (let i = 0; i < 8; i++) expect(h.fields.quake({ ...quake, sourceId: i }, 10)).toBe(true);
    expect(h.fields.quake(quake, 10)).toBe(false);
    expect(h.fields.quake(quake, 16)).toBe(true);
    for (let id = 0; id < 50; id++) h.fields.syncEntity(1, { id, auras: [root] });
    expect(h.draw(1, 16, 0)).toHaveLength(12 + 4 + 24 * 3);
    h.fields.clear();
    expect(h.draw()).toHaveLength(0);
    h.fields.dispose();
    expect(h.fields.quake(quake, 10)).toBe(false);
    h.fields.syncEntity(1, { id: 4, auras: [root] });
    expect(h.draw()).toHaveLength(0);
  });
  it.each([0, -1])('removes zero-health binding before dead state arrives (hp=%s)', (hp) => {
    const h = harness();
    h.fields.syncEntity(1, { id: 4, auras: [root, slow], hp: 100, dead: false });
    expect(h.draw(1).length).toBeGreaterThan(0);
    h.fields.syncEntity(2, { id: 4, auras: [root, slow], hp, dead: false });
    expect(h.draw(2)).toHaveLength(0);
    h.fields.syncEntity(3, { id: 4, auras: [root], hp: 100, dead: false });
    expect(h.draw(3).length).toBeGreaterThan(0);
  });
});

function produceQuake(aimed: boolean) {
  const sim = new Sim({ seed: 2806, playerClass: 'shaman', noPlayer: true });
  const id = sim.addPlayer('shaman', 'Field test');
  sim.setPlayerLevel(20, id);
  sim.setSpec('elemental', id);
  const player = sim.entities.get(id);
  const meta = sim.ctx.players.get(id);
  const resolved = sim.resolvedAbility('earthquake', id);
  if (!player || !meta || !resolved) throw new Error('missing Shaman field fixture');
  player.pos = sim.groundPos(700, 0);
  player.prevPos = { ...player.pos };
  player.castAim = aimed ? { ...player.pos } : null;
  const target = createMob(90001, MOBS.training_dummy, 20, sim.groundPos(701, 0));
  target.hostile = true;
  target.hp = target.maxHp = 999999;
  sim.ctx.addEntity(target);
  sim.drainEvents();
  sim.ctx.runEffects(player, meta, null, resolved);
  const events: SimEvent[] = sim.drainEvents();
  return { sim, player, events };
}

describe('Faultwake authoritative duration cue', () => {
  it.each([true, false])(
    'announces resolved radius and duration for aimed=%s without changing zone mechanics',
    (aimed) => {
      const { sim, player, events } = produceQuake(aimed);
      const cue = events.find(
        (e) => e.type === 'spellfxAt' && e.fx === 'nova' && e.ability === 'earthquake',
      );
      expect(cue).toMatchObject({ sourceId: player.id, x: 700, z: 0, radius: 8, duration: 6 });
      expect(sim.ctx.groundAoEs).toHaveLength(1);
      // The level-20 elemental resolved values include the existing spec scaling.
      expect(sim.ctx.groundAoEs[0]).toMatchObject({
        remaining: 6,
        interval: 1.5,
        radius: 8,
        min: 17,
        max: 22,
      });
      expect(
        events.some((e) => e.type === 'damage' && e.ability === 'Faultwake' && e.amount > 0),
      ).toBe(true);
      for (let i = 0; i < 119; i++) tickGroundAoEs(sim.ctx);
      expect(sim.ctx.groundAoEs).toHaveLength(1);
      const ticks = [...events, ...sim.drainEvents()].filter(
        (e) => e.type === 'spellfxAt' && e.fx === 'tick' && e.ability === 'earthquake',
      );
      expect(ticks).toHaveLength(4);
      tickGroundAoEs(sim.ctx);
      expect(sim.ctx.groundAoEs).toHaveLength(0);
    },
  );

  it('preserves the same damage sequence for aimed and fallback points and retains residue after caster death', () => {
    const aimed = produceQuake(true),
      fallback = produceQuake(false);
    for (let i = 0; i < 120; i++) {
      tickGroundAoEs(aimed.sim.ctx);
      tickGroundAoEs(fallback.sim.ctx);
    }
    const damage = (events: SimEvent[]) => events.filter((e) => e.type === 'damage');
    expect(damage([...aimed.events, ...aimed.sim.drainEvents()])).toEqual(
      damage([...fallback.events, ...fallback.sim.drainEvents()]),
    );
    const dead = produceQuake(true);
    dead.player.dead = true;
    for (let i = 0; i < 119; i++) tickGroundAoEs(dead.sim.ctx);
    expect(dead.sim.ctx.groundAoEs).toHaveLength(1);
    expect(dead.sim.drainEvents().filter((e) => e.type === 'damage')).toHaveLength(0);
    tickGroundAoEs(dead.sim.ctx);
    expect(dead.sim.ctx.groundAoEs).toHaveLength(0);
  });
});
