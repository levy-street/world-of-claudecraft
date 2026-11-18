// The Wheel of the Hearth on screen (the polish pass of 2026-11-18): the pure
// plan src/render/smith_heart_fx/heat_wheel_fx_core.ts (a doomed slice's
// warning builds and quickens, its eruption leaps and dies, its scorch cools
// to nothing; the vents spread over a slice by its share and keep clear of its
// edges) and its painter heat_wheel_fx.ts inside HeatFightFx over a fake world
// (each slice's floor on Wakefire's commuting rungs, its vents in the air, an
// erupted slice cooling after the sim drops it, a safe slice gone at once, the
// Wheel's whole-floor ignite cue never drawn as a ring over the safe slice).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer';
import { HeatFightFx } from '../src/render/smith_heart_fx';
import { wheelArc } from '../src/render/smith_heart_fx/heat_fight_fx_core';
import { HEAT_FLOOR } from '../src/render/smith_heart_fx/heat_floor_ladder_core';
import { WALL_AIR_ORDER } from '../src/render/smith_heart_fx/heat_lava_wall_fx';
import {
  WHEEL_FX,
  type WheelLook,
  wheelEruptLook,
  wheelEruptSpan,
  wheelFireLook,
  wheelVentAt,
  wheelVentCount,
  wheelVents,
  wheelWarnLook,
} from '../src/render/smith_heart_fx/heat_wheel_fx_core';
import { HEARTH_WELL } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  HEAT_CUES,
  HEAT_DIFFICULTY,
  HEAT_TUNING as T,
  WHEEL_ARCS_DEG,
  wheelTemplate,
} from '../src/sim/encounters/smith_heart/heat_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const look = (): WheelLook => ({ build: 0, throb: 0, erupt: -1, burn: 0, scorch: 0 });

