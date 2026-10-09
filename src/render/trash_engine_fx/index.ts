// The trash engine's visuals (public surface): TrashEngineFx, hosted by
// ../rift_death_zone.ts, the object test ../gate_objects.ts uses to give the
// engine's encounter objects an empty anchor, and the line-of-sight field's
// floor surface any blast that stops at cover lays (Cantor Ilvane's Dirge,
// ../hollow_crypt/ilvane_dirge_fx.ts). See CLAUDE.md in this folder.

export {
  SIGHT_DRAPE_BUDGET,
  SIGHT_FIELD_VERT,
  SIGHT_SHADE_GLSL,
  SIGHT_STEEP_GLSL,
  SightFieldSurface,
} from './sight_field';
export { sightStations } from './sight_field_core';
export { TrashEngineFx } from './trash_engine_fx';
export { isTrashEngineObject, NOVA_RAYS, sightReach } from './trash_engine_fx_core';
