import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { furyBeat } from '../src/render/ability_vfx/fury_choreography';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { HeldWarriorStorm } from '../src/render/ability_vfx/held_warrior_storm';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import { AbilityVfxRibbons, type RibbonAnchor } from '../src/render/ability_vfx/ribbons';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import {
  WarriorGuardPlates,
  warriorGuardKind,
} from '../src/render/ability_vfx/warrior_guard_plates';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';
import { weaponTrailAnchor } from '../src/render/weapon_trail_anchor';

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

it('composes simultaneous protections within one wearer allowance and uploads only the live prefix', () => {
  const h = fixture();
  h.pool.hold(1, 0, raised, 0, true);
  h.pool.hold(1, 1, resolve(160), 0, true);
  h.pool.hold(1, 2, sword, 0, true);
  h.draw(0);
  expect(h.pool.mesh.count).toBe(6);
  expect(h.pool.mesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 96 }]);
  expect(h.pool.mesh.instanceColor!.updateRanges).toEqual([{ start: 0, count: 18 }]);
  expect(h.pool.mesh.material.transparent).toBe(false);
  expect(h.pool.mesh.material.depthTest).toBe(true);
  expect(h.pool.mesh.material.depthWrite).toBe(true);
  h.draw(1);
  expect(h.pool.mesh.count).toBe(0);
  expect(h.pool.mesh.visible).toBe(false);
  h.pool.dispose();
});

it('shows actual reserve chunks and removes them on actual exhaustion', () => {
  const h = fixture();
  h.pool.hold(1, 1, resolve(160), 0, true);
  h.draw(0);
  expect(h.pool.mesh.count).toBe(6);
  h.pool.hold(1, 1, resolve(40, 9.95), 1, true);
  h.draw(1);
  expect(h.pool.mesh.count).toBe(2);
  h.pool.hold(1, 1, resolve(0, 9.9), 2, true);
  h.draw(2);
  expect(h.pool.mesh.count).toBe(0);
  h.pool.dispose();
});

it('shows the same absolute reserve for late or immediate observation and keeps the primary at tiny values', () => {
  const h = fixture();
  h.pool.hold(1, 1, resolve(40, 5), 0, false);
  h.draw(0);
  expect(h.pool.mesh.count).toBe(2);
  h.pool.hold(1, 1, resolve(1, 4.95), 1, false);
  h.draw(1);
  expect(h.pool.mesh.count).toBe(1);
  h.pool.sleep(1);
  h.pool.hold(1, 1, resolve(160), 2, false);
  h.draw(2);
  h.pool.hold(1, 1, resolve(1, 9.95), 3, false);
  h.draw(3);
  expect(h.pool.mesh.count).toBe(1);
  h.pool.dispose();
});

it('keeps the local player in the solid pool and outlines the seventeenth defender', () => {
  const h = fixture();
  for (let id = 1; id <= 17; id++) h.pool.hold(id, 1, resolve(160), 0, id === 17);
  h.draw(0);
  expect(h.pool.mesh.count).toBe(96);
  const matrix = new THREE.Matrix4();
  h.pool.mesh.getMatrixAt(0, matrix);
  expect(matrix.elements[12]).toBeGreaterThan(67);
  expect(
    h.lines.some((points) => points.length === 5 && points[0].x > 63 && points[0].x < 65),
  ).toBe(true);
  h.pool.dispose();
});

it('keeps every distinct primary outline while GPU preparation is cold', () => {
  const h = fixture(false);
  h.pool.hold(1, 0, raised, 0, true);
  h.pool.hold(2, 1, resolve(160), 0, false);
  h.pool.hold(3, 2, sword, 0, false);
  h.draw(0);
  expect(h.pool.mesh.count).toBe(0);
  expect(h.pool.mesh.visible).toBe(false);
  expect(h.lines).toHaveLength(3);
  expect(h.lines.every((line) => line.length === 5)).toBe(true);
  h.pool.clear();
  h.lines.length = 0;
  h.draw(1);
  expect(h.lines).toHaveLength(0);
  h.pool.dispose();
});

