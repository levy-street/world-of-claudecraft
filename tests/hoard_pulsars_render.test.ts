// Nyxaris's Bound Pulsars on screen: the pure look (src/render/hoard_pulsars_core.ts),
// the pooled adapter (src/render/hoard_pulsars.ts), and the shipped Blender orb.
import { existsSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ASSETS } from '../scripts/assets/pulsars/build.mjs';
import { VISUALS } from '../src/render/characters/manifest';
import { HoardBossFx } from '../src/render/hoard_boss_fx';
import { HoardPulsarFx, PULSAR_ASSET_URL, PULSAR_BOSS_TEMPLATE } from '../src/render/hoard_pulsars';
import {
  activationEnergy,
  bossLocalToWorld,
  type OrbDeath,
  type OrbEnergy,
  type OrbReform,
  type OrbStrain,
  orbDeath,
  orbReform,
  orbStrain,
  PULSAR_LOOK,
} from '../src/render/hoard_pulsars_core';
import {
  HOARD_BOUND_PULSARS_AURA_ID,
  HOARD_PULSAR_TEMPLATE,
  PULSAR_WARD_TOTAL_SEC,
  PULSARS,
  pulsarAnchor,
} from '../src/sim/rift/hoard_pulsars_core';
import type { IWorld } from '../src/world_api';
import type { HoardBossCueView } from '../src/world_api/dungeons';

const energy = (): OrbEnergy => ({ charge: 0, travel: 0, spin: 1, link: 0, pulse: 0, open: 1 });
const strain = (): OrbStrain => ({
  instability: 0,
  shake: 0,
  flickerHz: 0,
  flickerDepth: 0,
  cracks: 0,
});
const death = (): OrbDeath => ({
  coreScale: 1,
  flash: 0,
  nova: 0,
  scatter: 0,
  fade: 1,
  done: false,
});
const reform = (): OrbReform => ({ gather: 0, plates: 0, core: 0, done: false });

describe('the orb look', () => {
  it('activates in the order the brief asks: spin, brighten, link, leave, pulse', () => {
    const cast = PULSARS.activationCastSec;
    const at = (t: number) => activationEnergy(cast * t, energy());
    expect(at(0)).toMatchObject({ charge: 0, travel: 0, link: 0, pulse: 0 });
    // The turn quickens first, before anything brightens or moves.
    expect(at(0.12).spin).toBeGreaterThan(1);
    expect(at(0.12).charge).toBe(0);
    expect(at(0.3).charge).toBeGreaterThan(0);
    expect(at(0.3).travel).toBe(0);
    expect(at(0.5).travel).toBeGreaterThan(0);
    expect(at(0.5).link).toBe(0);
    expect(at(0.8).link).toBeGreaterThan(0);
    // All of it complete exactly when the ward closes, marked by one pulse.
    expect(at(0.999).pulse).toBe(0);
    const done = activationEnergy(cast, energy());
    expect(done).toMatchObject({ charge: 1, travel: 1, link: 1, pulse: 1 });
    expect(activationEnergy(cast + 1, energy()).pulse).toBe(0);
    expect(done.open).toBeGreaterThan(1);
    expect(done.spin).toBeGreaterThan(3);
  });

  it('shows its wounds in four steps, never the same from full to dying', () => {
    const tiers = [1, 0.69, 0.39, 0.14].map((hp) => ({ ...orbStrain(hp, strain()) }));
    expect(tiers[0]).toMatchObject({ instability: 0, shake: 0, flickerHz: 0, cracks: 0 });
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].instability).toBeGreaterThan(tiers[i - 1].instability);
      expect(tiers[i].shake).toBeGreaterThan(tiers[i - 1].shake);
      expect(tiers[i].flickerHz).toBeGreaterThan(tiers[i - 1].flickerHz);
      expect(tiers[i].cracks).toBeGreaterThan(tiers[i - 1].cracks);
    }
    // The brief's thresholds, to the percent.
    expect(orbStrain(0.71, strain()).instability).toBe(0);
    expect(orbStrain(0.41, strain()).instability).toBe(tiers[1].instability);
    expect(orbStrain(0.16, strain()).instability).toBe(tiers[2].instability);
    expect(orbStrain(0, strain()).instability).toBe(1);
  });

  it('dies by collapsing inward for a beat, THEN bursting, and is short', () => {
    expect(PULSAR_LOOK.deathSec).toBeLessThanOrEqual(1.2);
    const early = orbDeath(PULSAR_LOOK.deathSec * 0.15, death());
    expect(early.scatter).toBeLessThan(0); // pulled in
    expect(early.nova).toBe(0);
    expect(early.coreScale).toBeGreaterThan(0);
    const burst = orbDeath(PULSAR_LOOK.deathSec * 0.3, death());
    expect(burst.coreScale).toBe(0);
    expect(burst.flash).toBeGreaterThan(0.7);
    expect(burst.scatter).toBeGreaterThan(0);
    expect(burst.nova).toBeGreaterThan(0);
    const late = orbDeath(PULSAR_LOOK.deathSec * 0.9, death());
    expect(late.scatter).toBeGreaterThan(burst.scatter);
    expect(late.fade).toBeLessThan(0.2);
    expect(late.done).toBe(false);
    expect(orbDeath(PULSAR_LOOK.deathSec, death()).done).toBe(true);
  });

  it('reforms by gathering light, closing its plates, then kindling', () => {
    const a = orbReform(PULSAR_LOOK.reformSec * 0.2, reform());
    expect(a.gather).toBeGreaterThan(0);
    expect(a.plates).toBe(1);
    expect(a.core).toBe(0);
    const b = orbReform(PULSAR_LOOK.reformSec * 0.6, reform());
    expect(b.plates).toBeLessThan(0.5);
    const c = orbReform(PULSAR_LOOK.reformSec, reform());
    expect(c).toMatchObject({ plates: 0, core: 1, done: true });
  });

  it('carries the anchors round with the boss, whichever way he faces', () => {
    const out = { x: 0, y: 0, z: 0 };
    // Facing +z: his right is +x.
    expect(bossLocalToWorld(10, 1, 20, 0, 2, 3, -1, out)).toEqual({ x: 12, y: 4, z: 19 });
    // Facing +x: his right is -z, his forward +x.
    const turned = bossLocalToWorld(10, 1, 20, Math.PI / 2, 2, 3, -1, out);
    expect(turned.x).toBeCloseTo(9, 9);
    expect(turned.z).toBeCloseTo(18, 9);
  });
});

