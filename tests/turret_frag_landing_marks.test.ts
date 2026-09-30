import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { syncGroundAimReticleFrame } from '../src/game/pad_ground_aim_wiring';
import { GroundAimReticleVisual } from '../src/render/ground_aim_reticle_visual';
import { clampTurretAimInto, createTurretDefense } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { TURRET_BOMBLETS, turretFragBomblets } from '../src/sim/minigames/turret_fragmentation';
import { turretSessionView } from '../src/sim/turret_defense_session';
import type { TurretSession } from '../src/sim/types';
import { GroundAimController } from '../src/ui/hud/action_bar/ground_aim_controller';
import { TurretAimCore } from '../src/ui/hud/vehicle/turret_aim_core';
import { TurretOwnShotLedger } from '../src/ui/hud/vehicle/turret_own_shot_core';
import type { TurretSessionView } from '../src/world_api/vehicles';

const CENTER = { x: 10, z: 20 };
const START = 100;

function waveSeat(): TurretSession {
  const session: TurretSession = {
    kind: 'turret',
    origin: { x: CENTER.x, y: 0, z: CENTER.z },
    defense: createTurretDefense(resolveTurretPlan(), CENTER, 7, START),
    priorMountKey: '',
    returnTo: { x: 0, y: 0, z: 0, facing: 0 },
    feedback: [],
    nextFeedbackSeq: 1,
  };
  session.defense.phase = 'wave';
  session.defense.rev++;
  return session;
}

function rig() {
  const world = {
    turretSession: turretSessionView(waveSeat()) as TurretSessionView | null,
    turretClock: START as number | null,
    useVehicleAction: vi.fn(),
  };
  return { world, aim: new TurretAimCore(world, new TurretOwnShotLedger()) };
}

/** The sim's star for a raw aim: the engine's clamp, then its bomblet star at that bearing. */
function simStar(x: number, z: number) {
  const clamp = { x: 0, z: 0, dirX: 0, dirZ: 1, range: 0 };
  clampTurretAimInto(CENTER.x, CENTER.z, 0, 1, x, z, clamp);
  return turretFragBomblets(clamp.x, clamp.z, clamp.dirX, clamp.dirZ, 0).map(({ x, z }) => ({
    x,
    z,
  }));
}

describe('the armed fragmentation reticle carries the bomblet star', () => {
  it('equals the sim star for every bearing, exactly', () => {
    const { aim } = rig();
    aim.toggleFrag();
    for (let k = 0; k < 16; k++) {
      const bearing = (k / 16) * Math.PI * 2 + 0.1;
      const raw = {
        x: CENTER.x + Math.sin(bearing) * 23,
        z: CENTER.z + Math.cos(bearing) * 23,
      };
      aim.updatePoint(raw);
      const landing = aim.reticle()?.landing;
      expect(landing).toHaveLength(TURRET_BOMBLETS);
      expect(landing?.map(({ x, z }) => ({ x, z }))).toEqual(simStar(raw.x, raw.z));
      // The burst derives its bearing from the aimed point, not the raw one.
      const star = landing ?? [];
      const dx = star[0].x - CENTER.x;
      const dz = star[0].z - CENTER.z;
      const burst = turretFragBomblets(
        star[0].x,
        star[0].z,
        dx / Math.hypot(dx, dz),
        dz / Math.hypot(dx, dz),
        0,
      );
      for (let i = 0; i < burst.length; i++) {
        expect(star[i].x).toBeCloseTo(burst[i].x, 9);
        expect(star[i].z).toBeCloseTo(burst[i].z, 9);
      }
    }
  });

  it('carries nothing unarmed, after disarming, after firing, or past the seat', () => {
    const { world, aim } = rig();
    aim.updatePoint({ x: CENTER.x + 20, z: CENTER.z });
    expect(aim.reticle()?.landing ?? null).toBeNull();
    aim.toggleFrag();
    expect(aim.reticle()?.landing).toHaveLength(TURRET_BOMBLETS);
    aim.cancel();
    expect(aim.reticle()?.landing ?? null).toBeNull();
    aim.toggleFrag();
    expect(aim.commitAt()).toBe(true);
    expect(world.useVehicleAction).toHaveBeenLastCalledWith('turret_frag', expect.anything());
    expect(aim.reticle()?.landing ?? null).toBeNull();
    world.turretSession = null;
    expect(aim.reticle()).toBeNull();
  });

  it('writes the star into the same storage every frame', () => {
    const { aim } = rig();
    aim.toggleFrag();
    aim.updatePoint({ x: CENTER.x + 20, z: CENTER.z });
    const first = aim.reticle();
    const firstLanding = first?.landing;
    const firstPoint = firstLanding?.[3];
    aim.updatePoint({ x: CENTER.x, z: CENTER.z - 25 });
    const second = aim.reticle();
    expect(second).toBe(first);
    expect(second?.landing).toBe(firstLanding);
    expect(second?.landing?.[3]).toBe(firstPoint);
    expect(aim.fragLandingPoints()).toBe(firstLanding);
  });

  it('never carries a star for an ability ground aim', () => {
    const controller = new GroundAimController({
      player: () => ({ pos: { x: 0, y: 0, z: 0 }, facing: 0 }),
      resolveAbility: () => ({
        def: { id: 'blizzard', range: 30, school: 'frost' },
        effects: [],
      }),
      seedTargetPoint: () => null,
      fallbackPoint: () => ({ x: 0, z: 0 }),
      castAt: vi.fn(),
      clearReticle: vi.fn(),
    });
    controller.begin('blizzard', 1);
    controller.updatePoint({ x: 0, z: 10 });
    expect(controller.reticle()).not.toBeNull();
    expect(controller.reticle()?.landing ?? null).toBeNull();
  });

  it('rides the per-frame sync to the renderer by reference', () => {
    const landing = [{ x: 1, z: 2 }];
    const setReticle = vi.fn();
    syncGroundAimReticleFrame({
      hud: {
        isGroundAimActive: () => true,
        cancelGroundAim: () => false,
        groundAimAbilityRange: () => 30,
        nudgeGroundAimPoint: vi.fn(),
        updateGroundAimPoint: vi.fn(),
        commitGroundAimAt: () => true,
        groundAimReticle: () => ({
          point: { x: 1, z: 2 },
          radius: 8,
          school: 'fire',
          dimmed: false,
          blocked: false,
          landing,
        }),
      },
      isMobileTouch: () => true,
      cursorPoint: () => null,
      groundPoint: () => null,
      setReticle,
    });
    expect(setReticle.mock.calls[0][0].landing).toBe(landing);
  });
});

