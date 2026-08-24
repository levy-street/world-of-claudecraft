// The provisioning story (/wiki/professions/provisioning): how the gathering
// lines converge in cooking and climb from a levelling dish to the table a raid
// eats from. A NARRATIVE across professions rather than one profession's own
// reference, which is why it is a fixed page beside 'economy' and 'faq' rather
// than a per-craft one.
//
// NOTHING HERE IS HAND-LISTED. Every id, count and rung comes from
// GUIDE_PROF_PROVISIONING, which the generator derives from the live tables
// through the SAME supply authority tests/gathering_supply_coverage.test.ts
// reads (src/sim/professions/gathering_supply.ts), so this page cannot tell a
// player one thing while the guard asserts another. Every sentence is a
// guide.* t() key. A hand-listed reagent list goes stale the first time a bill
// moves; a generated table cannot.
//
// SPOILER-SAFE: the professions pages publish EXACT numbers under the
// transparency policy, so real skill rungs and real material names are correct
// and expected here. What stays out is instanced spoilers: no drop table, no
// boss, no instance is named anywhere on this page.

import { esc } from '../../ui/esc';
import { formatNumber, type TranslationKey, t } from '../../ui/i18n';
import { GUIDE_PROF_PROVISIONING } from '../content.generated';
import { hrefFor } from '../routes';
import { gatheringLabel } from './professions_gathering';
import { paras, related } from './ui';

/** The label for one supplying line. The five real gathering professions REUSE
 *  their shipped `hudChrome.gathering.*` names, which every locale already
 *  carries: minting a second set of one-word keys would have added six rows of
 *  translation debt to say what the catalog already says, and the two copies
 *  could then disagree.
 *
 *  Corpse harvesting is the one that needs its own key, and the reason is the
 *  same reason it needs one everywhere else in this packet: it is a gathering
 *  FAMILY without being a gathering PROFESSION, so it has no record and no
 *  shipped name to borrow. */
const CORPSE_LABEL_KEY: TranslationKey = 'guide.profPages.prov.lineCorpse';

function lineLabel(id: string): string {
  if (id === 'corpseHarvesting') return t(CORPSE_LABEL_KEY);
  return gatheringLabel(id);
}

/** One card per line that actually feeds the kitchen, listing what it brings.
 *  A line whose materials no cooking bill asks for never renders, so the page
 *  can only ever claim a supplier the tables agree with. */
function suppliersSection(): string {
  const cards = GUIDE_PROF_PROVISIONING.lines
    .map((line) => {
      const label = lineLabel(line.id);
      const items = line.materials.map((name) => `<li>${esc(name)}</li>`).join('');
      return `<div class="guide-fact">
          <dt>${esc(label)}</dt>
          <dd>${esc(t('guide.profPages.prov.lineCountFmt', { count: formatNumber(line.materials.length) }))}</dd>
          <dd><ul class="guide-prof-mat">${items}</ul></dd>
        </div>`;
    })
    .join('');
  return `<section class="guide-block" id="prov-suppliers">
      <h2>${esc(t('guide.profPages.prov.suppliersHeading'))}</h2>
      ${paras('guide.profPages.prov.suppliersBody')}
      <dl class="guide-class-facts guide-prof-facts">${cards}</dl>
    </section>`;
}

/** Cooking's own ladder, rung by rung. The outputs a player does not eat from
 *  bags are marked as such, because a ladder that did not say so would read
 *  wrong at the top: the feasts are set on the ground, and the Laden Hearth is
 *  a field station. Both live on the 125 rung beside plates that ARE eaten, so
 *  marking only the feasts told a reader the station was a dish (the Phase 11k
 *  QA finding). */
function ladderSection(): string {
  const rows = GUIDE_PROF_PROVISIONING.ladder
    .map((rung) => {
      const outputs = rung.outputs
        .map((out) => {
          // The quality colour is deliberately NOT painted here. Every other
          // guide list of outputs leaves it to the shipped list styling, and
          // minting a class no sheet defines would be a silent no-op dressed as
          // a design decision.
          const name = esc(out.name);
          if (out.placeable) {
            return `<li>${name} ${esc(t('guide.profPages.prov.placeableTag'))}</li>`;
          }
          // The station tag REUSES the shipped hudChrome name every locale
          // already carries, the same borrow the supplier labels above take:
          // minting a second key to say "field station" would be a row of
          // translation debt for a word the catalog ships.
          if (out.station) {
            return `<li>${name} (${esc(t('hudChrome.professions.mobileStationTooltip.kind'))})</li>`;
          }
          return `<li>${name}</li>`;
        })
        .join('');
      return `<li>
          <strong>${esc(t('guide.profPages.prov.rungFmt', { skill: formatNumber(rung.skillReq) }))}</strong>
          <ul class="guide-prof-mat">${outputs}</ul>
        </li>`;
    })
    .join('');
  return `<section class="guide-block" id="prov-ladder">
      <h2>${esc(t('guide.profPages.prov.ladderHeading'))}</h2>
      ${paras('guide.profPages.prov.ladderBody')}
      <ul class="guide-prof-bands">${rows}</ul>
    </section>`;
}

export function provisioningDetailHtml(): string {
  return `
    <article class="guide-article guide-prof-page">
      <p class="guide-section-more"><a href="${esc(hrefFor('professions'))}">${esc(t('guide.profPages.back'))}</a></p>
      <h1>${esc(t('guide.profPages.prov.title'))}</h1>
      <p class="guide-lead">${esc(t('guide.profPages.prov.intro'))}</p>
      ${suppliersSection()}
      ${ladderSection()}
      <section class="guide-block" id="prov-table">
        <h2>${esc(t('guide.profPages.prov.tableHeading'))}</h2>
        ${paras('guide.profPages.prov.tableBody')}
      </section>
      <section class="guide-block" id="prov-market">
        <h2>${esc(t('guide.profPages.prov.marketHeading'))}</h2>
        ${paras('guide.profPages.prov.marketBody')}
      </section>
      ${related([
        { href: hrefFor('professions'), key: 'guide.nav.professions' },
        { href: hrefFor('professions/cooking'), key: 'guide.profPages.prov.cookingLink' },
        { href: hrefFor('professions/economy'), key: 'guide.profPages.econ.title' },
      ])}
    </article>`;
}
