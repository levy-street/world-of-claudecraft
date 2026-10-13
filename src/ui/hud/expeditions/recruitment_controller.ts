import type { Role } from '../../../sim/content/talents';
import { EXPEDITION_PURPOSES, type ExpeditionPurpose } from '../../../sim/social/expedition_social';
import type { IWorld } from '../../../world_api';
import { dungeonDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { focusKeyAttr } from '../../focus_restore';
import { formatNumber, t } from '../../i18n';
import type { hudChromeStrings } from '../../i18n.catalog/hud_chrome';
import { svgIcon } from '../../ui_icons';
import { expeditionHero } from './expedition_art';
import { buildRecruitmentView, type RecruitmentDraft } from './recruitment_view';

const PUBLISH_CONFIRM_TIMEOUT_MS = 10_000;
const text = (key: keyof typeof hudChromeStrings.expeditions) =>
  esc(t(`hudChrome.expeditions.${key}`));
const purposeKeys = {
  first_time: 'purposeFirstTime',
  relaxed: 'purposeRelaxed',
  clear: 'purposeClear',
  needs_help: 'purposeNeedsHelp',
} as const;
const roleText = (role: Role) =>
  esc(
    t(
      `hudChrome.finder.${role === 'tank' ? 'roleTank' : role === 'healer' ? 'roleHealer' : 'roleDps'}`,
    ),
  );
const blockKeys = {
  loading: 'recruitLoading',
  leader: 'waitForLeader',
  exists: 'recruitAlreadyOpen',
  run: 'recruitExistingRun',
  queue: 'recruitLeaveQueue',
  proposal: 'recruitFinishProposal',
  application: 'recruitCancelRequests',
  activity: 'recruitNoActivities',
  role: 'recruitNoRoles',
  note: 'recruitInvalidNote',
} as const;
type View = ReturnType<typeof buildRecruitmentView>;

interface RecruitmentDeps {
  world(): IWorld;
  repaint(): void;
  maskPlayerText?(value: string): string;
}

/** Cold form owned by the expedition panel; all publication authority stays in IWorld. */
export class RecruitmentController {
  isOpen = false;
  isComposing = false;
  private draft: RecruitmentDraft = {
    dungeonId: '',
    difficulty: 'normal',
    role: null,
    purpose: 'clear',
    note: '',
  };
  private pendingUntil: number | null = null;
  private timedOut = false;

  constructor(private readonly deps: RecruitmentDeps) {}

  reset(): void {
    this.isOpen = false;
    this.isComposing = false;
    this.pendingUntil = null;
    this.timedOut = false;
    this.draft = { dungeonId: '', difficulty: 'normal', role: null, purpose: 'clear', note: '' };
  }

  open(): void {
    this.isOpen = true;
    this.sync();
  }

  close(): void {
    this.isOpen = false;
    this.isComposing = false;
  }

  sync(): void {
    if (this.deps.world().dungeonFinderInfo?.myListing) {
      // Only the authoritative listing is confirmation, never the button press.
      this.isOpen = false;
      this.isComposing = false;
      this.pendingUntil = null;
      this.timedOut = false;
    } else if (this.pendingUntil !== null && Date.now() >= this.pendingUntil) {
      this.pendingUntil = null;
      this.timedOut = true;
    }
  }

  private view(): View {
    const world = this.deps.world();
    return buildRecruitmentView(
      world.dungeonFinderInfo,
      world.partyInfo,
      world.playerId,
      world.player.level,
      this.draft,
    );
  }

  signature(): string {
    if (!this.isOpen) return '';
    return JSON.stringify([this.draft, this.view(), this.pendingUntil !== null, this.timedOut]);
  }

  restoreControls(root: ParentNode): void {
    const view = this.view();
    const values = {
      dungeon: view.dungeonId,
      difficulty: view.activity?.difficulty ?? '',
      role: view.role ?? '',
      purpose: this.draft.purpose,
    };
    for (const [field, value] of Object.entries(values)) {
      const control = root.querySelector<HTMLSelectElement>(`[data-recruit-field="${field}"]`);
      if (control) control.value = value;
    }
  }

  composition(event: CompositionEvent): void {
    if (
      !this.isOpen ||
      !(event.target instanceof HTMLInputElement) ||
      event.target.dataset.recruitField !== 'note'
    )
      return;
    this.isComposing = event.type === 'compositionstart';
    if (!this.isComposing) this.input(event);
  }

  html(): string {
    const view = this.view();
    const waiting = this.pendingUntil !== null;
    const disabled = waiting ? ' disabled' : '';
    const select = (field: string, label: string, options: string) =>
      `<label>${label}<select class="ui-input" data-recruit-field="${field}" ${focusKeyAttr(`recruit:${field}`)}${disabled}>${options}</select></label>`;
    const option = (value: string, label: string, selected: boolean) =>
      `<option value="${esc(value)}"${selected ? ' selected' : ''}>${label}</option>`;
    const message = view.blocked
      ? text(blockKeys[view.blocked])
      : this.timedOut
        ? text('recruitUnconfirmed')
        : waiting
          ? text('recruitPublishing')
          : text('recruitBeforeEntry');
    return `<header class="expedition-head"><div class="expedition-title"><img class="ui-win-art" src="/ui/chrome/dfinder.webp" alt=""><h2 class="ui-win-title">${text('recruitPlayers')}</h2></div><button type="button" class="ui-btn" data-recruit-action="cancel" ${focusKeyAttr('recruit:cancel')}>${text('backToGroups')}</button></header><section class="expedition-recruitment" aria-label="${text('recruitPlayers')}"><div class="expedition-recruit-fields ui-well"><p>${text('recruitIntro')}</p>${select('dungeon', text('recruitDungeon'), view.dungeonIds.map((id) => option(id, esc(dungeonDisplayName(id)), id === view.dungeonId)).join(''))}${select('difficulty', text('recruitDifficulty'), view.difficulties.map((activity) => option(activity.difficulty, esc(t(`hudChrome.finder.${activity.difficulty}`)), activity === view.activity)).join(''))}${select('role', text('chooseRole'), view.roles.map((role) => option(role, roleText(role), role === view.role)).join(''))}${select('purpose', text('purpose'), EXPEDITION_PURPOSES.map((purpose) => option(purpose, text(purposeKeys[purpose]), purpose === this.draft.purpose)).join(''))}<label>${text('note')}<input type="text" class="ui-input" data-recruit-field="note" id="expedition-recruit-note" maxlength="120" value="${esc(this.draft.note)}" ${focusKeyAttr('recruit:note')}${disabled}></label></div><aside class="expedition-recruit-preview ui-card-tile" aria-label="${text('recruitPreview')}" data-recruit-preview>${this.previewHtml(view)}</aside></section><footer class="expedition-recruit-footer"><p class="ui-meta" role="status">${message}</p><button type="button" class="ui-btn ui-btn--gold" data-recruit-action="publish" ${focusKeyAttr('recruit:publish')}${waiting || view.blocked ? ' disabled' : ''}>${text(waiting ? 'recruitPublishing' : 'recruitPublish')}</button></footer>`;
  }

  private previewHtml(view: View): string {
    if (!view.activity || !view.role) return `<p>${text('recruitPreview')}</p>`;
    const world = this.deps.world();
    const note = this.deps.maskPlayerText?.(this.draft.note) ?? this.draft.note;
    return `${expeditionHero(view.dungeonId, esc(dungeonDisplayName(view.dungeonId)), esc(t(`hudChrome.finder.${view.activity.difficulty}`)))}<div class="expedition-own-body"><h3>${text('recruitPreview')}</h3><p class="ui-chip">${text('formingGroup')}</p><p>${esc(t('hudChrome.expeditions.members', { current: formatNumber(view.size), total: formatNumber(view.activity.size) }))}</p><p>${svgIcon(view.role === 'tank' ? 'tank' : view.role === 'healer' ? 'healer' : 'character')}${roleText(view.role)}</p><p class="ui-meta">${esc(t('hudChrome.expeditions.leader', { name: world.player.name }))}</p><p class="ui-chip">${text(purposeKeys[this.draft.purpose])}</p>${note ? `<p class="expedition-note">${esc(note)}</p>` : ''}</div>`;
  }

  change(event: Event): boolean {
    if (!this.isOpen || !(event.target instanceof HTMLSelectElement)) return false;
    const field = event.target.dataset.recruitField;
    if (!field) return false;
    if (this.pendingUntil !== null) return true;
    const value = event.target.value;
    if (field === 'dungeon') this.draft.dungeonId = value;
    else if (field === 'difficulty' && (value === 'normal' || value === 'heroic'))
      this.draft.difficulty = value;
    else if (field === 'role' && this.view().roles.includes(value as Role))
      this.draft.role = value as Role;
    else if (field === 'purpose' && EXPEDITION_PURPOSES.includes(value as ExpeditionPurpose))
      this.draft.purpose = value as ExpeditionPurpose;
    this.deps.repaint();
    return true;
  }

  input(event: Event): boolean {
    if (
      !this.isOpen ||
      !(event.target instanceof HTMLInputElement) ||
      event.target.dataset.recruitField !== 'note'
    )
      return false;
    if (this.pendingUntil !== null) return true;
    this.draft.note = event.target.value;
    if (!this.isComposing) this.deps.repaint();
    return true;
  }

  click(event: MouseEvent): boolean {
    if (!(event.target instanceof Element)) return false;
    const button = event.target.closest<HTMLButtonElement>('[data-recruit-action]');
    if (!button) return false;
    if (button.disabled) return true;
    if (button.dataset.recruitAction === 'cancel') this.close();
    else if (button.dataset.recruitAction === 'publish') {
      const view = this.view();
      if (view.blocked || !view.activity || !view.role || this.pendingUntil !== null) return true;
      this.pendingUntil = Date.now() + PUBLISH_CONFIRM_TIMEOUT_MS;
      this.timedOut = false;
      this.deps.world().dungeonFinderExpeditionConfigure({
        kind: 'recruit',
        activityId: view.activity.id,
        role: view.role,
        details: { purpose: this.draft.purpose, note: this.draft.note },
      });
      this.sync();
    }
    this.deps.repaint();
    return true;
  }
}
