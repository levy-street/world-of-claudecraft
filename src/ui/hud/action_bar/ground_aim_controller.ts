// Ground-aim orchestration: owns the aim state machine and the raw desired
// point, and derives the clamped reticle from the live caster position at read
// time so a moving caster always sees the point a commit would cast at. The
// Hud composes it with thin delegates; dependencies arrive as a narrow bag of
// closures (never the Hud class), per the hud-domain module rules.

import type { AbilityEffect, Entity } from '../../../sim/types';
import {
  type AimPoint,
  abilityAoeRadius,
  cancelGroundAim,
  clampAimToRange,
  commitGroundAim,
  createGroundAimState,
  enterGroundAim,
  type GroundAimState,
  quickAimPoint,
  smartSeedPoint,
  withinMinRange,
} from './ground_aim';

export interface GroundAimResolvedAbility {
  def: { id: string; range: number; minRange?: number; school: string };
  effects: readonly AbilityEffect[];
}

export interface GroundAimReticleView {
  point: AimPoint;
  radius: number;
  school: string;
  /** Softened but valid: range-clamped or projection-diverged; still casts. */
  dimmed: boolean;
  /** Inside the ability's minimum range: the commit will be refused. */
  blocked: boolean;
}

export interface GroundAimControllerDeps {
  player(): Pick<Entity, 'pos' | 'facing'>;
  resolveAbility(abilityId: string): GroundAimResolvedAbility | null;
  /** Attackable-target seed point, or null when nothing qualifies. */
  seedTargetPoint(): AimPoint | null;
  /** The no-point commit fallback (current target's spot, else the caster's). */
  fallbackPoint(): AimPoint;
  castAt(abilityId: string, point: AimPoint): void;
  /** Hide the world reticle (cancel and commit both clear it). */
  clearReticle(): void;
  /** The world's authoritative landing for a placement-adjusted ability
   *  (Heroic Leap's diverted landing); identity for everything else. */
  projectPlacement?(abilityId: string, point: AimPoint): AimPoint;
}

const PROJECTION_DIVERGENCE_EPSILON = 0.05;

export class GroundAimController {
  private state: GroundAimState = createGroundAimState();
  private rawPoint: AimPoint | null = null;
  // Per-frame projection memo: Heroic Leap's preview walks the whole landing
  // sweep, so recompute only when the ability, aim point, or caster moved.
  private projMemo: {
    abilityId: string;
    aimX: number;
    aimZ: number;
    fromX: number;
    fromZ: number;
    point: AimPoint;
  } | null = null;

  constructor(private readonly deps: GroundAimControllerDeps) {}

  private projectedPoint(abilityId: string, aim: AimPoint, from: AimPoint): AimPoint {
    const memo = this.projMemo;
    if (
      memo &&
      memo.abilityId === abilityId &&
      memo.aimX === aim.x &&
      memo.aimZ === aim.z &&
      memo.fromX === from.x &&
      memo.fromZ === from.z
    ) {
      return memo.point;
    }
    const point = this.deps.projectPlacement?.(abilityId, aim) ?? aim;
    this.projMemo = {
      abilityId,
      aimX: aim.x,
      aimZ: aim.z,
      fromX: from.x,
      fromZ: from.z,
      point,
    };
    return point;
  }

  isActive(): boolean {
    return this.state.activeAbilityId !== null;
  }

  activeSlot(): number | null {
    return this.state.activeSlot;
  }

  activeAbilityId(): string | null {
    return this.state.activeAbilityId;
  }

  /** The stored raw (unclamped) point; reticle() owns the clamped view. */
  rawAimPoint(): AimPoint | null {
    return this.rawPoint;
  }

  cancel(): boolean {
    if (!this.isActive()) return false;
    this.state = cancelGroundAim(this.state);
    this.rawPoint = null;
    this.deps.clearReticle();
    return true;
  }

  begin(abilityId: string, slot: number): void {
    this.state = enterGroundAim(this.state, abilityId, slot);
    const res = this.activeAbility();
    this.rawPoint = res
      ? smartSeedPoint(this.deps.player(), this.deps.seedTargetPoint(), res.def.range)
      : null;
  }

  abilityRange(): number | null {
    return this.activeAbility()?.def.range ?? null;
  }

  updatePoint(rawPoint: AimPoint | null): void {
    if (!this.isActive() || !rawPoint) {
      this.rawPoint = null;
      return;
    }
    if (!this.activeAbility()) {
      this.cancel();
      return;
    }
    this.rawPoint = rawPoint;
  }

  // Leashed to the range edge so stick steering pins at the rim instead of
  // wandering unbounded; min-range dimming still derives in reticle().
  nudge(dx: number, dz: number): void {
    if (!this.isActive() || !this.rawPoint) return;
    const res = this.activeAbility();
    if (!res) {
      this.cancel();
      return;
    }
    this.rawPoint = clampAimToRange(
      this.deps.player(),
      { x: this.rawPoint.x + dx, z: this.rawPoint.z + dz },
      res.def.range,
    ).point;
  }

  // The ring paints the PROJECTED point (where the cast truly lands) while the
  // commit still sends the clamped aim: the authoritative cast re-derives its
  // own landing, so projecting the submission would double-apply it. A
  // divergence dims the ring like a range clamp does: honest "not exactly
  // where you point" feedback for a cast that WILL land. A min-range
  // violation is a different state (the commit will be refused) and gets its
  // own flag so the render can look refusing, not merely soft. Min range
  // judges the submitted aim, matching the sim's refusal.
  reticle(): GroundAimReticleView | null {
    if (!this.isActive() || !this.rawPoint) return null;
    const res = this.activeAbility();
    if (!res) return null;
    const player = this.deps.player();
    const aim = clampAimToRange(player, this.rawPoint, res.def.range);
    const projected = this.projectedPoint(res.def.id, aim.point, {
      x: player.pos.x,
      z: player.pos.z,
    });
    const diverged =
      Math.hypot(projected.x - aim.point.x, projected.z - aim.point.z) >
      PROJECTION_DIVERGENCE_EPSILON;
    return {
      point: projected,
      radius: abilityAoeRadius(res),
      school: res.def.school,
      dimmed: aim.clamped || diverged,
      blocked: withinMinRange(player, aim.point, res.def.minRange),
    };
  }

  commitAt(rawPoint: AimPoint | null | undefined = this.rawPoint): boolean {
    if (!this.isActive()) return false;
    const res = this.activeAbility();
    const abilityId = this.state.activeAbilityId;
    if (!res || !abilityId) {
      this.cancel();
      return true;
    }
    const player = this.deps.player();
    const point = rawPoint
      ? clampAimToRange(player, rawPoint, res.def.range).point
      : quickAimPoint(
          player,
          this.deps.seedTargetPoint(),
          this.deps.fallbackPoint(),
          res.def.range,
          res.def.minRange,
        );
    const committed = commitGroundAim(this.state);
    this.state = committed.state;
    this.rawPoint = null;
    this.deps.clearReticle();
    this.deps.castAt(abilityId, point);
    return true;
  }

  private activeAbility(): GroundAimResolvedAbility | null {
    const id = this.state.activeAbilityId;
    if (!id) return null;
    return this.deps.resolveAbility(id);
  }
}
