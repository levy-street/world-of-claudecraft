// Protect Yumi hold-to-grab client driver. Each frame it decides whether the
// local player should be channeling a mystery power-up orb (Interact held, a
// READY orb within reach, and NOT already carrying a power-up) and sends the
// yumiGrabStart / yumiGrabStop intent, EDGE-triggered off the chosen orb so it
// never spams the wire. The 1.8s channel itself is server-authoritative (the
// server re-checks stun / range / holding and cancels); this only expresses
// intent, and the grab bar reads the authoritative player.yumiGrabRemaining.
//
// Pure of any src/sim import (world_api types only): the reach radius is passed
// in from main.ts (the sim's YUMI_POWERUP_RADIUS), and "already holding a
// power-up" is the presence of any mystery-power-up aura, whose kinds are the
// `pu_*` family (pu_invuln / pu_stealth / pu_endless_mana / pu_berserk).

import type { IWorld } from '../world_api';
import type { YumiGroundPowerupView } from '../world_api/duel_arena';

export interface GrabDecisionInput {
  x: number; // player world x
  z: number; // player world z
  holding: boolean; // already carries a mystery power-up (one-at-a-time gate)
  interactHeld: boolean;
  dead: boolean;
}

/** The id of the nearest READY orb within `radius`, or null when nothing is
 *  grabbable (Interact not held, dead, already holding, or none in reach). */
export function pickGrabbableOrb(
  input: GrabDecisionInput,
  orbs: readonly YumiGroundPowerupView[],
  radius: number,
): number | null {
  if (!input.interactHeld || input.dead || input.holding) return null;
  let best: number | null = null;
  let bestD = radius;
  for (const o of orbs) {
    if (o.state !== 'ready') continue;
    const d = Math.hypot(o.x - input.x, o.z - input.z);
    if (d <= bestD) {
      bestD = d;
      best = o.id;
    }
  }
  return best;
}

/** True when the player carries a mystery power-up (its aura is a `pu_*` kind). */
export function carriesMysteryPowerup(auras: readonly { kind: string }[]): boolean {
  return auras.some((a) => a.kind.startsWith('pu_'));
}

export class YumiGrabDriver {
  private intentOrb: number | null = null;

  /** Poll once per frame; sends start when the chosen orb appears/changes and
   *  stop when it goes away. Idempotent server-side, so an unchanged choice
   *  sends nothing. `radius` is the sim's YUMI_POWERUP_RADIUS. */
  update(world: IWorld, interactHeld: boolean, radius: number): void {
    const match = world.arenaInfo?.match;
    const yumi = match?.yumi;
    const p = world.player;
    const desired =
      yumi && match?.state === 'active'
        ? pickGrabbableOrb(
            {
              x: p.pos.x,
              z: p.pos.z,
              holding: carriesMysteryPowerup(p.auras),
              interactHeld,
              dead: p.dead,
            },
            yumi.groundPowerups,
            radius,
          )
        : null;
    if (desired === this.intentOrb) return;
    if (desired != null) world.yumiGrabStart(desired);
    else world.yumiGrabStop();
    this.intentOrb = desired;
  }

  /** Forget the last intent (e.g. on match end / world swap) so the next update
   *  re-sends cleanly. */
  reset(): void {
    this.intentOrb = null;
  }
}
