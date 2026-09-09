// Thin painter for the gathering source-info detail (Intentional Gathering
// PR5): paints the capped GatheringSourceViewModel (gathering_source_view.ts)
// for one material item id. Reused by the general harvest-preference picker
// (componentTags undefined) AND, since the PR5 goal-row wiring, by the
// persistent gathering goal panel's per-material Sources disclosure
// (gathering_goal_painter.ts): both callers paint into a container THEY mint
// and own, and neither reaches into it beyond that. The corpse Change picker
// never shows it, since it already lists that body's own supported choices.
// Resolves every creature/zone/material name at the UI seam
// (tEntity/itemDisplayName), every tier/proficiency number through
// formatNumber, and every duration through durationText; nothing here ever
// prints a raw internal id or a hand-built number string via textContent.
//
// `render` replaces the whole subtree under `container` on every call and
// returns void, the harvest_preference_picker.ts contract. A material with no
// known source (`kind: 'unknown'`) clears the container and paints nothing,
// rather than inventing a location.

import { ITEMS } from '../../../sim/data';
import { materialSourceInfo } from '../../../sim/professions/gathering_source_locations';
import { durationText } from '../../duration_text';
import { itemDisplayName, tEntity, zoneDisplayName } from '../../entity_i18n';
import { formatNumber, t } from '../../i18n';
import { knownItemDef } from '../../known_item';
import {
  buildGatheringSourceView,
  type GatheringSourceExampleModel,
} from './gathering_source_view';

function tierNumber(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 0 });
}

function mobDisplayName(mobId: string): string {
  return tEntity({ kind: 'mob', id: mobId, field: 'name' });
}

function materialDisplayName(itemId: string): string {
  const item = knownItemDef(ITEMS, itemId);
  return item ? itemDisplayName(item) : t('hudChrome.harvestPreference.unknownMaterial');
}

function exampleTag(example: GatheringSourceExampleModel): string | null {
  if (example.questGated) return t('hudChrome.gatheringSource.gatedTag');
  if (example.elite) return t('hudChrome.gatheringSource.eliteTag');
  if (example.rare) return t('hudChrome.gatheringSource.rareTag');
  return null;
}

function appendLine(list: HTMLElement, text: string): void {
  const li = list.ownerDocument.createElement('li');
  li.textContent = text;
  list.appendChild(li);
}

/** Paint the source-info detail for `itemId` into `container`, or clear it
 *  when the material has no known source. */
export function renderGatheringSourceDetail(container: HTMLElement, itemId: string): void {
  const document = container.ownerDocument;
  container.textContent = '';
  const view = buildGatheringSourceView(materialSourceInfo(itemId));
  if (view.kind === 'unknown') return;

  const root = document.createElement('div');
  root.className = 'harvest-preference-source';

  const heading = document.createElement('div');
  heading.className = 'harvest-preference-source-title';
  heading.textContent = t('hudChrome.gatheringSource.title', {
    material: materialDisplayName(itemId),
  });
  root.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'harvest-preference-source-list';

  if (view.kind === 'corpse') {
    for (const example of view.examples) {
      const tag = exampleTag(example);
      const creature = mobDisplayName(example.mobId);
      const zone = zoneDisplayName(example.zoneId);
      appendLine(
        list,
        tag
          ? t('hudChrome.gatheringSource.corpseExampleTagged', { creature, zone, tag })
          : t('hudChrome.gatheringSource.corpseExample', { creature, zone }),
      );
    }
    if (view.remainingCount > 0) {
      appendLine(
        list,
        t('hudChrome.gatheringSource.moreSources', { count: tierNumber(view.remainingCount) }),
      );
    }
    root.appendChild(list);
    for (const specimenId of view.premiumSpecimenItemIds) {
      const premium = document.createElement('div');
      premium.className = 'harvest-preference-source-premium';
      premium.textContent = t('hudChrome.gatheringSource.premiumChance', {
        material: materialDisplayName(itemId),
        specimen: materialDisplayName(specimenId),
      });
      root.appendChild(premium);
    }
    if (view.conditionalOnBaseItemId !== null) {
      const condition = document.createElement('div');
      condition.className = 'harvest-preference-source-premium';
      condition.textContent = t('hudChrome.gatheringSource.specimenOfBase', {
        material: materialDisplayName(itemId),
        base: materialDisplayName(view.conditionalOnBaseItemId),
      });
      root.appendChild(condition);
    }
  } else if (view.kind === 'node') {
    for (const zone of view.zones) {
      appendLine(
        list,
        t('hudChrome.gatheringSource.nodeZone', {
          zone: zoneDisplayName(zone.zoneId),
          tier: tierNumber(zone.minimumNodeTier),
        }),
      );
    }
    if (view.remainingZoneCount > 0) {
      appendLine(
        list,
        t('hudChrome.gatheringSource.moreZones', { count: tierNumber(view.remainingZoneCount) }),
      );
    }
    root.appendChild(list);
    if (view.isFineGrade && view.minimumFineToolTier !== null) {
      const note = document.createElement('div');
      note.className = 'harvest-preference-source-note';
      note.textContent = t('hudChrome.gatheringSource.nodeFineNote', {
        tier: tierNumber(view.minimumFineToolTier),
      });
      root.appendChild(note);
    }
  } else if (view.kind === 'farm') {
    for (const zoneId of view.zoneIds) appendLine(list, zoneDisplayName(zoneId));
    if (view.remainingZoneCount > 0) {
      appendLine(
        list,
        t('hudChrome.gatheringSource.moreZones', { count: tierNumber(view.remainingZoneCount) }),
      );
    }
    root.appendChild(list);
    const note = document.createElement('div');
    note.className = 'harvest-preference-source-note';
    note.textContent = t('hudChrome.gatheringSource.farmNote', {
      duration: durationText(view.growDurationMs / 1000),
      skill: tierNumber(view.minimumFarmingSkill),
      tier: tierNumber(view.requiredHoeTier),
    });
    root.appendChild(note);
  } else {
    for (const zone of view.zones) {
      appendLine(
        list,
        zone.provenLocation
          ? t('hudChrome.gatheringSource.fishingZoneProven', {
              zone: zoneDisplayName(zone.zoneId),
              skill: tierNumber(zone.minimumProficiency),
              tier: tierNumber(zone.minimumRodTier),
            })
          : t('hudChrome.gatheringSource.fishingZoneUnproven', {
              skill: tierNumber(zone.minimumProficiency),
              tier: tierNumber(zone.minimumRodTier),
            }),
      );
    }
    if (view.remainingZoneCount > 0) {
      appendLine(
        list,
        t('hudChrome.gatheringSource.moreZones', { count: tierNumber(view.remainingZoneCount) }),
      );
    }
    root.appendChild(list);
  }

  container.appendChild(root);
}
