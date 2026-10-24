import type { CharacterSummary } from './character_summary';

// The primary action a character-select entry offers, as i18n keys (not rendered
// text) so this stays DOM/i18n-free and unit-testable. Single source of truth for
// BOTH the shared desktop Enter World button's label/enabled/title AND the branch
// that routes its click to enter vs take over, so the two can never drift.
export type CharselectActionKind = 'enter' | 'takeover' | 'disabled';

export interface CharselectPrimaryAction {
  kind: CharselectActionKind;
  labelKey: 'auth.enterWorld' | 'character.takeOver';
  titleKey: 'character.renameRequired' | 'character.membershipRequired' | null;
}

export function charselectPrimaryAction(
  c: Pick<CharacterSummary, 'online' | 'forceRename' | 'membershipLocked'> | null,
): CharselectPrimaryAction {
  // No selection: a disabled Enter World placeholder (roster loading or empty).
  if (!c) return { kind: 'disabled', labelKey: 'auth.enterWorld', titleKey: null };
  if (c.membershipLocked)
    return {
      kind: 'disabled',
      labelKey: 'auth.enterWorld',
      titleKey: 'character.membershipRequired',
    };
  // A forced rename must happen first: entry is blocked until the name is fixed.
  if (c.forceRename)
    return { kind: 'disabled', labelKey: 'auth.enterWorld', titleKey: 'character.renameRequired' };
  // Online in another session: entry means taking that session over.
  if (c.online) return { kind: 'takeover', labelKey: 'character.takeOver', titleKey: null };
  return { kind: 'enter', labelKey: 'auth.enterWorld', titleKey: null };
}
