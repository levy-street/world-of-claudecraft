// Per-craft reference page (/wiki/professions/<craftId>), one module driven by
// craft id for all ten earnable crafts, the classes-page parameterized
// precedent. Renders entirely from GUIDE_PROF_* generated data plus guide.*
// t() keys; recipe/output/NPC names are baked English proper nouns (the
// GUIDE_DEEDS precedent) and craft/station/slot/stat/quality labels localize
// through their existing catalog keys. ONE CARVE-OUT since
// wiki-craft-table-baked-english: a MATERIALS cell name localizes through the
// item's own entities.items.<id>.name key (materialName below), because that
// name is interpolated INTO a t() format string and a baked English half made
// the whole sentence mixed-language for every reader. TRANSPARENCY POLICY
// professions pages publish EXACT numbers; the mirrored
// accuracy guards live in tests/guide.test.ts.
//
// Enchanting rides this module as one of its routes rather than a bespoke
// page: it reuses the whole frame (facts strip, mastery, masterwork,
// specialization, related links) and differs only in its content sections
// (enchant/disenchant/salvage tables instead of a recipe ladder), so sharing
// the module reuses strictly more than a separate page would.

import type { AuraKind } from '../../sim/types';
import { esc } from '../../ui/esc';
import { WELLFED_STAT_KEYS } from '../../ui/hud/professions/wellfed_stat_keys';
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
const enchantLabel = (id: string): string => t(`hudChrome.enchantName.${id}` as TranslationKey);

export function craftById(id: string): GuideProfCraft | undefined {
  return GUIDE_PROF_CRAFTS.find((c) => c.id === id);
}

/** The catalog key holding an item's localized display name.
 *
 *  Built here rather than imported. The canonical builder
 *  (entityTranslationKey in src/ui/entity_i18n.ts) IS exported, but it is
 *  unusable from this bundle: its module statically imports
 *  ITEMS/MOBS/NPCS/QUESTS/ZONES from src/sim/data, so pulling in the one
 *  function drags the whole table with it. The public wiki is spoiler-scoped
 *  to what the generator publishes, so shipping the bestiary into guide.html
 *  to read one name would be both a bundle and a spoiler regression. The
 *  catalog keys themselves ARE in the guide's locale bundle
 *  (entities.items.<id>.name is dense in every resolved slice), so only the
 *  key-building needs re-stating, and tests/guide.test.ts pins this builder
 *  against entityTranslationKey for every material id the generator emits.
 *  The sanitizer mirrors entityPathSegment, and gets its own arm in that pin
 *  on SYNTHETIC ids: every shipped material id is word-characters-only, so
 *  the live sweep alone stays green with the replace() deleted outright.
 *
 *  Exported for that pin. */
export function itemNameKey(itemId: string): TranslationKey {
  return `entities.items.${itemId.replace(/[^A-Za-z0-9_]/g, '_')}.name` as TranslationKey;
}

/** A reagent's display name in the READER's language.
 *
 *  Was `m.name`, the generator's baked English, interpolated straight into a
 *  t() format string, so a Spanish reader got "Osmium Ore x4" on the wiki and
 *  "Mineral de osmio" in the game. The generated `name` stays as the English
 *  source the accuracy guards pin the id against; nothing renders it. */
export function materialName(m: GuideProfMaterial): string {
  return t(itemNameKey(m.itemId));
}

