// Re-export shim. entityDisplayName lives in ./entity_display_core since the
// Phase 18 sweep folded the entity_display family into that one pure leaf;
// this path survives only for the coordinator's import surface (src/ui/hud.ts
// imports it by this name) and goes the day hud.ts re-points. Import the core
// directly from any new code.
export { entityDisplayName } from './entity_display_core';
