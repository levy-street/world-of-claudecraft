// Pure view-core for the warrior stance bar: maps the player's known stance
// abilities plus the currently-worn stance to a small render model the painter
// (Hud.renderStanceBar) turns into clickable buttons. DOM/i18n/Three-free and
// instance-agnostic, so a Vitest drives it directly against either world shape.
//
// The stance bar shows ONLY for warriors and ONLY the stances valid for their
// spec (Arms/Prot: Battle + Guarded; Fury: Berserker; no spec: Battle). That
// spec filtering already happens upstream in abilitiesKnownAt, so this core just
// consumes the known-stance ids the host hands it (identified by the shared
// exclusiveGroup 'warrior_stance'), never re-deriving the gate.

export const WARRIOR_STANCE_GROUP = 'warrior_stance';

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

// Build the render model. `knownStanceIds` is the ordered list of stance ability
// ids the player currently knows (host filters `sim.known` by the exclusiveGroup);
// `activeStanceId` is the id of the worn stance aura, or null.
export function stanceBarView(
  isWarrior: boolean,
  knownStanceIds: readonly string[],
  activeStanceId: string | null,
): StanceBarModel {
  if (!isWarrior || knownStanceIds.length === 0) return HIDDEN;
  const slots: StanceSlot[] = knownStanceIds.map((id) => ({
    id,
    iconKey: id,
    active: id === activeStanceId,
  }));
  const sig = `${activeStanceId ?? ''}|${knownStanceIds.join(',')}`;
  return { visible: true, slots, sig };
}
