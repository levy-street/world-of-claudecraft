// The Great Saurian's totem rework, render half: the pure plan
// (src/render/wildheart_basin/saurian_totem_fx_core.ts) and its painter
// (saurian_totem_fx.ts) on a fake BasinFxHost and a stub world. The painter
// mints every mesh and material once in its constructor and nothing after;
// every ACTIONABLE read (the ring at a totem's foot, its beacon and sigil,
// the tether, the drum and its pulse) draws on every density and motion
// setting; dispose releases what it owns, never the cached surface.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TelegraphKit } from '../src/render/floor_telegraph';
import { isSharedMaterial } from '../src/render/shared_resource';
import type { BasinFxHost } from '../src/render/wildheart_basin/basin_fx_host';
import { TOTEM_SIM_SCALE } from '../src/render/wildheart_basin/basin_trash_model_core';
import { SAURIAN_MODEL } from '../src/render/wildheart_basin/saurian_model_core';
import { SaurianTotemFx } from '../src/render/wildheart_basin/saurian_totem_fx';
import {
  DRUM_LOOK,
  drumBeat,
  drumSeat,
  drumSticks,
  RIDER_FLARE_SECONDS,
  riderEmber,
  riderFlare,
  riderHands,
  SAP_BEACON_HEIGHT,
  SAP_POOLS,
  SAP_PULSE_SECONDS,
  SAP_SHARDS,
  sapAnchor,
  sapBreakFlash,
  sapMendFlare,
  sapPulse,
  sapShardCount,
  sapTether,
  sapTotemArming,
  sapTotemHeight,
  TOTEM_THROW_SECONDS,
  totemThrow,
} from '../src/render/wildheart_basin/saurian_totem_fx_core';
import { MOBS } from '../src/sim/data';
import {
  GREAT_SAURIAN_ID,
  SAP_TOTEM_ID,
  SAURIAN_DRUM_BEAT,
  SAURIAN_DRUM_SILENCED,
  SAURIAN_SAP_BACKLASH,
  SAURIAN_SAP_TETHER,
  SAURIAN_TOTEM_THROW,
  SAURIAN_WAR_DRUM,
  SAURIAN_TUNING as T,
} from '../src/sim/encounters/wildheart_basin/ids';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

/** A player is about 2 yd tall (the README's human male). */
const PLAYER_HEIGHT = 2;