function cue(partial: Partial<HoardBossCueView> & { variant: HoardBossCueView['variant'] }) {
  return {
    instanceId: 1,
    cueId: 1,
    kind: 'mark',
    phase: 'hazard',
    x: 0,
    z: 0,
    radius: 0,
    remaining: PULSAR_WARD_TOTAL_SEC,
    total: PULSAR_WARD_TOTAL_SEC,
    ...partial,
  } as HoardBossCueView;
}
const CALM_OFF = () => false;
const named = (scene: THREE.Scene, name: string): THREE.Object3D[] => {
  const out: THREE.Object3D[] = [];
  scene.traverse((node) => {
    if (node.name === name) out.push(node);
  });
  return out;
};
const shown = (scene: THREE.Scene, name: string) =>
  named(scene, name).filter((node) => node.visible).length;

function worldWith(stacks: number) {
  const boss = {
    id: 50,
    templateId: PULSAR_BOSS_TEMPLATE,
    dead: false,
    scale: 2,
    facing: 0,
    pos: { x: 0, y: 0, z: 0 },
    hp: 1000,
    maxHp: 1000,
    auras: stacks > 0 ? [{ id: HOARD_BOUND_PULSARS_AURA_ID, stacks }] : [],
  };
  const entities = new Map<number, unknown>([[boss.id, boss]]);
  // A hoard is a rift floor: the module only ever looks for its boss inside one.
  const world = { entities, playerId: 1, riftFloor: { seed: 1 } } as unknown as IWorld;
  return { boss, entities, world };
}

