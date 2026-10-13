// Cold Groups controls. The board remains the only listing browser.
import {
  EXPEDITION_PURPOSES,
  type ExpeditionDetails,
  type ExpeditionPurpose,
} from '../sim/social/expedition_social';
import type { IWorld } from '../world_api';
import { boardMemberHtml } from './dungeon_board_chrome';
import { dungeonDisplayName } from './entity_i18n';
import { esc } from './esc';
import { focusKeyAttr } from './focus_restore';
import { buildExpeditionView } from './hud/expeditions/expedition_view';
import { formatNumber, t } from './i18n';
import type { hudChromeStrings } from './i18n.catalog/hud_chrome';

type View = ReturnType<typeof buildExpeditionView>;
const text = (key: keyof typeof hudChromeStrings.expeditions, values?: Record<string, string>) =>
  esc(t(`hudChrome.expeditions.${key}`, values));
const num = (n: number) => formatNumber(n, { maximumFractionDigits: 0 });
const button = (action: string, label: string, disabled = false) =>
  `<button type="button" class="ui-btn" data-group-action="${action}"${focusKeyAttr(`group:${action}`)}${disabled ? ' disabled' : ''}>${label}</button>`;
const purposeKeys = {
  first_time: 'purposeFirstTime',
  relaxed: 'purposeRelaxed',
  clear: 'purposeClear',
  needs_help: 'purposeNeedsHelp',
} as const;
const feedbackKeys = {
  accepted: 'outcomeAccepted',
  declined: 'outcomeDeclined',
  expired: 'outcomeExpired',
  cancelled: 'outcomeCancelled',
  closed: 'outcomeClosed',
} as const;

export function groupControlsView(world: IWorld): View {
  return buildExpeditionView(
    world.dungeonFinderInfo,
    world.dungeonFinderBoard,
    world.playerId,
    !!world.partyInfo,
    world.player.inCombat,
    null,
    world.partyInfo?.members.length ?? 1,
    world.partyInfo,
  );
}

/** View state stays local; all mutations go through authoritative IWorld commands. */
export class DungeonGroupControls {
  private details: ExpeditionDetails | null = null;
  private detailsId: number | null = null;
  private world: IWorld | null = null;

  sync(world: IWorld): View {
    if (this.world !== world) {
      this.details = null;
      this.world = world;
    }
    if (this.detailsId !== world.dungeonFinderInfo?.myListing?.id) this.details = null;
    return groupControlsView(world);
  }

  ownHtml(view: View): string {
    const run = view.run;
    if (!run && !view.grouped && !view.myListing) return '';
    const progress = run
      ? text('progress', { defeated: num(run.bossesDefeated), total: num(run.bossesTotal) })
      : '';
    const title = run ? esc(dungeonDisplayName(run.dungeonId)) : text('yourGroup');
    const members = view.partyMembers.map(boardMemberHtml).join('');
    const controls = run
      ? `${run.isLeader && run.isInside && (run.open || view.canOpen) && !(run.open && view.myListing) ? button(run.open ? 'close-run' : 'open', text(run.open ? 'closeRecruitment' : 'open')) : ''}${!run.isInside ? button('travel', text('travel'), !run.canTravel) : ''}`
      : '';
    const editor = this.details
      ? `<div class="expedition-details"><label>${text('purpose')}<select class="ui-input" data-group-purpose${focusKeyAttr('group:purpose')}>${EXPEDITION_PURPOSES.map((p) => `<option value="${p}"${this.details?.purpose === p ? ' selected' : ''}>${text(purposeKeys[p])}</option>`).join('')}</select></label><label>${text('note')}<input class="ui-input" data-group-note maxlength="120" value="${esc(this.details.note)}"${focusKeyAttr('group:note')}></label><div class="expedition-actions">${button('save-details', text('saveDetails'))}${button('cancel-details', text('cancel'))}</div></div>`
      : '';
    return `<section class="df-current-group"><h3>${title}</h3>${run ? `<p class="ui-meta">${text(run.open ? 'recruitmentOpen' : 'recruitmentClosed')}</p><p>${progress}</p><progress class="expedition-progress" value="${run.bossesDefeated}" max="${Math.max(1, run.bossesTotal)}" aria-label="${progress}"></progress>` : ''}${members ? `<div class="df-group-roster" role="group" aria-label="${text('groupRoster')}">${members}</div>` : ''}${editor}<div class="expedition-actions">${controls}${view.myListing && !this.details ? button('edit-details', text('editDetails')) : ''}</div></section>`;
  }