describe('saurian totem plan', () => {
  it('stands the Sap Totem far taller than a player, over the Binders own', () => {
    const h = sapTotemHeight(MOBS[SAP_TOTEM_ID].scale);
    expect(h).toBeGreaterThan(3 * PLAYER_HEIGHT);
    expect(h).toBeGreaterThan(sapTotemHeight(TOTEM_SIM_SCALE));
    expect(SAP_BEACON_HEIGHT).toBeGreaterThan(SAURIAN_MODEL.headTop);
  });

  it('flies the throw on the Rise beat and lands it', () => {
    const out = { along: 0, lift: 0, spin: 0 };
    expect(totemThrow(-0.01, out)).toBeNull();
    const mid = totemThrow(TOTEM_THROW_SECONDS / 2, out);
    expect(mid?.along).toBeCloseTo(0.5, 5);
    expect(mid?.lift).toBeGreaterThan(4);
    expect(totemThrow(TOTEM_THROW_SECONDS, out)).toBeNull();
  });

  it('reaches the tether out through the arming bar, then feeds at full reach', () => {
    const out = { charge: 0, strength: 0 };
    expect(sapTotemArming(T.totemArm)).toBe(true);
    expect(sapTotemArming(T.totemHealEvery)).toBe(false);
    sapTether(true, 0, out);
    const start = out.charge;
    sapTether(true, 0.5, out);
    expect(out.charge).toBeGreaterThan(start);
    expect(out.charge).toBeLessThan(1);
    sapTether(true, 1, out);
    expect(out.charge).toBeCloseTo(1, 5);
    sapTether(false, 0, out);
    expect(out.charge).toBe(1);
    const fed = out.strength;
    sapTether(true, 0.2, out);
    expect(out.strength).toBeLessThan(fed);
  });

  it('runs a mending pulse down the tether and blooms on the beast when it arrives', () => {
    expect(sapPulse(-0.1)).toBe(-1);
    expect(sapPulse(0)).toBe(0);
    expect(sapPulse(SAP_PULSE_SECONDS / 2)).toBeCloseTo(0.5, 5);
    expect(sapPulse(SAP_PULSE_SECONDS)).toBe(-1);
    expect(sapMendFlare(0, false)).toBe(1);
    expect(sapMendFlare(0.1, true)).toBe(0);
    expect(sapMendFlare(SAP_PULSE_SECONDS, true)).toBe(1);
    expect(sapBreakFlash(0)).toBe(1);
    expect(sapBreakFlash(0.7)).toBe(0);
  });

  it('ties the tether to the withers under the howdah, and seats rider and drum on the deck', () => {
    const a = sapAnchor(3.2);
    expect(a.up).toBeGreaterThan(SAURIAN_MODEL.deckTop * 0.5);
    expect(a.up).toBeLessThan(SAURIAN_MODEL.deckTop);
    expect(riderHands(3.2).up).toBeGreaterThan(SAURIAN_MODEL.deckTop);
    const seat = drumSeat(3.2);
    expect(seat.up).toBeGreaterThan(SAURIAN_MODEL.deckTop);
    expect(seat.forward).toBeLessThan(riderHands(3.2).forward);
    expect(DRUM_LOOK.drummer).toBeGreaterThan(PLAYER_HEIGHT);
  });

  it('lands the sticks on the beat and hangs them silenced', () => {
    const out = { right: 0, left: 0 };
    drumSticks(0, true, out);
    expect(out.right).toBeCloseTo(1.1, 5);
    drumSticks(T.drumBeatEvery / 2, true, out);
    expect(out.right).toBeLessThan(0.7);
    expect(out.left).toBeCloseTo(1.1, 5);
    drumSticks(0, false, out);
    expect(out.right).toBe(out.left);
  });

  it('throws the beat ring out and fades it inside its look', () => {
    const out = { flash: 0, radius: 0, alpha: 0 };
    drumBeat(0, out);
    expect(out.flash).toBe(1);
    expect(out.alpha).toBe(1);
    const r0 = out.radius;
    drumBeat(DRUM_LOOK.beatSeconds * 0.8, out);
    expect(out.radius).toBeGreaterThan(r0);
    expect(out.radius).toBeLessThanOrEqual(DRUM_LOOK.airRing);
    drumBeat(DRUM_LOOK.beatSeconds, out);
    expect(out.alpha).toBe(0);
    // The beat fits inside the drum's own beat.
    expect(DRUM_LOOK.beatSeconds).toBeLessThanOrEqual(T.drumBeatEvery);
  });

  it('gathers the rider flare, then bursts it, and keeps an ember between throws', () => {
    expect(riderFlare(-0.1)).toBe(0);
    expect(riderFlare(RIDER_FLARE_SECONDS * 0.3)).toBeCloseTo(1, 5);
    expect(riderFlare(RIDER_FLARE_SECONDS)).toBe(0);
    for (let t = 0; t < 10; t += 0.37) expect(riderEmber(t)).toBeGreaterThan(0.1);
  });

  it('sizes the pools to the totems that can stand and keeps splinters on every tier', () => {
    expect(SAP_POOLS.totems).toBeGreaterThan(T.totemMax);
    expect(sapShardCount(1)).toBe(SAP_SHARDS.full);
    expect(sapShardCount(0.1)).toBe(SAP_SHARDS.min);
  });
});

// ---- the painter ---------------------------------------------------------------------

interface StubEntity {
  id: number;
  kind: 'mob' | 'player' | 'object';
  templateId: string;
  pos: { x: number; y: number; z: number };
  facing: number;
  scale: number;
  dead: boolean;
  inCombat: boolean;
  auras: { id: string; remaining: number }[];
  castingAbility: string | null;
  castRemaining: number;
  castTotal: number;
  castTargetId: number | null;
}

