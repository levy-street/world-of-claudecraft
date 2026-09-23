import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { shamanDamage } from '../src/render/ability_vfx/shaman_events';
import { ShamanHeld, type ShamanHeldEntity } from '../src/render/ability_vfx/shaman_held';
import {
  runUnleashWeapon,
  STONEBOUND_UNLEASH_GUARD_ID,
} from '../src/sim/combat/shaman_unleash_weapon';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';

const guard = { id: STONEBOUND_UNLEASH_GUARD_ID, remaining: 4, value: 0.2 };
const wearer = (auras: ShamanHeldEntity['auras']): ShamanHeldEntity => ({ id: 7, auras, hp: 100 });

function fixture() {
  const held = new ShamanHeld();
  const paths: { points: number[][]; width: number; color: number }[] = [];
  const buffers: THREE.Vector3[][] = [];
  const overlay = { push: vi.fn() };
  const anchor = vi.fn((id: number, _fraction: number, out: THREE.Vector3) =>
    out.set(id * 10, 3, -8),
  );
  const draw = (frame = 1, quality = 1, time = 0, reduced = false, facing = 0) => {
    paths.length = 0;
    buffers.length = 0;
    overlay.push.mockClear();
    held.draw(
      frame,
      time,
      reduced,
      quality,
      { anchorOf: anchor, facingAt: () => facing },
      {
        appendHeld(points, count, width, color) {
          buffers.push(points);
          paths.push({ points: points.slice(0, count).map((p) => p.toArray()), width, color });
        },
      },
      overlay,
    );
    return paths;
  };
  return { held, paths, buffers, overlay, anchor, draw };
}

describe('Stonebound Unleash aura-owned caster brace', () => {
  it('draws the real guard even when the real Stonebound attack misses, without a receiving contact', () => {
    const sim = new Sim({ seed: 2905, playerClass: 'shaman', noPlayer: true });
    const id = sim.addPlayer('shaman', 'Guard wearer');
    sim.setPlayerLevel(20, id);
    sim.setSpec('enhancement', id);
    const player = sim.entities.get(id);
    if (!player) throw new Error('missing guard wearer');
    player.pos = sim.groundPos(720, 0);
    player.prevPos = { ...player.pos };
    sim.castAbility('rockbiter_weapon', id);
    const target = createMob(91040, MOBS.forest_wolf, 20, sim.groundPos(722, 0));
    target.hostile = true;
    sim.ctx.addEntity(target);
    sim.drainEvents();
    sim.rng.next = () => 0;
    runUnleashWeapon(sim.ctx, player, target);
    const miss = sim
      .drainEvents()
      .find((event) => event.type === 'damage' && event.kind === 'miss');
    expect(miss).toMatchObject({ sourceId: id, targetId: target.id, amount: 0 });
    expect(player.auras.find((aura) => aura.id === STONEBOUND_UNLEASH_GUARD_ID)).toMatchObject({
      remaining: 4,
      kind: 'buff_dr',
      value: 0.2,
    });
    const contact = vi.fn();
    const fx = { sequenceShamanContact: contact } as unknown as AbilityVfxFx;
    if (miss?.type !== 'damage') throw new Error('missing real missed attack');
    expect(
      shamanDamage(
        { fx, variant: () => 'unleash_weapon_earth', tier: () => 0, gesture: vi.fn() },
        miss,
      ),
    ).toBe(true);
    expect(contact).not.toHaveBeenCalled();
    const h = fixture();
    h.held.sync(1, player, id);
    h.held.sync(1, target, id);
    expect(h.draw()).toHaveLength(4);
    expect(h.anchor.mock.calls.every(([actor]) => actor === id)).toBe(true);
    expect(h.overlay.push).not.toHaveBeenCalled();
  });

  it.each([0, 1])(
    'preserves two open protective flanks at quality %s using existing scratch',
    (quality) => {
      const h = fixture();
      h.held.sync(1, wearer([guard]));
      h.draw(1, quality);
      expect(h.paths).toHaveLength(quality ? 4 : 2);
      const slate = h.paths.filter((path) => path.width > 0.1);
      expect(slate).toHaveLength(2);
      for (const path of slate) {
        expect(
          path.points.every(([x, y]) => Math.abs(x - 70) - path.width / 2 > 0.5 && y < 4.8),
        ).toBe(true);
        expect(path.points[0]).not.toEqual(path.points[path.points.length - 1]);
      }
      expect(slate[0].points.every(([x]) => x < 70)).not.toBe(
        slate[1].points.every(([x]) => x < 70),
      );
      const scratch = h.buffers[0];
      h.draw(1, quality, 100, true);
      expect(h.buffers.every((points) => points === scratch)).toBe(true);
      expect(h.overlay.push).not.toHaveBeenCalled();
    },
  );

  it('follows live remaining time rather than elapsed presentation time, then drops on expiry or dispel', () => {
    const h = fixture();
    h.held.sync(1, wearer([{ ...guard, remaining: 0.01 }]));
    expect(h.draw(1, 1, 1000)).toHaveLength(4);
    h.held.sync(2, wearer([{ ...guard, remaining: 0 }]));
    expect(h.draw(2)).toHaveLength(0);
    h.held.sync(3, wearer([guard]));
    expect(h.draw(3)).toHaveLength(4);
    h.held.sync(4, wearer([]));
    expect(h.draw(4)).toHaveLength(0);
  });

  it('is static under reduced motion and rotates with the real wearer', () => {
    const h = fixture();
    h.held.sync(1, wearer([guard]));
    const initial = structuredClone(h.draw(1, 1, 0, true));
    expect(h.draw(1, 1, 100, true)).toEqual(initial);
    h.draw(1, 1, 100, true, Math.PI / 2);
    for (let p = 0; p < initial.length; p++)
      for (let i = 0; i < initial[p].points.length; i++) {
        const a = initial[p].points[i],
          b = h.paths[p].points[i];
        expect(b[0] - 70).toBeCloseTo(a[2] + 8);
        expect(b[2] + 8).toBeCloseTo(-(a[0] - 70));
        expect(b[1]).toBe(a[1]);
      }
  });

  it('clears on missing snapshots, death, sleep, reset and disposal without retaining a stale guard', () => {
    const h = fixture();
    h.held.sync(1, wearer([guard]));
    expect(h.draw(2)).toHaveLength(0);
    h.held.sync(3, { ...wearer([guard]), hp: 0 });
    expect(h.draw(3)).toHaveLength(0);
    for (const remove of [() => h.held.sleep(7), () => h.held.clear(), () => h.held.dispose()]) {
      h.held.sync(4, wearer([guard]));
      expect(h.draw(4)).toHaveLength(4);
      remove();
      expect(h.draw(4)).toHaveLength(0);
    }
    h.held.sync(5, wearer([guard]));
    expect(h.draw(5)).toHaveLength(0);
  });
});
