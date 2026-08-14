import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { tintedMaterial } from '../src/render/characters/assets';
import { VISUALS } from '../src/render/characters/manifest';
import { gfxInternalsForTest } from '../src/render/gfx';
import {
  MOUNT_VISUAL_SPECS,
  mountBobY,
  mountSeatLift,
  mountVisualSpec,
} from '../src/render/mount_visuals';
import { MOUNT_KEYS } from '../src/sim/content/mounts';

describe('mount visual specs cover the sim catalog', () => {
  it('has a spec for every MountKey and nothing else', () => {
    expect(Object.keys(MOUNT_VISUAL_SPECS).sort()).toEqual([...MOUNT_KEYS].sort());
  });

  it('every spec points at a registered lazyPreload VisualDef', () => {
    for (const key of MOUNT_KEYS) {
      const spec = MOUNT_VISUAL_SPECS[key];
      const def = VISUALS[spec.visualKey];
      expect(def, `VISUALS[${spec.visualKey}] missing for mount ${key}`).toBeDefined();
      expect(def.lazyPreload, `${spec.visualKey} must be lazyPreload (never boot-swept)`).toBe(
        true,
      );
      expect(def.url).toBe(`models/mounts/${key}.glb`);
      // The mount never swings: the rider's one-shots carry mounted combat.
      expect(def.clips.attack).toEqual([]);
    }
  });

  it('seats sit inside a ridden mount, and exactly ON TOP of a stood-on one', () => {
    // Two different contracts, because there are now two ways to ride. A SEATED
    // rider is in a saddle, so their lift is strictly below the crown. A
    // STANDING rider (the rolling log and barrel) has their feet ON the crown,
    // so seat === height: below it would sink them into the mount, above it
    // would float them. Measured in game at the time of writing: log crown 2.90
    // against feet 2.90, barrel crown 2.97 against feet 3.00.
    for (const key of MOUNT_KEYS) {
      const spec = MOUNT_VISUAL_SPECS[key];
      const def = VISUALS[spec.visualKey];
      expect(spec.seat, `${key} seat`).toBeGreaterThan(0.5);
      if (spec.ridePose === 'standing') {
        expect(spec.seat, `${key} stands on its crown`).toBeCloseTo(def.height, 6);
      } else {
        expect(spec.seat, `${key} seat above its own crown`).toBeLessThan(def.height);
      }
    }
  });

  it('only the rolling mounts stand their rider, and only they carry a radius', () => {
    // The two flags must agree: a mount you stand on is one that rolls under
    // you, and rolling is what forces the backwards walk. A mount with one and
    // not the other is a half-built mount, not a style choice.
    const standing = MOUNT_KEYS.filter((k) => MOUNT_VISUAL_SPECS[k].ridePose === 'standing');
    const rolling = MOUNT_KEYS.filter((k) => MOUNT_VISUAL_SPECS[k].rollRadius > 0);
    expect(standing).toEqual(['rolling_log', 'tavern_barrel']);
    expect(rolling).toEqual(standing);
    // Each radius is half its own model height: the cylinder lies on its side,
    // so the model height IS its diameter. A radius that drifts from that makes
    // the roll skate, because omega = v / r no longer matches the ground.
    for (const key of rolling) {
      const spec = MOUNT_VISUAL_SPECS[key];
      expect(spec.rollRadius, `${key} radius is half its height`).toBeCloseTo(
        VISUALS[spec.visualKey].height / 2,
        6,
      );
    }
    // Everything else is seated and does not roll, the mine cart included: it
    // runs on wheels, so rolling the body would turn the tub and its rider.
    for (const key of MOUNT_KEYS.filter((k) => !standing.includes(k))) {
      expect(MOUNT_VISUAL_SPECS[key].ridePose, `${key} pose`).toBe('seated');
      expect(MOUNT_VISUAL_SPECS[key].rollRadius, `${key} radius`).toBe(0);
    }
  });

  it('resolves specs by sim mountKey and returns null/0 when dismounted', () => {
    expect(mountVisualSpec('valorsteed')?.visualKey).toBe('mount_valorsteed');
    expect(mountVisualSpec('')).toBeNull();
    expect(mountVisualSpec('not_a_mount')).toBeNull();
    expect(mountSeatLift('grag_bear')).toBeGreaterThan(0);
    expect(mountSeatLift('')).toBe(0);
  });

  it('preserves authored vertex colors when Low converts mount materials to Lambert', () => {
    const restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: false });
    try {
      const source = new THREE.MeshStandardMaterial({
        color: 0x8c65a7,
        vertexColors: true,
      });
      const converted = tintedMaterial(source, null, 0);
      expect(converted).toBeInstanceOf(THREE.MeshLambertMaterial);
      expect((converted as THREE.MeshLambertMaterial).vertexColors).toBe(true);
      expect((converted as THREE.MeshLambertMaterial).color.getHex()).not.toBe(0xffffff);
    } finally {
      restoreGfx();
    }
  });
});

