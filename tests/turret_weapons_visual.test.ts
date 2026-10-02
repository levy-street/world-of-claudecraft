// Fire and Fly's limited weapons painter over a real cannon draw and tower: the
// slam's hop, chips and camera kick, the front timed on the display tick, the
// cracked mark, the frag's burst and bomblets, and the pools that hold a frag
// landing in a keg chain.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  CANNON_AIRBURST,
  CANNON_BOMBLET,
  cannonBombletBlastId,
} from '../src/render/cannon_frag_core';
import { PUFF } from '../src/render/cannon_puff_core';
import { CANNON_BLAST } from '../src/render/cannon_shell_core';
import { type CannonShellHost, CannonShellVisuals } from '../src/render/cannon_shell_visuals';
import {
  TURRET_CONTACT_BURSTS,
  TURRET_CONTACT_PUFFS,
} from '../src/render/turret_contact_dust_core';
import { TURRET_TICK_LATE_MAX, TURRET_TICK_LEAD_MAX } from '../src/render/turret_monster_pose_core';
import {
  TURRET_SHOCKWAVE_FRONT_LIFE,
  TURRET_SHOCKWAVE_LOOK,
  turretShockwaveCounts,
} from '../src/render/turret_shockwave_core';
import { TurretTowerVisual } from '../src/render/turret_tower_visual';
import {
  TURRET_WEAPON_BOMBLETS,
  TURRET_WEAPON_FRAGS,
  TURRET_WEAPON_IMPACTS,
  TURRET_WEAPON_LINGERING_FRAGS,
  TurretWeaponsVisual,
  turretBombletBlast,
  turretShockwaveBursts,
} from '../src/render/turret_weapons_visual';
import {
  FIRE_AND_FLY_MAX_KEG_CAP,
  FIRE_AND_FLY_SCENARIOS,
} from '../src/sim/content/fire_and_fly_scenarios';
import { TURRET_FRAGMENTATION, TURRET_WEAPON } from '../src/sim/content/turret_defense';
import { resolveTurretPlan, turretChargesGiven } from '../src/sim/minigames/turret_defense_plan';
import {
  burstTurretFrag,
  TURRET_BOMBLETS,
  turretFragBomblets,
} from '../src/sim/minigames/turret_fragmentation';
import { DT } from '../src/sim/types';

const flat = { ground: () => 0, water: () => null };

/** The most fragmentation shells any scenario's run holds, its resupplies included. */
function mostFragsHeld(): number {
  return Math.max(
    ...FIRE_AND_FLY_SCENARIOS.map((scenario) => {
      const plan = resolveTurretPlan(scenario);
      return turretChargesGiven(plan, plan.resupplyWaves.length).fragmentation;
    }),
  );
}

function hostStub() {
  const host = {
    vfx: { burst: vi.fn() },
    camera: new THREE.PerspectiveCamera(),
    addShake: vi.fn(),
    punchFov: vi.fn(),
  };
  return host as typeof host & CannonShellHost;
}

function rig(tier: 'low' | 'high' = 'high') {
  const weapon = new CannonShellVisuals({
    blastRadius: 6,
    groundAt: () => 0,
    effectsTier: tier,
    bursts: {
      slots: TURRET_CONTACT_BURSTS + turretShockwaveBursts(TURRET_CONTACT_PUFFS),
      puffs: TURRET_CONTACT_PUFFS,
    },
    impacts: TURRET_WEAPON_IMPACTS,
    bomblets: TURRET_WEAPON_BOMBLETS,
    holdTicks: 4,
  });
  weapon.prepare(new THREE.Scene());
  const tower = new TurretTowerVisual(undefined, () => new Promise(() => {}));
  const slam = vi.spyOn(tower, 'slam');
  const weapons = new TurretWeaponsVisual(weapon, tower, () => 0);
  const host = hostStub();
  weapon.setHost(host);
  weapons.setHost(host);
  const puffs = (kind: number) => weapon.drawnPuffs(kind);
  return { weapon, tower, slam, weapons, host, puffs };
}

const ring = (startTick: number) => ({
  type: 'shockwave' as const,
  id: 1,
  x: 0,
  y: 0,
  z: 0,
  startTick,
  reach: 12,
});

function scorchShown(weapon: CannonShellVisuals): boolean {
  return !!weapon.root.getObjectByName('cannonShell:scorch')?.visible;
}

