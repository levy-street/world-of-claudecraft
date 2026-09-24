import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { furyBeat } from '../src/render/ability_vfx/fury_choreography';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { HeldWarriorStorm } from '../src/render/ability_vfx/held_warrior_storm';
import { AbilityVfxRibbons, type RibbonAnchor } from '../src/render/ability_vfx/ribbons';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import {
  WarriorGuardPlates,
  warriorGuardKind,
} from '../src/render/ability_vfx/warrior_guard_plates';
import { drawWarriorPowerCast } from '../src/render/ability_vfx/warrior_power_cast';
import { WarriorPowerForms } from '../src/render/ability_vfx/warrior_power_forms';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';

function fixture(ready = true) {
  const scene = new THREE.Scene(),
    pool = new WarriorGuardPlates(scene);
  vi.spyOn(pool.preparation, 'ready').mockReturnValue(ready);
  const lines: THREE.Vector3[][] = [];
  const ribbons = {
    appendHeld: vi.fn((points: THREE.Vector3[], count: number) => {
      lines.push(points.slice(0, count).map((p) => p.clone()));
    }),
  } as unknown as AbilityVfxRibbons;
  const anchor: RibbonAnchor = (id, _f, out = new THREE.Vector3()) => out.set(id * 4, 1, 0);
  const draw = (frame: number, dt = 0.3, reduced = false) =>
    pool.draw(frame, dt, reduced, anchor, () => 0, undefined, ribbons);
  return { pool, scene, lines, ribbons, draw };
}
const resolve = (value: number, remaining = 10) => ({
  id: 'iron_resolve',
  kind: 'absorb',
  value,
  remaining,
  duration: 10,
});
const raised = {
  id: 'raised_guard_dr',
  kind: 'buff_dr_phys',
  remaining: 6,
  duration: 6,
  value: 0.5,
};
const sword = { id: 'die_by_sword', kind: 'die_by_sword', remaining: 8, duration: 8, value: 0.3 };