  toolsHtml(
    view: View,
    visibleListingIds: readonly number[] = view.groups.map((group) => group.id),
  ): string {
    let sound = false;
    try {
      sound = localStorage.getItem('woc_expedition_sound') === '1';
    } catch {
      /* Storage may be disabled. */
    }
    const feedback = view.feedback
      ? `<p role="status">${text(feedbackKeys[view.feedback.outcome], { name: view.feedback.leaderName })}</p>`
      : '';
    const pending = view.applications
      .filter((app) => !visibleListingIds.includes(app.listingId))
      .map(
        (app) =>
          `<div class="expedition-actions"><span>${text('waiting', { name: app.leaderName ?? '' })}</span><button type="button" class="ui-btn" data-group-action="cancel-application" data-listing="${app.listingId}"${focusKeyAttr(`group:cancel:${app.listingId}`)}>${text('cancel')}</button></div>`,
      )
      .join('');
    return `<div class="df-group-tools">${pending}${feedback}<label class="expedition-check"><input type="checkbox" data-group-sound${sound ? ' checked' : ''}${focusKeyAttr('group:sound')}>${text('sound')}</label></div>`;
  }

  wire(root: HTMLElement, world: () => IWorld, repaint: () => void): void {
    for (const node of root.querySelectorAll<HTMLButtonElement>('[data-group-action]'))
      node.addEventListener('click', () => {
        if (node.disabled) return;
        const current = world();
        const action = node.dataset.groupAction ?? node.dataset.action;
        switch (action) {
          case 'cancel-application':
            current.dungeonFinderExpeditionConfigure({
              kind: 'cancel_application',
              listingId: Number(node.dataset.listing),
            });
            break;
          case 'open':
            current.dungeonFinderExpeditionOpen();
            break;
          case 'close-run':
            current.dungeonFinderListingClose();
            break;
          case 'travel':
            current.dungeonFinderExpeditionTravel();
            break;
          case 'edit-details':
            this.detailsId = current.dungeonFinderInfo?.myListing?.id ?? null;
            this.details = {
              ...(current.dungeonFinderInfo?.myListing?.details ?? { purpose: 'clear', note: '' }),
            };
            break;
          case 'save-details':
            if (this.details)
              current.dungeonFinderExpeditionConfigure({
                kind: 'details',
                details: { ...this.details },
              });
            this.details = null;
            break;
          case 'cancel-details':
            this.details = null;
            break;
        }
        repaint();
      });
    root
      .querySelector<HTMLSelectElement>('[data-group-purpose]')
      ?.addEventListener('change', (e) => {
        if (this.details)
          this.details.purpose = (e.currentTarget as HTMLSelectElement).value as ExpeditionPurpose;
      });
    root.querySelector<HTMLInputElement>('[data-group-note]')?.addEventListener('input', (e) => {
      if (this.details) this.details.note = (e.currentTarget as HTMLInputElement).value;
    });
    root.querySelector<HTMLInputElement>('[data-group-sound]')?.addEventListener('change', (e) => {
      try {
        localStorage.setItem(
          'woc_expedition_sound',
          (e.currentTarget as HTMLInputElement).checked ? '1' : '0',
        );
      } catch {
        /* Keep the usable control if storage is disabled. */
      }
    });
  }
}
