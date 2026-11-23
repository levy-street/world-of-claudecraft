import { MEMBERSHIP_CHARACTER_SLOTS } from '../membership_contract';
import type { PlayerClass } from '../sim/types';
import { deleteCharButtonHtml } from './char_delete_button';
import { type CharselectHintSource, charselectHintsHtml } from './charselect_hints';
import { classDisplayName } from './entity_i18n';
import { esc } from './esc';
import { t } from './i18n';
import { svgIcon } from './ui_icons';

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
  return `${portraitHtml}<div class="char-id"><span class="char-name">${c.membershipLocked ? svgIcon('lock', { cls: 'char-slot-lock' }) : ''}${esc(c.name)}</span><span class="char-sub">${esc(t('character.levelClass', { level: c.level, className }))}${esc(status)}</span>${hintsHtml}</div>${actions}`;
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
  limit: number,
): string {
  const premiumOccupied = characters.filter((character) => character.membershipSlot).length;
  const baseLimit = limit - (active ? MEMBERSHIP_CHARACTER_SLOTS : 0);
  const baseEmpty = Math.max(0, baseLimit - (characters.length - premiumOccupied));
  const premiumEmpty = Math.max(0, MEMBERSHIP_CHARACTER_SLOTS - premiumOccupied);
  const row = (premium: boolean) => {
    const locked = premium && !active;
    const label = t(locked ? 'character.membershipSlots' : 'character.emptySlot');
    const icon = locked ? svgIcon('lock', { cls: 'char-slot-lock' }) : '';
    return `<li class="char-row char-empty-slot${premium ? ' membership-slot' : ''}${locked ? ' membership-locked' : ''}">${icon}<span class="char-sub">${esc(label)}</span></li>`;
  };
  return (
    Array.from({ length: baseEmpty }, () => row(false)).join('') +
    Array.from({ length: premiumEmpty }, () => row(true)).join('')
  );
}
