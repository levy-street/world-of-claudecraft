// Fire and Fly's limited weapons on screen, the thin painter the turret visual
// (turret_defense_visual.ts) composes, all on the cannon's prewarmed draw
// (cannon_shell_visuals.ts): no mesh, material or light of its own.
//
// The Shockwave: on the slam (the click when the page's own-shot ledger played
// it, else its `shockwave` entry) the tower's head hops on its mount, stone chips
// pop off the plinth and the camera kicks (not under reduced motion); from the
// entry, timed on its start tick against the display tick the monsters are drawn
// on, the dust wall and the spark line roll out on the sim's own front
// (turret_shockwave_core.ts) and a pale cracked mark is laid around the foot.
// The fragmentation shell: its `fragBurst` entry flashes the airburst and flies
// the bomblets to their points, each `bomblet` entry lands one into a small blast
// with no dust cloud.
import { TURRET_EXPLOSIVE_BARREL, TURRET_FRAGMENTATION } from '../sim/content/turret_defense';
import type { TurretEvent } from '../sim/minigames/turret_defense';
import { TURRET_BOMBLETS } from '../sim/minigames/turret_fragmentation';
import { DT } from '../sim/types';
import { CANNON_BOMBLET, cannonBombletBlastId } from './cannon_frag_core';
import { type CannonPuff, newCannonPuff } from './cannon_puff_core';
import { CANNON_IMPACT_POOL } from './cannon_shell_core';
import type { CannonBlast, CannonShellHost, CannonShellVisuals } from './cannon_shell_visuals';
import {
  TURRET_SHOCKWAVE_CHIP_LIFE,
  TURRET_SHOCKWAVE_CHIP_PUFFS,
  TURRET_SHOCKWAVE_FRONT_LIFE,
  TURRET_SHOCKWAVE_FRONT_PUFFS,
  TURRET_SHOCKWAVE_LOOK,
  type TurretShockwaveCounts,
  turretShockwaveChipPuffs,
  turretShockwaveCounts,
  turretShockwaveFrontPuffs,
} from './turret_shockwave_core';
import type { TurretTowerVisual } from './turret_tower_visual';

type ShockwaveEvent = Extract<TurretEvent, { type: 'shockwave' }>;
type BombletEvent = Extract<TurretEvent, { type: 'bomblet' }>;

/** Pooled bursts one Shockwave keeps alive at once (its front, then its chips), `perBurst` puffs each. */
export function turretShockwaveBursts(perBurst: number): number {
  const per = Math.max(1, perBurst);
  return (
    Math.ceil(TURRET_SHOCKWAVE_FRONT_PUFFS / per) + Math.ceil(TURRET_SHOCKWAVE_CHIP_PUFFS / per)
  );
}

/** Blasts the cannon keeps on the ground at once: the shells' own, a whole keg chain's, and a frag's airburst and bomblets. */
export const TURRET_WEAPON_IMPACTS =
  CANNON_IMPACT_POOL + TURRET_EXPLOSIVE_BARREL.cap + 1 + TURRET_BOMBLETS;

/** Bomblets in flight at once: two frag shells' worth, fired a reload apart on different ranges. */
export const TURRET_WEAPON_BOMBLETS = 2 * TURRET_BOMBLETS;

/** How far above its ground point a shell of `weapon` ends its flight: a frag's airburst height. */
export function turretShellEndLift(weapon: string | undefined): number {
  return weapon === 'frag' ? TURRET_FRAGMENTATION.burstHeight : 0;
}

/** A bomblet's blast as the cannon draws it: a small shell's, on its own id, with no dust cloud. */
export function turretBombletBlast(ev: BombletEvent): CannonBlast {
  return {
    shotId: cannonBombletBlastId(ev.shotId, ev.index),
    x: ev.x,
    y: ev.y,
    z: ev.z,
    hits: ev.hits,
    radius: TURRET_FRAGMENTATION.blastRadius,
    scale: CANNON_BOMBLET.blastScale,
    cloud: false,
  };
}

