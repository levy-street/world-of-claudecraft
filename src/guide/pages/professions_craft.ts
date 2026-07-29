// Per-craft reference page (/wiki/professions/<craftId>), one module driven by
// craft id for all eight earnable crafts, the classes-page parameterized
// precedent. Renders entirely from GUIDE_PROF_* generated data plus guide.*
// t() keys; item/recipe/NPC names are baked English proper nouns (the
// GUIDE_DEEDS precedent) and craft/station/slot/stat/quality labels localize
// through their existing catalog keys. TRANSPARENCY POLICY
// professions pages publish EXACT numbers; the mirrored
// accuracy guards live in tests/guide.test.ts.
//
// Enchanting rides this module as one of its routes rather than a bespoke
// page: it reuses the whole frame (facts strip, mastery, masterwork,
// specialization, related links) and differs only in its content sections
// (enchant/disenchant/salvage tables instead of a recipe ladder), so sharing
// the module reuses strictly more than a separate page would.

import { esc } from '../../ui/esc';
import { formatMoney, formatNumber, type TranslationKey, t } from '../../ui/i18n';
import {
  GUIDE_PROF_CRAFTS,
  GUIDE_PROF_CURVE,
  GUIDE_PROF_ECONOMY,
  GUIDE_PROF_ENCHANTING,
  GUIDE_PROF_MASTERWORK,
  type GuideProfCraft,
  type GuideProfMaterial,
  type GuideProfRecipe,
} from '../content.generated';
import { hrefFor } from '../routes';
import { paras, related } from './ui';

export function craftLabel(id: string): string {
  return t(`hudChrome.craftName.${id}` as TranslationKey);
}
export function stationLabel(type: string): string {
  return t(`hudChrome.crafting.stationName.${type}` as TranslationKey);
}
const qualityLabel = (q: string): string => t(`itemUi.quality.${q}` as TranslationKey);
const slotLabel = (slot: string): string => t(`itemUi.slots.${slot}` as TranslationKey);
const statLabel = (stat: string): string => t(`itemUi.stats.${stat}` as TranslationKey);

export function craftById(id: string): GuideProfCraft | undefined {
  return GUIDE_PROF_CRAFTS.find((c) => c.id === id);
}

function materialsCell(materials: GuideProfMaterial[]): string {
  return materials
    .map(
      (m) =>
        `<span class="guide-prof-mat">${esc(
          t('guide.profPages.matFmt', { name: m.name, count: formatNumber(m.count) }),
        )}</span>`,
    )
    .join('');
}

function sourceCell(r: GuideProfRecipe): string {
  if (r.acquisition === 'trainer') {
    return r.feeCopper > 0
      ? esc(t('guide.profPages.sourceTrainerFee', { fee: formatMoney(r.feeCopper) }))
      : esc(t('guide.profPages.sourceTrainerFree'));
  }
  return esc(t('guide.profPages.sourceKnown'));
}

function recipeRow(r: GuideProfRecipe): string {
  const combo = r.combo
    ? `<span class="guide-prof-combo">${esc(
        t('guide.profPages.comboReq', {
          a: craftLabel(r.combo.crafts[0]),
          b: craftLabel(r.combo.crafts[1]),
        }),
      )}</span>`
    : '';
  const output =
    r.output.count > 1
      ? t('guide.profPages.outputFmt', { name: r.output.name, count: formatNumber(r.output.count) })
      : r.output.name;
  return `<tr>
      <td class="guide-prof-recipe q-${esc(r.output.quality)}">${esc(output)}${combo}</td>
      <td>${esc(formatNumber(r.skillReq))}</td>
      <td>${sourceCell(r)}</td>
      <td>${esc(r.station ? stationLabel(r.station) : t('guide.profPages.stationAnywhere'))}</td>
      <td>${materialsCell(r.materials)}</td>
      <td>${esc(qualityLabel(r.output.quality))}</td>
      <td>${esc(
        t('guide.profPages.gainFmt', {
          reduced: formatNumber(r.gain.reducedAt),
          minimal: formatNumber(r.gain.minimalAt),
          zero: formatNumber(r.gain.zeroAt),
        }),
      )}</td>
    </tr>`;
}

function recipesTable(recipes: GuideProfRecipe[]): string {
  return `<div class="guide-table-scroll">
      <table class="guide-keytable guide-prof-table">
        <thead><tr>
          <th scope="col">${esc(t('guide.profPages.colRecipe'))}</th>
          <th scope="col">${esc(t('guide.profPages.colSkill'))}</th>
          <th scope="col">${esc(t('guide.profPages.colSource'))}</th>
          <th scope="col">${esc(t('guide.profPages.colStation'))}</th>
          <th scope="col">${esc(t('guide.profPages.colMaterials'))}</th>
          <th scope="col">${esc(t('guide.profPages.colQuality'))}</th>
          <th scope="col">${esc(t('guide.profPages.colGain'))}</th>
        </tr></thead>
        <tbody>${recipes.map(recipeRow).join('')}</tbody>
      </table>
    </div>`;
}

