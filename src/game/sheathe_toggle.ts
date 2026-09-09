// The sheathe keybind's one rule, shared by the keyboard dispatch and the
// gamepad dispatch in src/main.ts (which each carried a verbatim copy): the
// world owns the gate (dead-gate, combat auto-unsheathe), so the cue plays only
// when the stow state actually moved, and which cue plays follows the state
// the toggle landed on. Extracted (the Masterwrought Phase 18 sweep) so main.ts
// stays a firewall and the rule is unit-tested once instead of pinned twice
// as source text.

import type { IWorld } from '../world_api';

/** The two cues the toggle can play; audio.ts's GameAudio satisfies it. */
export interface SheatheCue {
  weaponSheathe(): void;
  weaponUnsheathe(): void;
}

/** Toggle the cosmetic weapon stow and play the matching cue, but only when
 *  the state moved (the world may refuse: dead, or auto-unsheathed by combat). */
export function toggleSheatheWithCue(
  world: Pick<IWorld, 'player' | 'toggleWeaponStow'>,
  cue: SheatheCue,
): void {
  const wasStowed = world.player.weaponStowed;
  world.toggleWeaponStow();
  if (world.player.weaponStowed === wasStowed) return;
  if (world.player.weaponStowed) cue.weaponSheathe();
  else cue.weaponUnsheathe();
}