describe('the reticle visual draws the landing marks', () => {
  const star = turretFragBomblets(40, 50, 0.6, 0.8, 0).map(({ x, z }) => ({ x, z }));
  const aim = { x: 40, z: 50, radius: 8, color: 0xff5a16, dimmed: false };

  function build(heightAt: (x: number, z: number) => number = () => 1) {
    const scene = new THREE.Scene();
    const visual = new GroundAimReticleVisual(scene, heightAt);
    const root = scene.getObjectByName('ground-aim-reticle') as THREE.Group;
    const lines = root.getObjectByName('ground-aim-landing-marks') as THREE.LineSegments;
    const discs = root.getObjectByName('ground-aim-landing-discs') as THREE.Mesh;
    return { scene, visual, root, lines, discs };
  }

  it('prepares the marks with the reticle, on its own materials', () => {
    const { root, lines, discs } = build();
    expect(lines).toBeInstanceOf(THREE.LineSegments);
    expect(discs).toBeInstanceOf(THREE.Mesh);
    expect(lines.visible).toBe(false);
    expect(discs.visible).toBe(false);
    const ticks = root.getObjectByName('ground-aim-ticks') as THREE.LineSegments;
    const band = root.getObjectByName('ground-aim-band') as THREE.Mesh;
    expect(lines.material).toBe(ticks.material);
    expect(discs.material).toBe(band.material);
  });

  it('draws one draped mark per bomblet while armed, and none after', () => {
    const heightAt = (x: number, z: number) => Math.sin(x * 0.3) + Math.cos(z * 0.2);
    const { visual, lines, discs } = build(heightAt);
    visual.setAim({ ...aim, landing: star });
    expect(lines.visible).toBe(true);
    expect(discs.visible).toBe(true);
    const lineCount = lines.geometry.drawRange.count;
    const perMark = lineCount / TURRET_BOMBLETS;
    expect(Number.isInteger(perMark)).toBe(true);
    expect(discs.geometry.drawRange.count % TURRET_BOMBLETS).toBe(0);
    const positions = lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let m = 0; m < TURRET_BOMBLETS; m++) {
      let sx = 0;
      let sz = 0;
      for (let v = 0; v < perMark; v++) {
        const i = m * perMark + v;
        const x = positions.getX(i);
        const z = positions.getZ(i);
        expect(Math.hypot(x - star[m].x, z - star[m].z)).toBeLessThan(1);
        expect(positions.getY(i)).toBeGreaterThan(heightAt(x, z));
        sx += x;
        sz += z;
      }
      expect(sx / perMark).toBeCloseTo(star[m].x, 4);
      expect(sz / perMark).toBeCloseTo(star[m].z, 4);
    }
    visual.setAim(aim);
    expect(lines.visible).toBe(false);
    expect(discs.visible).toBe(false);
    visual.setAim({ ...aim, landing: star });
    visual.setAim(null);
    expect(lines.visible).toBe(false);
  });

  it('rewrites the marks only when a bomblet point moves', () => {
    let samples = 0;
    const { visual, lines } = build(() => {
      samples++;
      return 0;
    });
    const landing = star.map((p) => ({ ...p }));
    visual.setAim({ ...aim, landing });
    const positions = lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const version = positions.version;
    const before = samples;
    visual.setAim({ ...aim, landing, dimmed: true });
    expect(samples).toBe(before);
    expect(positions.version).toBe(version);
    landing[2].x += 0.5;
    visual.setAim({ ...aim, landing });
    expect(positions.version).toBe(version + 1);
    expect(samples).toBeGreaterThan(before);
  });

  it('samples each ground point of the marks once per rewrite', () => {
    const sampled: string[] = [];
    const { visual } = build((x, z) => {
      sampled.push(`${x},${z}`);
      return 0;
    });
    visual.setAim({ ...aim, landing: star });
    sampled.length = 0;
    // Same reticle centre and radius: only the marks resample the ground.
    visual.setAim({ ...aim, landing: star.map((p) => ({ x: p.x + 0.25, z: p.z })) });
    expect(sampled.length).toBeGreaterThan(0);
    expect(new Set(sampled).size).toBe(sampled.length);
  });
});
