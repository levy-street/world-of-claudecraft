// Mount cosmetics and character riding progression. Catalog appearances have
// no intrinsic speed; the guide describes the same training ranks as the game.

import { ADVANCED_RIDING_FEE_COPPER, ridingMoveSpeedPct } from '../../sim/riding_training';
import { formatNumber } from '../../ui/i18n';
import { RIDING_MIN_LEVEL } from '../data';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { callout, p, pageHeader, paras, related, section } from './ui';

export const mounts: GuidePage = {
  titleKey: 'guide.nav.mounts',
  render() {
    const level = formatNumber(RIDING_MIN_LEVEL);
    const training = {
      level,
      basicSpeed: formatNumber(ridingMoveSpeedPct(1) * 100),
      advancedSpeed: formatNumber(ridingMoveSpeedPct(2) * 100),
      advancedFee: formatNumber(ADVANCED_RIDING_FEE_COPPER / 10_000),
    };
    return `
      <article class="guide-article guide-mounts">
        ${pageHeader('guide.mountsPage.heading', 'guide.mountsPage.intro')}
        ${section('guide.mountsPage.whatHeading', p('guide.mountsPage.whatBody'))}
        ${section(
          'guide.mountsPage.learnHeading',
          paras('guide.mountsPage.learnBody', training) +
            callout(p('guide.mountsPage.whereBody'), {
              variant: 'note',
              titleKey: 'guide.mountsPage.whereHeading',
            }),
        )}
        ${section('guide.mountsPage.firstHeading', p('guide.mountsPage.firstBody'))}
        ${section('guide.mountsPage.rideHeading', paras('guide.mountsPage.rideBody'))}
        ${section('guide.mountsPage.breaksHeading', paras('guide.mountsPage.breaksBody'))}
        ${section('guide.mountsPage.speedHeading', paras('guide.mountsPage.speedBody', training))}
        ${section('guide.mountsPage.collectHeading', p('guide.mountsPage.collectBody'))}
        ${section('guide.mountsPage.raceHeading', paras('guide.mountsPage.raceBody'))}
        ${section('guide.mountsPage.goodsHeading', p('guide.mountsPage.goodsBody'))}
        ${related([
          { href: hrefFor('world'), key: 'guide.nav.world' },
          { href: hrefFor('economy'), key: 'guide.nav.economy' },
          { href: hrefFor('gear'), key: 'guide.nav.gear' },
          { href: hrefFor('reference/controls'), key: 'guide.nav.controls' },
        ])}
      </article>`;
  },
};
