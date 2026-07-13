// The starter tutorial's MAP: Dawnhaven Isle.
//
// Map only. The per-class step script is presentation data (it names i18n keys),
// so it lives with the director in `src/ui/starter_tutorial_script.ts`, not here.
//
// Nothing here is spread into the built-in world's spatial arrays. `data.ts`
// merges only the LOOKUP tables (mobs, quests, and the `dynamic`-marked NPC
// registry) so runtime resolution by id works; the isle itself ships as the
// standalone `DAWNHAVEN_WORLD` bundle the offline tutorial Sim boots against.

export {
  DAWNHAVEN_AMBUSH,
  DAWNHAVEN_ASSET_SIZES,
  DAWNHAVEN_BLOCKERS,
  DAWNHAVEN_CAMPS,
  DAWNHAVEN_HOLLOW,
  DAWNHAVEN_KNOLL,
  DAWNHAVEN_LANDING,
  DAWNHAVEN_MOBS,
  DAWNHAVEN_NPC_REGISTRY,
  DAWNHAVEN_NPCS,
  DAWNHAVEN_OBJECTS,
  DAWNHAVEN_PLACEMENTS,
  DAWNHAVEN_QUESTS,
  DAWNHAVEN_SEED,
  DAWNHAVEN_TERRAIN,
  DAWNHAVEN_WARDEN_POS,
  DAWNHAVEN_WORLD,
  DAWNHAVEN_YARD,
  DAWNHAVEN_ZONE,
  placedHeightYd,
} from './isle';
