import type { PlayerClass } from '../sim/types';

// Pure decision core for the Glitch single-character pre-game screen. It maps the
// player's current server character plus the aspects they chose on the screen
// (class, name, appearance skin) to the one action Enter World should take, with
// no DOM, network, or i18n dependency so a Vitest imports it directly. This is the
// single source of truth for BOTH what the button does and what behavioral event
// is emitted, so the two can never drift (mirrors src/net/charselect_action.ts).

export interface GlitchExistingCharacter {
  class: PlayerClass;
  skin: number;
  name: string;
  level: number;
  online: boolean;
  forceRename: boolean;
}

export interface GlitchChosenCharacter {
  class: PlayerClass;
  skin: number;
  name: string;
}

// The primary outcome. `takeover` and `needsConfirm` are modifiers that can ride
// on `rename`/`reroll`/`enter`; `blocked` overrides everything with a `reason`.
export type GlitchCharselectActionKind = 'enter' | 'rename' | 'reroll' | 'blocked';

export type GlitchCharselectBlockReason = 'name_required' | 'name_invalid' | 'rename_required';

export interface GlitchCharselectAction {
  kind: GlitchCharselectActionKind;
  // A re-roll deletes the existing character and creates a fresh one, so it needs
  // a destructive confirmation ONLY when there is progress to lose (level > 1).
  needsConfirm: boolean;
  // The existing character is live in another session: displace it before entering.
  takeover: boolean;
  // Set only when kind === 'blocked'.
  reason: GlitchCharselectBlockReason | null;
}

// Stable behavioral-event keys for the screen. step_key is the Glitch reports
// "stage/screen"; the action_keys are what happened within it. Kept here so the
// wiring in main.ts and any test reference the same machine keys (never labels).
export const GLITCH_CHAR_STEP_KEY = 'character_create';

export const GLITCH_CHAR_ACTION = {
  open: 'open',
  selectClass: 'select_class',
  selectAppearance: 'select_appearance',
  editName: 'edit_name',
  submit: 'submit',
  enter: 'enter',
  rename: 'rename',
  reroll: 'reroll',
  rerollConfirmShown: 'reroll_confirm_shown',
  rerollConfirmAccept: 'reroll_confirm_accept',
  rerollConfirmCancel: 'reroll_confirm_cancel',
  takeover: 'takeover',
  create: 'create',
  back: 'back',
  error: 'error',
} as const;

export type GlitchCharAction = (typeof GLITCH_CHAR_ACTION)[keyof typeof GLITCH_CHAR_ACTION];

/**
 * Decide what Enter World should do for the Glitch character screen.
 *
 * `nameValid` is the caller's result of the shared character-name validator; it is
 * passed in (rather than computed here) so this module stays free of the DOM/regex
 * validation layer and remains trivially unit-testable.
 */
export function glitchCharselectAction(input: {
  existing: GlitchExistingCharacter;
  chosen: GlitchChosenCharacter;
  nameValid: boolean;
}): GlitchCharselectAction {
  const { existing, chosen, nameValid } = input;
  const chosenName = chosen.name.trim();
  const existingName = existing.name.trim();

  const block = (reason: GlitchCharselectBlockReason): GlitchCharselectAction => ({
    kind: 'blocked',
    needsConfirm: false,
    takeover: false,
    reason,
  });

  const classChanged = chosen.class !== existing.class;
  const skinChanged = chosen.skin !== existing.skin;
  const nameChanged = chosenName !== existingName;
  const takeover = existing.online;

  if (!chosenName) return block('name_required');
  // A forced rename is only satisfied by an actually-different name. Check this
  // before shape validation so an existing legacy Glitch name that no longer
  // passes the public character-name regex still explains the real blocker.
  if (existing.forceRename && !nameChanged) return block('rename_required');
  // Existing Glitch characters may have been provisioned from platform display
  // names that are not valid public character names. Let an unchanged Glitch-owned
  // name carry through entry and class or appearance re-rolls; only a requested
  // name change has to satisfy the public character-name validator.
  if ((nameChanged || existing.forceRename) && !nameValid) {
    return block('name_invalid');
  }

  // Class, appearance, or ordinary name customization means a destructive
  // re-roll: Glitch accounts hold a single character, and the public rename route
  // is reserved for moderator-forced renames.
  if (classChanged || skinChanged || (!existing.forceRename && nameChanged)) {
    return { kind: 'reroll', needsConfirm: existing.level > 1, takeover, reason: null };
  }
  // A forced-rename-only change is non-destructive.
  if (nameChanged) return { kind: 'rename', needsConfirm: false, takeover, reason: null };
  // Nothing changed: enter the existing character as-is.
  return { kind: 'enter', needsConfirm: false, takeover, reason: null };
}
