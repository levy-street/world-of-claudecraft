// The Smith's Heart's seal moments felt in the camera (phase 2F): as the
// seal splits into the portal, a tremor through the charge, the heavy jolt on
// the flash and an aftershock as the shards lift; as a vein's light reaches
// the seal, a thud. Read from the slot's seal memory (../smith_heart/
// heart_seal_core.ts, fed by the mirrored markers), so offline and online feel
// the same; scaled by the player's distance from the seal; through the
// renderer's shake sink, which honours reduced motion. Presentation only: no
// mesh, no light, nothing on the scene.

import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import type { IWorld } from '../../world_api';
import { sharedUniforms } from '../gfx';
import {
  HEART_ARRIVAL_SHAKES,
  HEART_PORTAL_SHAKES,
  heartShakeDue,
} from '../smith_heart/heart_portal_core';
import { heartSealSlotKey, heartSealView, newHeartSealView } from '../smith_heart/heart_seal_core';

/** How far from the seal a moment is felt (full within `near`, fading out
 *  to nothing at `far`). */
export const SEAL_SHAKE_REACH = { near: 40, far: 150 } as const;

/** The share of a jolt felt `d` yards from the seal. */
export function sealShakeFalloff(d: number): number {
  if (d <= SEAL_SHAKE_REACH.near) return 1;
  if (d >= SEAL_SHAKE_REACH.far) return 0;
  return 1 - (d - SEAL_SHAKE_REACH.near) / (SEAL_SHAKE_REACH.far - SEAL_SHAKE_REACH.near);
}

export class SealShake {
  private readonly view = newHeartSealView();
  private key = '';
  private prevPortal: number | null = null;
  private readonly prevVeins: (number | null)[] = [];

  constructor(
    private readonly world: IWorld | undefined,
    private readonly shake: ((amount: number) => void) | undefined,
  ) {}

  update(): void {
    const world = this.world;
    if (!world || !this.shake) return;
    const me = world.entities.get(world.playerId);
    const def = DUNGEONS.smith_heart;
    if (!me || !def) return;
    const o = instanceOrigin(def.index, instanceSlotForZ(me.pos.z));
    // Only inside a Smith's Heart slot (its main map's own half).
    if (Math.abs(me.pos.x - o.x) > 300 || Math.abs(me.pos.z - o.z) > 250) {
      this.key = '';
      return;
    }
    const key = heartSealSlotKey(o.x, o.z);
    const view = heartSealView(key, sharedUniforms.uTime.value, this.view);
    if (key !== this.key) {
      // A slot first felt: every moment already past stays past.
      this.key = key;
      this.prevPortal = view.portalSince;
      this.prevVeins.length = 0;
      for (const s of view.since) this.prevVeins.push(s);
      return;
    }
    let jolt = heartShakeDue(HEART_PORTAL_SHAKES, this.prevPortal, view.portalSince);
    this.prevPortal = view.portalSince;
    view.since.forEach((s, i) => {
      jolt += heartShakeDue(HEART_ARRIVAL_SHAKES, this.prevVeins[i] ?? null, s);
      this.prevVeins[i] = s;
    });
    if (jolt <= 0) return;
    const k = sealShakeFalloff(Math.hypot(me.pos.x - o.x, me.pos.z - o.z));
    if (k > 0) this.shake(jolt * k);
  }
}