it('uses actual equipped face orientation with unit axes under nonuniform scale, and rejects hidden or detached equipment', () => {
  const root = new THREE.Group(),
    holder = new THREE.Group();
  holder.userData.heldPropHolder = true;
  holder.userData.heldSlot = 1;
  const shield = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.3));
  shield.userData.weaponMesh = true;
  holder.add(shield);
  root.add(holder);
  holder.scale.set(0.3, 0.7, 0.4);
  holder.rotation.set(0.3, 0.4, 0.2);
  root.position.set(3, 1, 2);
  const sample = weaponTrailAnchor(root, 1)!;
  const frame = new THREE.Matrix4();
  expect(sample.frame!(frame)).toBe(true);
  const x = new THREE.Vector3(),
    y = new THREE.Vector3(),
    z = new THREE.Vector3();
  frame.extractBasis(x, y, z);
  expect(x.length()).toBeCloseTo(1);
  expect(y.length()).toBeCloseTo(1);
  expect(z.length()).toBeCloseTo(1);
  expect(x.dot(y)).toBeCloseTo(0);
  expect(y.dot(z)).toBeCloseTo(0);
  const actual = new THREE.Vector3(0, 0, 0.15)
    .applyMatrix4(shield.matrixWorld)
    .addScaledVector(z, 0.045);
  expect(new THREE.Vector3().setFromMatrixPosition(frame).distanceTo(actual)).toBeLessThan(1e-7);
  const previous = frame.clone();
  holder.rotation.y += 0.5;
  expect(sample.frame!(frame)).toBe(true);
  expect(frame.equals(previous)).toBe(false);
  holder.visible = false;
  expect(sample.frame!(frame)).toBe(false);
  holder.visible = true;
  root.remove(holder);
  expect(sample.frame!(frame)).toBe(false);
  shield.geometry.dispose();
  (shield.material as THREE.Material).dispose();
});

it('feeds exact live auras and excludes dead, expired and unrelated defenses from the held guard renderer', () => {
  const fx = new Proxy(
    {},
    {
      get(target, key) {
        if (!(key in target)) Reflect.set(target, key, vi.fn());
        return Reflect.get(target, key);
      },
    },
  ) as AbilityVfxDeps['fx'];
  const painter = new AbilityVfx(
    { fx, vfx: {}, localPlayerId: () => 1 } as AbilityVfxDeps,
    () => 0,
  );
  const e = {
    id: 1,
    castingAbility: null,
    castRemaining: 0,
    castTotal: 0,
    auras: [raised, resolve(160), sword],
  };
  painter.syncEntity(e);
  expect(fx.holdWarriorGuard).toHaveBeenCalledTimes(3);
  expect(fx.holdShell).not.toHaveBeenCalled();
  expect(fx.orbit).not.toHaveBeenCalled();
  vi.mocked(fx.holdWarriorGuard).mockClear();
  painter.syncEntity({ ...e, dead: true });
  expect(fx.holdWarriorGuard).not.toHaveBeenCalled();
  expect(warriorGuardKind({ id: 'iron_resolve', kind: 'dot' })).toBe(null);
  expect(warriorGuardKind({ id: 'power_word_shield', kind: 'absorb' })).toBe(null);
  const h = fixture();
  h.pool.hold(1, 0, { ...raised, remaining: 0 }, 0, true);
  h.draw(0);
  expect(h.pool.mesh.count).toBe(0);
  h.pool.dispose();
});

it('leaves real ribbon room for a complete storm and attack even with 64 cold triple-protected wearers', () => {
  const h = fixture(false),
    texture = new THREE.Texture();
  const ribbons = new AbilityVfxRibbons(h.scene, () => null, {
    ribbon: texture,
    noise: texture,
  } as AbilityVfxTextures);
  for (let id = 1; id <= 64; id++) {
    h.pool.hold(id, 0, raised, 0, id === 1);
    h.pool.hold(id, 1, resolve(160), 0, id === 1);
    h.pool.hold(id, 2, sword, 0, id === 1);
  }
  ribbons.spawnPath(
    0xffffff,
    0.2,
    0.3,
    (points) => {
      for (let i = 0; i < points.length; i++)
        points[i].set(-8 + (i * 16) / (points.length - 1), 2, -20);
      return points.length;
    },
    true,
    null,
    false,
    false,
    1,
  );
  const storm = new HeldWarriorStorm();
  const anchor: RibbonAnchor = (id, _f, out = new THREE.Vector3()) => out.set(id * 4, 1, 0);
  ribbons.update(0.05, new THREE.Vector3(0, 5, 20), false, undefined, () => {
    storm.drawPrimary(ribbons, new THREE.Vector3(0, 0, 20), 0.2, false);
    h.pool.draw(0, 0.05, false, anchor, () => 0, undefined, ribbons);
  });
  const geo = (ribbons as unknown as { geo: THREE.BufferGeometry }).geo;
  const used = Math.max(...Array.from(geo.getIndex()!.array).slice(0, geo.drawRange.count)) + 1;
  expect(used).toBe(3 * 22 * 2 + 64 * 3 * 5 * 2 + 136);
  const position = geo.getAttribute('position');
  const attackX: number[] = [];
  for (let i = 0; i < used; i++)
    if (Math.abs(position.getZ(i) + 20) < 0.3) attackX.push(position.getX(i));
  expect(Math.min(...attackX)).toBeCloseTo(-8);
  expect(Math.max(...attackX)).toBeCloseTo(8);
  h.pool.dispose();
  ribbons.dispose();
  texture.dispose();
});

