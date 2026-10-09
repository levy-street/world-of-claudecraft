// The Gravewyrm Sanctum trash kit's cast ids, as a dependency-free leaf (the
// Hollow Crypt's live in cast_ids.ts, the Bastion's in bastion_cast_ids.ts, the
// Temple's in temple_cast_ids.ts, the Basin's in wildheart_cast_ids.ts): the
// content (gravewyrm_sanctum.ts), the kit driver, the interrupt table
// (mob/healer_channel.ts) and the renderer's telegraph table all key on these.
//
// docs/design/dungeon-rework/gravewyrm_sanctum.md section 5.1.

import { GOADSMITH_RERIVET } from '../../encounters/gravewyrm_sanctum/boss_ids';
import type { Aura } from '../../types';

/** Sanctum Scaleguard: a telegraphed breath of cinders across its front
 *  (breathCone). Step out. */
export const SANCTUM_CINDER_BREATH = 'sanctum_cinder_breath';
/** Broodsworn Thawcaller: an interruptible soulfire heal on a hurt ally
 *  (trashKit.mend). Kick it. */
export const SANCTUM_WARMING_RITE = 'sanctum_warming_rite';
/** Broodsworn Goadsmith: an interruptible goad that enrages one ally
 *  (trashKit.goad). Kick it. */
export const SANCTUM_GOAD = 'sanctum_goad';
/** The damage-done aura a Goad leaves on its ally. */
export const SANCTUM_GOADED = 'sanctum_goaded';
/** Broodsworn Pyre-Tender: plants a Soul Brazier beside her (trashKit.call). */
export const SANCTUM_PLANT_BRAZIER = 'sanctum_plant_brazier';
/** Soul Brazier: its soulfire quickens every ally near it (trashKit.stoke). */
export const SANCTUM_SOULFIRE_STOKE = 'sanctum_soulfire_stoke';
/** The attack-speed aura a Soul Brazier keeps on the allies near it. */
export const SANCTUM_STOKED = 'sanctum_stoked';
/** Rime Whelp: it bursts in a puff of hoarfrost as it dies, a small slowing
 *  ring (trashKit.deathBurst with a slow). */
export const SANCTUM_HOARFROST_POP = 'sanctum_hoarfrost_pop';
/** Ogre Sledge-Hauler: a block of ice hurled at the farthest player, onto a
 *  ring painted where they stood (trashKit.toss). Step out. */
export const SANCTUM_ICE_BLOCK_TOSS = 'sanctum_ice_block_toss';
/** Glacier Splinter: it shatters where it fell 2 s after it dies
 *  (trashKit.deathBurst). Step away from the body. */
export const SANCTUM_SHATTER = 'sanctum_shatter';

// ---- The trash mechanics pass (E:/woc/entregas/investigacion/
// MECANICAS_TRASH.md section 8, on the trash engine's generic keys) ----------

/** Broodsworn Thawcaller: an interruptible 3 s rite on a fallen Boneguard's
 *  corpse that raises it as a Raised Bonewalker (trashKit.reanimate). Kick it. */
export const SANCTUM_THAW_THE_HELD = 'sanctum_thaw_the_held';
/** Sanctum Scaleguard: a 1 s bar, then its spiked tail lashes the cone behind
 *  it (trashKit.tailLash). With the Cinder Breath in front, only its flanks
 *  are safe. */
export const SANCTUM_COUNTERWEIGHT_LASH = 'sanctum_counterweight_lash';
/** Sanctum Scaleguard, heroic: where the Cinder Breath lands the ice melts to
 *  scalding water for 5 s (trashKit.breathPool; also the pool's object
 *  template, scale = radius). */
export const SANCTUM_BOILING_MELTWATER = 'sanctum_boiling_meltwater';
/** Broodsworn Goadsmith: an interruptible 2 s bar that brands one player who
 *  stays in its sight (trashKit.brand). Kick it, hide, or douse it in
 *  meltwater. */
export const SANCTUM_BRANDING_IRON = 'sanctum_branding_iron';
/** The burning brand the Branding Iron leaves (a dot aura; quench zones put
 *  it out). */
export const SANCTUM_BRANDED = 'sanctum_branded';
/** Soul Brazier: a player in reach kicks it over (trashKit.usable, the G3
 *  use; the cast id carries KIT_USE_CAST_PREFIX). */
export const SANCTUM_TOPPLE_BRAZIER = 'kituse_sanctum_topple_brazier';
/** The soulfire a toppled brazier spills: a pool that burns the cult's own
 *  trash standing in it (the hazard's name id and its object template). */
export const SANCTUM_SPILLED_SOULFIRE = 'sanctum_spilled_soulfire';
/** Rime Whelp: a short-bar frost breath at the one it fights
 *  (trashKit.cone). Step out of its front. */
export const SANCTUM_RIME_BREATH = 'sanctum_rime_breath';
/** The stacking chill the Rime Breath leaves (a slow aura with stacks). */
export const SANCTUM_CREEPING_RIME = 'sanctum_creeping_rime';
/** Five stacks of Creeping Rime: frozen in place (a stun). */
export const SANCTUM_ICED_OVER = 'sanctum_iced_over';
/** Ogre Sledge-Hauler: the block of its Ice Block Toss stays where it lands
 *  as a wall for 15 s (toss.leavesWall; the wall object's template, a shape
 *  in instances/combat_wall_state.ts COMBAT_WALL_SHAPES). */
export const SANCTUM_ICE_SLAB = 'sanctum_ice_slab';
/** Glacier Splinter: at half health it splits in two smaller splinters
 *  (trashKit.split; the split's spellfx). */
export const SANCTUM_FRACTURE = 'sanctum_fracture';

/** The Sanctum trash casts a player interrupt can lock out, by school. The
 *  brazier plant (kill the brazier), the breath and the toss (step out) are
 *  absent on purpose, and so are the tail lash and the Rime Breath (dodge
 *  them). */
export const SANCTUM_KIT_CAST_SCHOOLS: Readonly<Record<string, { school: Aura['school'] }>> = {
  [SANCTUM_WARMING_RITE]: { school: 'shadow' },
  [SANCTUM_GOAD]: { school: 'fire' },
  [SANCTUM_THAW_THE_HELD]: { school: 'shadow' },
  [SANCTUM_BRANDING_IRON]: { school: 'fire' },
  // Korgath's heroic Re-rivet: the Goadsmith's 6 s channel at a broken pillar.
  [GOADSMITH_RERIVET]: { school: 'fire' },
};
