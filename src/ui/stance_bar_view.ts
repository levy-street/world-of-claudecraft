// Pure view-core for the stance-style choice bar: maps the player's known stance
// or aura abilities plus the currently-worn choice to a small render model the painter
// (Hud.renderStanceBar) turns into clickable buttons. DOM/i18n/Three-free and
// instance-agnostic, so a Vitest drives it directly against either world shape.
//
// It shows for warriors and paladins. Spec and level filtering already happens
// upstream in abilitiesKnownAt, so this core only consumes the ids handed to it.

export const WARRIOR_STANCE_GROUP = 'warrior_stance';
export const PALADIN_DEVOTION_GROUP = 'paladin_devotion';

export function isStanceBarAbilityGroup(group: string | undefined): boolean {
  return group === WARRIOR_STANCE_GROUP || group === PALADIN_DEVOTION_GROUP;
}

export interface StanceSlot {
  /** Stance ability id: the cast target and the icon key. */
  id: string;
  /** Icon identity the painter resolves + elides by (equals `id`). */
  iconKey: string;
  /** Whether this stance is the one currently worn (drives the active ring). */
  active: boolean;
}

export interface StanceBarModel {
  /** False hides the bar entirely (non-warrior, or no stance known yet). */
  visible: boolean;
  slots: StanceSlot[];
  /** Byte-stable rebuild key: the painter skips the DOM rebuild when unchanged. */
  sig: string;
}

const HIDDEN: StanceBarModel = { visible: false, slots: [], sig: 'hidden' };

export function activeStanceBarAbilityId(
  knownAbilityIds: readonly string[],
  auras: readonly { id: string; sourceId: number }[],
  ownerId: number,
): string | null {
  const known = new Set(knownAbilityIds);
  return auras.find((aura) => aura.sourceId === ownerId && known.has(aura.id))?.id ?? null;
}

// Build the render model. `knownStanceIds` is the ordered list of stance ability
// ids the player currently knows (host filters `sim.known` by the exclusiveGroup);
// `activeStanceId` is the id of the worn stance aura, or null.
export function stanceBarView(
  playerClass: string,
  knownStanceIds: readonly string[],
  activeStanceId: string | null,
): StanceBarModel {
  if ((playerClass !== 'warrior' && playerClass !== 'paladin') || knownStanceIds.length === 0)
    return HIDDEN;
  const slots: StanceSlot[] = knownStanceIds.map((id) => ({
    id,
    iconKey: id,
    active: id === activeStanceId,
  }));
  const sig = `${activeStanceId ?? ''}|${knownStanceIds.join(',')}`;
  return { visible: true, slots, sig };
}
