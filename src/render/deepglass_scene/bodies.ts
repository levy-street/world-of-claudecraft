// Everything the Deepglass draws ON the fighters in a live bout: thrustpacks,
// the bubble wake and burner exhaust, the local player's speed rush, ice
// shells, team auras, and the Zap Shot demolition hide. Moved out of
// renderer.ts; built only in the Deepglass world (scene.ts owns it).

import type * as THREE from 'three';
import { deepglassMatch } from '../../sim/deepglass/match';
import { DT } from '../../sim/types';
import type { IWorld } from '../../world_api';
import type { CharacterVisual } from '../characters';
import { type AuraSample, DeepglassAuras } from '../deepglass_aura';
import { DeepglassIce, type IceSample } from '../deepglass_ice';
import { tuneCharacterMetalsForBell } from '../deepglass_kit';
import { DeepglassPacks, type PackWearerState, packChargeFraction } from '../deepglass_pack';
import { DeepglassRush, type RushSample } from '../deepglass_rush';
import { DeepglassWake, type WakeSample } from '../deepglass_wake';
import type { BudgetPointLightRegistry } from '../point_light_budget';
import { setRenderCategory } from '../renderer_diagnostics';
import { deepglassTeamOf } from './deepglass_cue_core';

/** How close the Tidesow counts as CARRIED for the aura's pulse. Matches the
 *  sim's own carry reach (match.ts isCarrying: body + ball radius + slack). */
const DG_CARRY_MARK_R = 3.3;

/** The slice of an EntityView this layer reads. */
export interface DeepglassBodyView {
  visual?: CharacterVisual | null;
}

interface FlightState {
  dgFlight?: boolean;
  dgCharge?: number;
  dgBoosting?: boolean;
  dgSpool?: number;
  dgDashTicks?: number;
  dgWish?: { x: number; y: number; z: number };
  dgFrozenTicks?: number;
  dgDeadTicks?: number;
  vx: number;
  vy: number;
  vz: number;
}

export class DeepglassBodies {
  /** Thrustpacks worn by everyone in a live bout; empty elsewhere. */
  readonly packs: DeepglassPacks;
  /** Bubble wake and burner exhaust shed by bodies pushing through the water. */
  private readonly wake = new DeepglassWake();
  /** The local player's speed sheath and streak lines at pace. */
  private readonly rush = new DeepglassRush();
  /** Ice shells on bodies caught by a Tidewarden's Lance. */
  private readonly ice = new DeepglassIce();
  private readonly auras = new DeepglassAuras();
  /** Bodies hidden by a Zap Shot demolition, so they can be shown again. */
  private readonly hidden = new Set<number>();

  /** `lightBudget` is the renderer's point-light registry: the packs' burner
   *  lights only shine once it ranks them. */
  constructor(lightBudget: BudgetPointLightRegistry) {
    this.packs = new DeepglassPacks(lightBudget);
  }

  /** Put the wake, rush and ice layers into the scene. */
  attach(scene: THREE.Scene): void {
    setRenderCategory(this.wake.group, 'vfx');
    scene.add(this.wake.group);
    setRenderCategory(this.rush.group, 'vfx');
    scene.add(this.rush.group);
    setRenderCategory(this.ice.group, 'vfx');
    scene.add(this.ice.group);
  }

