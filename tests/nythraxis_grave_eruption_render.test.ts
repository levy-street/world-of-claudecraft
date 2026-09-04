// Grave Eruption on the shared meteor-warning path: the fourth snapshot source,
// the grave read (no falling rock, green/violet telegraph, bone shards at
// impact), the school-keyed landing burst, and the encounter VFX specs.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  abilityVfxFullSpecFor,
  abilityVfxSpecFor,
} from '../src/render/ability_vfx/encounter_specs';
import {
  handleMageGroundSpellfxEvent,
  MageGroundFx,
  type MeteorFallSpawn,
} from '../src/render/mage_ground_fx';
import { meteorLandingBurst } from '../src/render/meteor_landing_burst';
import {
  isNythraxisGraveEruption,
  NYTHRAXIS_GRAVE_ERUPTION_PALETTE,
  NYTHRAXIS_GRAVE_SHARD_RISE_SECONDS,
  nythraxisGraveShardFade,
  nythraxisGraveShardPoseInto,
  nythraxisGraveShardRise,
} from '../src/render/nythraxis_grave_core';
import { NYTHRAXIS_BONE_SPIKE_CAST_ID } from '../src/sim/nythraxis_bone_spike';
import { NYTHRAXIS_DREAD_CURSE_CAST_ID } from '../src/sim/nythraxis_dread_curse';
import {
  type ActiveNythraxisGraveEruption,
  NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
  NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
  NYTHRAXIS_GRAVE_ERUPTION_REVEAL_DELAY_SECONDS,
  NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS,
  NYTHRAXIS_GRAVE_FLAME_CAST_ID,
} from '../src/sim/nythraxis_grave_eruption';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

const ERUPTION: ActiveNythraxisGraveEruption = {
  id: '42:ge:7:0',
  x: 3,
  z: 9,
  radius: NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
  duration: NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS,
  remaining: NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS,
  warningLead: NYTHRAXIS_GRAVE_ERUPTION_REVEAL_DELAY_SECONDS,
};

const FIRE_WARNING = {
  id: 'ignivar:1',
  x: 1,
  z: 2,
  radius: 2.4,
  duration: 2.5,
  remaining: 2,
  warningLead: 0.75,
};

const readSource = (path: string): string =>
  codeWithoutLineComments(readFileSync(new URL(path, import.meta.url), 'utf8'));

function meteorRoot(scene: THREE.Scene, persistentId: string): THREE.Group {
  return scene.children.find(
    (child) => child.userData.persistentMeteorId === persistentId,
  ) as THREE.Group;
}

function instanceScaleY(mesh: THREE.InstancedMesh, index: number): number {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  const scale = new THREE.Vector3();
  matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  return scale.y;
}

