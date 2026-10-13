import type { Role } from '../sim/content/talents';
import type { DungeonDifficulty } from '../sim/types';
import { activitySceneUrl } from './dungeon_activity_art';
import type { FinderQueuePanelView } from './dungeon_finder_view';
import { dungeonDisplayName } from './entity_i18n';
import { esc } from './esc';
import { expeditionImageUrl } from './hud/expeditions/expedition_art';
import { t } from './i18n';
import { svgIcon } from './ui_icons';

interface ActivityOption {
  id: string;
  dungeonId: string;
  difficulty: DungeonDifficulty;
  checked: boolean;
  disabled: boolean;
}

/** Group only the supplied variants; activity IDs still own all selection semantics. */
export function groupedActivityOptionsHtml(
  options: readonly ActivityOption[],
  mode: 'queue' | 'create',
): string {
  const groups = new Map<string, ActivityOption[]>();
  for (const option of options) {
    const group = groups.get(option.dungeonId) ?? [];
    group.push(option);
    groups.set(option.dungeonId, group);
  }
  return [...groups]
    .map(([dungeonId, variants], index) => {
      const nameId = `df-${mode}-activity-${index}`;
      const buttons = [...variants]
        .sort((a, b) => Number(a.difficulty === 'heroic') - Number(b.difficulty === 'heroic'))
        .map((option, variantIndex) => {
          const labelId = `${nameId}-difficulty-${variantIndex}`;
          const attribute = mode === 'queue' ? 'data-opt' : 'data-createopt';
          return `<button type="button" class="df-difficulty ui-btn${option.checked ? ' active' : ''}" ${attribute}="${esc(option.id)}" data-difficulty="${option.difficulty}" role="${mode === 'queue' ? 'checkbox' : 'radio'}" aria-checked="${option.checked}" aria-labelledby="${nameId} ${labelId}"${option.disabled ? ' disabled' : ''}><span id="${labelId}">${esc(t(option.difficulty === 'heroic' ? 'hudChrome.finder.heroic' : 'hudChrome.finder.normal'))}</span></button>`;
        })
        .join('');
      return `<div class="df-activity-group ui-card ui-card-tile" data-dungeon="${esc(dungeonId)}"><div class="df-activity-art"><img src="${esc(mode === 'create' ? activitySceneUrl(dungeonId) : expeditionImageUrl(dungeonId))}" width="768" height="384" loading="lazy" decoding="async" alt=""></div><div class="df-activity-copy"><div class="df-activity-name" id="${nameId}">${esc(dungeonDisplayName(dungeonId))}</div><div class="df-difficulties">${buttons}</div></div></div>`;
    })
    .join('');
}

function roleLabel(role: Role): string {
  return t(
    role === 'tank'
      ? 'hudChrome.finder.roleTank'
      : role === 'healer'
        ? 'hudChrome.finder.roleHealer'
        : 'hudChrome.finder.roleDps',
  );
}

export function quickMatchHtml(q: FinderQueuePanelView): string {
  const roles = `<div class="df-sub">${esc(t('hudChrome.finder.yourRoles'))}</div><div class="df-roles">${q.roles.map((r) => `<button type="button" class="df-role ui-card ui-card-tile${r.selected ? ' active' : ''}" data-role="${r.role}" aria-pressed="${r.selected}"${r.eligible ? '' : ' disabled'}>${svgIcon(r.role === 'tank' ? 'tank' : r.role === 'healer' ? 'healer' : 'attack')}<span>${esc(roleLabel(r.role))}</span></button>`).join('')}</div>`;
  const leaderNote =
    q.inParty && !q.isLeader
      ? `<div class="df-note">${esc(t('hudChrome.finder.leaderNote'))}</div>`
      : '';
  const options = groupedActivityOptionsHtml(
    q.options.map((option) => ({ ...option, disabled: !option.eligible || q.queued })),
    'queue',
  );
  const status = q.queued
    ? `<div class="df-queue-status">${svgIcon('social')} <span data-df-clock="waited"></span></div><button type="button" class="btn leave ui-btn ui-btn--red" data-act="leavequeue">${esc(t('hudChrome.finder.leaveQueue'))}</button>`
    : q.onCooldown
      ? '<div class="df-note df-warn" data-df-clock="cooldown"></div>'
      : `<button type="button" class="btn df-join ui-btn ui-btn--gold" data-act="join"${q.canQueue ? '' : ' disabled'}>${esc(t('hudChrome.finder.joinQueue'))}</button>`;
  return `<div class="df-queue-shell"><aside class="df-queue-sidebar ui-card ui-card-tile">${roles}${leaderNote}<div class="df-footer">${status}</div><div class="df-note">${esc(t('hudChrome.finder.travelNote'))}</div></aside><section class="df-queue-activities"><div class="df-sub">${esc(t('hudChrome.finder.chooseActivities'))}</div><div class="df-options df-activity-options">${options}</div></section></div>`;
}