describe('heat_wheel_fx_core: a slice warns, erupts and cools', () => {
  it('builds the warning on the sim clock, quickening only in its last stretch', () => {
    const warn = HEAT_DIFFICULTY.normal.wheel.warn;
    let last = -1;
    for (let t = 0; t <= warn; t += 0.25) {
      const l = wheelWarnLook(t, warn, look());
      expect(l.build).toBeGreaterThanOrEqual(last);
      expect(l.erupt).toBe(-1);
      expect(l.burn).toBe(0);
      last = l.build;
    }
    expect(wheelWarnLook(warn, warn, look()).build).toBe(1);
    // No throb in the first stretch; some throb near the end.
    for (let t = 0; t < warn * 0.4; t += 0.05) expect(wheelWarnLook(t, warn, look()).throb).toBe(0);
    let peak = 0;
    for (let t = warn * 0.85; t <= warn; t += 0.02)
      peak = Math.max(peak, wheelWarnLook(t, warn, look()).throb);
    expect(peak).toBeGreaterThan(0.5);
  });

  it('leaps at the eruption, dies with the sim burn, and its scorch cools to nothing', () => {
    const burn = T.wheelBurn;
    expect(wheelEruptLook(0, burn, look()).burn).toBe(0);
    const leap = wheelEruptLook(0.1, burn, look());
    expect(leap.burn).toBeGreaterThan(0.8);
    expect(leap.erupt).toBeCloseTo(0.1, 5);
    // Still burning through the sim's burn, out soon after.
    expect(wheelEruptLook(burn * 0.5, burn, look()).burn).toBeGreaterThan(0.3);
    expect(wheelEruptLook(burn + 0.5, burn, look()).burn).toBe(0);
    // The scorch spreads under the fire, then cools over WHEEL_FX.fade.
    expect(wheelEruptLook(burn, burn, look()).scorch).toBeGreaterThan(0.9);
    expect(wheelEruptLook(burn + WHEEL_FX.fade * 0.5, burn, look()).scorch).toBeGreaterThan(0.2);
    expect(wheelEruptLook(wheelEruptSpan(burn), burn, look()).scorch).toBe(0);
    expect(wheelEruptSpan(burn)).toBeCloseTo(burn + WHEEL_FX.fade, 5);
  });

  it('reads as fire for at least as long as the sim burns, quenched or not', () => {
    const burn = T.wheelBurn;
    const fire = { floor: 0, geysers: 0, low: 0 };
    // The visual danger window covers the damage window: every instant the
    // sim still burns the slice, the floor is at least the danger fire and
    // the low flames stand, whether or not the next round marks it safe.
    for (const quench of [0, 0.5, 1])
      for (let t = 0.05; t <= burn + 1e-9; t += 0.05) {
        wheelFireLook(wheelEruptLook(t, burn, look()), true, 0, quench, fire);
        expect(fire.floor).toBeGreaterThanOrEqual(WHEEL_FX.danger);
        expect(fire.low).toBe(1);
        expect(fire.geysers).toBeCloseTo(1 - quench, 9);
      }
    // Once the sim drops it, it goes within WHEEL_FX.out.
    const late = wheelEruptLook(burn + 0.1, burn, look());
    wheelFireLook(late, false, 0, 0, fire);
    expect(fire.floor).toBeGreaterThan(0);
    wheelFireLook(late, false, WHEEL_FX.out, 0, fire);
    expect(fire.floor).toBe(0);
    expect(fire.low).toBe(0);
  });

  it('spreads the vents over a slice by its share, thins them on the low tier, keeps its edges clear', () => {
    const vents = wheelVents();
    expect(vents.length).toBe(WHEEL_FX.vents * 4);
    let geysers = 0;
    for (let i = 0; i < WHEEL_FX.vents; i++) {
      expect(vents[i * 4]).toBeGreaterThan(0);
      expect(vents[i * 4]).toBeLessThan(1);
      expect(vents[i * 4 + 1]).toBeGreaterThanOrEqual(0);
      expect(vents[i * 4 + 1]).toBeLessThanOrEqual(1);
      geysers += vents[i * 4 + 3];
    }
    expect(geysers).toBe(Math.ceil(WHEEL_FX.vents / WHEEL_FX.geyserEvery));
    // Deterministic.
    expect(Array.from(wheelVents())).toEqual(Array.from(vents));
    const wide = wheelArc(0);
    const narrow = wheelArc(1);
    expect(wheelVentCount(wide.from, wide.to, true)).toBe(WHEEL_FX.vents);
    expect(wheelVentCount(narrow.from, narrow.to, true)).toBe(Math.round(WHEEL_FX.vents / 3));
    for (const slice of WHEEL_ARCS_DEG.keys()) {
      const a = wheelArc(slice);
      const full = wheelVentCount(a.from, a.to, true);
      const low = wheelVentCount(a.from, a.to, false);
      expect(low).toBeGreaterThan(0);
      expect(low).toBeLessThan(full);
      const at: [number, number] = [0, 0];
      for (let i = 0; i < full; i++) {
        if (!wheelVentAt(vents, i, a.from, a.to, at)) continue;
        // Inside its own slice, past the wellspring's lip, clear of both edges.
        const r = Math.hypot(at[0], at[1]);
        expect(r).toBeGreaterThan(HEARTH_WELL.r);
        let b = Math.atan2(at[0], at[1]);
        if (b < -Math.PI / 2) b += Math.PI * 2;
        expect(b).toBeGreaterThanOrEqual(a.from);
        expect(b).toBeLessThanOrEqual(a.to);
        expect(Math.min(b - a.from, a.to - b) * r).toBeGreaterThanOrEqual(WHEEL_FX.ventEdge - 1e-6);
      }
    }
  });
});

