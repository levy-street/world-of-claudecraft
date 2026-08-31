// Which dungeon interiors prewarm encounter character programs at first
// attach: the catalog Soul Rend clones plus the live player visuals already in
// the room. Boot never pays this; the outdoor zone prewarm stops at the dungeon
// door.
//
// Deliberately NOT the encounter's own NPC. Brother Aldric was the first
// suspect and the A/B says he is innocent: entering the arena from a start zone
// that had never compiled npc_aldric, his 70% spawn still linked ZERO programs
// and cost 29ms, because his rig shares its programs with the player bodies
// already on screen. Warming a model that costs nothing is work, not a fix.
import type { PlayerClass } from '../sim/types';

export interface InteriorEncounterPrewarmSpec {
  soulRendPlayerClasses: boolean;
  soulRendVfxWeaponSkins: boolean;
  soulRendLivePlayerVisuals: boolean;
  varkhulVisuals?: boolean;
  ignivarVisuals?: boolean;
}

export const INTERIOR_ENCOUNTER_PREWARM: Record<string, InteriorEncounterPrewarmSpec> = {
  nythraxis: {
    soulRendPlayerClasses: true,
    soulRendVfxWeaponSkins: true,
    soulRendLivePlayerVisuals: true,
  },
  ignivar_depths: {
    soulRendPlayerClasses: false,
    soulRendVfxWeaponSkins: false,
    soulRendLivePlayerVisuals: false,
    varkhulVisuals: true,
    ignivarVisuals: true,
  },
};

export function encounterPrewarmForInterior(interior: string): InteriorEncounterPrewarmSpec | null {
  return INTERIOR_ENCOUNTER_PREWARM[interior] ?? null;
}

export function encounterPrewarmDisabled(search: string): boolean {
  const value = new URLSearchParams(search).get('encounterPrewarm');
  return value === '0' || value === 'off';
}

// vfxModels has no default on purpose: an empty catalog warms NOTHING, and a
// module whose whole job is warming must not have "warm nothing" as its
// fallback. The caller names the VFX table it means.
export function vfxWeaponSkinIds(
  skins: Record<string, { id: string; model: string }>,
  vfxModels: Record<string, unknown>,
): string[] {
  const ids: string[] = [];
  for (const skin of Object.values(skins)) {
    if (vfxModels[skin.model]) ids.push(skin.id);
  }
  return ids;
}

export interface InteriorEncounterPrewarmPlan {
  playerClasses: PlayerClass[];
  weaponSkinIds: string[];
}

export function planInteriorEncounterPrewarm(
  spec: InteriorEncounterPrewarmSpec,
  opts: {
    playerClasses: readonly PlayerClass[];
    weaponSkinIds: readonly string[];
  },
): InteriorEncounterPrewarmPlan {
  return {
    playerClasses: spec.soulRendPlayerClasses ? [...opts.playerClasses] : [],
    weaponSkinIds: spec.soulRendVfxWeaponSkins ? [...opts.weaponSkinIds] : [],
  };
}

/** What a body is HOLDING, the only part of a live look that re-keys the mark. */
export interface LiveSoulRendLook {
  weaponSkinId: string | null;
  mainhandItemId: string | null;
  offhandItemId: string | null;
}

// No entity id in the key: the caller holds one warmed set PER VISUAL, and a
// visual belongs to one body, so an id would say nothing the map does not
// already say (and forced a reverse scan to recover it).
//
// The HELD look is in the key, not just the worn skin, because the mark repaints
// whatever the visual snapshotted as its original materials, and setWeapon and
// setOffhand both re-run finishWeaponAttach, which re-snapshots that map with
// the new weapon's meshes. A sheathe toggle re-clones the SAME materials, so it
// composes the same program key and deliberately does not re-key here. A null
// look is a body that holds nothing it can swap: a form rig.
export function liveSoulRendPrewarmIdentity(look: LiveSoulRendLook | null): string {
  if (!look) return '';
  return `${look.weaponSkinId ?? ''}|${look.mainhandItemId ?? ''}|${look.offhandItemId ?? ''}`;
}

export function shouldQueueLiveSoulRendPrewarm(opts: {
  disabled: boolean;
  spec: InteriorEncounterPrewarmSpec | null;
  kind: string;
  shutdown: boolean;
  already: boolean;
}): boolean {
  // No materialCount arm: the slots are built AFTER this decision, on an idle
  // slot, so no caller here can know the count. An empty rig is caught there.
  if (opts.disabled || !opts.spec?.soulRendLivePlayerVisuals) return false;
  return opts.kind === 'player' && !opts.shutdown && !opts.already;
}