it('retains valid equipment samplers and reacquires only a missing needed hand after a swap', () => {
  const h = fixture();
  let valid = true;
  const sampler = Object.assign(() => true, {
    frame: (out: THREE.Matrix4) => {
      if (!valid) return false;
      out.identity().setPosition(4, 1, 0);
      return true;
    },
  });
  const equipment = vi.fn((_id: number, _hand: 0 | 1) => sampler);
  const anchor: RibbonAnchor = (_id, _f, out = new THREE.Vector3()) => out.set(4, 1, 0);
  for (let frame = 0; frame < 30; frame++) {
    h.pool.hold(1, 0, raised, frame, true);
    h.pool.hold(2, 1, resolve(160), frame, false);
    h.pool.draw(frame, 0.05, false, anchor, () => 0, equipment, h.ribbons);
  }
  expect(equipment.mock.calls).toEqual([[1, 1]]);
  valid = false;
  for (let frame = 30; frame < 45; frame++) {
    h.pool.hold(1, 0, raised, frame, true);
    h.pool.draw(frame, 0.05, false, anchor, () => 0, equipment, h.ribbons);
  }
  expect(equipment.mock.calls.length).toBeGreaterThan(1);
  expect(equipment.mock.calls.length).toBeLessThan(4);
  expect(equipment.mock.calls.every((call) => call[0] === 1 && call[1] === 1)).toBe(true);
  h.pool.dispose();
});

it('cleans every owned resource after a disposal error without touching shared maps', () => {
  const h = fixture(),
    texture = new THREE.Texture();
  h.pool.mesh.material.map = texture;
  vi.spyOn(h.pool.preparation, 'dispose').mockImplementation(() => {
    throw Error('detach failure');
  });
  const geometry = vi.spyOn(h.pool.mesh.geometry, 'dispose');
  const material = vi.spyOn(h.pool.mesh.material, 'dispose');
  const instances = vi.spyOn(h.pool.mesh, 'dispose');
  const shared = vi.spyOn(texture, 'dispose');
  expect(() => h.pool.dispose()).toThrow(AggregateError);
  expect(geometry).toHaveBeenCalledOnce();
  expect(material).toHaveBeenCalledOnce();
  expect(instances).toHaveBeenCalledOnce();
  expect(shared).not.toHaveBeenCalled();
  expect(() => h.pool.dispose()).not.toThrow();
  texture.dispose();
});

it.each(['raging_gale', 'red_harvest'])(
  'retains every authored %s ribbon under the worst guard load',
  (id) => {
    function draw(crowded: boolean) {
      const h = fixture(false),
        texture = new THREE.Texture();
      const ribbons = new AbilityVfxRibbons(h.scene, () => null, {
        ribbon: texture,
        noise: texture,
      } as AbilityVfxTextures);
      const host = new Proxy(
        {
          anchorOf: (entity: number, frac: number, out: { x: number; y: number; z: number }) =>
            Object.assign(out, { x: 0, y: frac * 2, z: entity === 1 ? 0 : 2 }),
          facingAt: () => 0,
          groundYAt: () => 0,
          pathRibbon: (
            color: number,
            width: number,
            duration: number,
            fill: (points: THREE.Vector3[]) => number,
            brushed: boolean,
            motion: null,
            preserve: boolean,
            priority: 0 | 1,
          ) =>
            ribbons.spawnPath(
              color,
              width,
              duration,
              fill,
              brushed,
              motion,
              preserve,
              false,
              priority,
            ),
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
      expect(furyBeat(host, slot, id === 'red_harvest' ? 2 : 1)).toBe(true);
      if (crowded)
        for (let entity = 1; entity <= 64; entity++) {
          h.pool.hold(entity, 0, raised, 0, entity === 1);
          h.pool.hold(entity, 1, resolve(160), 0, entity === 1);
          h.pool.hold(entity, 2, sword, 0, entity === 1);
        }
      const anchor: RibbonAnchor = (entity, _frac, out = new THREE.Vector3()) =>
        out.set(entity * 4, 1, 0);
      const storm = new HeldWarriorStorm();
      ribbons.update(0.05, new THREE.Vector3(0, 5, 20), false, undefined, () => {
        storm.drawPrimary(ribbons, new THREE.Vector3(0, 0, 20), 0.2, false);
        if (crowded) h.pool.draw(0, 0.05, false, anchor, () => 0, undefined, ribbons);
      });
      const geo = (ribbons as unknown as { geo: THREE.BufferGeometry }).geo;
      const used = Math.max(...Array.from(geo.getIndex()!.array).slice(0, geo.drawRange.count)) + 1;
      const prefix = 132 + (crowded ? 1920 : 0);
      const result = {
        vertices: used - prefix,
        positions: Array.from(geo.getAttribute('position').array).slice(prefix * 3, used * 3),
      };
      h.pool.dispose();
      ribbons.dispose();
      texture.dispose();
      return result;
    }
    const ordinary = draw(false),
      crowded = draw(true);
    expect(ordinary.vertices).toBe(id === 'red_harvest' ? 816 : 408);
    expect(crowded).toEqual(ordinary);
  },
);
