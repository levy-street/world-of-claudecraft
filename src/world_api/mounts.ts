import type { MountKey } from '../sim/content/mounts';

// Riding speed belongs to the character's training rank. Reins held in any
// character's bags or bank grant account-wide cosmetic appearances, which are
// selected in Cosmetics and revalidated server-side when ownership changes.
export interface IWorldMounts {
  /** The owned subset of the catalog, in catalog order: any mount whose
   *  reins item sits in bags or bank (ownership travels with the item; reins
   *  are not soulbound). A fresh player owns nothing. */
  ownedMounts(): readonly MountKey[];
  /** Whether the player has purchased the riding skill from Marla (80g).
   *  Required before summoning any mount. */
  ridingTrained(): boolean;
  /** Character riding rank: untrained, +70% speed, or +110% speed. */
  ridingTrainingTier(): 0 | 1 | 2;
  /** Dismount instantly if riding; otherwise summon the trained ride with the
   *  selected cosmetic. An active lesson lends its training steed. */
  toggleMounted(): void;
  /** Purchase the next riding rank from Marla: 80 gold for +70% speed, then
   *  1000 gold for +110% speed. Training is permanent and per character. Requires the
   *  player to be level 20, alive, and standing near Marla. Emits an error toast on
   *  failure (not enough money, wrong NPC, wrong level). */
  learnRiding(npcId: number, expectedTier?: 0 | 1): void;
  /** Legacy start for a riding-lesson attempt at Stablemaster Marla, gating
   *  reins_valorsteed's q_riding_lessons quest reward. Current lesson completion
   *  comes from finishing the show-jumping race on the lent training Valorsteed.
   *  Server-authoritative; rules live in src/sim/mounts_training.ts, feedback
   *  rides the mountTrain* events. Current clients start the lesson directly from
   *  the race platform instead. */
  mountTrainBegin(): void;
  /** Begin a show-jumping race from the glowing square behind the arch. An active
   *  riding quest may start dismounted (the server lends its training horse);
   *  repeat racers must already be mounted. Enters the movement-locked 3..2..1
   *  countdown, then the timed lap. The HUD's Start Race button calls this.
   *  Server-authoritative; rules live in src/sim/mount_race.ts. */
  mountRaceStart(): void;
  /** Exit the player's current countdown or timed lap. Server-authoritative;
   *  emits the normal abandoned race end and leaves a riding lesson retryable. */
  mountRaceCancel(): void;
  /** Whether the player has a live riding lesson in progress. Retained for
   *  compatibility; events update it immediately and the authoritative self
   *  snapshot reconciles it after reconnects. */
  mountLessonActive(): boolean;
  /** The player's OWN active show-jumping race in the stables paddock, or null
   *  when not racing. The HUD strip, the countdown, and the ground racing line
   *  all key off this read. Server-authoritative; rules live in
   *  src/sim/mount_race.ts. Events update it immediately and the authoritative
   *  self snapshot reconciles it after reconnects. */
  mountRaceView(): MountRaceView | null;
}

// Render-safe projection of the player's own active race. `phase` is 'countdown'
// (pre-GO, showing 3..2..1) or 'racing' (the timed lap); `clearedMask` is the
// bitset of cleared jumps and `cleared` its popcount; `jumpsTotal` the whole
// course. `goTicksLeft` is the countdown remaining in sim ticks (phase
// 'countdown'); `ticksLeft`/`timeLimitTicks` are the lap timer + full budget
// (phase 'racing', for the strip bar). Jumps clear in any order.
export interface MountRaceView {
  raceId: string;
  phase: 'countdown' | 'racing';
  clearedMask: number;
  cleared: number;
  jumpsTotal: number;
  goTicksLeft: number;
  ticksLeft: number;
  timeLimitTicks: number;
}