describe('Grave Eruption warning rings', () => {
  it('consumes activeNythraxisGraveEruptions as the fourth snapshot source', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 0, vi.fn());
    fx.syncWorldMeteorWarnings({
      activeIgnivarMeteors: [FIRE_WARNING],
      activeVarkhulAnvilMeteors: [],
      activeVarkhulForgestormWarnings: [],
      activeNythraxisGraveEruptions: [ERUPTION],
    });
    expect(scene.children.filter((child) => child.name === 'mage-meteor-fx')).toHaveLength(2);
    const grave = meteorRoot(scene, ERUPTION.id);
    expect(grave.userData.graveEruption).toBe(true);
    expect(meteorRoot(scene, FIRE_WARNING.id).userData.graveEruption).toBe(false);

    // Snapshot reconciliation removes it with its row, like every other source.
    fx.syncWorldMeteorWarnings({
      activeIgnivarMeteors: [FIRE_WARNING],
      activeVarkhulAnvilMeteors: [],
      activeVarkhulForgestormWarnings: [],
      activeNythraxisGraveEruptions: [],
    });
    expect(meteorRoot(scene, ERUPTION.id)).toBeUndefined();
    expect(meteorRoot(scene, FIRE_WARNING.id)).toBeDefined();

    const renderer = readSource('../src/render/renderer.ts');
    expect(
      renderer.match(/this\.mageGroundFx\.syncWorldMeteorWarnings\(this\.sim\);/g),
    ).toHaveLength(2);
  });

  it('keeps the meteor ring geometry but never drops a rock: the ground is the threat', () => {
    const scene = new THREE.Scene();
    const fx = new MageGroundFx(scene, () => 0, vi.fn());
    fx.syncWorldMeteorWarnings({
      activeIgnivarMeteors: [],
      activeVarkhulAnvilMeteors: [],
      activeVarkhulForgestormWarnings: [],
      activeNythraxisGraveEruptions: [ERUPTION],
    });
    const grave = meteorRoot(scene, ERUPTION.id);
    const boundary = grave.getObjectByName('mage-meteor-telegraph-boundary') as THREE.LineLoop;
    const countdown = grave.getObjectByName('mage-meteor-telegraph-countdown-ring') as THREE.Mesh;
    // The actionable ring: the exact authored radius, on the ground.
    const positions = boundary.geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index++) {
      expect(
        Math.hypot(positions.getX(index) - ERUPTION.x, positions.getZ(index) - ERUPTION.z),
      ).toBeCloseTo(ERUPTION.radius, 5);
    }
    expect(countdown.visible).toBe(true);
    // The grave palette, on every telegraph material.
    expect((boundary.material as THREE.LineBasicMaterial).color.getHex()).toBe(
      NYTHRAXIS_GRAVE_ERUPTION_PALETTE.boundary,
    );
    expect((countdown.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      NYTHRAXIS_GRAVE_ERUPTION_PALETTE.countdown,
    );
    const veins = grave.getObjectByName('mage-meteor-telegraph-veins') as THREE.LineSegments;
    expect(veins.visible).toBe(true);
    expect((veins.material as THREE.LineBasicMaterial).color.getHex()).toBe(
      NYTHRAXIS_GRAVE_ERUPTION_PALETTE.vein,
    );
    const footprint = grave.getObjectByName('mage-meteor-telegraph-footprint') as THREE.Mesh;
    expect(footprint.visible).toBe(true);
    expect((footprint.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      NYTHRAXIS_GRAVE_ERUPTION_PALETTE.footprint,
    );
    // No Ignivar fire disc, no rim flames during the warning, no falling body
    // even once the reveal delay passes.
    expect(scene.getObjectByName('ground_fire_aoe')).toBeUndefined();
    expect(grave.getObjectByName('mage-meteor-telegraph-flames')?.visible).toBe(false);
    fx.update(NYTHRAXIS_GRAVE_ERUPTION_REVEAL_DELAY_SECONDS + 0.5);
    expect(grave.getObjectByName('mage-meteor-body')?.visible).toBe(false);
    expect(grave.getObjectByName('mage-meteor-trail')?.visible).toBe(false);

    // A fire warning on the same painter is untouched: body revealed after its lead.
    fx.syncMeteorWarnings([FIRE_WARNING]);
    fx.update(1);
    const fire = meteorRoot(scene, FIRE_WARNING.id);
    expect(fire.getObjectByName('mage-meteor-body')?.visible).toBe(true);
    expect(fire.getObjectByName('mage-meteor-trail')?.visible).toBe(true);
    expect(scene.getObjectByName('ground_fire_aoe')).toBeDefined();
  });

  it('erupts a rising bone-shard cluster at the authoritative impact, then fades it', () => {
    const scene = new THREE.Scene();
    const landed = vi.fn();
    const fx = new MageGroundFx(scene, () => 0, landed);
    fx.syncWorldMeteorWarnings({
      activeIgnivarMeteors: [],
      activeVarkhulAnvilMeteors: [],
      activeVarkhulForgestormWarnings: [],
      activeNythraxisGraveEruptions: [ERUPTION],
    });
    const grave = meteorRoot(scene, ERUPTION.id);
    const shards = grave.getObjectByName('mage-meteor-telegraph-flames') as THREE.InstancedMesh;
    const shardMaterial = shards.material as THREE.MeshBasicMaterial;
    expect(shardMaterial.color.getHex()).toBe(NYTHRAXIS_GRAVE_ERUPTION_PALETTE.shard);

    fx.impactMeteor(ERUPTION.id, ERUPTION.x, ERUPTION.z);
    expect(shards.visible).toBe(true);
    expect(shardMaterial.opacity).toBeGreaterThan(0.8);
    // The landing callback carries the eruption's own cue identity.
    expect(landed).toHaveBeenCalledOnce();
    const spawn = landed.mock.calls[0][2] as MeteorFallSpawn;
    expect(spawn.ability).toBe(NYTHRAXIS_GRAVE_ERUPTION_CAST_ID);
    expect(spawn.school).toBe('shadow');
    // Rising: barely out of the ground at the impact, full height shortly after.
    const atImpact = instanceScaleY(shards, 0);
    expect(atImpact).toBeLessThan(0.05);
    fx.update(NYTHRAXIS_GRAVE_SHARD_RISE_SECONDS);
    const risen = instanceScaleY(shards, 0);
    expect(risen).toBeGreaterThan(1);
    // Every shard stands inside the circle.
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    for (let index = 0; index < shards.count; index++) {
      shards.getMatrixAt(index, matrix);
      position.setFromMatrixPosition(matrix);
      expect(Math.hypot(position.x - ERUPTION.x, position.z - ERUPTION.z)).toBeLessThan(
        ERUPTION.radius,
      );
      expect(position.y).toBeGreaterThan(0);
    }
    // Then the cluster fades with the scorch and the whole visual retires.
    fx.update(1.6);
    expect(shardMaterial.opacity).toBeLessThan(0.5);
    fx.update(1);
    expect(meteorRoot(scene, ERUPTION.id)).toBeUndefined();
  });

  it('samples shard ground once and stops uploading matrices after the final rise pose', () => {
    const scene = new THREE.Scene();
    const groundY = vi.fn((x: number, z: number) => x * 0.01 + z * 0.02);
    const fx = new MageGroundFx(scene, groundY, vi.fn());
    fx.syncWorldMeteorWarnings({
      activeIgnivarMeteors: [],
      activeVarkhulAnvilMeteors: [],
      activeVarkhulForgestormWarnings: [],
      activeNythraxisGraveEruptions: [ERUPTION],
    });
    const grave = meteorRoot(scene, ERUPTION.id);
    const shards = grave.getObjectByName('mage-meteor-telegraph-flames') as THREE.InstancedMesh;
    const shardMaterial = shards.material as THREE.MeshBasicMaterial;
    const samplesBeforeImpact = groundY.mock.calls.length;

    fx.impactMeteor(ERUPTION.id, ERUPTION.x, ERUPTION.z);
    expect(groundY).toHaveBeenCalledTimes(samplesBeforeImpact + shards.count);
    const landingSamples = groundY.mock.calls.slice(samplesBeforeImpact);
    const samplesAtLanding = groundY.mock.calls.length;
    fx.update(NYTHRAXIS_GRAVE_SHARD_RISE_SECONDS + 0.01);
    expect(groundY).toHaveBeenCalledTimes(samplesAtLanding);

    const finalMatrix = new THREE.Matrix4();
    const finalPosition = new THREE.Vector3();
    for (let shardIndex = 0; shardIndex < shards.count; shardIndex++) {
      shards.getMatrixAt(shardIndex, finalMatrix);
      finalPosition.setFromMatrixPosition(finalMatrix);
      expect(landingSamples[shardIndex][0]).toBeCloseTo(finalPosition.x, 5);
      expect(landingSamples[shardIndex][1]).toBeCloseTo(finalPosition.z, 5);
    }

    const risenBytes = new Uint8Array(
      shards.instanceMatrix.array.buffer,
      shards.instanceMatrix.array.byteOffset,
      shards.instanceMatrix.array.byteLength,
    ).slice();
    const matrixVersionAtFullRise = shards.instanceMatrix.version;
    const opacityAtFullRise = shardMaterial.opacity;
    for (let frame = 0; frame < 4; frame++) fx.update(0.4);
    const tailBytes = new Uint8Array(
      shards.instanceMatrix.array.buffer,
      shards.instanceMatrix.array.byteOffset,
      shards.instanceMatrix.array.byteLength,
    );
    expect(tailBytes).toEqual(risenBytes);
    expect(shards.instanceMatrix.version).toBe(matrixVersionAtFullRise);
    expect(groundY).toHaveBeenCalledTimes(samplesAtLanding);
    expect(shardMaterial.opacity).toBeLessThan(opacityAtFullRise);
  });

  it('spawns the grave read from the live spellfxAt cue and lands its school', () => {
    const scene = new THREE.Scene();
    const landed = vi.fn();
    const fx = new MageGroundFx(scene, () => 0, landed);
    const persistentId = '42:ge:9:1';
    expect(
      handleMageGroundSpellfxEvent(fx, {
        fx: 'meteorFall',
        x: 4,
        z: 4,
        school: 'shadow',
        ability: NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
        radius: NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
        duration: NYTHRAXIS_GRAVE_ERUPTION_TELEGRAPH_SECONDS,
        warningLead: NYTHRAXIS_GRAVE_ERUPTION_REVEAL_DELAY_SECONDS,
        persistentId,
        sourceId: 42,
      }),
    ).toBe(true);
    expect(meteorRoot(scene, persistentId).userData.graveEruption).toBe(true);

    // The live cue names no school (the legacy spawn shape is pinned), so the
    // grave flavour derives shadow from its cast id for the landing burst.
    expect(
      handleMageGroundSpellfxEvent(fx, {
        fx: 'meteorImpact',
        x: 4,
        z: 4,
        school: 'shadow',
        ability: NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
        persistentId,
        sourceId: 42,
      }),
    ).toBe(true);
    expect(landed).toHaveBeenCalledOnce();
    const spawn = landed.mock.calls[0][2] as MeteorFallSpawn;
    expect(spawn.school).toBe('shadow');
    expect(spawn.ability).toBe(NYTHRAXIS_GRAVE_ERUPTION_CAST_ID);

    // An impact whose warning this client never saw lands the legacy way (no
    // cue to hand over), exactly as every other meteor does.
    expect(
      handleMageGroundSpellfxEvent(fx, {
        fx: 'meteorImpact',
        x: 8,
        z: 8,
        school: 'shadow',
        ability: NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
        persistentId: '42:ge:9:3',
        sourceId: 42,
      }),
    ).toBe(true);
    expect(landed).toHaveBeenCalledTimes(2);
    expect(landed).toHaveBeenLastCalledWith(8, 8);
  });

  it('lands a bare snapshot fire warning the legacy way and a cue-bearing one with its cue', () => {
    const scene = new THREE.Scene();
    const landed = vi.fn();
    const fx = new MageGroundFx(scene, () => 0, landed);
    fx.syncMeteorWarnings([FIRE_WARNING]);
    fx.impactMeteor(FIRE_WARNING.id, FIRE_WARNING.x, FIRE_WARNING.z);
    expect(landed).toHaveBeenLastCalledWith(FIRE_WARNING.x, FIRE_WARNING.z);
    fx.spawnMeteor({
      x: 5,
      z: 5,
      radius: 2.4,
      duration: 2.5,
      ability: 'Falling Cinders',
      persistentId: 'cinders:1',
    });
    fx.impactMeteor('cinders:1', 5, 5);
    expect(landed).toHaveBeenLastCalledWith(
      5,
      5,
      expect.objectContaining({ ability: 'Falling Cinders' }),
    );
    // A fire cue derives no school of its own: the landing keeps its fire default.
    const cinders = landed.mock.calls[landed.mock.calls.length - 1][2] as MeteorFallSpawn;
    expect(cinders.school).toBeUndefined();
  });
});

