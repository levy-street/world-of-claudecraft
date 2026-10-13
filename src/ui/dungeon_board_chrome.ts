// Cold, emit-only premade group chrome. Listing authority stays in the view and IWorld.
import { FINDER_ACTIVITIES, type FinderListingTag } from '../sim/content/dungeon_finder';
import { type Role, TALENTS } from '../sim/content/talents';
import { CLASSES } from '../sim/data';
import type { DungeonDifficulty } from '../sim/types';
import type { DungeonFinderApplicantView } from '../world_api';
import { classIconUrl } from './class_icon_art';
import type { FinderBoardPanelView, FinderListingRowView } from './dungeon_finder_view';
import { classDisplayName, dungeonDisplayName } from './entity_i18n';
import { esc } from './esc';
import { expeditionImageUrl } from './hud/expeditions/expedition_art';
import { formatNumber, type TranslationKey, t } from './i18n';
import { tTalent } from './talent_i18n';
import { svgIcon } from './ui_icons';

const ROLES: readonly Role[] = ['tank', 'healer', 'dps'];
const num = (value: number) =>
  formatNumber(value, { maximumFractionDigits: 0, useGrouping: false });

export function boardTagLabel(tag: FinderListingTag): string {
  const keys: Record<FinderListingTag, TranslationKey> = {
    first_run: 'hudChrome.finder.tagFirstRun',
    quest_run: 'hudChrome.finder.tagQuestRun',
    full_clear: 'hudChrome.finder.tagFullClear',
    learning: 'hudChrome.finder.tagLearning',
    fast_run: 'hudChrome.finder.tagFastRun',
  };
  return t(keys[tag]);
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

function roleIcon(role: Role): string {
  return svgIcon(role === 'tank' ? 'tank' : role === 'healer' ? 'healer' : 'attack');
}

function difficultyBadge(difficulty: DungeonDifficulty): string {
  return `<span class="df-badge ui-chip${difficulty === 'heroic' ? ' heroic' : ''}">${esc(t(difficulty === 'heroic' ? 'hudChrome.finder.heroic' : 'hudChrome.finder.normal'))}</span>`;
}

function tagsHtml(tags: readonly FinderListingTag[]): string {
  return tags
    .map(
      (tag) =>
        `<span class="df-chip ui-chip" data-purpose="${tag}">${esc(boardTagLabel(tag))}</span>`,
    )
    .join('');
}

function portraitHtml(cls: string, cssClass: string): string {
  const url = classIconUrl(cls);
  return `<span class="${cssClass}" aria-hidden="true">${url ? `<img src="${esc(url)}" alt="" width="56" height="56" loading="lazy" decoding="async" draggable="false">` : svgIcon('character')}</span>`;
}

export function boardApplicantHtml(applicant: DungeonFinderApplicantView): string {
  const roles = applicant.roles
    .map(
      (role) =>
        `<span class="df-role-chip" data-combat-role="${role}">${roleIcon(role)}${esc(roleLabel(role))}</span>`,
    )
    .join('');
  const spec = TALENTS[applicant.cls]?.specs.find((entry) => entry.id === applicant.spec);
  const specName = spec
    ? tTalent({ kind: 'talentSpec', spec, field: 'name' })
    : applicant.spec === null
      ? t('game.talents.noSpec')
      : '';
  const classColor = CLASSES[applicant.cls].color.toString(16).padStart(6, '0');
  const meta = t('hudChrome.finder.levelOne', { level: num(applicant.level) });
  return `<article class="df-applicant ui-card ui-card-tile" data-player-class="${esc(applicant.cls)}" style="--class-color:#${classColor}">
    ${portraitHtml(applicant.cls, 'df-app-portrait')}
    <div class="df-app-person"><strong class="df-app-name">${esc(applicant.name)}</strong><span class="df-app-class">${esc(classDisplayName(applicant.cls))}<span class="df-app-meta">${esc(meta)}</span></span><span class="df-app-spec">${esc(specName)}</span></div><div class="df-app-roles">${roles}</div>
    <div class="df-app-actions"><button type="button" class="btn df-accept df-app-accept ui-btn ui-btn--gold" data-appacc="${applicant.pid}" aria-label="${esc(t('hudChrome.finder.acceptApplicantAria', { name: applicant.name }))}">${svgIcon('social')}${esc(t('hudChrome.finder.accept'))}</button><button type="button" class="btn df-decline df-app-decline ui-btn" data-appdec="${applicant.pid}" aria-label="${esc(t('hudChrome.finder.declineApplicantAria', { name: applicant.name }))}">${esc(t('hudChrome.finder.decline'))}</button></div>
  </article>`;
}

/** Compact identity card for members already admitted to the group. */
export function boardMemberHtml(member: {
  pid: number;
  name: string;
  cls: import('../sim/types').PlayerClass;
  level: number;
  role?: Role;
  spec?: string | null;
}): string {
  const spec = TALENTS[member.cls]?.specs.find((entry) => entry.id === member.spec);
  const specName = spec
    ? tTalent({ kind: 'talentSpec', spec, field: 'name' })
    : member.spec === null
      ? t('game.talents.noSpec')
      : '';
  const classColor = CLASSES[member.cls].color.toString(16).padStart(6, '0');
  return `<article class="df-group-member ui-card ui-card-tile" data-member="${member.pid}" style="--class-color:#${classColor}">
    ${portraitHtml(member.cls, 'df-app-portrait')}
    <div class="df-app-person"><strong class="df-app-name">${esc(member.name)}</strong><span class="df-app-class">${esc(classDisplayName(member.cls))}<span class="df-app-meta">${esc(t('hudChrome.finder.levelOne', { level: num(member.level) }))}</span></span><span class="df-app-spec">${esc(specName)}</span></div>
    ${member.role ? `<div class="df-app-roles"><span class="df-role-chip" data-combat-role="${member.role}">${roleIcon(member.role)}${esc(roleLabel(member.role))}</span></div>` : ''}</article>`;
}

function rosterHtml(listing: FinderListingRowView): string {
  const members = listing.members.map((member) => {
    const meta = t('hudChrome.finder.levelClass', {
      level: num(member.level),
      className: classDisplayName(member.cls),
    });
    return `<span class="df-member df-roster-seat" data-seat-role="${member.role ?? 'any'}" title="${esc(meta)}">${portraitHtml(member.cls, 'df-member-portrait')}<span class="df-member-role">${member.role ? roleIcon(member.role) : ''}</span><span class="df-member-label">${esc(meta)}${member.role ? `<span>${esc(roleLabel(member.role))}</span>` : ''}</span></span>`;
  });
  // Only authoritative vacancies get a role. Class alone never assigns a member's role.
  const vacancies = Math.max(0, listing.capacity - listing.size);
  const roles: (Role | null)[] = [];
  if (listing.needed) {
    for (const role of ROLES) {
      for (let i = 0; i < listing.needed[role] && roles.length < vacancies; i++) roles.push(role);
    }
  }
  while (roles.length < vacancies) roles.push(null);
  const empty = roles.map(
    (role) =>
      `<span class="df-member df-roster-seat is-empty" data-seat-role="${role ?? 'any'}"><span class="df-member-portrait" aria-hidden="true">${role ? roleIcon(role) : svgIcon('social')}</span><span class="df-member-label">${esc(role ? t('hudChrome.finder.needs', { roles: roleLabel(role) }) : t('hudChrome.finder.freeRoles'))}</span></span>`,
  );
  return `<div class="df-listing-members">${members.join('')}${empty.join('')}</div>`;
}

export function boardListingHtml(
  listing: FinderListingRowView,
  maskPlayerText?: (text: string) => string,
): string {
  const required = listing.needed;
  const needed = required
    ? ROLES.filter((role) => required[role] > 0)
        .map(
          (role) =>
            `<span class="df-role-chip" data-combat-role="${role}">${roleIcon(role)}${esc(t('hudChrome.finder.needs', { roles: t('hudChrome.finder.roleCount', { count: num(required[role]), role: roleLabel(role) }) }))}</span>`,
        )
        .join('')
    : '';
  const action = listing.mine
    ? `<span class="df-chip ui-chip">${esc(t('hudChrome.finder.yourListing'))}</span>`
    : listing.applied
      ? `<button type="button" class="btn leave df-withdraw ui-btn" data-withdraw="${listing.id}" data-act="withdraw">${esc(t('hudChrome.finder.withdraw'))}</button>`
      : `<button type="button" class="btn df-apply ui-btn ui-btn--gold" data-apply="${listing.id}"${listing.canApply ? '' : ' disabled'}>${esc(t('hudChrome.finder.apply'))}</button>`;
  return `<article class="df-listing ui-card ui-card-tile${listing.mine ? ' is-mine' : ''}${listing.applied ? ' is-applied' : ''}">
    <div class="df-listing-art"><img src="${esc(expeditionImageUrl(listing.dungeonId))}" alt="" loading="lazy" decoding="async" draggable="false"><div class="df-listing-head"><h3 class="df-listing-name">${esc(dungeonDisplayName(listing.dungeonId))}</h3>${difficultyBadge(listing.difficulty)}</div></div>
    <div class="df-listing-content"><div class="df-listing-meta"><span class="df-listing-leader">${svgIcon('social')}${esc(t('hudChrome.finder.leader', { name: listing.leaderName }))}</span><span class="df-listing-size">${esc(t('hudChrome.finder.slots', { size: num(listing.size), capacity: num(listing.capacity) }))}</span></div>
    ${rosterHtml(listing)}<div class="df-needed">${needed}</div>${listing.expedition ? `<p class="ui-meta">${esc(t('hudChrome.expeditions.progress', { defeated: num(listing.expedition.bossesDefeated), total: num(listing.expedition.bossesTotal) }))}</p>` : ''}${listing.details?.note ? `<p class="expedition-note">${esc(maskPlayerText?.(listing.details.note) ?? listing.details.note)}</p>` : ''}<div class="df-listing-tags">${tagsHtml(listing.tags)}</div><div class="df-listing-action">${action}</div></div>
  </article>`;
}

export function boardMyListingHtml(board: FinderBoardPanelView, groupHtml = ''): string {
  const mine = board.myListing;
  if (!mine) return '';
  const activity = FINDER_ACTIVITIES.find((entry) => entry.id === mine.activityId);
  const hero = activity
    ? `<div class="df-board-hero"><img src="${esc(expeditionImageUrl(activity.dungeonId))}" alt="" decoding="async" draggable="false"><div class="df-board-hero-copy"><span class="df-board-eyebrow">${esc(t('hudChrome.finder.yourListing'))}</span><h3>${esc(dungeonDisplayName(activity.dungeonId))}</h3>${difficultyBadge(activity.difficulty)}</div></div>`
    : `<h3 class="df-sub">${esc(t('hudChrome.finder.yourListing'))}</h3>`;
  return `<section class="df-mine ui-card ui-card-tile">${hero}<div class="df-mine-content">${groupHtml}<div class="df-mine-tags">${tagsHtml(mine.tags)}</div><div class="df-board-heading"><h3>${esc(t('hudChrome.finder.applicants'))}</h3><span class="df-board-count">${esc(num(mine.applicants.length))}</span></div><div class="df-applicants">${mine.applicants.length ? mine.applicants.map(boardApplicantHtml).join('') : `<div class="df-board-empty df-note">${svgIcon('social')}<p>${esc(t('hudChrome.finder.noApplicants'))}</p></div>`}</div><button type="button" class="btn leave df-close-listing ui-btn" data-act="closelisting">${esc(t('hudChrome.finder.closeListing'))}</button></div></section>`;
}

/** The caller supplies only the staged creation form; all live cards use the view. */
export function premadeBoardHtml(
  board: FinderBoardPanelView,
  creationHtml: string,
  groupHtml = '',
  rolesHtml = '',
  maskPlayerText?: (text: string) => string,
): string {
  const sidebar = board.myListing
    ? boardMyListingHtml(board, groupHtml)
    : groupHtml || creationHtml;
  const listings = board.listings.filter((row) => !row.mine);
  const rows = listings.length
    ? listings.map((listing) => boardListingHtml(listing, maskPlayerText)).join('')
    : `<div class="df-board-empty df-note">${svgIcon('social')}<p>${esc(t('hudChrome.finder.boardEmpty'))}</p></div>`;
  return `<div class="df-board-shell df-board-shell--browse">${sidebar ? `<section class="df-board-own">${sidebar}</section>` : ''}<section class="df-board-listings"><div class="df-board-heading"><h2>${esc(t('hudChrome.finder.openListings'))}</h2><span class="df-board-count">${esc(num(listings.length))}</span></div>${rolesHtml}<div class="df-listings">${rows}</div></section></div>`;
}
