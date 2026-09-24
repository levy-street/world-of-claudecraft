// Plays a hoard boss's authored body gesture for a cue, at the beat the pure core
// (hoard_boss_gestures_core.ts) names. Local presentation only: the cue, its
// timing and every hit come from the authoritative world; this only asks the
// renderer's one-shot route to animate the body that owns it.
//
// Cost: nothing outside a hoard fight. While a gesture cue is live and unplayed
// its boss is looked up once (an entity scan), then the cue is remembered as
// played until it leaves the cue list.

import type { IWorld } from '../world_api';
import type { HoardBossCueView } from '../world_api/dungeons';
import { hoardBossGesture, hoardGestureDue } from './hoard_boss_gestures_core';

/** How far from its cue's origin a boss may stand and still own it (yards). Sweep
 *  cues are laid at the boss's feet; Ice Age is centred on the room. */
const OWNER_REACH = 60;

export class HoardBossGestures {
  private readonly played = new Set<number>();
  private readonly live = new Set<number>();

  constructor(
    private readonly world: IWorld | undefined,
    private readonly play: ((entityId: number, gesture: string) => void) | undefined,
  ) {}

  sync(cues: readonly HoardBossCueView[]): void {
    const world = this.world;
    if (!world || !this.play) return;
    if (cues.length === 0) {
      if (this.played.size > 0) this.played.clear();
      return;
    }
    this.live.clear();
    for (const cue of cues) {
      const gesture = hoardBossGesture(cue.variant);
      if (!gesture) continue;
      // Cue ids restart per instance, so the instance is part of the key.
      const key = cue.instanceId * 1_000_000 + cue.cueId;
      this.live.add(key);
      if (this.played.has(key)) continue;
      const late = cue.total - cue.remaining - gesture.startAt(cue.total);
      if (late < 0) continue;
      // Due now, or already too late to be worth a wind-up: either way, once.
      this.played.add(key);
      if (!hoardGestureDue(gesture, cue.total, cue.remaining)) continue;
      const boss = this.owner(gesture.template, cue.x, cue.z);
      if (boss !== -1) this.play(boss, gesture.gesture);
    }
    for (const key of this.played) if (!this.live.has(key)) this.played.delete(key);
  }

  private owner(template: string, x: number, z: number): number {
    let best = -1;
    let bestDistance = OWNER_REACH * OWNER_REACH;
    for (const entity of this.world?.entities.values() ?? []) {
      if (entity.templateId !== template || entity.dead) continue;
      const dx = entity.pos.x - x;
      const dz = entity.pos.z - z;
      const distance = dx * dx + dz * dz;
      if (distance <= bestDistance) {
        best = entity.id;
        bestDistance = distance;
      }
    }
    return best;
  }
}
