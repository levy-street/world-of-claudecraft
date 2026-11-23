import type { PlayerClass } from '../sim/types';
import { deleteCharButtonHtml } from './char_delete_button';
import { type CharselectHintSource, charselectHintsHtml } from './charselect_hints';
import { classDisplayName } from './entity_i18n';
import { esc } from './esc';
import { t } from './i18n';

interface RosterCharacter extends CharselectHintSource {
  class: PlayerClass;
  appearanceRerollAvailable?: boolean;
  name: string;
  level: number;
  online: boolean;
  forceRename: boolean;
  membershipLocked?: boolean;
}

/** Shared row markup; every entry affordance reflects the server's slot lock. */
export function characterRowHtml(c: RosterCharacter, portraitHtml: string, nowMs: number): string {
  const className = classDisplayName(c.class);
  const status = c.online ? '' : c.forceRename ? ` (${t('character.renameRequired')})` : '';
  const hintsHtml = charselectHintsHtml(c, nowMs);
  const deleteHtml = deleteCharButtonHtml(c.online);
  const rerollHtml = c.appearanceRerollAvailable
    ? `<button type="button" class="btn reroll-char-btn" title="${esc(t('character.redesignHint'))}" aria-label="${esc(t('character.redesignTitle', { name: c.name }))}">${esc(t('character.redesign'))}</button>`
    : '';
  const actions = c.forceRename
    ? `<input class="rename-input" placeholder="${esc(t('character.newNamePlaceholder'))}" maxlength="16" /><span class="char-actions"><button class="btn rename-btn">${esc(t('character.rename'))}</button>${rerollHtml}${deleteHtml}</span>`
    : c.membershipLocked
      ? `<span class="char-actions"><button class="btn enter-world-btn" disabled>${esc(t('character.membershipRequired'))}</button>${deleteHtml}</span>`
      : c.online
        ? `<span class="char-actions"><button class="btn take-over-btn" title="${esc(t('character.takeOverConfirm'))}" aria-label="${esc(t('character.takeOverConfirm'))}">${esc(t('character.takeOver'))}</button>${rerollHtml}${deleteHtml}</span>`
        : `<span class="char-actions"><button class="btn enter-world-btn">${esc(t('auth.enterWorld'))}</button>${rerollHtml}${deleteHtml}</span>`;
  return `${portraitHtml}<div class="char-id"><span class="char-name">${esc(c.name)}</span><span class="char-sub">${esc(t('character.levelClass', { level: c.level, className }))}${esc(status)}</span>${hintsHtml}</div>${actions}`;
}

export function canCreateMembershipCharacter(
  characters: readonly { membershipSlot?: boolean }[],
  active: boolean,
  limit: number,
): boolean {
  return (active ? characters.length : characters.filter((c) => !c.membershipSlot).length) < limit;
}

/** Occupied membership slots keep their server identity regardless of roster sort. */
export function membershipSlotsHtml(
  characters: readonly { membershipLocked?: boolean; membershipSlot?: boolean }[],
  active: boolean,
): string {
  const count = active
    ? Math.max(0, 20 - characters.length)
    : Math.max(0, 10 - characters.filter((character) => character.membershipSlot).length);
  const label = t(active ? 'character.emptySlot' : 'character.membershipSlots');
  return Array.from(
    { length: count },
    () =>
      `<li class="char-row membership-slot${active ? '' : ' membership-locked'}" role="option" aria-disabled="true" aria-selected="false"><span class="char-sub">${esc(label)}</span></li>`,
  ).join('');
}