describe('Fire and Fly Shockwave on screen', () => {
  it('slams: the head hops, stone chips pop off the plinth, the camera kicks', () => {
    const { weapon, slam, weapons, host, puffs } = rig();
    weapons.slam(3, 0, 0, 2, false);
    expect(slam).toHaveBeenCalledWith(2);
    expect(host.addShake).toHaveBeenCalledWith(TURRET_SHOCKWAVE_LOOK.shake);
    expect(host.punchFov).toHaveBeenCalledWith(TURRET_SHOCKWAVE_LOOK.fovPunch);
    weapon.update(0, 2.1);
    expect(puffs(PUFF.stone)).toBe(turretShockwaveCounts(false).chips);
    // The slam alone rolls no front and lays no mark: those wait for the server's ring.
    expect(puffs(PUFF.shock)).toBe(0);
    expect(scorchShown(weapon)).toBe(false);
    weapon.dispose();
  });

  it('drops the camera kick under reduced motion, never the hop or the chips', () => {
    const { weapon, slam, weapons, host, puffs } = rig();
    weapons.slam(3, 0, 0, 2, true);
    expect(slam).toHaveBeenCalledTimes(1);
    expect(host.addShake).not.toHaveBeenCalled();
    expect(host.punchFov).not.toHaveBeenCalled();
    weapon.update(0, 2.1);
    expect(puffs(PUFF.stone)).toBeGreaterThan(0);
    weapon.dispose();
  });

  it('rolls the dust wall and the spark line from the ring entry, and lays the cracked mark', () => {
    const { weapon, weapons, puffs } = rig();
    weapons.roll(ring(200), 200, 5);
    weapon.update(200, 5.1);
    expect(puffs(PUFF.shock)).toBe(turretShockwaveCounts(false).wall);
    expect(puffs(PUFF.spark)).toBeGreaterThan(0);
    expect(scorchShown(weapon)).toBe(true);
    // Its sparks go with the roll; its wall hangs a moment longer, then nothing is left.
    weapon.update(200, 5 + TURRET_SHOCKWAVE_FRONT_LIFE - 0.1);
    expect(puffs(PUFF.spark)).toBe(0);
    expect(puffs(PUFF.shock)).toBeGreaterThan(0);
    weapon.update(200, 5 + TURRET_SHOCKWAVE_FRONT_LIFE + 0.01);
    expect(puffs(PUFF.shock)).toBe(0);
    weapon.dispose();
  });

  it('times the front on its start tick against the display tick, not on the frame that read it', () => {
    // Read with the display two ticks behind the start: the wall waits for them.
    const behind = rig();
    behind.weapons.roll(ring(200), 198, 5);
    behind.weapon.update(198, 5);
    expect(behind.puffs(PUFF.shock)).toBe(0);
    behind.weapon.update(200, 5 + 2 * DT + 0.01);
    expect(behind.puffs(PUFF.shock)).toBeGreaterThan(0);
    behind.weapon.dispose();
    // Read after the display passed its whole life: only the mark is left to lay.
    const late = rig();
    late.weapons.roll(ring(200), 200 + TURRET_SHOCKWAVE_FRONT_LIFE / DT + 1, 5);
    late.weapon.update(220, 5);
    expect(late.puffs(PUFF.shock)).toBe(0);
    expect(late.puffs(PUFF.spark)).toBe(0);
    expect(scorchShown(late.weapon)).toBe(true);
    late.weapon.dispose();
    // Read mid-roll: the wall is as old as the ring, so it ends as much sooner.
    const mid = rig();
    mid.weapons.roll(ring(200), 206, 5);
    mid.weapon.update(206, 5 + TURRET_SHOCKWAVE_FRONT_LIFE - 6 * DT + 0.01);
    expect(mid.puffs(PUFF.shock)).toBe(0);
    mid.weapon.dispose();
  });

  it('sheds only counts on the low preset', () => {
    const high = rig('high');
    const low = rig('low');
    for (const r of [high, low]) {
      r.weapons.slam(3, 0, 0, 5, false);
      r.weapons.roll(ring(200), 200, 5);
      r.weapon.update(200, 5.1);
    }
    expect(low.puffs(PUFF.shock)).toBe(turretShockwaveCounts(true).wall);
    expect(low.puffs(PUFF.stone)).toBe(turretShockwaveCounts(true).chips);
    expect(low.puffs(PUFF.shock)).toBeLessThan(high.puffs(PUFF.shock));
    expect(low.puffs(PUFF.shock)).toBeGreaterThan(0);
    high.weapon.dispose();
    low.weapon.dispose();
  });
});

