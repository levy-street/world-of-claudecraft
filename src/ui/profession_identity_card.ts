import { archetypeTitleText, craftNameText } from './char_window';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import type { ProfessionIdentityModel } from './profession_identity_view';

function ceilingText(ceiling: 'unlimited' | 'rare' | 'common'): string {
  return t(
    ceiling === 'unlimited'
      ? 'hudChrome.crafting.identity.ceilingUnlimited'
      : ceiling === 'rare'
        ? 'hudChrome.crafting.identity.ceilingRare'
        : 'hudChrome.crafting.identity.ceilingCommon',
  );
}

function roleText(role: 'major' | 'hobby' | 'dormant' | 'unattuned'): string {
  return t(
    role === 'major'
      ? 'hudChrome.crafting.identity.roleMajor'
      : role === 'hobby'
        ? 'hudChrome.crafting.identity.roleHobby'
        : role === 'dormant'
          ? 'hudChrome.crafting.identity.roleDormant'
          : 'hudChrome.crafting.identity.roleUnattuned',
  );
}

export function renderProfessionIdentityCard(
  parent: HTMLElement,
  identity: ProfessionIdentityModel,
): void {
  const title = t('hudChrome.crafting.identity.title');
  const card = document.createElement('section');
  card.className = 'profession-identity-card';
  card.setAttribute('role', 'region');
  card.setAttribute('aria-label', title);

  if (identity.state === 'syncing') {
    card.innerHTML = `<h3>${esc(title)}</h3><p>${esc(t('hudChrome.crafting.identity.syncing'))}</p>`;
    parent.appendChild(card);
    return;
  }

  const summary = identity.summary;
  const summaryHtml =
    identity.state === 'unattuned' || !summary.majors
      ? `<p>${esc(t('hudChrome.crafting.identity.unattuned'))}</p>`
      : `<dl class="profession-identity-summary"><dt>${esc(t('hudChrome.crafting.identity.titleLabel'))}</dt><dd>${esc(archetypeTitleText(summary.pairId))}</dd><dt>${esc(t('hudChrome.crafting.identity.majorsLabel'))}</dt><dd>${esc(summary.majors.map(craftNameText).join(' + '))}</dd><dt>${esc(t('hudChrome.crafting.identity.hobbyLabel'))}</dt><dd>${esc(craftNameText(summary.hobbyCraft))}</dd><dt>${esc(t('hudChrome.crafting.identity.historyLabel'))}</dt><dd>${esc(t('hudChrome.crafting.identity.history', { pairs: formatNumber(summary.attunedPairCount, { maximumFractionDigits: 0 }), returns: formatNumber(summary.returnCount, { maximumFractionDigits: 0 }) }))}</dd></dl>`;

  const skillRows = identity.skills
    .map((row) => {
      const label = craftNameText(row.craftId);
      const detail = t('hudChrome.crafting.identity.skillAria', {
        craft: label,
        skill: formatNumber(row.skill, { maximumFractionDigits: 0 }),
        tier: formatNumber(row.tier, { maximumFractionDigits: 0 }),
        role: roleText(row.role),
        ceiling: ceilingText(row.ceiling),
      });
      return `<li class="profession-skill-row role-${row.role}" aria-label="${esc(detail)}"><span>${esc(label)}</span><span>${esc(formatNumber(row.skill, { maximumFractionDigits: 0 }))}</span><span>${esc(roleText(row.role))}</span><span>${esc(ceilingText(row.ceiling))}</span></li>`;
    })
    .join('');

  // Visual column headers only: aria-hidden because every skill row already
  // carries the complete skillAria sentence, so exposing the headers too would
  // double-read the table for screen readers.
  const skillHeader = skillRows
    ? `<li class="profession-skill-header" aria-hidden="true"><span>${esc(t('hudChrome.crafting.identity.colCraft'))}</span><span>${esc(t('hudChrome.crafting.identity.colSkill'))}</span><span>${esc(t('hudChrome.crafting.identity.colRole'))}</span><span>${esc(t('hudChrome.crafting.identity.colCap'))}</span></li>`
    : '';

  const tutorial = identity.tutorial
    ? `<p class="profession-identity-tutorial">${esc(t('hudChrome.crafting.identity.tutorial', { skill: formatNumber(identity.tutorial.targetSkill, { maximumFractionDigits: 0 }) }))}</p>`
    : '';
  const nudges = identity.nudges
    .map((nudge) =>
      nudge.type === 'nearTier'
        ? `<li>${esc(t('hudChrome.crafting.identity.nearTier', { craft: craftNameText(nudge.craftId), points: formatNumber(nudge.points, { maximumFractionDigits: 0 }) }))}</li>`
        : `<li>${esc(t('hudChrome.crafting.identity.dormantKnowledge', { craft: craftNameText(nudge.craftId) }))}</li>`,
    )
    .join('');

  card.innerHTML = `<h3>${esc(title)}</h3>${summaryHtml}${tutorial}<ul class="profession-skill-list" role="list">${skillHeader}${skillRows}</ul>${nudges ? `<ul class="profession-identity-nudges" role="list">${nudges}</ul>` : ''}`;
  parent.appendChild(card);
}