  /** Hang a thrustpack on everyone in the bout and drive its burners off their
   *  live boost state (src/render/deepglass_pack.ts). */
  update(dt: number, sim: IWorld, views: ReadonlyMap<number, DeepglassBodyView>): void {
    const wearers: {
      id: number;
      chest: THREE.Object3D | null;
      state: PackWearerState;
    }[] = [];
    const wake: WakeSample[] = [];
    const ice: IceSample[] = [];
    const auras: AuraSample[] = [];
    // Which side each body is on, and who is carrying. Read once per frame
    // rather than per body: the roster lists are small but this runs at frame
    // rate over every view in the scene.
    const match = deepglassMatch();
    const ball = match?.ball ?? null;
    let rush: RushSample | null = null;
    for (const [id, view] of views) {
      const e = sim.entities.get(id) as FlightState | undefined;
      if (!e?.dgFlight || !view.visual) continue;
      // Demolished (a Zap Shot landed): the body is gone until it respawns by
      // its goal. Hidden here, remembered in `hidden` so it comes back the
      // frame the sim clears the timer (or the bout ends under it).
      if ((e.dgDeadTicks ?? 0) > 0) {
        view.visual.root.visible = false;
        this.hidden.add(id);
        continue;
      }
      // The thrust intent, which is what the burners are AIMED down the reverse
      // of. Copied rather than passed by reference: the flight pass mutates
      // dgWish in place every tick and the pack holds it across a frame.
      const wish = e.dgWish;
      wearers.push({
        id,
        chest: view.visual.root.getObjectByName('chest') ?? null,
        state: {
          boosting: e.dgBoosting === true,
          charge: packChargeFraction(e.dgCharge),
          speed: Math.hypot(e.vx, e.vy, e.vz),
          spool: e.dgSpool ?? 0,
          dashing: (e.dgDashTicks ?? 0) > 0,
          wish: { x: wish?.x ?? 0, y: wish?.y ?? 0, z: wish?.z ?? 0 },
          vel: { x: e.vx, y: e.vy, z: e.vz },
          isSelf: id === sim.playerId,
        },
      });
      const p = sim.entities.get(id);
      if (p) {
        wake.push({
          id,
          // Shed from the chest, not the feet: the wake should trail the body's
          // mass, and the entity origin is at the soles.
          x: p.pos.x,
          y: p.pos.y + 1,
          z: p.pos.z,
          vx: e.vx,
          vy: e.vy,
          vz: e.vz,
          boosting: e.dgBoosting === true,
          // Same thrust intent the nozzles are aimed with, so the exhaust rope
          // leaves along the plumes instead of merely trailing the body.
          wx: wish?.x ?? 0,
          wy: wish?.y ?? 0,
          wz: wish?.z ?? 0,
        });
        ice.push({
          id,
          x: p.pos.x,
          y: p.pos.y,
          z: p.pos.z,
          remaining: (e.dgFrozenTicks ?? 0) * DT,
        });
        const team = deepglassTeamOf(match, id);
        if (team && view.visual) {
          // Metallic armour is a black patch in here until it is tamed; the
          // helper remembers each material, so this is a WeakSet hit per body
          // per frame after the first sight of it.
          tuneCharacterMetalsForBell(view.visual.root);
          // Carrying is not a flag anyone sets, it is "the ball is on my
          // chest", the same test the sim slows a carrier by.
          const carrying =
            ball !== null &&
            Math.hypot(ball.x - p.pos.x, ball.y - (p.pos.y + 1), ball.z - p.pos.z) <
              DG_CARRY_MARK_R;
          auras.push({
            id,
            root: view.visual.root,
            team,
            isSelf: id === sim.playerId,
            carrying,
          });
        }
        // The rush is a first-person read on YOUR speed, so only the camera's
        // own body feeds it: drawn on the whole roster the aura would sit
        // between you and every opponent.
        if (id === sim.playerId) {
          rush = {
            x: p.pos.x,
            y: p.pos.y + 1,
            z: p.pos.z,
            vx: e.vx,
            vy: e.vy,
            vz: e.vz,
          };
        }
      }
    }
    // Hidden bodies whose timer has cleared (respawned, or the bout ended
    // under them) come back before anything else is drawn.
    for (const id of this.hidden) {
      const e = sim.entities.get(id) as { dgDeadTicks?: number } | undefined;
      if (e && (e.dgDeadTicks ?? 0) > 0) continue;
      const v = views.get(id);
      if (v?.visual) v.visual.root.visible = true;
      this.hidden.delete(id);
    }
    this.packs.update(dt, wearers);
    this.wake.update(dt, wake);
    this.rush.update(dt, rush);
    this.ice.update(dt, ice);
    this.auras.update(dt, auras);
  }
}
