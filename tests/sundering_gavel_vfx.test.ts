import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { setPaladinVfxDetailForTest } from '../src/render/ability_vfx/paladin_vfx_detail';
import type { PaladinVfxDetail } from '../src/render/ability_vfx/paladin_vfx_detail_core';
import {
  GAVEL_CONTACT,
  GAVEL_CONTACT_MIN,
  GAVEL_COUNT,
  GAVEL_LIFE,
  GAVEL_RELEASE,
  gavelContactTime,
  gavelPhase,
  gavelSwing,
  SunderingGavel,
} from '../src/render/ability_vfx/sundering_gavel';
import { AbilityVfxBudget } from '../src/render/ability_vfx_core';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';

type TestSim = Sim & { nextId: number; addEntity(entity: Entity): void };

function fixture(height = 1.8, distance = 6) {
  const scene = new THREE.Scene();
  // The Paladin (1) at the origin, the target (2) 6 yards away.
  const where = new Map<number, [number, number]>([
    [1, [0, 0]],
    [2, [0, distance]],
  ]);
  const anchor = vi.fn((id: number, fraction: number, out?: THREE.Vector3) => {
    const at = where.get(id);
    return at && out ? out.set(at[0], fraction * (id === 2 ? height : 1.8), at[1]) : null;
  });
  const impact = vi.fn();
  const effect = new SunderingGavel(scene, anchor, () => 0, undefined, impact);
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const gl = {
    properties: { get: () => ({ programs: new Map([['canvas', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
  const quads = () => {
    const g = effect.mesh.geometry;
    const shape = g.getAttribute('aShape');
    const out: number[] = [];
    for (let i = 0; i < g.drawRange.count; i += 6) out.push(shape.getX(i));
    return out;
  };
  // The shown gavels' head positions and handle directions.
  const gavels = () =>
    effect.gavels
      .filter((g) => g.visible)
      .map((g) => {
        const head = new THREE.Vector3().setFromMatrixPosition(g.matrix);
        const handle = new THREE.Vector3().setFromMatrixColumn(g.matrix, 0);
        const size = handle.length();
        return { head, handle: handle.normalize(), size };
      });
  return {
    effect,
    scene,
    impact,
    quads,
    gavels,
    prepare: async () => {
      for (const u of effect.preparation.units(gl)) await u.run();
    },
  };
}

function step(effect: SunderingGavel, seconds: number): void {
  for (let t = 0; t < seconds - 1e-6; t += 0.05) effect.update(0.05);
}

// Node runs at the Medium preset: pin the authored composition.
beforeEach(() => setPaladinVfxDetailForTest('full'));
afterEach(() => setPaladinVfxDetailForTest(null));

describe('Sundering Gavel', () => {
  it('rears the gavels back, then swings them down to land at contact', () => {
    expect(gavelSwing(0)).toBeLessThan(-1.8);
    expect(gavelSwing(0.13)).toBeLessThan(gavelSwing(0));
    expect(gavelSwing(GAVEL_CONTACT)).toBeCloseTo(0, 5);
    // They recoil a little and settle back.
    expect(gavelSwing(0.3)).toBeLessThan(0);
    expect(gavelSwing(0.9)).toBeCloseTo(0, 5);
  });

  it('raises four solid gavels overhead that chop down together, the blow landing once', async () => {
    const f = fixture();
    expect(f.effect.strike(1, 2)).toBe(false);
    await f.prepare();
    expect(f.effect.strike(1, 99)).toBe(false);
    expect(f.effect.strike(1, 2)).toBe(true);
    f.effect.update(0.05);
    // Four gavels raised overhead: every handle points down from its head
    // towards its grip, the heads up high round the target.
    const raised = f.gavels();
    expect(raised).toHaveLength(GAVEL_COUNT);
    for (const g of raised) {
      expect(g.handle.y).toBeLessThan(-0.5);
      expect(g.head.y).toBeGreaterThan(1.8 + 0.5);
    }
    // The sounding block beneath.
    expect(f.quads()).toContain(1);
    expect(f.impact).not.toHaveBeenCalled();
    // The stun's projectile takes five ticks to cross 6 yards.
    step(f.effect, gavelContactTime(6) - 0.1);
    expect(f.impact).not.toHaveBeenCalled();
    step(f.effect, 0.05);
    expect(f.impact).toHaveBeenCalledOnce();
    const [x, , z] = f.impact.mock.calls[0];
    expect([x, z]).toEqual([0, 6]);
    step(f.effect, 0.3);
    expect(f.impact).toHaveBeenCalledOnce();
    step(f.effect, GAVEL_LIFE);
    expect(f.effect.mesh.visible).toBe(false);
    expect(f.effect.gavels.some((g) => g.visible)).toBe(false);
    f.effect.dispose();
    expect(f.scene.children).toHaveLength(0);
  });

  it('lands as one hammer: the four heads on one spot just above the head, handles level in a cross, the same size over a giant', async () => {
    const sizes: number[] = [];
    for (const height of [1.8, 7.2]) {
      const f = fixture(height);
      await f.prepare();
      f.effect.strike(1, 2);
      // Once they have landed, hopped and settled.
      step(f.effect, gavelContactTime(6) + 0.3);
      const gavels = f.gavels();
      expect(gavels).toHaveLength(GAVEL_COUNT);
      const [first] = gavels;
      for (const g of gavels) {
        // One shared head.
        expect(g.head.distanceTo(first.head)).toBeLessThan(1e-4);
        // Level handles.
        expect(Math.abs(g.handle.y)).toBeLessThan(1e-3);
      }
      expect(first.head.x).toBeCloseTo(0, 5);
      expect(first.head.z).toBeCloseTo(6, 5);
      // The long head standing on the target's head, its striking face on top of it.
      expect(first.head.y).toBeGreaterThan(height + 0.3 * first.size);
      expect(first.head.y).toBeLessThan(height + 0.6 * first.size);
      // The handles point four ways, each a quarter turn from the next.
      const dirs = gavels.map((g) => Math.atan2(g.handle.z, g.handle.x));
      for (let k = 1; k < dirs.length; k++) {
        const turn = (((dirs[k] - dirs[0]) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        expect(turn).toBeCloseTo((k * Math.PI) / 2, 3);
      }
      sizes.push(first.size);
      f.effect.dispose();
    }
    // The giant's gavels are capped at a readable size.
    expect(sizes[0]).toBeCloseTo(1.05, 5);
    expect(sizes[1]).toBeCloseTo(1.05 * 1.25, 5);
  });

  it('shackles the stunned target with rune rings and glints, breaking them when it lifts', async () => {
    const f = fixture();
    await f.prepare();
    for (let t = 0; t < 1; t += 0.05) {
      f.effect.hold(2);
      f.effect.update(0.05);
    }
    const held = f.quads();
    expect(held.filter((q) => q === 2)).toHaveLength(2);
    expect(held.filter((q) => q === 3).length).toBeGreaterThan(0);
    // The stun lifts: the rings snap outward and are gone.
    f.effect.update(0.05);
    expect(f.effect.mesh.visible).toBe(true);
    step(f.effect, GAVEL_RELEASE + 0.05);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
  });

  it('lands as the stun does: timed by distance to the tick the projectile arrives', async () => {
    // The sim steps the stun 1.3 yards a tick from the tick after the cast.
    expect(gavelContactTime(10)).toBeCloseTo(0.4, 5);
    expect(gavelContactTime(6)).toBeCloseTo(0.25, 5);
    expect(gavelContactTime(2.6)).toBeCloseTo(GAVEL_CONTACT_MIN, 5);
    expect(gavelContactTime(0)).toBe(GAVEL_CONTACT_MIN);
    expect(gavelContactTime(Number.NaN)).toBe(GAVEL_CONTACT_MIN);
    for (const contact of [GAVEL_CONTACT_MIN, 0.25, 0.4]) {
      // The swing's clock is continuous and reaches its contact pose exactly then.
      expect(gavelPhase(contact, contact)).toBeCloseTo(GAVEL_CONTACT, 9);
      let last = -1;
      for (let age = 0; age < 1; age += 0.01) {
        const phase = gavelPhase(age, contact);
        expect(phase).toBeGreaterThanOrEqual(last);
        last = phase;
      }
    }
    // A far target: still raised overhead at the old fixed contact, landing at 0.4 s.
    const f = fixture(1.8, 10);
    await f.prepare();
    f.effect.strike(1, 2);
    step(f.effect, 0.35);
    expect(f.impact).not.toHaveBeenCalled();
    expect(f.gavels()[0].handle.y).toBeLessThan(-0.5);
    f.effect.update(0.0501);
    expect(f.impact).toHaveBeenCalledOnce();
    f.effect.dispose();
  });

  it('matches the sim: the stun lands on the tick the gavels do', () => {
    for (const distance of [2, 6, 10]) {
      const sim = new Sim({ seed: 7176, playerClass: 'paladin', autoEquip: true }) as TestSim;
      sim.setPlayerLevel(20);
      sim.player.resource = sim.player.maxResource;
      // Clear the ambient wildlife; a lone wolf stands still `distance` yards ahead.
      for (const [id, entity] of [...sim.entities]) {
        if (entity.kind === 'player') continue;
        sim.grid.remove(entity);
        sim.entities.delete(id);
      }
      const p = sim.player;
      const mob = createMob(sim.nextId++, MOBS.forest_wolf, 1, {
        x: p.pos.x,
        y: p.pos.y,
        z: p.pos.z + distance,
      });
      mob.maxHp = mob.hp = 50_000;
      mob.hostile = true;
      mob.aiState = 'idle';
      mob.auras.push({
        id: 'test_root',
        name: 'Test Root',
        kind: 'root',
        remaining: 60,
        duration: 60,
        value: 0,
        sourceId: -1,
        school: 'physical',
      });
      sim.addEntity(mob);
      sim.targetEntity(mob.id);
      sim.castAbility('hammer_of_justice');
      const stunned = () => mob.auras.some((a) => a.kind === 'stun');
      expect(stunned()).toBe(false);
      let ticks = 0;
      while (!stunned() && ticks < 40) {
        sim.tick();
        ticks++;
      }
      expect(stunned()).toBe(true);
      expect(Math.max(GAVEL_CONTACT_MIN, ticks * DT)).toBeCloseTo(gavelContactTime(distance), 5);
    }
  });

  it('claims the cast so only its own art plays, striking even on an immune target', () => {
    const fx = { sunderingGavel: vi.fn() };
    const releaseGesture = vi.fn();
    const p = Object.assign(Object.create(AbilityVfx.prototype), {
      // The painter reads the cast budget for every Paladin cue.
      budget: new AbilityVfxBudget(),
      castChargeAt: new Map(),
      now: () => 0,
      deps: { fx },
      releaseGesture,
    }) as AbilityVfx;
    const ev = { sourceId: 1, targetId: 2, school: 'holy', ability: 'hammer_of_justice' };
    expect(p.handleSpellfx({ ...ev, fx: 'projectile' })).toBe(true);
    expect(p.handleSpellfx({ ...ev, fx: 'ccImpact' })).toBe(true);
    expect(releaseGesture).toHaveBeenCalledExactlyOnceWith(1, 'hammer_of_justice');
    expect(fx.sunderingGavel).toHaveBeenCalledExactlyOnceWith(1, 2);
  });
});

describe('Sundering Gavel detail', () => {
  const count = (quads: number[], shape: number) => quads.filter((q) => q === shape).length;

  /** One strike cast at `detail`: what draws as the gavels appear, as they
   * land, while they dissolve, and how long it lasts. */
  const strike = async (detail: PaladinVfxDetail) => {
    const f = fixture();
    await f.prepare();
    setPaladinVfxDetailForTest(detail);
    f.effect.strike(1, 2);
    // A running strike keeps the detail it was cast at.
    setPaladinVfxDetailForTest('full');
    f.effect.update(0.05);
    const appearing = f.quads();
    // The swing's clock reaches contact at gavelContactTime(6).
    const contact = gavelContactTime(6);
    step(f.effect, contact - 0.05);
    f.effect.update(0.0001);
    const landed = f.quads();
    const landedGavels = f.gavels().length;
    // 0.1 s into the dissolve.
    step(f.effect, 0.4);
    const dissolving = f.quads();
    const dissolvingGavels = f.gavels().length;
    let life = contact + 0.4;
    while (f.effect.mesh.visible && life < 3) {
      f.effect.update(0.01);
      life += 0.01;
    }
    const impactDetail = f.impact.mock.calls[0]?.[3];
    f.effect.dispose();
    return { appearing, landed, landedGavels, dissolving, dissolvingGavels, life, impactDetail };
  };

  /** The shackles held at `detail`, and how long their break plays. */
  const shackles = async (detail: PaladinVfxDetail) => {
    const f = fixture();
    await f.prepare();
    setPaladinVfxDetailForTest(detail);
    for (let t = 0; t < 0.5; t += 0.05) {
      f.effect.hold(2);
      f.effect.update(0.05);
    }
    const held = f.quads();
    let release = 0;
    while (f.effect.mesh.visible && release < 1) {
      f.effect.update(0.01);
      release += 0.01;
    }
    f.effect.dispose();
    return { held, release };
  };

  it('draws the same cross-hammer lighter: the gavels, block and landing flash stay, extras go', async () => {
    const full = await strike('full');
    const light = await strike('light');
    const minimal = await strike('minimal');
    // Core on every tier: the four gavels, the sounding block, the flash on the joined head.
    for (const d of [full, light, minimal]) {
      expect(d.landedGavels).toBe(GAVEL_COUNT);
      expect(d.dissolvingGavels).toBe(GAVEL_COUNT);
      expect(count(d.appearing, 1)).toBe(1);
      expect(count(d.landed, 1)).toBe(1);
      expect(count(d.landed, 0)).toBeGreaterThanOrEqual(1);
      expect(count(d.dissolving, 4)).toBeGreaterThan(0);
    }
    // Accents: each gavel's appearing flash, only at full.
    expect(count(full.appearing, 0)).toBe(GAVEL_COUNT);
    expect(count(light.appearing, 0)).toBe(0);
    expect(count(minimal.appearing, 0)).toBe(0);
    // The landing: the joined head's flash (core), the blow's flare on the
    // head (secondary, kept at light) and its spun gold flare (accent).
    expect(count(full.landed, 0)).toBe(3);
    expect(count(light.landed, 0)).toBe(2);
    expect(count(minimal.landed, 0)).toBe(1);
    // The dissolve's motes thin with the mote count.
    expect(count(light.dissolving, 4)).toBeLessThan(count(full.dissolving, 4));
    expect(count(minimal.dissolving, 4)).toBeLessThan(count(light.dissolving, 4));
    expect(light.landed.length).toBeLessThan(full.landed.length);
    expect(minimal.landed.length).toBeLessThan(light.landed.length);
    // The fade tail shortens; the strike still lands and tells the floor its detail.
    expect(light.life).toBeLessThan(full.life);
    expect(minimal.life).toBeLessThan(light.life);
    expect([full.impactDetail, light.impactDetail, minimal.impactDetail]).toEqual([
      'full',
      'light',
      'minimal',
    ]);
  });

  it('keeps both shackles on every tier, the glints only at full, and breaks them sooner when lighter', async () => {
    const full = await shackles('full');
    const light = await shackles('light');
    const minimal = await shackles('minimal');
    for (const d of [full, light, minimal]) expect(count(d.held, 2)).toBe(2);
    expect(count(full.held, 3)).toBeGreaterThan(0);
    expect(count(light.held, 3)).toBe(0);
    expect(count(minimal.held, 3)).toBe(0);
    expect(full.release).toBeCloseTo(GAVEL_RELEASE, 1);
    expect(light.release).toBeLessThan(full.release);
    expect(minimal.release).toBeLessThan(light.release);
  });
});