describe('meteor landing burst routing', () => {
  const burst = () => vi.fn();
  it('detonates through the spec painter in the cue school when it claims the landing', () => {
    const handleSpellfxAt = vi.fn(() => true);
    const vfx = { burst: burst() };
    const arm = meteorLandingBurst({ handleSpellfxAt }, vfx, 1, 2, 3, {
      x: 2,
      z: 3,
      radius: 3,
      duration: 2.5,
      ability: NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
      school: 'shadow',
      sourceId: 42,
    });
    expect(arm).toBe('spec');
    expect(handleSpellfxAt).toHaveBeenCalledWith({
      x: 2,
      z: 3,
      school: 'shadow',
      fx: 'nova',
      radius: 3,
      sourceId: 42,
      ability: NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
    });
    expect(vfx.burst).not.toHaveBeenCalled();
  });

  it('falls back to the pooled burst in the spawn school, fire when none is authored', () => {
    const handleSpellfxAt = vi.fn(() => false);
    const vfx = { burst: burst() };
    expect(
      meteorLandingBurst({ handleSpellfxAt }, vfx, 1, 2, 3, {
        x: 2,
        z: 3,
        radius: 3,
        duration: 2.5,
        ability: 'Falling Cinders',
        school: 'fire',
      }),
    ).toBe('burst');
    expect(vfx.burst).toHaveBeenLastCalledWith(expect.any(THREE.Vector3), 'fire', 34, 1.4);
    expect(meteorLandingBurst({ handleSpellfxAt }, vfx, 1, 2, 3)).toBe('burst');
    expect(vfx.burst).toHaveBeenLastCalledWith(expect.any(THREE.Vector3), 'fire', 34, 1.4);
    expect(handleSpellfxAt).toHaveBeenCalledOnce();
    expect(
      meteorLandingBurst({ handleSpellfxAt }, vfx, 1, 2, 3, {
        x: 2,
        z: 3,
        radius: 3,
        duration: 2.5,
        school: 'shadow',
      }),
    ).toBe('burst');
    expect(vfx.burst).toHaveBeenLastCalledWith(expect.any(THREE.Vector3), 'shadow', 34, 1.4);
    const renderer = readSource('../src/render/renderer.ts');
    expect(renderer).toContain(
      'meteorLandingBurst(this.abilityVfx, this.vfx, this.sim.cfg.seed, x, z, meteor)',
    );
  });
});

