// The world-marker placement aim: a symbol armed from the world-marker button
// (or its hotkey) waits for a click on the ground, exactly like a
// ground-targeted spell. It speaks the same aim surface as the spell aim
// (GroundAimController) and the cannon's (VehicleAimCore), so the Hud routes
// it through its one `groundAim` seam and every input path main.ts already has
// works unchanged: the cursor drives the reticle, a left click (or a tap)
// places, a right click or Escape cancels, the pad stick steers and commits.
//
// The reticle is the ground-aim reticle in the marker's colour (the renderer
// maps `marker` to it), sized to the world marker's circle, and drawn refused
// when the point lies outside the instance copy the player stands in. A
// placement sends IWorld.placeSharedWorldMark: the server resolves the floor
// and owns every rule. No DOM (the button and flyout are the controller's).

import { WORLD_MARKER_RADIUS } from '../../../render/world_markers_core';
import type { AimPoint } from '../action_bar/ground_aim';
import type { GroundAimReticleView } from '../action_bar/ground_aim_controller';
import { worldMarkerTarget } from './world_markers_core';

/** How far the pad stick may steer the reticle from the player (yards). */
export const WORLD_MARKER_AIM_RANGE = 40;

export interface WorldMarkerAimDeps {
  player(): { pos: { x: number; y: number; z: number } };
  place(page: number, x: number, y: number, z: number, symbol: number): void;
  /** Hide the world reticle (cancel and place both clear it). */
  clearReticle(): void;
  /** The armed symbol changed (the button repaints its lit tile). */
  changed(): void;
}

/** The reticle view for a world marker: the shared ground-aim reticle view
 *  plus the marker symbol whose colour it draws in. */
export type WorldMarkerReticleView = GroundAimReticleView & { marker: number };

export class WorldMarkerAim {
  private symbol: number | null = null;
  private rawPoint: AimPoint | null = null;
  /** Place at the next cursor point instead of waiting for a click (a hotkey
   *  press on desktop: the classic "place at the cursor"). */
  private atCursor = false;

  constructor(private readonly deps: WorldMarkerAimDeps) {}

  isActive(): boolean {
    return this.symbol !== null;
  }

  /** The armed symbol, or null. */
  armed(): number | null {
    return this.symbol;
  }

  /** Arm `symbol` for a ground click; `atCursor` places it at the next cursor
   *  point the frame sync supplies (the touch HUD and the pad never supply
   *  one, so there it waits for the tap or the commit button). */
  begin(symbol: number, atCursor = false): void {
    this.symbol = symbol;
    this.atCursor = atCursor;
    this.rawPoint = null;
    this.deps.changed();
  }

  cancel(): boolean {
    if (this.symbol === null) return false;
    this.symbol = null;
    this.atCursor = false;
    this.rawPoint = null;
    this.deps.clearReticle();
    this.deps.changed();
    return true;
  }

  // The spell aim's surface: a marker has no bar slot and no ability.
  activeSlot(): number | null {
    return null;
  }

  activeAbilityId(): string | null {
    return null;
  }

  abilityRange(): number | null {
    return this.symbol === null ? null : WORLD_MARKER_AIM_RANGE;
  }

  rawAimPoint(): AimPoint | null {
    return this.rawPoint;
  }

  updatePoint(point: AimPoint | null): void {
    if (this.symbol === null || !point) {
      this.rawPoint = null;
      return;
    }
    this.rawPoint = point;
    if (this.atCursor) this.commitAt(point);
  }

  /** Pad stick steering, leashed to the aim range round the player. */
  nudge(dx: number, dz: number): void {
    if (this.symbol === null) return;
    const p = this.deps.player().pos;
    const from = this.rawPoint ?? { x: p.x, z: p.z };
    let x = from.x + dx;
    let z = from.z + dz;
    const ox = x - p.x;
    const oz = z - p.z;
    const d = Math.hypot(ox, oz);
    if (d > WORLD_MARKER_AIM_RANGE) {
      x = p.x + (ox / d) * WORLD_MARKER_AIM_RANGE;
      z = p.z + (oz / d) * WORLD_MARKER_AIM_RANGE;
    }
    this.rawPoint = { x, z };
  }

  reticle(): WorldMarkerReticleView | null {
    if (this.symbol === null || !this.rawPoint) return null;
    const blocked = worldMarkerTarget(this.deps.player().pos, this.rawPoint) === null;
    return {
      point: this.rawPoint,
      radius: WORLD_MARKER_RADIUS,
      school: 'physical',
      dimmed: false,
      blocked,
      marker: this.symbol,
    };
  }

  /**
   * Place the armed symbol at `point` (the click, else the steered point).
   * A point outside the player's instance copy keeps the aim armed (the
   * reticle shows it refused) so the next click can land; returns true when
   * the press was this aim's (it always is while armed).
   */
  commitAt(point: AimPoint | null | undefined = this.rawPoint): boolean {
    const symbol = this.symbol;
    if (symbol === null) return false;
    const p = this.deps.player().pos;
    const at = point ?? { x: p.x, z: p.z };
    const target = worldMarkerTarget(p, at);
    if (!target) {
      this.atCursor = false;
      return true;
    }
    this.symbol = null;
    this.atCursor = false;
    this.rawPoint = null;
    this.deps.clearReticle();
    this.deps.place(target.page, at.x, p.y, at.z, symbol);
    this.deps.changed();
    return true;
  }
}
