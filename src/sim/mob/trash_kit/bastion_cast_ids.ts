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

/** The Bastion trash casts a player interrupt can lock out, by school. The
 *  sweeps, the slam and the Piercing Bolt are absent on purpose: dodge those. */
export const BASTION_KIT_CAST_SCHOOLS: Readonly<Record<string, { school: Aura['school'] }>> = {
  [BASTION_BRINE_MEND]: { school: 'nature' },
  [BASTION_FOG_WARD]: { school: 'frost' },
};
