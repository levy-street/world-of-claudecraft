// Account-owned companion cards with this character's active selection.
import { BUDDY_KEYS } from '../../../sim/content/buddies';
import { buddyDisplayName } from '../../buddy_event_lines';
import { esc } from '../../esc';
import { focusKeyAttr } from '../../focus_restore';
import { t } from '../../i18n';
import { BUDDY_PORTRAIT_URLS } from '../../target_portrait_view';

export interface BuddyCosmeticsSnapshot {
  owned: readonly string[];
  pending: readonly string[];
  active: string;
}

export function buddyCosmeticsCards(s: BuddyCosmeticsSnapshot) {
  return BUDDY_KEYS.map((id) => ({
    id,
    owned: s.owned.includes(id),
    pending: s.pending.includes(id),
    active: s.owned.includes(id) && s.active === id,
  }));
}

export function buddyCosmeticsHtml(s: BuddyCosmeticsSnapshot): string {
  return `<div class="cos-grid">${buddyCosmeticsCards(s)
    .map((card) => {
      const state = card.active
        ? t('hudChrome.cosmetics.buddyActive')
        : card.owned
          ? t('hudChrome.collections.state.owned')
          : card.pending
            ? t('hudChrome.collections.state.pending')
            : t('hudChrome.collections.state.notOwned');
      const action = card.owned
        ? `<button type="button" class="cos-action" data-act="summon-buddy" data-id="${esc(card.id)}"${focusKeyAttr(`cosmetic:${card.id}`)}>${esc(t(card.active ? 'hudChrome.collections.actions.dismiss' : 'hudChrome.collections.actions.summon'))}</button>`
        : '';
      return `<article class="cos-card${card.owned ? ' owned' : ''}${card.active ? ' worn' : ''}" data-card="${esc(card.id)}">
        <div class="cos-card-head"><img class="cos-buddy-icon" src="${esc(BUDDY_PORTRAIT_URLS[card.id])}" alt="" aria-hidden="true" draggable="false" width="64" height="64"><span class="cos-scope cos-scope-account">${esc(t('hudChrome.cosmetics.scopeAccount'))}</span></div>
        <h3 class="cos-card-name">${esc(buddyDisplayName(card.id))}</h3>
        <div class="cos-card-actions"><span class="cos-state${card.active ? ' worn' : card.owned ? ' owned' : ''}">${esc(state)}</span>${action}</div>
      </article>`;
    })
    .join('')}</div>`;
}
