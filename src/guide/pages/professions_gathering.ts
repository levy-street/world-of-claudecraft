// Per-gathering-profession reference page (/wiki/professions/<id>), one module
// for mining, logging, herbalism, and fishing (the classes-page parameterized
// precedent). Renders entirely from GUIDE_PROF_* generated data plus guide.*
// t() keys; item/vendor names are baked English proper nouns and
// profession/quality labels localize via their existing catalog keys.
// TRANSPARENCY POLICY: professions pages publish EXACT
// numbers (cast timing, band thresholds, odds, prices); the mirrored accuracy
// guards live in tests/guide.test.ts.

import {
  TIER2_TOOL_GATE_PROFICIENCY,
  TIER3_TOOL_GATE_PROFICIENCY,
} from '../../sim/content/vendor_row_gates';
import { esc } from '../../ui/esc';
import { formatMoney, formatNumber, type TranslationKey, t } from '../../ui/i18n';
import {
  GUIDE_PROF_CURVE,
  GUIDE_PROF_GATHERING,
  type GuideProfGathering,
  type GuideProfTool,
} from '../content.generated';
import { hrefFor } from '../routes';
import { paras, related } from './ui';

export function gatheringLabel(id: string): string {
  return t(`hudChrome.gathering.${id}` as TranslationKey);
}
const qualityLabel = (q: string): string => t(`itemUi.quality.${q}` as TranslationKey);

export function gatheringById(id: string): GuideProfGathering | undefined {
  return GUIDE_PROF_GATHERING.find((g) => g.id === id);
}

// The Source cell's one decision, flattened: crafted tools name their craft
// and, when a delve counter also stocks them, the Marks price behind its
// clears gate (the eight top tools; naming only the craft made the table
// contradict the prose above it); bought tools name their counter.
function toolSource(tool: GuideProfTool): string {
  if (tool.craftedBy) {
    const craft = t(`hudChrome.craftName.${tool.craftedBy}` as TranslationKey);
    if (tool.priceMarks == null) return t('guide.profPages.toolCrafted', { craft });
    const marks = formatNumber(tool.priceMarks);
    return tool.marksHeroicClear
      ? t('guide.profPages.toolCraftedOrMarksHeroic', { craft, marks })
      : t('guide.profPages.toolCraftedOrMarks', { craft, marks });
  }
  if (tool.vendors.length > 0) {
    return t('guide.profPages.toolVendor', {
      name: tool.vendors[0].name,
      hub: tool.vendors[0].hub,
    });
  }
  return t('guide.profPages.toolUnavailable');
}

function toolRow(tool: GuideProfTool): string {
  const source = toolSource(tool);
  // R22: the wield requirement the harvest gate enforces, or None for tier 1
  // and every rod (rods are the structural exemption).
  const wield =
    tool.wieldProficiency != null
      ? formatNumber(tool.wieldProficiency)
      : t('guide.profPages.wieldNone');
  return `<tr>
      <td class="q-${esc(tool.quality)}">${esc(tool.name)}</td>
      <td>${esc(formatNumber(tool.tier))}</td>
      <td>${esc(qualityLabel(tool.quality))}</td>
      <td>${esc(wield)}</td>
      <td>${esc(tool.priceCopper != null ? formatMoney(tool.priceCopper) : t('guide.profPages.priceNone'))}</td>
      <td>${esc(source)}</td>
    </tr>`;
}

function toolsSection(g: GuideProfGathering): string {
  return `<section class="guide-block" id="prof-tools">
      <h2>${esc(t('guide.profPages.toolsHeading'))}</h2>
      ${paras('guide.profPages.toolsNote', {
        // Fed from the live gate constants, the sibling sections' idiom
        // (rhythmBody takes the cast curve, nodesNote the respawn), so a
        // retune moves the prose in all 19 languages instead of leaving a
        // stale number behind in each of them. Named ...Prof because the
        // adjacent trainingBody key already uses {tier1}/{tier2} for training
        // COSTS in copper, and a fill pass reading both should never have to
        // guess which unit a token carries. The crafted rungs' 85/100 stay
        // ENGLISH LITERALS in the prose (the long-translated key keeps its
        // token set); tests/guide.test.ts pins them against the frozen wield
        // table so a retune fails there instead of rotting here.
        tier2Prof: formatNumber(TIER2_TOOL_GATE_PROFICIENCY),
        tier3Prof: formatNumber(TIER3_TOOL_GATE_PROFICIENCY),
      })}
      <div class="guide-table-scroll"><table class="guide-keytable guide-prof-table guide-tools-table">
        <thead><tr>
          <th scope="col">${esc(t('guide.profPages.colTool'))}</th>
          <th scope="col">${esc(t('guide.profPages.colTier'))}</th>
          <th scope="col">${esc(t('guide.profPages.colQuality'))}</th>
          <th scope="col">${esc(t('guide.profPages.colWield'))}</th>
          <th scope="col">${esc(t('guide.profPages.colPrice'))}</th>
          <th scope="col">${esc(t('guide.profPages.colSource'))}</th>
        </tr></thead>
        <tbody>${g.tools.map(toolRow).join('')}</tbody>
      </table></div>
    </section>`;
}