describe('Nythraxis grave eruption core', () => {
  it('keys the grave flavour on the eruption cast id alone', () => {
    expect(isNythraxisGraveEruption(NYTHRAXIS_GRAVE_ERUPTION_CAST_ID)).toBe(true);
    expect(isNythraxisGraveEruption('Falling Cinders')).toBe(false);
    expect(isNythraxisGraveEruption(undefined)).toBe(false);
  });

  it('rises within the rise window, fades over the tail, and stays inside the circle', () => {
    expect(nythraxisGraveShardRise(0)).toBe(0);
    expect(nythraxisGraveShardRise(NYTHRAXIS_GRAVE_SHARD_RISE_SECONDS / 2)).toBeCloseTo(0.5);
    expect(nythraxisGraveShardRise(9)).toBe(1);
    expect(nythraxisGraveShardFade(0, 2.2)).toBe(1);
    expect(nythraxisGraveShardFade(1.32, 2.2)).toBeCloseTo(1, 5);
    expect(nythraxisGraveShardFade(2.2, 2.2)).toBe(0);
    const pose = { dx: 0, dz: 0, y: 0, width: 1, height: 1, yaw: 0, leanX: 0, leanZ: 0 };
    for (let index = 0; index < 18; index++) {
      nythraxisGraveShardPoseInto(pose, index, 18, 3, 1, 0.45);
      expect(Math.hypot(pose.dx, pose.dz)).toBeLessThan(3);
      expect(pose.height).toBeGreaterThan(0.5);
      expect(pose.y).toBeCloseTo(0.45 * pose.height, 9);
    }
    nythraxisGraveShardPoseInto(pose, 0, 18, 3, 0, 0.45);
    expect(pose.height).toBeLessThan(0.01);
  });
});

