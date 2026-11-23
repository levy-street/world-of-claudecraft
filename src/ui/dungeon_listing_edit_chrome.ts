// Leader controls shared by the create form and my published listing: the role
// pickers for the party members a listing brings along, and the difficulty
// switch. Markup only; the finder window wires the controls.
import type { Role } from '../sim/content/talents';
import type { FinderDifficultyOptionView, FinderPartyMemberView } from './dungeon_finder_view';
import { classDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';

const ROLE_KEYS: Record<Role, TranslationKey> = {
  tank: 'hudChrome.finder.roleTank',
  healer: 'hudChrome.finder.roleHealer',
  dps: 'hudChrome.finder.roleDps',
};

/** One select per member: "their choice" (own finder role) or a class role.
 *  The create form passes its draft as `assigned`; a published listing reads
 *  each member's assignment and titles the block as its role editor. */
export function partyRolesHtml(
  members: readonly FinderPartyMemberView[],
  assigned?: (pid: number) => Role | null,
): string {
  if (members.length === 0) return '';
  const rows = members
    .map((member) => {
      const current = assigned ? assigned(member.pid) : member.assigned;
      const options = [
        `<option value=""${current === null ? ' selected' : ''}>${esc(t('hudChrome.finder.partyRoleOwn'))}</option>`,
        ...member.roles.map(
          (role) =>
            `<option value="${role}"${current === role ? ' selected' : ''}>${esc(t(ROLE_KEYS[role]))}</option>`,
        ),
      ].join('');
      const meta = t('hudChrome.finder.partyMemberMeta', {
        level: formatNumber(member.level, { maximumFractionDigits: 0 }),
        cls: classDisplayName(member.cls),
      });
      return `<li class="df-party-member"><span class="df-party-name">${esc(member.name)}</span><span class="df-party-meta ui-meta">${esc(meta)}</span><select class="ui-input" data-party-role="${member.pid}" aria-label="${esc(t('hudChrome.finder.partyRoleAria', { name: member.name }))}">${options}</select></li>`;
    })
    .join('');
  return `<section class="df-party-roles"><h3 class="df-sub">${esc(t(assigned ? 'hudChrome.finder.partyHeading' : 'hudChrome.finder.partyRolesHeading'))}</h3><p class="df-note">${esc(t(assigned ? 'hudChrome.finder.partyNote' : 'hudChrome.finder.partyRolesNote'))}</p><ul class="df-party-list">${rows}</ul></section>`;
}

/** Normal / Heroic toggle for my listing; the current difficulty is pressed. */
export function difficultySwitchHtml(options: readonly FinderDifficultyOptionView[]): string {
  if (options.length < 2) return '';
  const buttons = options
    .map(
      (option) =>
        `<button type="button" class="df-difficulty-option ui-btn${option.current ? ' active' : ''}${option.difficulty === 'heroic' ? ' heroic' : ''}" data-listing-difficulty="${esc(option.id)}" aria-pressed="${option.current}"${option.current || !option.eligible ? ' disabled' : ''}>${esc(t(option.difficulty === 'heroic' ? 'hudChrome.finder.heroic' : 'hudChrome.finder.normal'))}</button>`,
    )
    .join('');
  return `<div class="df-difficulty-switch" role="group" aria-label="${esc(t('hudChrome.finder.difficultyHeading'))}"><span class="df-sub">${esc(t('hudChrome.finder.difficultyHeading'))}</span><div class="df-difficulty-options">${buttons}</div></div>`;
}
