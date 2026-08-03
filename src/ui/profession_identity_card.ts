import { archetypeTitleText, craftNameText } from './char_window';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { archetypeImageUrl } from './profession_art';
import { orderSkillsForCard, type ProfessionIdentityModel } from './profession_identity_view';

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
    // Same .profession-identity-main wrapper the full card uses: the card is
    // a flex ROW (components.css), so bare children would sit side by side
    // and the waiting line would render beside its heading, not under it.
    card.innerHTML = `<div class="profession-identity-main"><h3>${esc(title)}</h3><p>${esc(t('hudChrome.crafting.identity.syncing'))}</p></div>`;
    parent.appendChild(card);
    return;
  }

  const summary = identity.summary;
  const attuned = identity.state !== 'unattuned' && summary.majors !== null;
  const crestUrl = attuned ? archetypeImageUrl(summary.pairId) : null;
  const headingHtml =
    `<div class="profession-identity-heading">` +
    `${crestUrl ? `<img class="profession-archetype-crest" src="${esc(crestUrl)}" alt="" draggable="false">` : ''}` +
    `<h3>${esc(title)}</h3></div>`;
  const summaryHtml =
    identity.state === 'unattuned' || !summary.majors
      ? `<p>${esc(t('hudChrome.crafting.identity.unattuned'))}</p>`
      : `<dl class="profession-identity-summary"><dt>${esc(t('hudChrome.crafting.identity.titleLabel'))}</dt><dd>${esc(archetypeTitleText(summary.pairId))}</dd><dt>${esc(t('hudChrome.crafting.identity.majorsLabel'))}</dt><dd>${esc(summary.majors.map(craftNameText).join(' + '))}</dd><dt>${esc(t('hudChrome.crafting.identity.hobbyLabel'))}</dt><dd>${esc(craftNameText(summary.hobbyCraft))}</dd><dt>${esc(t('hudChrome.crafting.identity.historyLabel'))}</dt><dd>${esc(t('hudChrome.crafting.identity.history', { pairs: formatNumber(summary.attunedPairCount, { maximumFractionDigits: 0 }), returns: formatNumber(summary.returnCount, { maximumFractionDigits: 0 }) }))}</dd></dl>`;
  // The make-amends return cost (closing the 2039 preview gap): shown
  // only while attuned, the same requiredAmendsProgress figure the quest
  // attunement preview and the professions window's switch-cost line render.
  const returnCostHtml = attuned
    ? `<p class="profession-identity-returncost">${esc(t('hudChrome.crafting.attunementReturnCost', { cost: formatNumber(summary.returnCost, { maximumFractionDigits: 0 }) }))}</p>`
    : '';

  // The skill rows reuse the professions window's row family (phase 22, the
  // Q28 ruling): a .prof-craft-head name line with the right-aligned
  // tabular-nums value, and the role/cap pills on their own chips line, so
  // long localized names and wide chips never fight for one baseline. When
  // the view collapsed the uniform chips (identity.uniform, the unattuned
  // card), the rows drop the chips line and the caption above the list
  // states the shared pair once. Every row keeps the complete skillAria
  // sentence either way, so no reader loses the role/cap facts.
  // Card presentation order (majors first; see orderSkillsForCard): the
  // model's own skills stay ring-ordered for the professions wheel.
  const skillRows = orderSkillsForCard(identity.skills)
    .map((row) => {
      const label = craftNameText(row.craftId);
      const detail = t('hudChrome.crafting.identity.skillAria', {
        craft: label,
        skill: formatNumber(row.skill, { maximumFractionDigits: 0 }),
        tier: formatNumber(row.tier, { maximumFractionDigits: 0 }),
        role: roleText(row.role),
        ceiling: ceilingText(row.ceiling),
      });
      const chips = identity.uniform
        ? ''
        : `<div class="prof-craft-chips"><span class="prof-role-badge">${esc(roleText(row.role))}</span><span class="prof-ceiling">${esc(ceilingText(row.ceiling))}</span></div>`;
      return `<li class="profession-skill-row prof-craft-row role-${row.role}" aria-label="${esc(detail)}"><div class="prof-craft-main"><div class="prof-craft-head"><span class="prof-craft-name">${esc(label)}</span><span class="prof-skill-value">${esc(formatNumber(row.skill, { maximumFractionDigits: 0 }))}</span></div>${chips}</div></li>`;
    })
    .join('');

  // The uniform-chips caption (the option 3 collapse): one line stating the
  // role and cap every row shares, in the same pill family the rows would
  // have carried. A list item rather than a sibling so the card keeps its
  // two-column flex shape untouched. aria-hidden like the retired column
  // header was, and for the same reason: every row's skillAria already
  // carries the role and cap, so exposing the caption too would read the
  // same pair an eleventh time. The role-* class lets the family's badge
  // recolors reach the caption pill, exactly as they reach a row's.
  const uniformCaption =
    identity.uniform && skillRows
      ? `<li class="profession-skill-uniform role-${identity.uniform.role}" aria-hidden="true"><span class="profession-skill-uniform-label">${esc(t('hudChrome.crafting.identity.allCrafts'))}</span><span class="prof-role-badge">${esc(roleText(identity.uniform.role))}</span><span class="prof-ceiling">${esc(ceilingText(identity.uniform.ceiling))}</span></li>`
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

  // Two-column card: the narrative half (heading, summary, return cost,
  // tutorial, nudges) beside the skill table, so the card reads as a compact
  // hero instead of a tall stack (the wrapper is layout-only; every child
  // keeps its class and semantics).
  // uniform-collapsed lifts the list's height cap: the collapse already
  // makes the rows one-liners, so the whole list fits without scrolling,
  // while the attuned two-line rows scroll past the cap (components.css).
  // The capped (non-collapsed) list is a scroll region with no focusable
  // child, so it takes tabindex 0 and a name: without them a keyboard-only
  // player cannot reach the rows past the fold (axe
  // scrollable-region-focusable). The collapsed list never scrolls and
  // stays out of the tab order.
  const cappedListAttrs = identity.uniform
    ? ''
    : ` tabindex="0" aria-label="${esc(t('hudChrome.crafting.identity.skillListAria'))}"`;
  card.innerHTML = `<div class="profession-identity-main">${headingHtml}${summaryHtml}${returnCostHtml}${tutorial}${nudges ? `<ul class="profession-identity-nudges" role="list">${nudges}</ul>` : ''}</div><ul class="profession-skill-list${identity.uniform ? ' uniform-collapsed' : ''}" role="list"${cappedListAttrs}>${uniformCaption}${skillRows}</ul>`;
  parent.appendChild(card);
}