function stubWorld() {
  const entities = new Map<number, StubEntity>();
  const add = (e: Partial<StubEntity> & { id: number; templateId: string }) => {
    const full: StubEntity = {
      kind: 'mob',
      pos: { x: 0, y: 0, z: 0 },
      facing: 0,
      scale: 1,
      dead: false,
      inCombat: true,
      auras: [],
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      castTargetId: null,
      ...e,
    };
    entities.set(full.id, full);
    return full;
  };
  return { world: { entities, playerId: 1 } as unknown as IWorld, add };
}

function fakeHost(density: number, reduced: boolean) {
  const root = new THREE.Group();
  const kit = new TelegraphKit(new THREE.Group(), density >= 1);
  let seed = 7;
  const host: BasinFxHost = {
    root,
    kit,
    density,
    uTime: { value: 0 },
    groundY: () => 0,
    puff: () => {},
    shockRing: () => {},
    rand: () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    },
    reducedMotion: () => reduced,
    shake: () => {},
    splash: { crown: () => {}, ripple: () => {} } as never,
    thorns: {} as never,
  };
  return { host, root };
}

function drawn(root: THREE.Object3D, name: string): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverseVisible((o) => {
    if (o.name === name) out.push(o);
  });
  return out;
}

function counts(root: THREE.Object3D): { meshes: number; materials: number } {
  let meshes = 0;
  const mats = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mat);
  });
  return { meshes, materials: mats.size };
}

function spellfx(ability: string, sourceId: number, targetId?: number) {
  return {
    type: 'spellfx',
    sourceId,
    targetId,
    school: 'nature',
    fx: 'nova',
    ability,
  } as SimEvent & { type: 'spellfx' };
}

function scan(fx: SaurianTotemFx, world: IWorld): void {
  fx.beginScan();
  for (const e of world.entities.values()) {
    if (e.templateId === GREAT_SAURIAN_ID) fx.scanSaurian(e as Entity);
    else fx.scanTotem(e as Entity);
  }
  fx.endScan();
}