export class TurretWeaponsVisual {
  private readonly counts: Readonly<TurretShockwaveCounts>;
  private readonly scratch: CannonPuff[] = Array.from(
    { length: Math.max(TURRET_SHOCKWAVE_FRONT_PUFFS, TURRET_SHOCKWAVE_CHIP_PUFFS) },
    newCannonPuff,
  );
  private host: CannonShellHost | null = null;

  constructor(
    private readonly weapon: CannonShellVisuals,
    private readonly tower: TurretTowerVisual,
    private readonly groundAt: (x: number, z: number) => number,
  ) {
    this.counts = turretShockwaveCounts(weapon.lowEffects);
  }

  setHost(host: CannonShellHost | null): void {
    this.host = host;
  }

  /** The slam at the tower on (cx, cz), seen at frame seconds `time`; `seed` names it. */
  slam(seed: number, cx: number, cz: number, time: number, reducedMotion: boolean): void {
    this.tower.slam(time);
    const footY = this.ground(cx, cz, 0);
    const n = turretShockwaveChipPuffs(
      this.scratch,
      seed,
      cx,
      footY,
      cz,
      this.counts.chips,
      this.groundAt,
    );
    this.launch(n, time, time, TURRET_SHOCKWAVE_CHIP_LIFE);
    const host = this.host;
    if (!host || reducedMotion) return;
    host.addShake(TURRET_SHOCKWAVE_LOOK.shake);
    host.punchFov(TURRET_SHOCKWAVE_LOOK.fovPunch);
  }

  /**
   * The front of Shockwave `ev`, read at display tick `tick`: its wall and sparks
   * aged by how far the tick is past its start (ahead of it, they wait), and the
   * cracked mark around the foot.
   */
  roll(ev: ShockwaveEvent, tick: number, time: number): void {
    this.weapon.markGround(ev.id, ev.x, ev.y, ev.z, TURRET_SHOCKWAVE_LOOK.markHalf, time);
    const elapsed = (tick - ev.startTick) * DT;
    if (elapsed >= TURRET_SHOCKWAVE_FRONT_LIFE) return;
    const n = turretShockwaveFrontPuffs(
      this.scratch,
      ev.id,
      ev.x,
      ev.z,
      this.counts,
      this.groundAt,
      ev.y,
    );
    this.launch(n, time - elapsed, time, TURRET_SHOCKWAVE_FRONT_LIFE);
  }

  /** The frag shell's burst, seen at display tick `burstTick`. */
  burst(ev: Extract<TurretEvent, { type: 'fragBurst' }>, burstTick: number, time: number): void {
    this.weapon.scatter(ev, burstTick, time);
  }

  /** A bomblet lands: its flight ends, and unless its entry is stale its blast shows. */
  bomblet(ev: BombletEvent, stale: boolean, time: number, reducedMotion: boolean): void {
    this.weapon.landBomblet(ev.shotId, ev.index);
    if (!stale) this.weapon.impact(turretBombletBlast(ev), time, reducedMotion);
  }

  /** The first `count` scratch puffs, split over as many pooled bursts as they fill, seen at `time` and aged from `at`. */
  private launch(count: number, at: number, time: number, life: number): void {
    let from = 0;
    while (from < count) {
      const burst = this.weapon.puffBurst(time);
      if (!burst) return;
      const take = Math.min(burst.puffs.length, count - from);
      if (take <= 0) return;
      for (let i = 0; i < take; i++) Object.assign(burst.puffs[i], this.scratch[from + i]);
      burst.count = take;
      burst.life = life;
      burst.at = at;
      from += take;
    }
  }

  private ground(x: number, z: number, fallback: number): number {
    const g = this.groundAt(x, z);
    return Number.isFinite(g) ? g : fallback;
  }
}