function materialsCell(materials: GuideProfMaterial[]): string {
  return materials
    .map(
      (m) =>
        `<span class="guide-prof-mat">${esc(
          t('guide.profPages.matFmt', { name: materialName(m), count: formatNumber(m.count) }),
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
  // BOTH channels (Masterwrought phase 11f): a pattern that drops AND sells on
  // the marks counter. Sits FIRST because either single label below is a lie
  // about the other channel, and the harmful direction is specific: a farming
  // pattern labelled vendor-only would send a player to the quartermaster and
  // they would never look in the raid it also drops from.
  if (r.acquisition === 'dropAndVendor') return esc(t('guide.profPages.sourceDropAndVendor'));
  // Vendor-sold patterns (Masterwrought phase 11, R8's deterministic pillar):
  // the generator emits 'vendor' for a drop-acquisition recipe whose teaching
  // pattern the Heroic Quartermaster stocks and NO drop table carries, so this
  // arm sits before the drop arm and the row states the deterministic source.
  if (r.acquisition === 'vendor') return esc(t('guide.profPages.sourceVendor'));
  // Drop-taught (the Masterwrought apex rows, R8): the row must never claim
  // the recipe is known from the start.
  if (r.acquisition === 'drop') return esc(t('guide.profPages.sourceDrop'));
  return esc(t('guide.profPages.sourceKnown'));
}

/** The consumable-effect sub-lines for a dish recipe (the C10 gap: the wiki
 *  showed no effect prose for ANY dish). Composed from the generated VALUES
 *  through t() templates per the tooltip doctrine (resolved numbers from the
 *  live def, the finish-the-meal trigger stated, nothing hidden); the stat
 *  label rides the SAME exported map the in-game dish and feast tooltips use
 *  (WELLFED_STAT_KEYS), so the wiki can never name a stat the tooltip does
 *  not. An unmapped buff kind degrades to the aura-name line rather than
 *  shipping a silent dish (the wellfed_tooltip_view fallback rule); the
 *  interpolated aura value is the def's own baked English proper noun, the
 *  SAME policy the page's remaining baked names follow (see the module
 *  header's GUIDE_DEEDS precedent and the materials carve-out beside it),
 *  and tests/guide.test.ts asserts every SHIPPED
 *  wellfed kind is mapped, so the fallback stays a degradation path, never
 *  the live rendering. Exported for the direct fallback-render test.
 *
 *  A PLACEABLE FEAST reads the same three numbers but says them differently
 *  (harvest-feast-wiki-effect-cell). Its `effect` is the dish it SERVES, one
 *  hop through feast.dishItemId, because a feast carries no foodHp and no
 *  wellFed of its own; the wording has to follow, since the player sets a
 *  feast out and does not eat it, and the restore and the boon reach whoever
 *  takes a serving rather than the crafter. So the feast branch swaps the
 *  templates and nothing else: same resolved values, same stat map, same
 *  finish-the-meal trigger. The unmapped-kind degradation keeps the ONE
 *  shared aura line for both shapes, since it names no eater at all and
 *  nothing shipped ever renders it. */
export function effectLines(r: GuideProfRecipe): string {
  const effect = r.effect;
  if (!effect) return '';
  const feast = effect.feast;
  const lines: string[] = [];
  if (feast) {
    lines.push(
      t('guide.profPages.effectFeast', {
        servings: formatNumber(feast.servings),
        minutes: formatNumber(feast.minutes, { maximumFractionDigits: 1 }),
      }),
    );
  }
  if (effect.food) {
    const values = {
      amount: formatNumber(effect.food.amount),
      seconds: formatNumber(effect.food.seconds),
    };
    lines.push(
      feast
        ? t('guide.profPages.effectFeastServing', values)
        : t('guide.profPages.effectFood', values),
    );
  }
  if (effect.wellfed) {
    const statKey = WELLFED_STAT_KEYS[effect.wellfed.kind as AuraKind];
    const minutes = formatNumber(effect.wellfed.minutes, { maximumFractionDigits: 1 });
    if (statKey) {
      const values = { stat: t(statKey), value: formatNumber(effect.wellfed.value), minutes };
      lines.push(
        feast
          ? t('guide.profPages.effectFeastWellFed', values)
          : t('guide.profPages.effectWellFed', values),
      );
    } else {
      lines.push(t('guide.profPages.effectWellFedAura', { aura: effect.wellfed.aura, minutes }));
    }
  }
  return lines.map((line) => `<span class="guide-prof-effect">${esc(line)}</span>`).join('');
}

/** The "Gain fades at" cell: the three Mastery Curve boundaries, with any
 *  boundary a player can NEVER reach named as such instead of printed as a
 *  skill number.
 *
 *  wiki-craft-gain-clamp, and it is worth recording why this is a REWORD and
 *  not the clamp the finding asked for. A boundary is (recipeTier + 1|2|3) *
 *  TIER_SKILL_STEP, the skill at which the player's capability tier passes the
 *  recipe's by one, two, three. Craft skill is hard-capped at the craft's own
 *  maxSkill (125 for all ten; src/sim/professions/wheel.ts clamps gain AND
 *  load against it), so a tier-5 recipe's boundaries land at 150 / 175 / 200
 *  and none of them exists. 63 of the 170 published rows printed at least one.
 *
 *  CLAMPING those numbers to the cap was tried and is WRONG on the merits, not
 *  merely on the pins: the tier-3 pick would print "gain fades to nothing at
 *  125" when at 125 it still pays a quarter, so the clamp replaces an
 *  unreachable number with a FALSE claim about a reachable one. The two guards
 *  say the same thing, which is what a decisive pin is for: the curve arm in
 *  tests/guide.test.ts reds with "expected 0.25 to be +0" and the literal row
 *  reds on {100, 125, 150} becoming {100, 125, 125}. So the generated numbers
 *  stay the raw, curve-true arithmetic (nothing about the DATA moves) and the
 *  PAGE stops printing a skill nobody can have. */
function gainCell(r: GuideProfRecipe, maxSkill: number): string {
  const bound = (at: number): string =>
    at > maxSkill ? t('guide.profPages.gainNever') : formatNumber(at);
  return t('guide.profPages.gainFmt', {
    reduced: bound(r.gain.reducedAt),
    minimal: bound(r.gain.minimalAt),
    zero: bound(r.gain.zeroAt),
  });
}

function recipeRow(r: GuideProfRecipe, maxSkill: number): string {
  const combo = r.combo
    ? `<span class="guide-prof-combo">${esc(
        t('guide.profPages.comboReq', {
          a: craftLabel(r.combo.crafts[0]),
          b: craftLabel(r.combo.crafts[1]),
        }),
      )}</span>`
    : '';
  // The daily craft gate is the defining fact of a gated recipe (the whole
  // Masterwrought time-gate design hangs off it), so the wiki states it the
  // way the in-game tooltip does, in the same badge slot the combo gate uses.
  const daily = r.oncePerDay
    ? `<span class="guide-prof-combo">${esc(t('guide.profPages.oncePerDay'))}</span>`
    : '';
  const output =
    r.output.count > 1
      ? t('guide.profPages.outputFmt', { name: r.output.name, count: formatNumber(r.output.count) })
      : r.output.name;
  return `<tr>
      <td class="guide-prof-recipe q-${esc(r.output.quality)}">${esc(output)}${combo}${daily}${effectLines(r)}</td>
      <td>${esc(formatNumber(r.skillReq))}</td>
      <td>${sourceCell(r)}</td>
      <td>${esc(r.station ? stationLabel(r.station) : t('guide.profPages.stationAnywhere'))}</td>
      <td>${materialsCell(r.materials)}</td>
      <td>${esc(qualityLabel(r.output.quality))}</td>
      <td>${esc(gainCell(r, maxSkill))}</td>
    </tr>`;
}

function recipesTable(recipes: GuideProfRecipe[], maxSkill: number): string {
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
        <tbody>${recipes.map((r) => recipeRow(r, maxSkill)).join('')}</tbody>
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
// the craft-specific prose the shared sections cannot carry. The optional
// bodyKey override exists for a retired-and-re-keyed body (the reword-is-a-
// new-key convention) whose replacement suffix the template cannot build;
// the heading key always stays the template's.
function proseSection(
  craftId: string,
  slot: string,
  sectionId: string,
  bodyKey?: TranslationKey,
): string {
  return `<section class="guide-block" id="${esc(sectionId)}">
      <h2>${esc(t(`guide.profPages.craftProse.${craftId}.${slot}Heading` as TranslationKey))}</h2>
      ${paras(bodyKey ?? (`guide.profPages.craftProse.${craftId}.${slot}Body` as TranslationKey))}
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
  // The Perfected gate is the defining fact of the one enchant that carries it,
  // so it rides the same badge slot the recipe table gives the combo and daily
  // gates; the Skill column mirrors the recipe table's, since the Lucent tier
  // is the first enchant work with a floor at all (0 for the historical defs).
  const enchantRows = e.enchants
    .map(
      (row) => `<tr>
        <td>${esc(enchantLabel(row.id))}${
          row.perfectedOnly
            ? `<span class="guide-prof-combo">${esc(t('guide.profPages.ench.perfectedOnly'))}</span>`
            : ''
        }${row.requiresFormula ? `<span class="guide-prof-combo">${esc(t('guide.profPages.ench.formulaRequired'))}</span>` : ''}</td>
        <td>${esc(slotLabel(row.slot))}</td>
        <td>${esc(tierLabel(row.tier))}</td>
        <td>${esc(formatNumber(row.skillReq))}</td>
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
          .join(
            '',
          )}${row.hasDescription ? esc(t(`hudChrome.enchantDescription.${row.id}` as TranslationKey)) : ''}</td>
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
      ${paras('guide.profPages.ench.enchantsNoteRaidFormula')}
      <div class="guide-table-scroll"><table class="guide-keytable guide-prof-table">
        <thead><tr>
          <th scope="col">${esc(t('guide.profPages.ench.colEnchant'))}</th>
          <th scope="col">${esc(t('guide.profPages.ench.colSlot'))}</th>
          <th scope="col">${esc(t('guide.profPages.ench.colTier'))}</th>
          <th scope="col">${esc(t('guide.profPages.colSkill'))}</th>
          <th scope="col">${esc(t('guide.profPages.colMaterials'))}</th>
          <th scope="col">${esc(t('guide.profPages.ench.colBonus'))}</th>
        </tr></thead>
        <tbody>${enchantRows}</tbody>
      </table></div>
    </section>
    <section class="guide-block" id="prof-charms">
      <h2>${esc(t('guide.profPages.ench.charmsHeading'))}</h2>
      ${paras('guide.profPages.ench.charmsBody')}
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
          ${recipesTable(c.recipes, c.maxSkill)}
        </section>`;
  const preSections =
    c.id === 'enchanting'
      ? proseSection(c.id, 'identity', 'prof-identity') +
        proseSection(c.id, 'leveling', 'prof-leveling')
      : proseSection(
          c.id,
          'identity',
          'prof-identity',
          // Cooking's identity body was retired and re-keyed for the
          // canonical one-meal Well Fed sentence (the reword-is-a-new-key
          // convention); the heading key is unchanged.
          c.id === 'cooking' ? 'guide.profPages.craftProse.cooking.identityBodyOneMeal' : undefined,
        ) +
        proseSection(
          c.id,
          'materials',
          'prof-materials',
          // Engineering's materials body was retired and re-keyed at Phase 19F
          // (its rod count was wrong: three recipes, not two); inscription's at
          // Phase 19G (its scroll-elixir parity claim was false until the
          // scroll took the gourd, D171). The heading keys are unchanged.
          c.id === 'engineering'
            ? 'guide.profPages.craftProse.engineering.materialsBodyThreeRods'
            : c.id === 'inscription'
              ? 'guide.profPages.craftProse.inscription.materialsBodyFrostGourd'
              : undefined,
        ) +
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
        ${paras('guide.profPages.masterworkBodyRaidCollections', {
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
        ${paras('guide.profPages.specializationBodyUndiscounted', {
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
