// Gear & Items: how equipment, quality tiers, consumables, fishing, and cosmetic skins
// work. Spoiler-safe by design: systems and direction only, no balance numbers, item
// names, or drop rates. The quality tiers render from the live QUALITY_COLOR table so the
// page stays in step with the game; the label is always present (never color alone).

import { t } from '../../ui/i18n';
import { esc } from '../../ui/esc';
import { hrefFor } from '../routes';
import { QUALITY_COLOR } from '../../ui/icons';
import { lead, section, p, related } from './ui';
import type { GuidePage } from './types';

// Quality tiers low to high, paired with their catalog label key. Each renders a small
// color swatch from QUALITY_COLOR next to its always-present name, so the tier never
// reads by color alone.
const QUALITY_TIERS = [
  ['poor', 'guide.gear.qualityPoor'],
  ['common', 'guide.gear.qualityCommon'],
  ['uncommon', 'guide.gear.qualityUncommon'],
  ['rare', 'guide.gear.qualityRare'],
  ['epic', 'guide.gear.qualityEpic'],
  ['legendary', 'guide.gear.qualityLegendary'],
] as const;

// The eight equip slots, paired with their catalog label key (paperdoll order).
const SLOTS = [
  'guide.gear.slotMainhand',
  'guide.gear.slotHelmet',
  'guide.gear.slotShoulder',
  'guide.gear.slotChest',
  'guide.gear.slotWaist',
  'guide.gear.slotLegs',
  'guide.gear.slotGloves',
  'guide.gear.slotFeet',
] as const;

function qualityList(): string {
  const items = QUALITY_TIERS
    .map(([id, key]) => {
      const color = QUALITY_COLOR[id] ?? QUALITY_COLOR.common;
      const swatch = `<span class="guide-gear-swatch" style="background:${esc(color)}" aria-hidden="true"></span>`;
      return `<li class="guide-gear-quality">${swatch}<span>${esc(t(key))}</span></li>`;
    })
    .join('');
  return `<ul class="guide-gear-qualities">${items}</ul>`;
}

function slotList(): string {
  const items = SLOTS.map((key) => `<li>${esc(t(key))}</li>`).join('');
  return `<ul class="guide-gear-slots">${items}</ul>`;
}

export const gear: GuidePage = {
  titleKey: 'guide.nav.gear',
  render() {
    return `
      <article class="guide-article">
        <h1>${esc(t('guide.nav.gear'))}</h1>
        ${lead('guide.gear.intro')}

        ${section('guide.gear.slotsTitle', p('guide.gear.slotsBody') + slotList())}

        ${section('guide.gear.qualityTitle', p('guide.gear.qualityBody') + qualityList() + p('guide.gear.qualityNote'))}

        ${section('guide.gear.upgradeTitle', p('guide.gear.upgradeBody'))}

        ${section('guide.gear.sourcesTitle', p('guide.gear.sourcesBody'))}

        ${section('guide.gear.consumablesTitle',
          p('guide.gear.consumablesIntro')
          + p('guide.gear.consumablesPotions')
          + p('guide.gear.consumablesFood')
          + p('guide.gear.consumablesElixirs'))}

        ${section('guide.gear.fishingTitle',
          p('guide.gear.fishingBody')
          + p('guide.gear.fishingFood')
          + p('guide.gear.fishingRare'))}

        ${section('guide.gear.cosmeticsTitle',
          p('guide.gear.cosmeticsBody')
          + p('guide.gear.cosmeticsSkins')
          + p('guide.gear.cosmeticsRanks')
          + p('guide.gear.cosmeticsCache'))}

        ${related([
          { href: hrefFor('classes'), key: 'guide.nav.classes' },
          { href: hrefFor('economy'), key: 'guide.nav.economy' },
          { href: hrefFor('how-to-play'), key: 'guide.nav.howToPlay' },
        ])}
      </article>`;
  },
};