/** The phase `elapsed` seconds in: the ward, two orbs, and (optionally) a beam. */
function phase(elapsed: number, beam?: 'lock' | 'beam', aim = { x: 0, z: -20 }) {
  const remaining = PULSAR_WARD_TOTAL_SEC - elapsed;
  const cues = [
    cue({ cueId: 1, kind: 'sweep', variant: 'arcane-pulsar-ward', remaining }),
    cue({ cueId: 2, variant: 'arcane-pulsar', x: -7, z: 2, radius: 0, remaining }),
    cue({ cueId: 4, variant: 'arcane-pulsar', x: 7, z: 2, radius: 1, remaining }),
  ];
  if (beam) {
    cues.push(
      cue({
        cueId: 3,
        variant: beam === 'beam' ? 'arcane-pulsar-beam' : 'arcane-pulsar-lock',
        x: aim.x,
        z: aim.z,
        radius: PULSARS.beamWidth,
        remaining: 0.4,
        total: 0.45,
      }),
    );
  }
  return cues;
}

describe('the adapter', () => {
  it('hides its cues from the generic floor telegraph', async () => {
    const scene = new THREE.Scene();
    const generic = new HoardBossFx(scene, () => 0);
    await generic.readyForEntry;
    generic.sync(phase(5, 'beam'));
    const root = scene.getObjectByName('hoard-boss-actionable-cues');
    expect(root?.children.every((slot) => !slot.visible)).toBe(true);
    generic.dispose();
  });

  it('rides the boss dormant: two orbs, three for a legendary, at his own scale', async () => {
    for (const stacks of [2, 3]) {
      const scene = new THREE.Scene();
      const { boss, world } = worldWith(stacks);
      const fx = new HoardPulsarFx(
        scene,
        () => 0,
        world,
        undefined,
        CALM_OFF,
        undefined,
        'high',
        new THREE.Group(),
      );
      await fx.readyForEntry;
      fx.sync([]);
      for (let i = 0; i < 200; i++) fx.update(0.016); // past the reforming
      const orbs = named(scene, 'PulsarOrb').filter((node) => node.visible);
      expect(orbs).toHaveLength(stacks);
      const left = pulsarAnchor(0, boss.scale);
      expect(orbs[0].position.x).toBeCloseTo(left.x, 1);
      expect(Math.abs(orbs[0].position.y - left.y)).toBeLessThanOrEqual(
        PULSARS.orbHoverAmount + 0.01,
      );
      expect(orbs[0].scale.x).toBeCloseTo(PULSAR_LOOK.dormantScale, 6);
      // Scenery: no beam, no line, no ward.
      expect(
        shown(scene, 'PulsarBeam') + shown(scene, 'PulsarLock') + shown(scene, 'PulsarWard'),
      ).toBe(0);
      // He turns, they turn with him.
      boss.facing = Math.PI / 2;
      for (let i = 0; i < 120; i++) fx.update(0.016);
      expect(orbs[0].position.z).toBeCloseTo(left.x * -1, 0);
      fx.dispose();
    }
  });

  it('flies each orb off his shoulder to its station, then wards him', async () => {
    const scene = new THREE.Scene();
    const { world } = worldWith(2);
    const fx = new HoardPulsarFx(
      scene,
      () => 0,
      world,
      undefined,
      CALM_OFF,
      undefined,
      'high',
      new THREE.Group(),
    );
    await fx.readyForEntry;
    fx.sync([]);
    for (let i = 0; i < 200; i++) fx.update(0.016);
    const orb = named(scene, 'PulsarOrb')[0];
    const start = orb.position.clone();
    fx.sync(phase(PULSARS.activationCastSec * 0.7));
    fx.update(0.016);
    // Part way: neither on his shoulder nor yet at the station.
    expect(orb.position.distanceTo(start)).toBeGreaterThan(0.5);
    expect(Math.hypot(orb.position.x + 7, orb.position.z - 2)).toBeGreaterThan(0.5);
    expect(shown(scene, 'PulsarLink')).toBe(2);
    fx.sync(phase(PULSARS.activationCastSec + 1));
    fx.update(0.016);
    expect(orb.position.x).toBeCloseTo(-7, 3);
    expect(orb.position.z).toBeCloseTo(2, 3);
    expect(orb.position.y).toBeCloseTo(PULSARS.stationHeight, 0);
    expect(orb.scale.x).toBeCloseTo(PULSAR_LOOK.activeScale, 6);
    fx.update(0.5); // the boss poll sees the ward
    expect(shown(scene, 'PulsarWard')).toBe(1);
    fx.dispose();
  });

  it('draws the harmless line, then the beam, from the orb whose id sits under the cue', async () => {
    const scene = new THREE.Scene();
    const { world } = worldWith(0);
    const fx = new HoardPulsarFx(
      scene,
      () => 0,
      world,
      undefined,
      CALM_OFF,
      undefined,
      'high',
      new THREE.Group(),
    );
    await fx.readyForEntry;
    fx.sync(phase(5, 'lock'));
    fx.update(0.016);
    expect(shown(scene, 'PulsarLock')).toBe(1);
    expect(shown(scene, 'PulsarBeam')).toBe(0);
    const line = named(scene, 'PulsarLock').find((node) => node.visible) as THREE.Mesh;
    // From orb 0 (cue 2), the one whose id is one under the lock's.
    expect(line.position.x).toBeCloseTo(-7, 3);
    expect(line.scale.x).toBeLessThan(0.2); // thin: it cannot be mistaken for the beam

    fx.sync(phase(6, 'beam'));
    fx.update(0.3);
    expect(shown(scene, 'PulsarLock')).toBe(0);
    expect(shown(scene, 'PulsarBeam')).toBe(1);
    const beam = named(scene, 'PulsarBeam').find((node) => node.visible) as THREE.Mesh;
    // The burning core is drawn at the width the sim burns at, to the aim point.
    expect(beam.scale.x).toBeCloseTo(PULSARS.beamWidth, 1);
    expect(beam.scale.z).toBeCloseTo(Math.hypot(7, 22, PULSARS.stationHeight - 0.35), 0);
    // The aim point glides after the cue, never jumps.
    fx.sync(phase(6.1, 'beam', { x: 10, z: -20 }));
    fx.update(0.016);
    expect(beam.scale.z).toBeLessThan(Math.hypot(17, 22, 3));
    fx.dispose();
  });

  it('bursts a destroyed orb where it stood, and clears everything on a reset', async () => {
    const scene = new THREE.Scene();
    const shakes: number[] = [];
    const { world, entities } = worldWith(0);
    const fx = new HoardPulsarFx(
      scene,
      () => 0,
      world,
      undefined,
      CALM_OFF,
      (n) => shakes.push(n),
      'high',
      new THREE.Group(),
    );
    await fx.readyForEntry;
    // Orb 0's mob, beaten down to a sliver: the painter reads its health.
    entities.set(60, {
      id: 60,
      templateId: HOARD_PULSAR_TEMPLATE,
      dead: false,
      pos: { x: -7, y: 0, z: 2 },
      hp: 5,
      maxHp: 100,
      auras: [],
    });
    fx.sync(phase(6, 'beam'));
    fx.update(0.3);
    // Orb 0 dies: its cue and its beam are withdrawn; orb 1 burns on.
    fx.sync(phase(6.1).filter((entry) => entry.cueId !== 2));
    fx.update(0.016);
    expect(shown(scene, 'PulsarBeam')).toBe(0);
    fx.update(PULSAR_LOOK.deathSec * 0.4);
    const orbs = named(scene, 'PulsarOrb');
    expect(orbs[0].visible).toBe(true); // still dying, where it stood
    expect(orbs[0].position.x).toBeCloseTo(-7, 3);
    expect(shown(scene, 'PulsarNova')).toBe(1);
    fx.update(PULSAR_LOOK.deathSec);
    expect(orbs[0].visible).toBe(false);
    expect(orbs[1].visible).toBe(true);
    expect(shakes).toHaveLength(1);
    // The encounter resets under the HEALTHY survivor: it just goes. No burst, no
    // ring and no shake for an orb nobody destroyed.
    fx.sync([]);
    fx.update(0.016);
    expect(orbs[1].visible).toBe(false);
    expect(shown(scene, 'PulsarNova')).toBe(0);
    expect(shakes).toHaveLength(1);
    fx.update(PULSAR_LOOK.deathSec + 0.1);
    expect(
      shown(scene, 'PulsarOrb') +
        shown(scene, 'PulsarBeam') +
        shown(scene, 'PulsarLock') +
        shown(scene, 'PulsarLink') +
        shown(scene, 'PulsarNova'),
    ).toBe(0);
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('never reuses the last orb on a rig: a new run starts clean', async () => {
    const scene = new THREE.Scene();
    const { world, entities } = worldWith(0);
    const fx = new HoardPulsarFx(
      scene,
      () => 0,
      world,
      undefined,
      CALM_OFF,
      undefined,
      'high',
      new THREE.Group(),
    );
    await fx.readyForEntry;
    entities.set(60, {
      id: 60,
      templateId: HOARD_PULSAR_TEMPLATE,
      dead: false,
      pos: { x: -7, y: 0, z: 2 },
      hp: 1,
      maxHp: 100,
      auras: [],
    });
    fx.sync(phase(6, 'beam'));
    fx.update(0.3);
    fx.sync([]); // killed: it is dying, its ring spreading
    fx.update(PULSAR_LOOK.deathSec * 0.4);
    expect(shown(scene, 'PulsarNova')).toBe(1);
    // The same cue ids in another hoard, before that death has played out.
    entities.delete(60);
    fx.sync(phase(0.2).map((entry) => ({ ...entry, instanceId: 2, x: entry.x + 200 })));
    fx.update(0.016);
    expect(shown(scene, 'PulsarNova')).toBe(0);
    expect(shown(scene, 'PulsarBeam')).toBe(0);
    const orbs = named(scene, 'PulsarOrb');
    expect(orbs[0].visible).toBe(true);
    // And it reads as a fresh, unwounded orb, not the corpse's last health.
    fx.sync([]);
    fx.update(0.016);
    expect(orbs[0].visible).toBe(false); // healthy and gone: silent
    fx.dispose();
  });

  it('costs nothing outside a rift floor: the boss is never looked for', async () => {
    const scene = new THREE.Scene();
    let scans = 0;
    const entities = new Map<number, unknown>();
    const counted = new Proxy(entities, {
      get(target, key) {
        if (key === 'values' || key === 'get') scans++;
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const world = { entities: counted, playerId: 1, riftFloor: null } as unknown as IWorld;
    const fx = new HoardPulsarFx(
      scene,
      () => 0,
      world,
      undefined,
      CALM_OFF,
      undefined,
      'high',
      new THREE.Group(),
    );
    await fx.readyForEntry;
    fx.sync([]);
    for (let i = 0; i < 600; i++) fx.update(0.016);
    expect(scans).toBe(0);
    expect(shown(scene, 'PulsarOrb')).toBe(0);
    fx.dispose();
  });

  it('puts the late Blender asset in place BEFORE the compile gate sees the root', async () => {
    const asset = new THREE.Group();
    for (const name of ['CoreEnergy', 'CoreJets', 'Fragment_01', 'Fragment_02', 'EnergyRing_A']) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          name: name.startsWith('Fragment') ? 'PulsarShell' : 'PulsarGlow',
        }),
      );
      mesh.name = name;
      mesh.position.set(name === 'Fragment_02' ? -1 : 1, 0, 0);
      asset.add(mesh);
    }
    let deliver: (value: THREE.Group) => void = () => {};
    const late = new Promise<THREE.Group>((resolve) => {
      deliver = resolve;
    });
    const seen: number[] = [];
    const scene = new THREE.Scene();
    const gate = async (root: THREE.Object3D) => {
      let boxes = 0;
      root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry.getAttribute('position').count === 24) boxes++;
      });
      seen.push(boxes);
    };
    const fx = new HoardPulsarFx(
      scene,
      () => 0,
      undefined,
      gate,
      CALM_OFF,
      undefined,
      'high',
      late,
    );
    expect(scene.children).toHaveLength(0);
    deliver(asset);
    await fx.readyForEntry;
    // Five parts on each of the three rigs, all baked in before the gate ran.
    expect(seen).toEqual([PULSARS.orbCountLegendary * 5]);
    expect(asset.children).toHaveLength(5); // the cached asset is never mutated
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('frees what it owns exactly once, and never the shared surface materials', async () => {
    const scene = new THREE.Scene();
    const fx = new HoardPulsarFx(
      scene,
      () => 0,
      undefined,
      undefined,
      CALM_OFF,
      undefined,
      'high',
      new THREE.Group(),
    );
    await fx.readyForEntry;
    const owned = new Map<string, number>();
    const shared = new Map<string, number>();
    const listening = new Set<string>();
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.geometry || !mesh.material) return;
      if (!listening.has(mesh.geometry.uuid)) {
        listening.add(mesh.geometry.uuid);
        mesh.geometry.addEventListener('dispose', () =>
          owned.set(mesh.geometry.uuid, (owned.get(mesh.geometry.uuid) ?? 0) + 1),
        );
      }
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (listening.has(material.uuid)) continue;
        listening.add(material.uuid);
        const lit =
          (material as THREE.MeshStandardMaterial).isMeshStandardMaterial ||
          (material as THREE.MeshLambertMaterial).isMeshLambertMaterial;
        const bucket = lit ? shared : owned;
        material.addEventListener('dispose', () =>
          bucket.set(material.uuid, (bucket.get(material.uuid) ?? 0) + 1),
        );
      }
    });
    fx.dispose();
    fx.dispose();
    expect(owned.size).toBeGreaterThan(20);
    expect([...owned.values()].every((count) => count === 1)).toBe(true);
    expect(shared.size).toBe(0);
  });

  it('on the low tier sheds the flourish and keeps everything a player acts on', async () => {
    const high = new THREE.Scene();
    const low = new THREE.Scene();
    const blank = () => new THREE.Group();
    const a = new HoardPulsarFx(
      high,
      () => 0,
      undefined,
      undefined,
      CALM_OFF,
      undefined,
      'high',
      blank(),
    );
    const b = new HoardPulsarFx(
      low,
      () => 0,
      undefined,
      undefined,
      CALM_OFF,
      undefined,
      'low',
      blank(),
    );
    await Promise.all([a.readyForEntry, b.readyForEntry]);
    const count = (scene: THREE.Scene, type: string) => {
      let n = 0;
      scene.traverse((node) => {
        if (node.type === type) n++;
      });
      return n;
    };
    expect(count(high, 'Points')).toBe(1);
    expect(count(low, 'Points')).toBe(0);
    expect(named(high, 'PulsarTrail')).toHaveLength(PULSARS.orbCountLegendary);
    expect(named(low, 'PulsarTrail')).toHaveLength(0);
    for (const scene of [high, low]) {
      expect(named(scene, 'PulsarOrb')).toHaveLength(PULSARS.orbCountLegendary);
      expect(named(scene, 'PulsarBeam')).toHaveLength(PULSARS.orbCountLegendary);
      expect(named(scene, 'PulsarLock')).toHaveLength(PULSARS.orbCountLegendary);
      expect(named(scene, 'PulsarLink')).toHaveLength(PULSARS.orbCountLegendary);
      expect(named(scene, 'PulsarWard')).toHaveLength(1);
    }
    a.dispose();
    b.dispose();
  });
});

