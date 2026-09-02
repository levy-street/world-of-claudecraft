import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { tintedMaterial } from '../src/render/characters/assets';
import { VISUALS } from '../src/render/characters/manifest';
import { gfxInternalsForTest } from '../src/render/gfx';
import {
  advanceRollAngle,
  MOUNT_VISUAL_SPECS,
  mountBobY,
  mountRollStep,
  mountSeatLift,
  mountVisualSpec,
  riderPoseFlags,
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

  it('seats a sitting rider inside the body and stands a treading one on the crown', () => {
    for (const key of MOUNT_KEYS) {
      const spec = MOUNT_VISUAL_SPECS[key];
      const def = VISUALS[spec.visualKey];
      expect(spec.seat, `${key} seat`).toBeGreaterThan(0.5);
      if (spec.ridePose === 'sit') {
        // A saddle sits somewhere in the body, so the rider rides below the crown.
        expect(spec.seat, `${key} seat above its own crown`).toBeLessThan(def.height);
      } else {
        // A treading rider has no saddle: their feet are ON the crown, so the
        // seat is exactly the mount height and never a hair over it.
        expect(spec.seat, `${key} treads its crown`).toBe(def.height);
      }
    }
  });

  it('poses every rider seated except the boulder, which is treaded', () => {
    const treaded = MOUNT_KEYS.filter((key) => MOUNT_VISUAL_SPECS[key].ridePose === 'tread');
    expect(treaded).toEqual(['riftbound_boulder']);
    // Only a mount that rolls has a radius, and only a rolling one is treaded.
    for (const key of MOUNT_KEYS) {
      const spec = MOUNT_VISUAL_SPECS[key];
      expect(spec.rollRadius > 0, `${key} rolls`).toBe(spec.ridePose === 'tread');
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
      const converted = tintedMaterial(source, null, 0, null, null, 'body', null, 'rig', '');
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

  it('carries authored COLOR_0 on the tank, the rickshaw, the boulder, and the Valorsteed', () => {
    expect(mountUrls.length).toBeGreaterThanOrEqual(8);
    const withVertexColors = mountUrls.filter((url) => glbAttributes(url).has('COLOR_0'));
    // The boulder is textureless by design: its stone shading and its rift
    // seams are BOTH vertex colors, so a Low path that dropped COLOR_0 would
    // render it as a flat grey ball rather than merely a duller stone.
    expect(withVertexColors).toEqual([
      'models/mounts/rickshaw_mount.glb',
      'models/mounts/riftbound_boulder.glb',
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

  it('the boulder rolls instead of bobbing, and stands its rider on the crown', () => {
    const spec = MOUNT_VISUAL_SPECS.riftbound_boulder;
    const def = VISUALS.mount_riftbound_boulder;
    expect(spec).toMatchObject({
      visualKey: 'mount_riftbound_boulder',
      seat: 1.6,
      seatFwd: 0,
      rigged: false,
      bobAmp: 0,
      fx: null,
      ridePose: 'tread',
      rollRadius: 0.8,
      // A sphere has no nose to tip, so the vehicle jump attitude is off.
      jumpTips: false,
    });
    expect(def).toMatchObject({
      url: 'models/mounts/riftbound_boulder.glb',
      height: 1.6,
      // hover is not decoration here: it slides the origin-centred stone down
      // so the visual root's origin lands on the stone's own centre, which is
      // the only place a root rotation spins it in place instead of swinging
      // it around its contact point.
      hover: -0.8,
      lazyPreload: true,
    });
    expect(def.hover).toBe(-spec.rollRadius);
    // The seat is the top of the stone: two radii above the ground it rests on.
    expect(spec.seat).toBeCloseTo(spec.rollRadius * 2, 10);
    expect(mountBobY(spec, 0.7, true)).toBe(0);
    expect(mountBobY(spec, 0.7, false)).toBe(0);
  });

  it('pins the ambient particle effects: snail slime, hover-cycle exhaust', () => {
    expect(MOUNT_VISUAL_SPECS.stalkglider_snail.fx).toBe('slime');
    expect(MOUNT_VISUAL_SPECS.aether_hover_cycle.fx).toBe('exhaust');
    expect(MOUNT_VISUAL_SPECS.valorsteed.fx).toBeNull();
    expect(MOUNT_VISUAL_SPECS.stormfeather_griffin.fx).toBeNull();
    expect(MOUNT_VISUAL_SPECS.terrorspark_groundshaker.fx).toBeNull();
  });
});

describe('rider pose flags', () => {
  it('imposes nothing off a mount, and invents nothing for an unknown key', () => {
    const none = { sitting: false, treading: false, mayEmote: false };
    expect(riderPoseFlags('riftbound_boulder', false, false)).toEqual(none);
    expect(riderPoseFlags('', true, false)).toEqual(none);
    expect(riderPoseFlags('not_a_mount', true, false)).toEqual(none);
  });

  it('seats every saddle mount and treads the boulder', () => {
    expect(riderPoseFlags('valorsteed', true, false)).toEqual({
      sitting: true,
      treading: false,
      mayEmote: false,
    });
    expect(riderPoseFlags('rickshaw_mount', true, false)).toEqual({
      sitting: true,
      treading: false,
      mayEmote: false,
    });
    expect(riderPoseFlags('riftbound_boulder', true, false)).toEqual({
      sitting: false,
      treading: true,
      mayEmote: true,
    });
  });

  it('lets a treading rider emote, but only while the stone is stopped', () => {
    // Standing a rider up opens the overhead-emote gate as a side effect. That
    // is wanted for an upright body, and deliberately limited to stopped: the
    // rule lives here rather than in the emote gate own !moving term.
    expect(riderPoseFlags('riftbound_boulder', true, false, false).mayEmote).toBe(true);
    expect(riderPoseFlags('riftbound_boulder', true, false, true).mayEmote).toBe(false);
  });

  it('still seats a rider who is resting, mounted or not', () => {
    // Sitting, eating and drinking seat the body on their own; a mount that
    // treads must not un-seat someone who sat down, and a seated body loses
    // the standing-emote permission with the standing pose.
    expect(riderPoseFlags('', false, true).sitting).toBe(true);
    expect(riderPoseFlags('riftbound_boulder', true, true)).toEqual({
      sitting: true,
      treading: true,
      mayEmote: false,
    });
  });
});

describe('rolling mount math', () => {
  const boulder = MOUNT_VISUAL_SPECS.riftbound_boulder;

  it('never rolls a mount that has no radius', () => {
    expect(mountRollStep(MOUNT_VISUAL_SPECS.valorsteed, 3.4, 1.1)).toBe(0);
    expect(mountRollStep(MOUNT_VISUAL_SPECS.rickshaw_mount, 9, 0)).toBe(0);
  });

  it('turns travel into spin at omega = v / r', () => {
    // One radius of travel is exactly one radian of roll, by definition.
    expect(mountRollStep(boulder, boulder.rollRadius, 0)).toBeCloseTo(1, 10);
    // And the rate is really inverse in the radius, not merely proportional to
    // travel: half the stone spins twice as fast over the same ground.
    const half = { ...boulder, rollRadius: boulder.rollRadius / 2 };
    expect(mountRollStep(half, 0.4, 0)).toBeCloseTo(mountRollStep(boulder, 0.4, 0) * 2, 10);
  });

  it('rolls backward when the rider backs up', () => {
    const forward = mountRollStep(boulder, 0.5, 0);
    expect(mountRollStep(boulder, -0.5, 0)).toBeCloseTo(-forward, 10);
    expect(forward).toBeGreaterThan(0);
  });

  it('keeps rolling at the true ground rate under a strafe', () => {
    // A pure strafe still sweeps ground, so the stone still turns: holding it
    // still would read as skating, which is the failure this coupling exists
    // to prevent. The rate is the whole travel distance, not its forward part.
    expect(mountRollStep(boulder, 0.3, 0.4)).toBeCloseTo(0.5 / boulder.rollRadius, 10);
    expect(mountRollStep(boulder, 0, 0.5)).toBeCloseTo(0.5 / boulder.rollRadius, 10);
    // Standing still is the one case that must NOT turn it.
    expect(mountRollStep(boulder, 0, 0)).toBe(0);
  });

  it('wraps the accumulated angle into one turn, in both directions', () => {
    const TAU = Math.PI * 2;
    expect(advanceRollAngle(0, 0.25)).toBeCloseTo(0.25, 10);
    expect(advanceRollAngle(TAU - 0.1, 0.2)).toBeCloseTo(0.1, 10);
    expect(advanceRollAngle(0.1, -0.2)).toBeCloseTo(TAU - 0.1, 10);
    // A long ride must not accumulate an ever-growing angle: float precision
    // decays with magnitude and the stone would start to judder.
    let angle = 0;
    for (let step = 0; step < 5000; step++) angle = advanceRollAngle(angle, 0.9);
    expect(angle).toBeGreaterThanOrEqual(0);
    expect(angle).toBeLessThan(TAU);
  });
});
