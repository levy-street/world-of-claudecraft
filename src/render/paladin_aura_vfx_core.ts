const AUTHORED = new Set([
  'guardian_covenant',
  'faithforged_guard',
  'sun_gods_verdict',
  'beacon_of_light',
  // Auras whose own visuals announce them, so the generic gain swirl would
  // only double them: the wings, the sprint, the plates and shields, the halo,
  // the dome and the veil. (Requital Aura and the Devotions are claimed after
  // this check, by painter.onWarriorControlAura, which draws their rings.)
  'avenging_wrath',
  'solar_step',
  'divine_protection',
  'sacred_form',
  'life_covenant',
  'aegis_first_dawn',
  'bastion_rite',
  'holy_shield',
  'veilbound_march',
  // Ascension's vow-ward from Vowkeeper Strike (vowkeeper_strike_absorb).
  'vowkeeper_strike',
]);
const LEGACY_NAMES = new Set([
  'Guardian Covenant',
  'Debt of Light',
  'Verdict of the Sun God',
  'Beacon of Light',
]);

/** The ability an aura id belongs to: its own id, or a part of it
 * (`avenging_wrath_buff_healing_done`, `aegis_first_dawn_dr:994`). */
function authoredRoot(id: string): boolean {
  if (AUTHORED.has(id)) return true;
  for (const root of AUTHORED) if (id.startsWith(`${root}_`)) return true;
  return false;
}

/** These aura renderers own their whole lifetime, including application accents. */
export function hasAuthoredPaladinAura(event: { abilityId?: string; name: string }): boolean {
  return event.abilityId ? authoredRoot(event.abilityId) : LEGACY_NAMES.has(event.name);
}