function nodesSection(g: GuideProfGathering): string {
  if (!g.nodes) return '';
  const rows = g.nodes
    .map(
      (n) => `<tr>
        <td>${esc(n.zone)}</td>
        <td>${esc(formatNumber(n.count))}</td>
        <td>${esc(formatNumber(n.tier))}</td>
        <td>${esc(t('guide.profPages.toolTierReq', { tier: formatNumber(n.toolTier) }))}</td>
        <td>${esc(n.material)}</td>
      </tr>`,
    )
    .join('');
  return `<section class="guide-block" id="prof-nodes">
      <h2>${esc(t('guide.profPages.nodesHeading'))}</h2>
      ${paras('guide.profPages.nodesNote', {
        respawn: formatNumber(g.respawnSeconds ?? 0),
      })}
      <div class="guide-table-scroll"><table class="guide-keytable guide-prof-table">
        <thead><tr>
          <th scope="col">${esc(t('guide.profPages.colZone'))}</th>
          <th scope="col">${esc(t('guide.profPages.colNodes'))}</th>
          <th scope="col">${esc(t('guide.profPages.colNodeTier'))}</th>
          <th scope="col">${esc(t('guide.profPages.colToolNeeded'))}</th>
          <th scope="col">${esc(t('guide.profPages.colMaterial'))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
}

function rhythmSection(g: GuideProfGathering): string {
  const cast = GUIDE_PROF_CURVE.cast;
  return `<section class="guide-block" id="prof-rhythm">
      <h2>${esc(t('guide.profPages.rhythmHeading'))}</h2>
      ${paras('guide.profPages.rhythmBody', {
        base: formatNumber(cast.baseSec),
        floor: formatNumber(cast.floorSec),
        tool: formatNumber(cast.toolTierReductionSec),
        band: formatNumber(cast.bandReductionSec),
      })}
      ${paras('guide.profPages.gainBody', {
        step: formatNumber(GUIDE_PROF_CURVE.gatherTierStep),
        cap: formatNumber(g.maxSkill),
      })}
    </section>`;
}

function yieldsSection(): string {
  return `<section class="guide-block" id="prof-yields">
      <h2>${esc(t('guide.profPages.yieldsHeading'))}</h2>
      ${paras('guide.profPages.yieldsBody')}
    </section>`;
}

function rareSection(): string {
  const rare = GUIDE_PROF_CURVE.rareEvent;
  return `<section class="guide-block" id="prof-rare">
      <h2>${esc(t('guide.profPages.rareHeading'))}</h2>
      ${paras('guide.profPages.rareBody', {
        oneIn: formatNumber(rare.oneIn),
        mult: formatNumber(rare.yieldMult),
      })}
      ${paras('guide.profPages.specimenBody', {
        pct: formatNumber(GUIDE_PROF_CURVE.specimenChancePct),
      })}
    </section>`;
}

// Corpse harvesting and Town Focus, shared with the overview catalog block
// (guide.professions.harvest*/focus*): the mechanics apply to every gatherer.
function corpseSection(): string {
  return `<section class="guide-block" id="prof-corpse">
      <h2>${esc(t('guide.professions.harvestTitle'))}</h2>
      ${paras('guide.professions.harvestBodyChoice')}
      <h3>${esc(t('guide.professions.focusTitle'))}</h3>
      ${paras('guide.professions.focusBody')}
    </section>`;
}

function deedsSection(g: GuideProfGathering): string {
  return `<section class="guide-block" id="prof-gather-deeds">
      <h2>${esc(t('guide.profPages.gatherDeedsHeading'))}</h2>
      ${paras(`guide.profPages.gatherDeeds.${g.id}` as TranslationKey)}
    </section>`;
}

function bandsSection(g: GuideProfGathering): string {
  const bands = g.bands
    .map(
      (threshold, band) =>
        `<li>${esc(
          t('guide.profPages.bandFmt', {
            band: formatNumber(band),
            at: formatNumber(threshold),
          }),
        )}</li>`,
    )
    .join('');
  return `<section class="guide-block" id="prof-bands">
      <h2>${esc(t('guide.profPages.bandsHeading'))}</h2>
      ${paras('guide.profPages.bandsBody')}
      <ul class="guide-prof-bands">${bands}</ul>
    </section>`;
}

// -------------------------------------------------------- fishing only
function fishingSections(g: GuideProfGathering): string {
  const f = g.fishing;
  if (!f) return '';
  const scheduleRows = f.schedule
    .map(
      (row) =>
        `<tr><td>${esc(
          t('guide.profPages.fish.belowFmt', { below: formatNumber(row.below) }),
        )}</td><td>${esc(formatNumber(row.gain))}</td></tr>`,
    )
    .join('');
  const bandTables = f.bandTables
    .map((band) => {
      const zones = band.zones
        .map((zone) => {
          const rows = zone.rows
            .map(
              (row) =>
                `<tr><td${row.quality ? ` class="q-${esc(row.quality)}"` : ''}>${esc(
                  row.name ?? t('guide.profPages.fish.emptyHook'),
                )}</td><td>${esc(t('guide.profPages.fish.pctFmt', { pct: formatNumber(row.pct) }))}</td></tr>`,
            )
            .join('');
          return `<h4>${esc(zone.zone)}</h4>
            <div class="guide-table-scroll"><table class="guide-keytable">
              <thead><tr><th scope="col">${esc(t('guide.profPages.fish.colCatch'))}</th><th scope="col">${esc(t('guide.profPages.fish.colOdds'))}</th></tr></thead>
              <tbody>${rows}</tbody>
            </table></div>`;
        })
        .join('');
      return `<h3 id="fish-band-${band.band}">${esc(
        t('guide.profPages.fish.bandHeading', {
          band: formatNumber(band.band),
          at: formatNumber(band.minProficiency),
          rod: formatNumber(band.rodTierRequired),
        }),
      )}</h3>${zones}`;
    })
    .join('');
  return `
    <section class="guide-block" id="prof-fish-start">
      <h2>${esc(t('guide.profPages.fish.startHeading'))}</h2>
      ${paras('guide.profPages.fish.startBody')}
    </section>
    <section class="guide-block" id="prof-bite">
      <h2>${esc(t('guide.profPages.fish.biteHeading'))}</h2>
      ${paras('guide.profPages.fish.biteBody', {
        min: formatNumber(f.biteMinSec),
        max: formatNumber(f.biteMaxSec),
        rod: formatNumber(f.rodBiteReductionSec),
        reel: formatNumber(f.reelWindowSec),
        reelRod: formatNumber(f.reelRodBonusSec),
        cap: formatNumber(f.sessionCapSec),
      })}
    </section>
    <section class="guide-block" id="prof-fish-schedule">
      <h2>${esc(t('guide.profPages.fish.scheduleHeading'))}</h2>
      ${paras('guide.profPages.fish.scheduleNote', { cutoff: formatNumber(f.junkCutoff) })}
      <div class="guide-table-scroll"><table class="guide-keytable">
        <thead><tr><th scope="col">${esc(t('guide.profPages.fish.colProficiency'))}</th><th scope="col">${esc(t('guide.profPages.fish.colGain'))}</th></tr></thead>
        <tbody>${scheduleRows}</tbody>
      </table></div>
    </section>
    <section class="guide-block" id="prof-fish-tables">
      <h2>${esc(t('guide.profPages.fish.tablesHeading'))}</h2>
      ${paras('guide.profPages.fish.tablesNote', { rare: f.rareCatch })}
      ${bandTables}
    </section>
    <section class="guide-block" id="prof-koi">
      <h2>${esc(t('guide.profPages.fish.koiHeading'))}</h2>
      ${paras('guide.profPages.fish.koiBody')}
    </section>`;
}

// ------------------------------------------------------------- page assembly
export function gatheringDetailHtml(g: GuideProfGathering): string {
  const isFishing = g.id === 'fishing';
  return `
    <article class="guide-article guide-prof-page">
      <p class="guide-section-more"><a href="${esc(hrefFor('professions'))}">${esc(t('guide.profPages.back'))}</a></p>
      <h1>${esc(gatheringLabel(g.id))}</h1>
      <p class="guide-lead">${esc(t(`guide.profPages.gatherIntro.${g.id}` as TranslationKey))}</p>
      <dl class="guide-class-facts guide-prof-facts">
        <div class="guide-fact"><dt>${esc(t('guide.profPages.capLabel'))}</dt><dd>${esc(formatNumber(g.maxSkill))}</dd></div>
      </dl>
      ${isFishing ? fishingSections(g) : rhythmSection(g) + nodesSection(g) + yieldsSection()}
      ${toolsSection(g)}
      ${bandsSection(g)}
      ${isFishing ? '' : rareSection() + corpseSection()}
      ${deedsSection(g)}
      ${related([
        { href: hrefFor('professions'), key: 'guide.nav.professions' },
        { href: hrefFor('professions/economy'), key: 'guide.profPages.econ.title' },
        { href: hrefFor('world'), key: 'guide.nav.world' },
      ])}
    </article>`;
}