describe('the shipped Blender orb', () => {
  it('exists, keeps the hierarchy the brief names, and is small', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    expect(ASSETS[0].target).toBe(`public${PULSAR_ASSET_URL}`);
    for (const asset of ASSETS) {
      expect(existsSync(asset.source), asset.source).toBe(true);
      expect(existsSync(asset.target), asset.target).toBe(true);
      const root = (await io.read(asset.target)).getRoot();
      expect(
        root
          .listNodes()
          .map((node) => node.getName())
          .sort(),
      ).toEqual(asset.nodes);
      expect((root.getExtras() as { authoring?: string }).authoring).toBe('Blender');
      expect(root.listTextures()).toHaveLength(0);
      expect(root.listAnimations()).toHaveLength(0);
      let triangles = 0;
      for (const mesh of root.listMeshes())
        for (const primitive of mesh.listPrimitives())
          triangles += (primitive.getIndices()?.getCount() ?? 0) / 3;
      expect(triangles).toBeLessThan(2000);
    }
    for (const part of ['Core', 'Shell', 'Details', 'VFXGeometry', 'BeamEmitter', 'ArcSegments']) {
      expect(ASSETS[0].nodes).toContain(part);
    }
  });

  it('the mob wears the nucleus, hovering where the station is drawn', () => {
    const visual = VISUALS.mob_bound_pulsar;
    expect(visual.url).toBe(ASSETS[1].target.replace(/^public\//, ''));
    // Its middle sits at the station height the effects are drawn round.
    expect((visual.hover ?? 0) + visual.height / 2).toBeCloseTo(PULSARS.stationHeight, 6);
    expect(HOARD_PULSAR_TEMPLATE).toBe('hoard_bound_pulsar');
  });
});