function factsHtml(c: GuideProfCraft): string {
  const masters = c.masters
    .map((m) => t('guide.profPages.masterFmt', { name: m.name, hub: m.hub }))
    .join(', ');
  const rows: [string, string][] = [
    [t('guide.profPages.capLabel'), formatNumber(c.maxSkill)],
    [
      t('guide.profPages.stationLabel'),
      c.station ? stationLabel(c.station) : t('guide.profPages.stationNone'),
    ],
    ...(masters ? [[t('guide.profPages.mastersLabel'), masters] as [string, string]] : []),
    [
      t('guide.profPages.specializationLabel'),
      t('guide.profPages.specializationFact', {
        at: formatNumber(c.specialization.at),
        pct: formatNumber(c.specialization.materialDiscountPct),
      }),
    ],
  ];
  const cells = rows
    .map(
      ([label, value]) =>
        `<div class="guide-fact"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`,
    )
    .join('');
  return `<dl class="guide-class-facts guide-prof-facts">${cells}</dl>`;
}

// ------------------------------------------------ per-craft prose sections
// Craft-specific narrative (identity, materials, ladder, route; enchanting:
// identity, leveling, market) from guide.profPages.craftProse.<craftId>.*,
// the craft-specific prose the shared sections cannot carry.
function proseSection(craftId: string, slot: string, sectionId: string): string {
  return `<section class="guide-block" id="${esc(sectionId)}">
      <h2>${esc(t(`guide.profPages.craftProse.${craftId}.${slot}Heading` as TranslationKey))}</h2>
      ${paras(`guide.profPages.craftProse.${craftId}.${slot}Body` as TranslationKey)}
    </section>`;
}

// ------------------------------------------------- enchanting-only sections
function enchantingSections(): string {
  const e = GUIDE_PROF_ENCHANTING;
  const disRows = e.disenchantByQuality
    .map(
      (row) =>
        `<tr><td class="q-${esc(row.quality)}">${esc(qualityLabel(row.quality))}</td><td>${esc(row.material)}</td></tr>`,
    )
    .join('');
  const typedRows = [
    ...e.typedSecondaries.armor.map(
      (row) =>
        `<tr><td>${esc(t(`hudChrome.itemArmorType.${row.armorType}` as TranslationKey))}</td><td>${esc(row.material)}</td></tr>`,
    ),
    `<tr><td>${esc(t('guide.profPages.ench.meleeWeapons'))}</td><td>${esc(e.typedSecondaries.meleeWeapons)}</td></tr>`,
    `<tr><td>${esc(t('guide.profPages.ench.timberWeapons'))}</td><td>${esc(e.typedSecondaries.timberWeapons.material)}</td></tr>`,
  ].join('');
  const tierLabel = (tier: string): string =>
    t(`guide.profPages.ench.tier.${tier}` as TranslationKey);
  const enchantRows = e.enchants
    .map(
      (row) => `<tr>
        <td>${esc(row.name)}</td>
        <td>${esc(slotLabel(row.slot))}</td>
        <td>${esc(tierLabel(row.tier))}</td>
        <td>${materialsCell(row.reagents)}</td>
        <td>${row.bonus
          .map(
            (b) =>
              `<span class="guide-prof-mat">${esc(
                t('guide.profPages.ench.bonusFmt', {
                  value: formatNumber(b.value),
                  stat: statLabel(b.stat),
                }),
              )}</span>`,
          )
          .join('')}</td>
      </tr>`,
    )
    .join('');
  const salvageRows = e.salvageByQuality
    .map(
      (row) =>
        `<tr><td class="q-${esc(row.quality)}">${esc(qualityLabel(row.quality))}</td><td>${esc(row.material)}</td></tr>`,
    )
    .join('');
  return `
    <section class="guide-block" id="prof-disenchant">
      <h2>${esc(t('guide.profPages.ench.disenchantHeading'))}</h2>
      ${paras('guide.profPages.ench.disenchantNote')}
      <div class="guide-table-scroll"><table class="guide-keytable">
        <thead><tr><th scope="col">${esc(t('guide.profPages.colQuality'))}</th><th scope="col">${esc(t('guide.profPages.colMaterial'))}</th></tr></thead>
        <tbody>${disRows}</tbody>
      </table></div>
      <h3>${esc(t('guide.profPages.ench.typedHeading'))}</h3>
      ${paras('guide.profPages.ench.typedNote', {
        rare: formatNumber(e.typedSecondaries.counts.rare),
        epicMin: formatNumber(e.typedSecondaries.counts.epicMin),
        epicMax: formatNumber(e.typedSecondaries.counts.epicMax),
      })}
      <div class="guide-table-scroll"><table class="guide-keytable">
        <thead><tr><th scope="col">${esc(t('guide.profPages.ench.colSource'))}</th><th scope="col">${esc(t('guide.profPages.colMaterial'))}</th></tr></thead>
        <tbody>${typedRows}</tbody>
      </table></div>
    </section>
    <section class="guide-block" id="prof-enchants">
      <h2>${esc(t('guide.profPages.ench.enchantsHeading'))}</h2>
      ${paras('guide.profPages.ench.enchantsNote')}
      <div class="guide-table-scroll"><table class="guide-keytable guide-prof-table">
        <thead><tr>
          <th scope="col">${esc(t('guide.profPages.ench.colEnchant'))}</th>
          <th scope="col">${esc(t('guide.profPages.ench.colSlot'))}</th>
          <th scope="col">${esc(t('guide.profPages.ench.colTier'))}</th>
          <th scope="col">${esc(t('guide.profPages.colMaterials'))}</th>
          <th scope="col">${esc(t('guide.profPages.ench.colBonus'))}</th>
        </tr></thead>
        <tbody>${enchantRows}</tbody>
      </table></div>
    </section>
    <section class="guide-block" id="prof-salvage">
      <h2>${esc(t('guide.profPages.ench.salvageHeading'))}</h2>
      ${paras('guide.profPages.ench.salvageNote')}
      <div class="guide-table-scroll"><table class="guide-keytable">
        <thead><tr><th scope="col">${esc(t('guide.profPages.colQuality'))}</th><th scope="col">${esc(t('guide.profPages.colMaterial'))}</th></tr></thead>
        <tbody>${salvageRows}</tbody>
      </table></div>
    </section>`;
}

