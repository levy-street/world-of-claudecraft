// Interface & HUD reference: a map of the screen. What every frame, bar, and
// button on the HUD is, and which window each key opens. Deliberately NOT a
// second key table (the Controls page owns that) and NOT an options tour (the
// Settings page owns that); both are cross-linked instead.
//
// Facts mirror the real HUD: index.html's #ui markup (frame, bar, tracker, and
// micro-button ids), src/styles/hud.css (where each anchor sits), src/game/keybinds.ts
// (the default keys), and the owning modules under src/ui/ and src/ui/hud/. Only
// windows a normal player can reach are listed: nothing gated behind
// ALLOW_DEV_COMMANDS or a linked wallet appears here.

import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { callout, loreBeat, p, pageHeader, paras, related, section } from './ui';

// The five unit frames, in the order a player meets them.
const FRAMES = [
  ['guide.interfacePage.frameSelfTitle', 'guide.interfacePage.frameSelfBody'],
  ['guide.interfacePage.frameTargetTitle', 'guide.interfacePage.frameTargetBody'],
  ['guide.interfacePage.frameTotTitle', 'guide.interfacePage.frameTotBody'],
  ['guide.interfacePage.framePartyTitle', 'guide.interfacePage.framePartyBody'],
  ['guide.interfacePage.framePetTitle', 'guide.interfacePage.framePetBody'],
] as const;

// Windows with a default key of their own. The key belongs in the copy (a player
// is told it in game); the full rebindable table stays on the Controls page.
const KEY_WINDOWS = [
  ['guide.interfacePage.winCharTitle', 'guide.interfacePage.winCharBody'],
  ['guide.interfacePage.winBagsTitle', 'guide.interfacePage.winBagsBody'],
  ['guide.interfacePage.winSpellbookTitle', 'guide.interfacePage.winSpellbookBody'],
  ['guide.interfacePage.winTalentsTitle', 'guide.interfacePage.winTalentsBody'],
  ['guide.interfacePage.winProfessionsTitle', 'guide.interfacePage.winProfessionsBody'],
  ['guide.interfacePage.winCraftingTitle', 'guide.interfacePage.winCraftingBody'],
  ['guide.interfacePage.winQuestLogTitle', 'guide.interfacePage.winQuestLogBody'],
  ['guide.interfacePage.winDeedsTitle', 'guide.interfacePage.winDeedsBody'],
  ['guide.interfacePage.winSocialTitle', 'guide.interfacePage.winSocialBody'],
  ['guide.interfacePage.winFinderTitle', 'guide.interfacePage.winFinderBody'],
  ['guide.interfacePage.winMetersTitle', 'guide.interfacePage.winMetersBody'],
  ['guide.interfacePage.winMoreTitle', 'guide.interfacePage.winMoreBody'],
] as const;

export const interfacePage: GuidePage = {
  titleKey: 'guide.nav.interface',
  render() {
    const frames = FRAMES.map(([title, body]) => loreBeat(title, body)).join('');
    const windows = KEY_WINDOWS.map(([title, body]) => loreBeat(title, body)).join('');
    return `
      <article class="guide-article">
        ${pageHeader('guide.nav.interface', 'guide.interfacePage.intro')}
        ${callout(p('guide.interfacePage.scopeBody'), {
          variant: 'note',
          titleKey: 'guide.interfacePage.scopeTitle',
        })}

        ${section('guide.interfacePage.glanceTitle', paras('guide.interfacePage.glanceBody'))}

        ${section(
          'guide.interfacePage.framesTitle',
          paras('guide.interfacePage.framesBody') +
            `<div class="guide-beat-grid">${frames}</div>` +
            paras('guide.interfacePage.framesMoveBody'),
        )}

        ${section('guide.interfacePage.barsTitle', paras('guide.interfacePage.barsBody'))}
        ${section('guide.interfacePage.aurasTitle', paras('guide.interfacePage.aurasBody'))}
        ${section('guide.interfacePage.actionBarsTitle', paras('guide.interfacePage.actionBarsBody'))}
        ${section('guide.interfacePage.minimapTitle', paras('guide.interfacePage.minimapBody'))}
        ${section('guide.interfacePage.railTitle', paras('guide.interfacePage.railBody'))}
        ${section('guide.interfacePage.mapTitle', paras('guide.interfacePage.mapBody'))}
        ${section('guide.interfacePage.chatTitle', paras('guide.interfacePage.chatBody'))}

        ${section(
          'guide.interfacePage.keyWindowsTitle',
          paras('guide.interfacePage.keyWindowsBody') +
            `<div class="guide-beat-grid">${windows}</div>`,
        )}

        ${section(
          'guide.interfacePage.worldWindowsTitle',
          paras('guide.interfacePage.worldWindowsBody'),
        )}
        ${section('guide.interfacePage.lootTitle', paras('guide.interfacePage.lootBody'))}
        ${section('guide.interfacePage.playerCardTitle', paras('guide.interfacePage.playerCardBody'))}
        ${section('guide.interfacePage.wikiTitle', paras('guide.interfacePage.wikiBody'))}
        ${section('guide.interfacePage.mobileTitle', paras('guide.interfacePage.mobileBody'))}

        ${related([
          { href: hrefFor('reference/controls'), key: 'guide.nav.controls' },
          { href: hrefFor('reference/settings'), key: 'guide.nav.settings' },
          { href: hrefFor('how-to-play'), key: 'guide.nav.howToPlay' },
          { href: hrefFor('social'), key: 'guide.nav.social' },
        ])}
      </article>`;
  },
};
