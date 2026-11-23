// The Sunken Bastion trash kit's cast ids, as a dependency-free leaf (the
// Hollow Crypt's live in cast_ids.ts): the content (sunken_bastion.ts), the
// kit driver, the interrupt table (mob/healer_channel.ts) and the renderer's
// telegraph table all key on these strings.

import type { Aura } from '../../types';

/** Tidebound Acolyte: an interruptible heal on the most injured ally. */
export const BASTION_BRINE_MEND = 'bastion_brine_mend';
/** Mistweaver: an interruptible fog shield on the most injured ally. */
export const BASTION_FOG_WARD = 'bastion_fog_ward';
/** Drowned Watchman: a telegraphed halberd sweep across its front (breathCone). */
export const BASTION_HALBERD_SWEEP = 'bastion_halberd_sweep';
/** Fogbound Arbalest: a telegraphed shot down a lane (trashKit.line). */
export const BASTION_PIERCING_BOLT = 'bastion_piercing_bolt';
/** The Turretback Hermit: a wide claw sweep across its front (breathCone). */
export const BASTION_CLAW_SWEEP = 'bastion_claw_sweep';
/** The Turretback Hermit: its tower-shell slammed down round it (trashKit.wingGust). */
export const BASTION_SHELL_SLAM = 'bastion_shell_slam';

// The trash mechanics pass (bastion_kit.ts): a second readable job per type.
/** Drowned Watchman: a telegraphed hook down a lane; whoever it catches is
 *  dragged to the watchman's feet (trashKit.hook). Physical: step aside. */
export const BASTION_BOATHOOK = 'bastion_boathook';
/** Drowned Watchman (heroic): the ward two watchmen side by side share. */
export const BASTION_HALBERD_WALL = 'bastion_halberd_wall';
/** Fogbound Arbalest: the cue as it leaps back from a melee (trashKit.fallBack). */
export const BASTION_FALL_BACK = 'bastion_fall_back';
/** Barnacle Crawler: the corpse-feeding stacks (trashKit.gorge). */
export const BASTION_CARRION_GLUT = 'bastion_carrion_glut';
/** Barnacle Crawler: its Brine Burst where it fell (trashKit.deathBurst). */
export const BASTION_BRINE_BURST = 'bastion_brine_burst';
/** Mist Chanter (id mistweaver): an interruptible cast that lays a fog patch
 *  under the tank; its allies inside take less damage (trashKit.fogBank). */
export const BASTION_FOG_BANK = 'bastion_fog_bank';
/** The damage ward a Fog Bank lays on the allies standing in it. */
export const BASTION_FOG_SHROUD = 'bastion_fog_shroud';
/** Tidebound Acolyte: an interruptible channel that roots one player in a
 *  column of sea water and drowns them while it runs (trashKit.column). Also
 *  the root's aura id. */
export const BASTION_BRINE_COLUMN = 'bastion_brine_column';
/** Shackled Prisoner: its chains break low on health and it stops fighting
 *  (trashKit.unshackle): the aura and the break cue. */
export const BASTION_SNAPPED_FETTERS = 'bastion_snapped_fetters';
/** The cue as a freed prisoner fades from the fight. */
export const BASTION_FETTERS_RELEASE = 'bastion_fetters_release';
/** Object templates the Bastion trash kit lays on the floor (the renderer
 *  draws them itself): the Fog Bank's patch. */
export const BASTION_FOG_BANK_CLOUD = 'bastion_fog_bank_cloud';
export const BASTION_TRASH_OBJECT_TEMPLATES: readonly string[] = [BASTION_FOG_BANK_CLOUD];

// The trash pass's second wave (the engine's G6 sight rule and G5 walker).
/** Drowned Sergeant: an interruptible shout that marks one player for every
 *  arbalest of its pack (trashKit.bastion.order, bastion_order.ts). */
export const BASTION_LOOSE_ON_MY_MARK = 'bastion_loose_on_my_mark';
/** An arbalest's bolt loosed on the sergeant's mark (the hit), and the one a
 *  wall stopped. */
export const BASTION_MARKED_BOLT = 'bastion_marked_bolt';
export const BASTION_MARKED_BOLT_BLOCKED = 'bastion_marked_bolt_blocked';
/** Bastion Revenant: the sea-light that leaves its throat when it falls (a
 *  walker, launch 'death'): its launch id, its object template, and the
 *  surge it lays on the packmate it reaches. */
export const BASTION_THROATLIGHT = 'bastion_throatlight';
export const BASTION_THROATLIGHT_ORB = 'bastion_throatlight_orb';
export const BASTION_DROWNED_SURGE = 'bastion_drowned_surge';

/** The Bastion trash casts a player interrupt can lock out, by school. The
 *  sweeps, the slam, the Piercing Bolt and the hook are absent on purpose:
 *  dodge those. */
export const BASTION_KIT_CAST_SCHOOLS: Readonly<Record<string, { school: Aura['school'] }>> = {
  [BASTION_BRINE_MEND]: { school: 'nature' },
  [BASTION_FOG_WARD]: { school: 'frost' },
  [BASTION_FOG_BANK]: { school: 'frost' },
  [BASTION_BRINE_COLUMN]: { school: 'nature' },
  [BASTION_LOOSE_ON_MY_MARK]: { school: 'nature' },
};