// ------------------------------------------------------------- page assembly
export function craftDetailHtml(c: GuideProfCraft): string {
  const curve = GUIDE_PROF_CURVE;
  const mw = GUIDE_PROF_MASTERWORK;
  const econ = GUIDE_PROF_ECONOMY;
  const hasTrainer = c.recipes.some((r) => r.acquisition === 'trainer');
  const contentSections =
    c.id === 'enchanting'
      ? enchantingSections()
      : `<section class="guide-block" id="prof-recipes">
          <h2>${esc(t('guide.profPages.recipesHeading'))}</h2>
          <p>${esc(t('guide.profPages.recipesNote'))}</p>
          ${recipesTable(c.recipes)}
        </section>`;
  const preSections =
    c.id === 'enchanting'
      ? proseSection(c.id, 'identity', 'prof-identity') +
        proseSection(c.id, 'leveling', 'prof-leveling')
      : proseSection(c.id, 'identity', 'prof-identity') +
        proseSection(c.id, 'materials', 'prof-materials') +
        proseSection(c.id, 'ladder', 'prof-ladder');
  const postSections =
    c.id === 'enchanting'
      ? proseSection(c.id, 'market', 'prof-market')
      : proseSection(c.id, 'route', 'prof-route');
  const training = hasTrainer
    ? `<section class="guide-block" id="prof-training">
        <h2>${esc(t('guide.profPages.trainingHeading'))}</h2>
        ${paras('guide.profPages.trainingBody', {
          tier1: formatMoney(econ.trainingFeeCopperByTier[1]),
          tier2: formatMoney(econ.trainingFeeCopperByTier[2]),
        })}
      </section>`
    : '';
  return `
    <article class="guide-article guide-prof-page">
      <p class="guide-section-more"><a href="${esc(hrefFor('professions'))}">${esc(t('guide.profPages.back'))}</a></p>
      <h1>${esc(craftLabel(c.id))}</h1>
      <p class="guide-lead">${esc(t(`guide.profPages.craftIntro.${c.id}` as TranslationKey))}</p>
      ${factsHtml(c)}
      ${preSections}
      <section class="guide-block" id="prof-how">
        <h2>${esc(t('guide.profPages.howHeading'))}</h2>
        ${paras('guide.profPages.howBody')}
      </section>
      ${contentSections}
      <section class="guide-block" id="prof-mastery">
        <h2>${esc(t('guide.profPages.masteryHeading'))}</h2>
        ${paras('guide.profPages.masteryBody', {
          step: formatNumber(curve.tierStep),
          cap: formatNumber(c.maxSkill),
        })}
      </section>
      <section class="guide-block" id="prof-masterwork">
        <h2>${esc(t('guide.profPages.masterworkHeading'))}</h2>
        ${paras('guide.profPages.masterworkBody', {
          base: formatNumber(mw.basePct),
          perTier: formatNumber(mw.perTierAbovePct),
          signed: formatNumber(mw.signedReagentPct),
          spec: formatNumber(mw.specializedPct),
          cap: formatNumber(mw.capPct),
        })}
      </section>
      ${training}
      <section class="guide-block" id="prof-specialization">
        <h2>${esc(t('guide.profPages.specializationHeading'))}</h2>
        ${paras('guide.profPages.specializationBody', {
          at: formatNumber(c.specialization.at),
          pct: formatNumber(c.specialization.materialDiscountPct),
        })}
      </section>
      ${postSections}
      ${related([
        { href: hrefFor('professions'), key: 'guide.nav.professions' },
        { href: hrefFor('professions/economy'), key: 'guide.profPages.econ.title' },
        { href: hrefFor('gear'), key: 'guide.nav.gear' },
      ])}
    </article>`;
}