// The Lambert conversion above changes what Low renders for EVERY GLB that ships
// authored COLOR_0, not just the mount that surfaced the bug. Pin that set so the
// blast radius stays written down: a mount re-exported with or without a baked
// vertex-color pass moves in or out of the fix, and the Highwatch stable horse
// rides along because it reuses the Valorsteed GLB.
describe('the Low vertex-color path covers every mount GLB that ships COLOR_0', () => {
  const REPO_ROOT = path.join(__dirname, '..');

  /** The attribute names declared across a GLB's mesh primitives. */
  function glbAttributes(url: string): Set<string> {
    const bytes = readFileSync(path.join(REPO_ROOT, 'public', url));
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      meshes?: { primitives?: { attributes: Record<string, number> }[] }[];
    };
    const attributes = new Set<string>();
    for (const mesh of json.meshes ?? []) {
      for (const primitive of mesh.primitives ?? []) {
        for (const name of Object.keys(primitive.attributes)) attributes.add(name);
      }
    }
    return attributes;
  }

  const mountUrls = [
    ...new Set(
      Object.values(VISUALS)
        .map((def) => def.url)
        .filter((url) => url.startsWith('models/mounts/')),
    ),
  ].sort();

  it('carries authored COLOR_0 on exactly the Terrorspark Groundshaker and the Valorsteed', () => {
    expect(mountUrls.length).toBeGreaterThanOrEqual(8);
    const withVertexColors = mountUrls.filter((url) => glbAttributes(url).has('COLOR_0'));
    expect(withVertexColors).toEqual([
      'models/mounts/terrorspark_groundshaker.glb',
      'models/mounts/valorsteed.glb',
    ]);
    // Not vacuous: every mount GLB is really parsed, and POSITION proves it.
    for (const url of mountUrls) expect(glbAttributes(url).has('POSITION'), url).toBe(true);
  });

  it('puts the ambient stable horse on the Valorsteed GLB, so Low moves it too', () => {
    expect(VISUALS.mob_stable_horse.url).toBe('models/mounts/valorsteed.glb');
    expect(VISUALS.mount_valorsteed.url).toBe('models/mounts/valorsteed.glb');
  });
});

describe('procedural bob math', () => {
  it('rigged mounts never bob (their clips carry the motion)', () => {
    const spec = MOUNT_VISUAL_SPECS.valorsteed;
    expect(mountBobY(spec, 0.37, true)).toBe(0);
    expect(mountBobY(spec, 1.9, false)).toBe(0);
  });

  it('the hover cycle floats even while standing, both directions', () => {
    const spec = MOUNT_VISUAL_SPECS.aether_hover_cycle;
    const at = (t: number) => mountBobY(spec, t, false);
    // quarter and three-quarter cycle of a 1.1 Hz sine: opposite signs
    const quarter = 0.25 / spec.bobHz;
    expect(at(quarter)).toBeCloseTo(spec.bobAmp, 5);
    expect(at(3 * quarter)).toBeCloseTo(-spec.bobAmp, 5);
  });

  it('the griffin is gait-rigged (its clips carry the motion, no bob)', () => {
    const spec = MOUNT_VISUAL_SPECS.stormfeather_griffin;
    expect(spec.rigged).toBe(true);
    expect(mountBobY(spec, 0.7, true)).toBe(0);
  });

  it('the gobbler is gait-rigged with the saddle over the hips (authored strut clips)', () => {
    const spec = MOUNT_VISUAL_SPECS.thunderstrut_gobbler;
    expect(spec.rigged).toBe(true);
    expect(spec.seat).toBe(2.05);
    expect(spec.seatFwd).toBe(-0.15);
    expect(spec.fx).toBeNull();
    expect(mountBobY(spec, 0.7, true)).toBe(0);
  });

  it('the tank is gait-rigged with a stable rear saddle and no procedural effect', () => {
    const spec = MOUNT_VISUAL_SPECS.terrorspark_groundshaker;
    const def = VISUALS.mount_terrorspark_groundshaker;
    expect(spec).toMatchObject({
      visualKey: 'mount_terrorspark_groundshaker',
      seat: 2.38,
      seatFwd: -0.3,
      rigged: true,
      bobAmp: 0,
      fx: null,
    });
    expect(def).toMatchObject({
      url: 'models/mounts/terrorspark_groundshaker.glb',
      height: 2.8,
      walkRef: 3,
      runRef: 4.4,
      lazyPreload: true,
    });
    expect(mountBobY(spec, 0.7, true)).toBe(0);
  });

  it('the snail glides flat (no bob at all)', () => {
    const spec = MOUNT_VISUAL_SPECS.stalkglider_snail;
    expect(mountBobY(spec, 0.5, true)).toBe(0);
  });

  it('pins the ambient particle effects: snail slime, hover-cycle exhaust', () => {
    expect(MOUNT_VISUAL_SPECS.stalkglider_snail.fx).toBe('slime');
    expect(MOUNT_VISUAL_SPECS.aether_hover_cycle.fx).toBe('exhaust');
    expect(MOUNT_VISUAL_SPECS.valorsteed.fx).toBeNull();
    expect(MOUNT_VISUAL_SPECS.stormfeather_griffin.fx).toBeNull();
    expect(MOUNT_VISUAL_SPECS.terrorspark_groundshaker.fx).toBeNull();
  });
});