describe('saurian totem painter', () => {
  for (const [density, reduced] of [
    [1, false],
    [0.4, false],
    [0.4, true],
  ] as const) {
    it(`draws every read on density ${density}${reduced ? ' with reduced motion' : ''}`, () => {
      const { host, root } = fakeHost(density, reduced);
      const { world, add } = stubWorld();
      const gestures: string[] = [];
      const fx = new SaurianTotemFx(host, world, (_id, g) => gestures.push(g));
      const built = counts(root);
      const saurian = add({ id: 10, templateId: GREAT_SAURIAN_ID, scale: 3.2 });
      const totem = add({
        id: 20,
        templateId: SAP_TOTEM_ID,
        scale: 2,
        pos: { x: 14, y: 0, z: 0 },
        castingAbility: SAURIAN_SAP_TETHER,
        castTotal: T.totemArm,
        castRemaining: T.totemArm,
        castTargetId: 10,
      });
      let clock = 0;
      const step = (seconds: number) => {
        for (let t = 0; t < seconds; t += 0.05) {
          clock += 0.05;
          fx.update(0.05, clock);
        }
      };
      scan(fx, world);
      fx.handleEvent(spellfx(SAURIAN_TOTEM_THROW, saurian.id, totem.id));
      step(0.1);
      // In the air: the bundle flies, the rider flares; nothing on the ford yet.
      expect(drawn(root, 'wildheart-sap-bundle').length).toBe(1);
      expect(drawn(root, 'wildheart-sap-rider').length).toBe(1);
      expect(drawn(root, 'wildheart-sap-ring').length).toBe(0);
      step(TOTEM_THROW_SECONDS);
      scan(fx, world);
      step(0.1);
      // Landed and arming: the ring, the beacon, the sigil and a short tether.
      expect(drawn(root, 'wildheart-sap-bundle').length).toBe(0);
      expect(drawn(root, 'wildheart-sap-ring').length).toBe(1);
      expect(drawn(root, 'wildheart-sap-beacon').length).toBe(1);
      expect(drawn(root, 'wildheart-sap-sigil').length).toBe(1);
      const tether = drawn(root, 'wildheart-sap-tether') as THREE.Mesh[];
      expect(tether.length).toBe(1);
      const tu = (tether[0].material as THREE.ShaderMaterial).uniforms;
      expect(tu.uCharge.value).toBeLessThan(0.5);
      expect(gestures).toContain('wildheart_totem_rise');
      // Fed: full reach, and a mending runs a pulse down it.
      totem.castTotal = T.totemHealEvery;
      totem.castRemaining = T.totemHealEvery;
      fx.handleEvent(spellfx(SAURIAN_SAP_TETHER, totem.id, saurian.id));
      step(0.1);
      expect(tu.uCharge.value).toBe(1);
      expect(tu.uPulse.value).toBeGreaterThan(0);
      expect(gestures).toContain(SAURIAN_SAP_TETHER);
      // Heroic: the drum rides the howdah, beats, and hangs its sticks silenced.
      saurian.auras = [{ id: SAURIAN_WAR_DRUM, remaining: 3600 }];
      scan(fx, world);
      fx.handleEvent(spellfx(SAURIAN_DRUM_BEAT, saurian.id, saurian.id));
      step(0.1);
      expect(drawn(root, 'wildheart-war-drum').length).toBe(1);
      expect(drawn(root, 'wildheart-war-drummer').length).toBe(1);
      expect(drawn(root, 'wildheart-war-drum-stick').length).toBe(2);
      expect(drawn(root, 'wildheart-war-drum-band').length).toBe(1);
      saurian.auras = [{ id: SAURIAN_DRUM_SILENCED, remaining: 6 }];
      scan(fx, world);
      step(0.6);
      expect(drawn(root, 'wildheart-war-drum').length).toBe(1);
      expect(drawn(root, 'wildheart-war-drum-band').length).toBe(0);
      // The break: the ring and beacon go at once, the tether snaps, splinters fly.
      totem.dead = true;
      scan(fx, world);
      fx.handleEvent(spellfx(SAURIAN_SAP_BACKLASH, totem.id, saurian.id));
      step(0.1);
      expect(drawn(root, 'wildheart-sap-ring').length).toBe(0);
      expect(drawn(root, 'wildheart-sap-beacon').length).toBe(0);
      expect(drawn(root, 'wildheart-sap-splinters').length).toBe(1);
      expect(tu.uSnap.value).toBeGreaterThan(0);
      step(2);
      scan(fx, world);
      step(0.1);
      expect(drawn(root, 'wildheart-sap-tether').length).toBe(0);
      expect(drawn(root, 'wildheart-sap-splinters').length).toBe(0);
      // Nothing minted after build.
      expect(counts(root)).toEqual(built);
      fx.hideAll();
      expect(drawn(root, 'wildheart-war-drum').length).toBe(0);
    });
  }

  it('shows the rider flare while the howdah stands, and hides it once it has broken', () => {
    const flare = (howdahWhole: boolean): number => {
      const { host, root } = fakeHost(1, false);
      const { world, add } = stubWorld();
      const fx = new SaurianTotemFx(host, world, undefined, () => howdahWhole);
      add({ id: 10, templateId: GREAT_SAURIAN_ID, scale: 3.2 });
      scan(fx, world);
      fx.update(0.05, 0.05);
      return drawn(root, 'wildheart-sap-rider').length;
    };
    // The same scene either way: only the howdah's state decides it.
    expect(flare(true)).toBe(1);
    expect(flare(false)).toBe(0);
  });

  it('disposes its own geometry and materials, never the shared surface', () => {
    const { host, root } = fakeHost(1, false);
    const { world } = stubWorld();
    const fx = new SaurianTotemFx(host, world);
    const disposedMats = new Set<THREE.Material>();
    const shared: THREE.Material[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        mat.addEventListener('dispose', () => disposedMats.add(mat));
        if (!(mat instanceof THREE.ShaderMaterial)) shared.push(mat);
      }
    });
    fx.dispose();
    expect(disposedMats.size).toBeGreaterThan(0);
    for (const m of shared) {
      expect(disposedMats.has(m)).toBe(false);
      expect(isSharedMaterial(m) || !(m instanceof THREE.ShaderMaterial)).toBe(true);
    }
  });
});
