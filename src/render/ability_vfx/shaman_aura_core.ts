// Exact ownership only. The event's stable ID survives consumed/expired state;
// older name-only events require a matching real recipient aura snapshot.
const SHAMAN_AURA_IDS: ReadonlySet<string> = new Set([
  'rockbiter_weapon',
  'flametongue_weapon',
  'galeheart_weapon',
  'lifespring_weapon',
  'lightning_shield',
  'elemental_mastery',
  'elemental_mastery_instant',
  'elemental_mastery_vent',
  'elemental_trance',
  'ghost_wolf',
  'bloodlust',
  'bloodlust_spell',
  'earthbind',
  'earthbind_root',
  'earthbind_slow',
  'flame_shock',
  'frost_shock',
  'unleash_weapon',
  'shaman_thunder_charges',
  'shaman_warspirit_cadence',
  'shaman_stormcast',
  'shaman_stormcast_cheap',
  'shaman_stormsurge_ready',
  'shaman_stonebound_armor',
  'shaman_stonebound_stamina',
  'shaman_stonebound_dr',
  'shaman_stonebound_ward_smooth',
  'shaman_stoneward',
  'shaman_primal_exaltation',
  'shaman_mending_current',
  'shaman_echoing_elements_heal',
  'shaman_echoing_elements_damage',
  'shaman_echoing_elements_stormcast',
  'shaman_living_weapon_absorb',
  'shaman_living_weapon_bolt',
  'shaman_galeheart_unleash_haste',
  'shaman_stonebound_unleash_guard',
  'shaman_flowing_elements',
  'shaman_wayfarer_grace',
  'shaman_flow_state_progress',
  'shaman_flow_state_ready',
  'shaman_ward_cycle_icd',
  'shaman_gathering_winds_icd',
  'shaman_wayfarer_grace_icd',
  'shaman_ancestral_bulwark_icd',
  'shaman_ancestral_bulwark',
  'shaman_warded_elements',
  'shaman_gathering_winds',
]);
interface AuraEvent {
  readonly targetId: number;
  readonly name: string;
  readonly gained: boolean;
  readonly abilityId?: string;
  readonly sourceId?: number;
  readonly auraKind?: string;
}
interface Recipient {
  readonly id: number;
  readonly auras: readonly {
    readonly id: string;
    readonly name?: string;
    readonly kind?: string;
    readonly sourceId?: number;
  }[];
}

// Exhaustion is shared with Mage. Claim it only alongside the real Chorus
// recipient state from the same caster; a name alone never grants ownership.
function chorusExhaustion(event: AuraEvent, recipient?: Recipient): boolean {
  if (!recipient || recipient.id !== event.targetId) return false;
  const exhaustion = recipient.auras.find(
    (a) =>
      a.id === 'sated' &&
      a.kind === 'sated' &&
      (event.sourceId === undefined || a.sourceId === event.sourceId),
  );
  return (
    exhaustion?.sourceId !== undefined &&
    recipient.auras.some(
      (a) =>
        a.sourceId === exhaustion.sourceId &&
        ((a.id === 'bloodlust' && a.kind === 'buff_haste') ||
          (a.id === 'bloodlust_spell' && a.kind === 'buff_spellhaste')),
    )
  );
}

/** Does this gain belong to Shaman presentation, rather than generic gold confetti? */
export function isShamanAuraEvent(event: AuraEvent, recipient?: Recipient): boolean {
  if (!event.gained) return false;
  // Explicit attribution is authoritative even if the aura was consumed again
  // in the same simulation tick. A different ID never falls back by name.
  if (event.abilityId !== undefined)
    return event.abilityId === 'sated'
      ? chorusExhaustion(event, recipient)
      : SHAMAN_AURA_IDS.has(event.abilityId);
  if (!recipient || recipient.id !== event.targetId) return false;
  let owned = false;
  for (const aura of recipient.auras) {
    if (aura.name !== event.name) continue;
    if (event.auraKind !== undefined && aura.kind !== event.auraKind) continue;
    if (event.sourceId !== undefined && aura.sourceId !== event.sourceId) continue;
    // Ambiguous legacy events must not suppress an unrelated same-name aura.
    if (
      !SHAMAN_AURA_IDS.has(aura.id) &&
      !(aura.id === 'sated' && chorusExhaustion(event, recipient))
    )
      return false;
    owned = true;
  }
  return owned;
}
