// A torched mudfin hut burning (q_deepfen_purge; the sim's `worldObjectBurning`
// event, world-visible to everyone near the hut). The event carries no
// duration, so this times each fire itself: an ignition burst ringed round the
// eaves (the hut is solid, so a burst at its centre would hide inside it), then
// hut_fire_core.ts's ten seconds of flame across the thatch with a flickering
// warm light, while a lit smoke plume (hut_smoke.ts) rises off the roof, goes
// thick and dark as the flames die, and thins out after. Re-torching a burning
// hut restarts it. The pooled particle cloud (vfx.ts) owns one of these and
// ticks it: the flames ride the one cloud, the plume its one shared mesh.

import * as THREE from 'three';
import { MUDFIN_HUT_MODELS, mudfinHutNear } from '../sim/mudfin_huts';
import type { SimEvent } from '../sim/types';
import {
  HUT_FIRE_RATES,
  type HutFireBody,
  type HutFireFrame,
  type HutFireKind,
  hutFireFrameInto,
} from './hut_fire_core';
import type { HutSmokeView } from './hut_smoke';
import { HUT_SMOKE_END_SECONDS } from './hut_smoke_core';

export interface HutFirePool {
  burst(at: THREE.Vector3, school: string, count?: number, power?: number): void;
  hutFire(kind: HutFireKind, body: HutFireBody, rate: number, dt: number): void;
}

/** The renderer's transient point-light pool (light_pulses.ts). The flicker
 *  only takes a free light, so a burning hut never cuts a talent flash short. */
export interface HutFireLight {
  pulseIfFree(
    at: THREE.Vector3,
    school: string,
    intensity?: number,
    duration?: number,
    range?: number,
  ): boolean;
}

/** A mud hut the table does not list (the shared Kenney mushroom). */
const UNLISTED_HUT = { radius: 1.2, height: 2.6 } as const;
const IGNITION_BURSTS = 4;
/** Reduced motion keeps the fire but thins it. */
const REDUCED_MOTION_RATE = 0.5;
/** The flicker: one short warm pulse at a time per hut, the next one rolled
 *  just after the last has faded. */
const FLICKER_PULSE_SECONDS = 0.4;
const FLICKER_MIN_SECONDS = 0.42;
const FLICKER_MAX_SECONDS = 0.62;

interface Fire {
  id: number;
  body: HutFireBody;
  age: number;
  nextFlicker: number;
}

export class HutFireFx {
  private readonly fires = new Map<number, Fire>();
  private light: HutFireLight | null = null;
  private readonly at = new THREE.Vector3();
  private readonly frame: HutFireFrame = { flame: 0, ember: 0, smoke: 0, done: false };

  constructor(
    private readonly pool: HutFirePool,
    private readonly groundY: (x: number, z: number) => number,
    /** The plume painter; null where the effects tier builds none. */
    private readonly smoke: HutSmokeView | null = null,
  ) {}

  /** The warm flicker's light pool, once the renderer has built it. */
  setLight(light: HutFireLight | null): void {
    this.light = light;
  }

  /** A torched hut catches: the ignition, then its timed fire. */
  handleEvent(ev: SimEvent): void {
    if (ev.type !== 'worldObjectBurning') return;
    const hut = mudfinHutNear(ev.x, ev.z);
    const size = hut ? MUDFIN_HUT_MODELS[hut.model] : UNLISTED_HUT;
    const body: HutFireBody = {
      x: ev.x,
      y: this.groundY(ev.x, ev.z),
      z: ev.z,
      radius: size.radius,
      height: size.height,
    };
    this.fires.set(ev.objectId, { id: ev.objectId, body, age: 0, nextFlicker: 0 });
    const eave = body.radius * 1.15;
    for (let i = 0; i < IGNITION_BURSTS; i++) {
      const a = (i / IGNITION_BURSTS) * Math.PI * 2 + 0.4;
      this.at.set(
        body.x + Math.sin(a) * eave,
        body.y + body.height * 0.5,
        body.z + Math.cos(a) * eave,
      );
      this.pool.burst(this.at, 'fire', 18, 1.5);
    }
    this.pool.burst(this.at.set(body.x, body.y + body.height * 0.85, body.z), 'fire', 24, 1.8);
  }

  /** Advance every fire; called once a frame by the particle cloud. */
  update(dt: number, reducedMotion = false): void {
    const thin = reducedMotion ? REDUCED_MOTION_RATE : 1;
    const frame = this.frame;
    for (const fire of this.fires.values()) {
      fire.age += Math.max(0, dt);
      hutFireFrameInto(fire.age, frame);
      if (frame.done) {
        // the flames and their sparks are out; the plume drifts on until its last puff
        if (!this.smoke || fire.age >= HUT_SMOKE_END_SECONDS) this.fires.delete(fire.id);
        continue;
      }
      if (frame.flame > 0)
        this.pool.hutFire('flame', fire.body, HUT_FIRE_RATES.flame * frame.flame * thin, dt);
      if (frame.ember > 0)
        this.pool.hutFire('ember', fire.body, HUT_FIRE_RATES.ember * frame.ember * thin, dt);
      if (frame.smoke > 0)
        this.pool.hutFire('smoke', fire.body, HUT_FIRE_RATES.smoke * frame.smoke * thin, dt);
      if (this.light && frame.flame > 0.05 && fire.age >= fire.nextFlicker) {
        fire.nextFlicker =
          fire.age +
          FLICKER_MIN_SECONDS +
          Math.random() * (FLICKER_MAX_SECONDS - FLICKER_MIN_SECONDS);
        // pulseIfFree() lifts the light 1.1 yd itself: this sits it in the eaves
        this.at.set(fire.body.x, fire.body.y + fire.body.height * 0.5 - 1.1, fire.body.z);
        this.light.pulseIfFree(
          this.at,
          'fire',
          (5 + Math.random() * 4) * frame.flame,
          FLICKER_PULSE_SECONDS,
          11,
        );
      }
    }
  }

  /** Paint the smoke plumes for this frame's camera (after its pose is set). */
  prepareDraw(camX: number, camZ: number): void {
    const smoke = this.smoke;
    if (!smoke || (this.fires.size === 0 && !smoke.mesh.visible)) return;
    smoke.update(this.fires.values(), camX, camZ);
  }

  /** Put out every fire (a scene reset). */
  clear(): void {
    this.fires.clear();
    this.smoke?.update([], 0, 0);
  }

  /** The object ids burning (or still smoking) right now (tests and diagnostics). */
  burning(): number[] {
    return [...this.fires.keys()];
  }
}