describe('Fire and Fly fragmentation shell on screen', () => {
  const shot = { id: 5, x: 30, z: 0, damage: 100, impactTick: 300, weapon: 'frag' as const };
  const burst = () => burstTurretFrag(shot as never, 0, 0, 300, flat).event;

  it("bursts over the point and drops the bomblets on the sim's schedule, each blast small and cloudless", () => {
    const { weapon, weapons, puffs } = rig();
    const ev = burst();
    if (ev.type !== 'fragBurst') throw new Error('fragBurst expected');
    weapons.burst(ev, 300, 1, false);
    weapon.update(300, 1.01);
    const shells = weapon.root.getObjectByName('cannonShell:shell') as THREE.InstancedMesh;
    expect(shells.count).toBe(TURRET_BOMBLETS);
    expect(puffs(PUFF.flash)).toBe(1);
    for (const b of ev.bomblets) {
      const blast = {
        type: 'bomblet' as const,
        shotId: 5,
        index: b.index,
        x: b.x,
        y: b.y,
        z: b.z,
        hits: [],
      };
      weapons.bomblet(blast, false, 1 + (b.landTick - 300) * DT, false);
    }
    weapon.update(310, 1.5);
    expect(shells.visible ? shells.count : 0).toBe(0);
    // Every bomblet's flash at once (the airburst's is long spent), and never a dust cloud.
    weapon.update(310, 1 + 11 * DT);
    expect(puffs(PUFF.fireball)).toBeGreaterThan(0);
    for (const time of [1.8, 2.2, 2.6]) {
      weapon.update(310, time);
      expect(puffs(PUFF.dust)).toBe(0);
    }
    weapon.dispose();
  });

  it('lands a stale bomblet without its blast', () => {
    const { weapon, weapons, puffs } = rig();
    const ev = burst();
    if (ev.type !== 'fragBurst') throw new Error('fragBurst expected');
    weapons.burst(ev, 300, 1, false);
    const b = ev.bomblets[0];
    weapons.bomblet(
      { type: 'bomblet', shotId: 5, index: 0, x: b.x, y: b.y, z: b.z, hits: [] },
      true,
      1.3,
      false,
    );
    weapon.update(304, 1.31);
    const shells = weapon.root.getObjectByName('cannonShell:shell') as THREE.InstancedMesh;
    expect(shells.count).toBe(TURRET_BOMBLETS - 1);
    expect(puffs(PUFF.fireball)).toBe(0);
    weapon.dispose();
  });

  it("draws a bomblet's blast as a small shell's, on its own id, with no dust cloud", () => {
    const blast = turretBombletBlast({
      type: 'bomblet',
      shotId: 5,
      index: 3,
      x: 1,
      y: 2,
      z: 3,
      hits: [],
    });
    expect(blast).toMatchObject({
      shotId: cannonBombletBlastId(5, 3),
      x: 1,
      y: 2,
      z: 3,
      radius: TURRET_FRAGMENTATION.blastRadius,
      scale: CANNON_BOMBLET.blastScale,
      cloud: false,
    });
  });

  it('holds every lingering frag landing in a whole keg chain beside a shell blast: every blast on the ground at once', () => {
    const w = TURRET_WEAPON;
    const star = turretFragBomblets(0, 0, 0, 1, 0);
    const lingers = Math.ceil(CANNON_BLAST.life / DT) + star[star.length - 1].landTick;
    const overlap =
      1 + Math.floor((w.maxFlightTicks - w.minFlightTicks + lingers) / w.cooldownTicks);
    expect(TURRET_WEAPON_LINGERING_FRAGS).toBe(Math.min(overlap, mostFragsHeld()));
    expect(TURRET_WEAPON_IMPACTS).toBe(
      6 + FIRE_AND_FLY_MAX_KEG_CAP + TURRET_WEAPON_LINGERING_FRAGS * (1 + TURRET_BOMBLETS),
    );
    const { weapon, weapons, puffs } = rig();
    weapon.impact({ shotId: 1, x: -20, y: 0, z: 0 }, 1, false);
    for (let k = 0; k < TURRET_WEAPON_LINGERING_FRAGS; k++) {
      const id = 5 + k;
      const ev = burstTurretFrag({ ...shot, id, x: 30 - 20 * k } as never, 0, 0, 300, flat).event;
      if (ev.type !== 'fragBurst') throw new Error('fragBurst expected');
      weapons.burst(ev, 300, 1, false);
      for (const b of ev.bomblets) {
        weapons.bomblet(
          { type: 'bomblet', shotId: id, index: b.index, x: b.x, y: b.y, z: b.z, hits: [] },
          false,
          1,
          false,
        );
      }
    }
    for (let id = 1; id <= FIRE_AND_FLY_MAX_KEG_CAP; id++) {
      weapon.impact({ shotId: -id, x: 30 + 3 * id, y: 0, z: 10, radius: 9, scale: 1.5 }, 1, false);
    }
    weapon.update(310, 1.01);
    expect(puffs(PUFF.flash)).toBe(
      1 + TURRET_WEAPON_LINGERING_FRAGS * (1 + TURRET_BOMBLETS) + FIRE_AND_FLY_MAX_KEG_CAP,
    );
    weapon.dispose();
  });

  it('keeps every frag that can fly at once in flight: a reload apart, long flight then short', () => {
    const w = TURRET_WEAPON;
    const star = turretFragBomblets(0, 0, 0, 1, 0);
    const ripple = star[star.length - 1].landTick + TURRET_TICK_LEAD_MAX + TURRET_TICK_LATE_MAX;
    const overlap =
      1 + Math.floor((w.maxFlightTicks - w.minFlightTicks + ripple) / w.cooldownTicks);
    expect(TURRET_WEAPON_FRAGS).toBe(Math.min(overlap, mostFragsHeld()));
    expect(TURRET_WEAPON_BOMBLETS).toBe(TURRET_WEAPON_FRAGS * TURRET_BOMBLETS);
    const { weapon, weapons } = rig();
    for (let k = 0; k < TURRET_WEAPON_FRAGS; k++) {
      const ev = burstTurretFrag(
        { ...shot, id: 5 + k, x: 30 - 20 * k } as never,
        0,
        0,
        300,
        flat,
      ).event;
      if (ev.type !== 'fragBurst') throw new Error('fragBurst expected');
      weapons.burst(ev, 300, 1, false);
    }
    weapon.update(301, 1.05);
    const shells = weapon.root.getObjectByName('cannonShell:shell') as THREE.InstancedMesh;
    expect(shells.count).toBe(TURRET_WEAPON_FRAGS * TURRET_BOMBLETS);
    weapon.dispose();
  });

  it("kicks the camera on the burst harder than a shell's strongest blast, by distance", () => {
    const { weapon, weapons, host } = rig();
    const ev = burst();
    if (ev.type !== 'fragBurst') throw new Error('fragBurst expected');
    host.camera.position.set(28, 6, 0);
    weapons.burst(ev, 300, 1, false);
    expect(host.addShake).toHaveBeenCalledWith(CANNON_AIRBURST.shake);
    expect(host.punchFov).toHaveBeenCalledWith(CANNON_AIRBURST.fovPunch);
    expect(CANNON_AIRBURST.shake).toBeGreaterThan(CANNON_BLAST.shake * 1.3);
    host.addShake.mockClear();
    host.camera.position.set(-5, 6, 0);
    weapons.burst(ev, 300, 1, false);
    const far = host.addShake.mock.calls[0]?.[0] ?? 0;
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(CANNON_AIRBURST.shake);
    weapon.dispose();
  });

  it('drops the burst kick under reduced motion, never the burst itself', () => {
    const { weapon, weapons, host, puffs } = rig();
    const ev = burst();
    if (ev.type !== 'fragBurst') throw new Error('fragBurst expected');
    host.camera.position.set(28, 6, 0);
    weapons.burst(ev, 300, 1, true);
    expect(host.addShake).not.toHaveBeenCalled();
    expect(host.punchFov).not.toHaveBeenCalled();
    weapon.update(300, 1.01);
    expect(puffs(PUFF.flash)).toBe(1);
    weapon.dispose();
  });
});
