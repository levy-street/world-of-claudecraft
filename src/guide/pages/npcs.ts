// NPC Locations (/wiki/npcs): where every standing overworld NPC is, grouped by
// zone. Generated (GUIDE_NPCS), so a moved or new NPC reaches the page by
// existing. Players have no coordinate readout, so each row gives the town, or
// the distance and compass point from it in the HUD compass strip's own
// abbreviations (hudChrome.compass.*). NPC names, towns and zones are baked
// English proper nouns (the GUIDE_PROF_STATIONS precedent); a title is a
// description ("Master of the Forge"), so it localizes through the NPC's own
// entities.npcs.<id>.title key, which every listed NPC carries (pinned in
// tests/guide_prof_materials.test.ts). Instanced and encounter NPCs never reach
// the generated list.

import { esc } from '../../ui/esc';
import { formatNumber, type TranslationKey, t } from '../../ui/i18n';
import { GUIDE_NPCS, type GuideNpcLocation } from '../content.generated';
import { hrefFor } from '../routes';
import { npcAnchor } from './professions_materials';
import type { GuidePage } from './types';
import { callout, pageHeader, related } from './ui';

/** The catalog key of an NPC's localized title (the itemNameKey pattern in
 *  professions_craft.ts, for the same bundle reason). */
export function npcTitleKey(npcId: string): TranslationKey {
  return `entities.npcs.${npcId.replace(/[^A-Za-z0-9_]/g, '_')}.title` as TranslationKey;
}

/** Where one NPC stands, in the reader's language. Exported for the tests. */
export function npcWhere(npc: GuideNpcLocation): string {
  if (npc.yards === undefined || npc.direction === undefined) {
    return t('guide.npcsPage.inTown', { town: npc.town });
  }
  return t('guide.npcsPage.awayFmt', {
    yards: formatNumber(npc.yards),
    direction: t(`hudChrome.compass.${npc.direction}` as TranslationKey),
    town: npc.town,
  });
}

function zoneSection(zoneId: string, rows: GuideNpcLocation[]): string {
  const body = rows
    .map(
      (n) => `<tr id="${esc(npcAnchor(n.id))}">
        <td>${esc(n.name)}</td>
        <td>${esc(t(npcTitleKey(n.id)))}</td>
        <td>${esc(npcWhere(n))}</td>
      </tr>`,
    )
    .join('');
  return `<section class="guide-block" id="npcs-${esc(zoneId)}">
      <h2>${esc(rows[0].zone)}</h2>
      <div class="guide-table-scroll"><table class="guide-keytable">
        <thead><tr>
          <th scope="col">${esc(t('guide.npcsPage.colNpc'))}</th>
          <th scope="col">${esc(t('guide.npcsPage.colRole'))}</th>
          <th scope="col">${esc(t('guide.npcsPage.colWhere'))}</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table></div>
    </section>`;
}

export const npcs: GuidePage = {
  titleKey: 'guide.nav.npcs',
  render() {
    // GUIDE_NPCS arrives sorted by zone order, so grouping keeps that order.
    const byZone = new Map<string, GuideNpcLocation[]>();
    for (const n of GUIDE_NPCS) {
      const list = byZone.get(n.zoneId) ?? [];
      list.push(n);
      byZone.set(n.zoneId, list);
    }
    const sections = [...byZone.entries()].map(([id, rows]) => zoneSection(id, rows)).join('');
    return `
      <article class="guide-article guide-npcs">
        ${pageHeader('guide.npcsPage.heading', 'guide.npcsPage.intro')}
        ${callout(esc(t('guide.npcsPage.eventNote')), { variant: 'note' })}
        ${sections}
        ${related([
          { href: hrefFor('world'), key: 'guide.nav.world' },
          { href: hrefFor('professions/materials'), key: 'guide.profPages.mat.title' },
          { href: hrefFor('professions'), key: 'guide.nav.professions' },
          { href: hrefFor('quests'), key: 'guide.nav.quests' },
        ])}
      </article>`;
  },
};
