// Staged group creation: filtering and role choice never mutate the world.
import { type FinderListingTag, finderActivity } from '../sim/content/dungeon_finder';
import type { Role } from '../sim/content/talents';
import { compatibleFinderRoles } from '../sim/social/dungeon_finder';
import type { IWorld } from '../world_api';
import { groupedActivityOptionsHtml } from './dungeon_activity_chrome';
import { boardTagLabel } from './dungeon_board_chrome';
import type { FinderBoardPanelView, FinderQueuePanelView } from './dungeon_finder_view';
import { partyRolesHtml } from './dungeon_listing_edit_chrome';
import { esc } from './esc';
import { t } from './i18n';
import { svgIcon } from './ui_icons';

export interface GroupDraft {
  kind: 'dungeon' | 'raid';
  activity: string | null;
  role: Role | null;
  tags: ReadonlySet<FinderListingTag>;
  // Guild Party: only members of my guild may apply (needs a guild).
  guildOnly: boolean;
  // Roles for the party members the listing brings along (absent = their own).
  partyRoles: ReadonlyMap<number, Role>;
}
export function createFormState(
  b: FinderBoardPanelView,
  q: FinderQueuePanelView,
  draft: GroupDraft,
) {
  const options = b.createOptions.filter((o) => finderActivity(o.id)?.kind === draft.kind);
  const activity = options.find((o) => o.id === draft.activity)?.id ?? options[0]?.id ?? null;
  const preferred = q.roles.filter((r) => r.selected && r.eligible);
  const role =
    draft.role === null
      ? preferred.length === 1
        ? preferred[0].role
        : null
      : q.roles.some((r) => r.role === draft.role && r.eligible)
        ? draft.role
        : null;
  const locked = q.queued || q.proposal !== null;
  return {
    options,
    activity,
    role,
    locked,
    guildOnly: draft.guildOnly && b.guild !== '',
    canPublish: b.canCreate && !!activity && !!role && !locked,
  };
}

/** Validate again at click time, then send role before listing on the ordered command channel. */
export function publishGroupDraft(
  world: IWorld,
  activityId: string | null,
  role: Role | null,
  tags: ReadonlySet<FinderListingTag>,
  partyRoles: ReadonlyMap<number, Role> = new Map(),
): boolean {
  const info = world.dungeonFinderInfo;
  const activity = activityId ? finderActivity(activityId) : null;
  const party = world.partyInfo;
  if (
    !info ||
    info.myListing ||
    info.queue ||
    info.proposal ||
    !activity ||
    !role ||
    (party && party.leader !== world.playerId) ||
    (party?.members.length ?? 1) >= activity.size ||
    world.player.level < activity.minLevel ||
    world.player.level > activity.maxLevel ||
    !compatibleFinderRoles(world.cfg.playerClass, world.player.level, world.talentRole).includes(
      role,
    )
  )
    return false;
  world.dungeonFinderSetRoles([role]);
  world.dungeonFinderListingCreate(activity.id, [...tags]);
  // The party joins the listing as it is created; their assigned roles follow
  // on the same ordered command channel.
  const roles = [...partyRoles]
    .filter(([pid]) => party?.members.some((member) => member.pid === pid))
    .map(([pid, role]) => ({ pid, role }));
  if (roles.length > 0) world.dungeonFinderExpeditionConfigure({ kind: 'party_roles', roles });
  return true;
}

export function createGroupFormHtml(
  b: FinderBoardPanelView,
  q: FinderQueuePanelView,
  draft: GroupDraft,
): string {
  if (!b.canCreate)
    return b.createGate === 'leader'
      ? `<div class="df-note">${esc(t('hudChrome.finder.boardLeaderGate'))}</div>`
      : '';
  const state = createFormState(b, q, draft);
  const options = groupedActivityOptionsHtml(
    state.options.map((o) => ({ ...o, checked: o.id === state.activity, disabled: false })),
    'create',
  );
  const tags = b.tags
    .map(
      (tag) =>
        `<button type="button" class="df-chip df-tag ui-chip${draft.tags.has(tag) ? ' active is-on' : ''}" data-tag="${tag}" role="checkbox" aria-checked="${draft.tags.has(tag)}">${esc(boardTagLabel(tag))}</button>`,
    )
    .join('');
  const roles = q.roles
    .map(
      (r) =>
        `<button type="button" class="df-create-role ui-card ui-card-tile${r.role === state.role ? ' active' : ''}" data-create-role="${r.role}" aria-pressed="${r.role === state.role}"${!r.eligible || state.locked ? ' disabled' : ''}><span class="df-create-role-icon">${svgIcon(r.role === 'tank' ? 'tank' : r.role === 'healer' ? 'healer' : 'attack')}</span><span>${esc(t(r.role === 'tank' ? 'hudChrome.finder.roleTank' : r.role === 'healer' ? 'hudChrome.finder.roleHealer' : 'hudChrome.finder.roleDps'))}</span></button>`,
    )
    .join('');
  const guild = `<section class="df-create-guild"><label class="df-guild-toggle"><input type="checkbox" data-create-guild${state.guildOnly ? ' checked' : ''}${b.guild ? '' : ' disabled'}><span>${esc(t('hudChrome.finder.guildPartyToggle'))}</span></label><p class="df-note">${esc(b.guild ? t('hudChrome.finder.guildPartyHint', { guild: b.guild }) : t('hudChrome.finder.guildPartyNeedsGuild'))}</p></section>`;
  return `<div class="df-create ui-card"><div class="df-create-heading"><label class="df-create-filter"><span>${esc(t('hudChrome.finder.activity'))}</span><select class="ui-input" data-create-kind><option value="dungeon"${draft.kind === 'dungeon' ? ' selected' : ''}>${esc(t('hudChrome.adventureGuide.dungeons'))}</option><option value="raid"${draft.kind === 'raid' ? ' selected' : ''}>${esc(t('hudChrome.adventureGuide.raids'))}</option></select></label><div class="df-create-actions"><button type="button" class="df-create-cancel ui-btn" data-cancel-create>${esc(t('hudChrome.finder.cancelCreate'))}</button><button type="button" class="btn df-create-btn ui-btn ui-btn--gold" data-act="create"${state.canPublish ? '' : ' disabled'}>${esc(t('hudChrome.finder.publish'))}</button></div></div><section class="df-create-role-section"><div class="df-sub" id="df-create-role-label">${esc(t('hudChrome.finder.yourRole'))}</div><div class="df-create-roles" role="group" aria-labelledby="df-create-role-label">${roles}</div>${state.locked ? `<p class="df-note">${esc(t('hudChrome.finder.createQueueLocked'))}</p>` : ''}</section>${guild}${partyRolesHtml(b.partyMembers, (pid) => draft.partyRoles.get(pid) ?? null)}<div class="df-options df-activity-options" role="radiogroup" aria-label="${esc(t('hudChrome.finder.activity'))}">${options || `<p class="df-note">${esc(t('hudChrome.finder.noCreateActivities'))}</p>`}</div><div class="df-create-tags">${tags}</div></div>`;
}
