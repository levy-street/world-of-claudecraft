// The Gourdlight Eve tricks' bodies (src/sim/seasonal/: a trick-or-treat trick
// or the Jar of Mischief): for a few seconds the player wears a bat's or a
// skeleton's body; a costume draught wears a skeleton's, a ghost's or a bat's for ten
// minutes, and a drink from the Gurglegreen Cauldron the treasure goblin's for the toy's
// duration (content/gourdlight_eve.ts). They ride the polymorph SLOT's look only (its lazy
// build and its compile gate, form_rig_sync.ts), never its control: the aura is kind
// 'seasonal_cosmetic', which no sim rule reads. Both bodies are the shipped
// creatures' own rigs and clips, sized to a player.
import type { VisualDef } from './manifest';

/** The ghost costume's moonlit white. */
export const GHOST_COSTUME_TINT = 0xdfe9ff;

/** The trick and costume bodies, derived from the creature defs already in `visuals`. */
export function seasonalTrickLooks(
  visuals: Readonly<Record<string, VisualDef>>,
): Record<string, VisualDef> {
  const out: Record<string, VisualDef> = {};
  const bat = visuals.mob_hoard_bat_swarmling;
  if (bat)
    out.form_trick_bat = {
      ...bat,
      lazyPreload: true,
      height: 1.25,
      hover: 0.55,
      tint: 0x6a5a6a,
      tintStrength: 0.35,
    };
  const skeleton = visuals.skel_minion;
  if (skeleton) out.form_trick_skeleton = { ...skeleton, height: 2.05, tint: undefined };
  // The ghost costume: the Veiled Hollow's spirit rig, drawn a player's height and floating,
  // in a pale moonlit white (its own material, tinted, never the entity colour).
  const ghost = visuals.mob_ghost;
  if (ghost) {
    out.form_costume_ghost = {
      ...ghost,
      height: 2.2,
      hover: 0.45,
      tint: GHOST_COSTUME_TINT,
      tintStrength: 0.55,
    };
  }
  // The Gurglegreen Cauldron's goblin (round 11): the Buried Hoards' treasure goblin, the
  // Coinsack Scurrier, sack of stolen gold and all, on its own KayKit rig and clips (idle,
  // walk, run), drawn a head shorter than a player so the drinker reads as a goblin at once.
  const goblin = visuals.mob_hoard_coinsack_scurrier;
  if (goblin) out.form_costume_goblin = { ...goblin, lazyPreload: true, height: 1.75 };
  // Thatchbound's puppets (Old Thatchgrin's mind control, src/sim/seasonal/scarecrow_puppet.ts):
  // the first victim of a cast becomes a little straw scarecrow, his own strawling's rig a
  // touch shorter than a player (its ember eyes lit, the read that it is HIS), the second a
  // crow, the crypt crow's rig grown to a player's size and dropped near the ground so it
  // stalks its friend rather than circling overhead.
  const strawling = visuals.mob_gourdlight_strawling;
  if (strawling) out.form_puppet_strawling = { ...strawling, height: 1.85 };
  const crow = visuals.mob_crypt_crow;
  if (crow) out.form_puppet_crow = { ...crow, height: 1.6, hover: 0.7 };
  return out;
}