describe('Nythraxis encounter VFX specs', () => {
  it('registers every Nythraxis damage ability as a shadow-school look', () => {
    for (const ability of [
      NYTHRAXIS_BONE_SPIKE_CAST_ID,
      NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
      NYTHRAXIS_GRAVE_FLAME_CAST_ID,
      NYTHRAXIS_DREAD_CURSE_CAST_ID,
    ]) {
      const spec = abilityVfxSpecFor(ability);
      expect(spec, ability).toBeDefined();
      expect(spec?.p, ability).toBe('shadow');
      const full = abilityVfxFullSpecFor(ability);
      expect(full, ability).toBeDefined();
      expect(full?.palette, ability).toBe('shadow');
    }
    expect(abilityVfxFullSpecFor(NYTHRAXIS_BONE_SPIKE_CAST_ID)).toMatchObject({
      archetype: 'burst',
      burst: { style: 'ground' },
      impact: { focused: true },
    });
    expect(abilityVfxFullSpecFor(NYTHRAXIS_GRAVE_ERUPTION_CAST_ID)).toMatchObject({
      archetype: 'burst',
      motifR: NYTHRAXIS_GRAVE_ERUPTION_RADIUS,
      burst: { style: 'ground' },
    });
    expect(abilityVfxFullSpecFor(NYTHRAXIS_GRAVE_FLAME_CAST_ID)).toMatchObject({
      archetype: 'dot',
      filler: true,
    });
    expect(abilityVfxFullSpecFor(NYTHRAXIS_DREAD_CURSE_CAST_ID)).toMatchObject({
      archetype: 'dot',
      motifs: ['chains'],
    });
  });
});