it.each([
  { id: 'raging_gale', avatar: false, ready: true, paths: 2, following: 2 },
  { id: 'raging_gale', avatar: true, ready: true, paths: 2, following: 2 },
  { id: 'raging_gale', avatar: false, ready: false, paths: 2, following: 1 },
  { id: 'raging_gale', avatar: true, ready: false, paths: 2, following: 1 },
  { id: 'red_harvest', avatar: false, ready: true, paths: 2, following: 2 },
  { id: 'red_harvest', avatar: true, ready: true, paths: 2, following: 2 },
  { id: 'red_harvest', avatar: false, ready: false, paths: 4, following: 2 },
  { id: 'red_harvest', avatar: true, ready: false, paths: 4, following: 2 },
] as const)(
  'retains every authored $id ribbon with eight cold storms and every guard and power fallback (Avatar=$avatar, crest ready=$ready)',
  ({ id, avatar, ready, paths, following }) => {
    function draw(crowded: boolean) {
      const h = fixture(false),
        texture = new THREE.Texture();
      const ribbons = new AbilityVfxRibbons(h.scene, () => null, {
        ribbon: texture,
        noise: texture,
      } as AbilityVfxTextures);
      const powers = new WarriorPowerForms(h.scene);
      const target = { x: 0, y: 0, z: 2, yaw: 0, present: true };
      const pathRibbon = vi.fn<SequencerHost['pathRibbon']>(
        (color, width, duration, fill, brushed, motion, preserve, priority, sweep, follow) =>
          ribbons.spawnPath(
            color,
            width,
            duration,
            fill,
            brushed,
            motion,
            preserve,
            follow,
            priority,
            sweep,
          ),
      );
      const host = new Proxy(
        {
          anchorOf: (entity: number, frac: number, out: { x: number; y: number; z: number }) => {
            if (entity !== 1 && !target.present) return null;
            return Object.assign(out, {
              x: entity === 1 ? 0 : target.x,
              y: frac * 2 + (entity === 1 ? 0 : target.y),
              z: entity === 1 ? 0 : target.z,
            });
          },
          facingAt: (entity: number) => (entity === 1 ? 0 : target.yaw),
          crestAt: vi.fn(() => ready),
          groundYAt: () => 0,
          pathRibbon,
        },
        {
          get(target, key) {
            if (!(key in target)) Reflect.set(target, key, vi.fn());
            return Reflect.get(target, key);
          },
        },
      ) as unknown as SequencerHost;
      const slot = {
        abilityId: id,
        spec: WARRIOR_VFX_FULL_SPECS[id],
        casterId: 1,
        targetId: 2,
        tier: 0,
        accent: 0xffc3c5,
        color: 0xb82235,
        physicalSecondary: false,
      } as SeqSlot;
      if (avatar)
        expect(drawWarriorPowerCast(host, { ...slot, abilityId: 'avatar', targetId: 1 }, 0)).toBe(
          true,
        );
      const avatarPaths = pathRibbon.mock.calls.length;
      expect(avatarPaths).toBe(avatar ? 2 : 0);
      expect(furyBeat(host, slot, id === 'red_harvest' ? 2 : 1)).toBe(true);
      const furyPaths = pathRibbon.mock.calls.slice(avatarPaths);
      expect(furyPaths).toHaveLength(paths);
      expect(furyPaths.filter((call) => call[9])).toHaveLength(following);
      expect(furyPaths.every((call) => call[7] === 1)).toBe(true);
      expect(
        pathRibbon.mock.results.every(
          (result) => result.type === 'return' && result.value === true,
        ),
      ).toBe(true);
      if (crowded)
        for (let entity = 1; entity <= 64; entity++) {
          h.pool.hold(entity, 0, raised, 0, entity === 1);
          h.pool.hold(entity, 1, resolve(160), 0, entity === 1);
          h.pool.hold(entity, 2, sword, 0, entity === 1);
          powers.hold(entity, 0, { duration: 20, remaining: 19 }, 0, 0, entity === 1);
          powers.hold(entity, 1, { duration: 12, remaining: 11 }, 1, 0, entity === 1);
        }
      const anchor: RibbonAnchor = (entity, _frac, out = new THREE.Vector3()) =>
        out.set(entity * 4, 1, 0);
      const storm = new HeldWarriorStorm();
      const geo = (ribbons as unknown as { geo: THREE.BufferGeometry }).geo;
      // Every cold wearer retains one Raised Guard outline, both Iron Resolve
      // shields and one Sword Guard outline: 64 * 4 * 5 points * 2 vertices.
      const prefix = 1056 + (crowded ? 2560 + 768 : 0) + (avatar ? 272 : 0);
      const capture = (dt: number) => {
        ribbons.update(dt, new THREE.Vector3(0, 5, 20), false, undefined, () => {
          for (let i = 0; i < 8; i++)
            storm.drawPrimary(ribbons, new THREE.Vector3(i * 5, 0, 20), 0.2, false);
          if (crowded) {
            h.pool.draw(0, dt, false, anchor, () => 0, undefined, ribbons);
            powers.draw(0, dt, false, anchor, () => 0, ribbons);
          }
        });
        const index = geo.getIndex();
        if (!index) throw new Error('Missing ribbon indices');
        const used = Math.max(...Array.from(index.array).slice(0, geo.drawRange.count)) + 1;
        return {
          vertices: used - prefix,
          positions: Array.from(geo.getAttribute('position').array).slice(prefix * 3, used * 3),
        };
      };
      const initial = capture(0.02);
      const beforeMovement = capture(0.005);
      Object.assign(target, { x: 3, y: 0.5, z: 4, yaw: 1.1 });
      // Freeze effect age to separate target following from travelling sweeps.
      const moved = capture(0);
      expect(initial.vertices).toBe(paths * 136);
      expect(moved.vertices).toBe(paths * 136);
      furyPaths.forEach((call, i) => {
        const before = beforeMovement.positions.slice(i * 136 * 3, (i + 1) * 136 * 3);
        const after = moved.positions.slice(i * 136 * 3, (i + 1) * 136 * 3);
        if (call[9]) expect(after).not.toEqual(before);
        else expect(after).toEqual(before);
      });
      target.present = false;
      const removed = capture(0.005);
      expect(removed.vertices).toBe((paths - following) * 136);
      // Fury's residue clears first; Avatar's .55s seams must still be present.
      const expired = capture(0.3);
      expect(expired.vertices).toBe(0);
      const result = { initial, moved, removed, expired };
      powers.dispose();
      h.pool.dispose();
      ribbons.dispose();
      texture.dispose();
      return result;
    }
    const ordinary = draw(false),
      crowded = draw(true);
    expect(crowded).toEqual(ordinary);
  },
);