describe('the Wheel inside HeatFightFx over a fake world', () => {
  const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
  let nextId = 1;
  const entity = (kind: string, templateId: string, x: number, z: number) =>
    ({
      id: nextId++,
      kind,
      templateId,
      name: templateId,
      pos: { x: o.x + x, y: 0, z: o.z + z },
      prevPos: { x: o.x + x, y: 0, z: o.z + z },
      facing: 0,
      scale: T.wheelOuter,
      hp: 100,
      maxHp: 100,
      dead: false,
      auras: [] as Entity['auras'],
      castingAbility: null as string | null,
      castTargetId: null,
      castRemaining: 0,
      castTotal: 0,
    }) as unknown as Entity;

  it('lays each slice on the zone rungs, its vents in the air, and cools an erupted slice', () => {
    const entities = new Map<number, Entity>();
    const add = (e: Entity) => {
      entities.set(e.id, e);
      return e;
    };
    const me = add(entity('player', 'warrior', -206, 2));
    const world = {
      entities,
      player: me,
      playerId: me.id,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const bump = () => {
      (world as unknown as { entityRosterVersion: number }).entityRosterVersion++;
    };
    const scene = new THREE.Scene();
    const fx = new HeatFightFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      () => {},
    );
    const run = (n: number) => {
      for (let i = 0; i < n; i++) fx.update(1 / 20);
    };
    const all = (name: string) => {
      const out: THREE.Mesh[] = [];
      scene.traverse((c) => {
        if (c.name === name) out.push(c as THREE.Mesh);
      });
      return out;
    };
    const shown = (name: string) => all(name).filter((m) => m.visible).length;
    // The pools: every slot a char decal with its glow child on Wakefire's
    // rungs, and a vents draw in the air over every floor band.
    const floors = all('smithHeartHeatWheel');
    expect(floors).toHaveLength(WHEEL_FX.slots);
    for (const f of floors) {
      expect(f.renderOrder).toBe(floorVfxRenderOrder('encounter', HEAT_FLOOR.zoneChar.step));
      const glow = f.children.find((c) => c.name === 'smithHeartHeatWheelGlow') as THREE.Mesh;
      expect(glow.renderOrder).toBe(floorVfxRenderOrder('encounter', HEAT_FLOOR.zoneGlow.step));
    }
    const vents = all('smithHeartHeatWheelVents');
    expect(vents).toHaveLength(WHEEL_FX.slots);
    for (const v of vents) expect(v.renderOrder).toBe(WALL_AIR_ORDER.fire);
    expect(vents[0].geometry).toBeInstanceOf(THREE.InstancedBufferGeometry);
    // Few, big geysers, each its crossed planes and its burst.
    expect((vents[0].geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(
      WHEEL_FX.vents * WHEEL_FX.planes,
    );
    expect(WHEEL_FX.vents).toBeLessThanOrEqual(16);
    // A round: three red slices and the safe one.
    const warn = HEAT_DIFFICULTY.normal.wheel.warn;
    const safe = 2;
    const slices: Entity[] = [];
    for (let s = 0; s < 4; s++)
      slices.push(
        add(
          entity(
            'object',
            wheelTemplate(s, s === safe ? 'safe' : 'warn', warn),
            HEARTH_WELL.x,
            HEARTH_WELL.z,
          ),
        ),
      );
    bump();
    run(4);
    expect(shown('smithHeartHeatWheel')).toBe(4);
    // The doomed slices' vents shimmer; the safe slice has none.
    expect(shown('smithHeartHeatWheelVents')).toBe(3);
    // The eruption: the reds burn, the safe slice leaves the floor.
    for (const [s, e] of slices.entries())
      if (s !== safe) e.templateId = wheelTemplate(s, 'burn', T.wheelBurn);
    entities.delete(slices[safe].id);
    bump();
    run(4);
    expect(shown('smithHeartHeatWheel')).toBe(3);
    expect(shown('smithHeartHeatWheelVents')).toBe(3);
    // The sim drops the burnt slices: their scorch stays and cools...
    for (const [s, e] of slices.entries()) if (s !== safe) entities.delete(e.id);
    bump();
    run(10);
    expect(shown('smithHeartHeatWheel')).toBe(3);
    // ...then goes.
    run(Math.ceil(wheelEruptSpan(T.wheelBurn) * 20) + 4);
    expect(shown('smithHeartHeatWheel')).toBe(0);
    expect(shown('smithHeartHeatWheelVents')).toBe(0);
    fx.dispose();
  });

  it("keeps the last round's fire reading as danger for as long as the sim burns it", () => {
    const entities = new Map<number, Entity>();
    const add = (e: Entity) => {
      entities.set(e.id, e);
      return e;
    };
    const me = add(entity('player', 'warrior', -206, 2));
    const world = {
      entities,
      player: me,
      playerId: me.id,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    const fx = new HeatFightFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      () => {},
    );
    const run = (n: number) => {
      for (let i = 0; i < n; i++) fx.update(1 / 20);
    };
    const bump = () => {
      (world as unknown as { entityRosterVersion: number }).entityRosterVersion++;
    };
    type Shown = { burn: number; scorch: number; geysers: number; low: number; pending: number };
    /** Each visible slice's look, by its slice (from its arc's start). */
    const looks = () => {
      const out = new Map<string, Shown>();
      scene.traverse((c) => {
        const m = (c as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
        if (c.name !== 'smithHeartHeatWheel' || !c.visible || !m?.uniforms) return;
        const vents = c.parent?.children.find(
          (v) =>
            v.name === 'smithHeartHeatWheelVents' &&
            ((v as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uArc.value ===
              m.uniforms.uArc.value,
        ) as THREE.Mesh | undefined;
        const vu = (vents?.material as THREE.ShaderMaterial | undefined)?.uniforms;
        const key = `${(m.uniforms.uArc.value as THREE.Vector4).z.toFixed(3)}:${m.uniforms.uSafe.value}`;
        out.set(key, {
          burn: m.uniforms.uBurn.value as number,
          scorch: m.uniforms.uScorch.value as number,
          geysers: (vu?.uGeysers.value as number) ?? 1,
          low: (vu?.uLow.value as number) ?? 0,
          pending: m.uniforms.uPending.value as number,
        });
      });
      return out;
    };
    const a0 = wheelArc(0).from.toFixed(3);
    const a1 = wheelArc(1).from.toFixed(3);
    // Slices 0 and 1 burning; the next round's safe slice lies on slice 0.
    const b0 = add(
      entity('object', wheelTemplate(0, 'burn', T.wheelBurn), HEARTH_WELL.x, HEARTH_WELL.z),
    );
    const b1 = add(
      entity('object', wheelTemplate(1, 'burn', T.wheelBurn), HEARTH_WELL.x, HEARTH_WELL.z),
    );
    add(entity('object', wheelTemplate(0, 'safe', 5), HEARTH_WELL.x, HEARTH_WELL.z));
    bump();
    // Through the sim's whole burn window, the burning slice under the next
    // safe one reads as fire: its floor at least the danger level, its low
    // flames up, the safe sheet only its rim; its big geysers dropped.
    const ticks = Math.round(T.wheelBurn * 20);
    for (let i = 0; i < ticks; i++) {
      run(1);
      if (i < 4) continue;
      const l = looks();
      const fire = l.get(`${a0}:0`);
      expect(fire, `tick ${i}`).toBeDefined();
      expect(fire?.burn).toBeGreaterThanOrEqual(WHEEL_FX.danger);
      expect(fire?.low).toBe(1);
      expect(l.get(`${a0}:1`)?.pending).toBe(1);
      expect(l.get(`${a1}:0`)?.burn).toBeGreaterThanOrEqual(WHEEL_FX.danger);
      if (i > 4 + WHEEL_FX.quench * 20) {
        expect(fire?.geysers).toBe(0);
        expect(l.get(`${a1}:0`)?.geysers).toBe(1);
      }
    }
    // The sim's burn ends: the safe sheet fills at once, the fire goes fast.
    entities.delete(b0.id);
    entities.delete(b1.id);
    bump();
    run(3);
    expect(looks().get(`${a0}:1`)?.pending).toBe(0);
    run(Math.ceil(WHEEL_FX.out * 20) + 1);
    const after = looks().get(`${a0}:0`);
    expect(after?.burn ?? 0).toBe(0);
    expect(after?.low ?? 0).toBe(0);
    fx.dispose();
  });

  it("draws the Wheel's whole-floor ignite as its slices, never a ring over the safe one", () => {
    const entities = new Map<number, Entity>();
    const add = (e: Entity) => {
      entities.set(e.id, e);
      return e;
    };
    const me = add(entity('player', 'warrior', -206, 2));
    const world = {
      entities,
      player: me,
      playerId: me.id,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    const fx = new HeatFightFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      () => {},
    );
    const run = (n: number) => {
      for (let i = 0; i < n; i++) fx.update(1 / 20);
    };
    const rings = () => fx.particles.liveRings();
    const ignite = {
      type: 'spellfxAt',
      x: o.x + HEARTH_WELL.x,
      z: o.z + HEARTH_WELL.z,
      radius: T.wheelOuter,
      school: 'fire',
      fx: 'burst',
      ability: HEAT_CUES.ignite,
    } as unknown as SimEvent;
    run(2);
    // Wakefire's back band (the same outer radius) still rings with no slice up.
    expect(fx.handleEvent(ignite)).toBe(true);
    expect(rings()).toBe(1);
    fx.particles.hideRings();
    add(entity('object', wheelTemplate(0, 'burn', T.wheelBurn), HEARTH_WELL.x, HEARTH_WELL.z));
    (world as unknown as { entityRosterVersion: number }).entityRosterVersion++;
    run(3);
    expect(fx.handleEvent(ignite)).toBe(true);
    expect(rings()).toBe(0);
    fx.dispose();
  });
});
