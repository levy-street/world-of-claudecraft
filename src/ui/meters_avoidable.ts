// Avoidable Damage registry and detection core for raid combat analysis.
// Encounter designers register telegraphed, environmental, or avoidable abilities here
// or via registerAvoidableAbility(). Damage meter uses this to aggregate avoidable intake.

/** Known telegraphed boss and environmental abilities that players can avoid. */
const AVOIDABLE_ABILITY_NAMES = new Set<string>([
  // Ignivar encounter
  'Searing Torrent',
  'Forge Judgment',
  'Forge Wave',
  'Meteor',
  'Brand of the Pyre',
  'Molten Blast',
  'Lava Pool',
  'Magma Pool',
  'Fire Trail',

  // Korzul / Gravewyrm encounter
  'Grave Inferno',
  'Void Zone',
  'Necrotic Spit',

  // Nythraxis encounter
  'Soul Rend',
  'Bone Storm',
  'Gravefire',
  'Sigil Unbound',
  'Spike Shatter',

  // Varkhul encounter
  'Worldfire',
  'Worldfire Consumed',
  'Forge Flame',
  'Overheat',

  // Common environmental / floor hazards
  'Falling',
  'Falling Rock',
  'Poison Cloud',
  'Toxic Pool',
  'Frost Blast',
]);

/** Stable content ability IDs that represent avoidable mechanics. */
const AVOIDABLE_ABILITY_IDS = new Set<string>([
  'ignivar_frontal',
  'ignivar_forge_wave',
  'ignivar_meteor',
  'ignivar_brand',
  'korzul_inferno',
  'nythraxis_bone_storm',
  'nythraxis_gravefire',
  'varkhul_worldfire',
  'env_lava',
  'env_falling',
]);

/**
 * Check if a damage ability/event represents avoidable damage.
 * Checks both display name and stable abilityId.
 */
export function isAvoidableDamage(
  abilityName: string | null | undefined,
  abilityId?: string | null,
): boolean {
  if (abilityId && AVOIDABLE_ABILITY_IDS.has(abilityId)) return true;
  if (!abilityName) return false;
  return AVOIDABLE_ABILITY_NAMES.has(abilityName);
}

/**
 * Register a new ability name or ID as avoidable damage.
 * Designed for encounter designers when creating new raid bosses or mechanics.
 */
export function registerAvoidableAbility(nameOrId: string): void {
  if (!nameOrId) return;
  AVOIDABLE_ABILITY_NAMES.add(nameOrId);
  AVOIDABLE_ABILITY_IDS.add(nameOrId);
}

/**
 * Unregister an ability from avoidable damage (used in testing or re-tuning).
 */
export function unregisterAvoidableAbility(nameOrId: string): void {
  AVOIDABLE_ABILITY_NAMES.delete(nameOrId);
  AVOIDABLE_ABILITY_IDS.delete(nameOrId);
}
