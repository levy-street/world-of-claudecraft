// Re-export shim. combatAbilityName and parseSimMoney live in
// ./entity_display_core since the Phase 18 sweep folded the entity_display
// family into that one pure leaf; this path survives only for the
// coordinator's import surface (src/ui/hud.ts imports them by this name) and
// goes the day hud.ts re-points. Import the core directly from any new code.
export { combatAbilityName, parseSimMoney } from './entity_display_core';
