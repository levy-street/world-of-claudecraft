// Settings & Performance reference: three ready-made loadouts (best FPS, balanced,
// best visuals), a plain-language tour of every graphics option, and the Interface
// and Key Bindings panels beside it. Setting and value labels reuse the game's own
// hud.options.* / hudChrome.* catalog keys so the wiki always matches the in-game
// options menu in every locale; only the guide prose is new. Facts mirror
// src/ui/options_view.ts (the panel structure), src/ui/options_window.ts (the
// graphics draft + Apply footer), src/game/settings.ts (defaults, first-run
// detection), src/game/graphics_rebuild_core.ts (the rebuild keys and the dial
// staging rule), src/game/startup_graphics_safety.ts (the iOS/native cap) and
// src/render/gfx.ts (the tier ladder and the always-armed governor).

import { esc } from '../../ui/esc';
import { type TranslationKey, t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { callout, loreBeat, p, pageHeader, related, section, tag } from './ui';

interface LoadoutRow {
  /** Setting label, from the game's own options catalog. */
  setting: TranslationKey;
  /** Value to pick, usually the game's own choice label. */
  value: TranslationKey;
  /** Marks the renderer-bound values that only land when you press Apply. */
  apply?: boolean;
}

interface Loadout {
  /** Card accent + stable hook for tests/styling. */
  id: 'fps' | 'balanced' | 'visuals';
  title: TranslationKey;
  tagline: TranslationKey;
  rows: LoadoutRow[];
  why: TranslationKey;
  recommended?: boolean;
}

const LOADOUTS: Loadout[] = [
  {
    id: 'fps',
    title: 'guide.settingsPage.fpsTitle',
    tagline: 'guide.settingsPage.fpsTagline',
    rows: [
      {
        setting: 'hud.options.graphicsQuality',
        value: 'hud.options.graphicsPresetLow',
        apply: true,
      },
      { setting: 'hud.options.renderQuality', value: 'guide.settingsPage.value50to70' },
      { setting: 'game.settings.weather', value: 'hud.options.off' },
      {
        setting: 'hudChrome.options.browserEffects',
        value: 'hudChrome.options.browserEffectsMinimal',
      },
      { setting: 'hud.options.frostedPanels', value: 'hud.options.off' },
      { setting: 'hud.options.reduceMotion', value: 'guide.settingsPage.valueOnOptional' },
    ],
    why: 'guide.settingsPage.fpsWhy',
  },
  {
    id: 'balanced',
    title: 'guide.settingsPage.balancedTitle',
    tagline: 'guide.settingsPage.balancedTagline',
    rows: [
      {
        setting: 'hud.options.graphicsQuality',
        value: 'guide.settingsPage.valueHighOrMedium',
        apply: true,
      },
      { setting: 'hud.options.renderQuality', value: 'guide.settingsPage.value90to100' },
      { setting: 'game.settings.weather', value: 'hud.options.on' },
      {
        setting: 'hudChrome.options.browserEffects',
        value: 'hudChrome.options.browserEffectsAuto',
      },
    ],
    why: 'guide.settingsPage.balancedWhy',
    recommended: true,
  },
  {
    id: 'visuals',
    title: 'guide.settingsPage.visualsTitle',
    tagline: 'guide.settingsPage.visualsTagline',
    rows: [
      {
        setting: 'hud.options.graphicsQuality',
        value: 'guide.settingsPage.valueUltraOrInsane',
        apply: true,
      },
      { setting: 'hud.options.renderQuality', value: 'guide.settingsPage.value100' },
      { setting: 'game.settings.weather', value: 'hud.options.on' },
      {
        setting: 'hudChrome.options.browserEffects',
        value: 'hudChrome.options.browserEffectsFull',
      },
      { setting: 'hud.options.frostedPanels', value: 'hud.options.on' },
    ],
    why: 'guide.settingsPage.visualsWhy',
  },
];

interface Fact {
  title: TranslationKey;
  body: TranslationKey;
}

const FACTS: Fact[] = [
  { title: 'guide.settingsPage.factDetectTitle', body: 'guide.settingsPage.factDetectBody' },
  { title: 'guide.settingsPage.factReloadTitle', body: 'guide.settingsPage.factReloadBody' },
  { title: 'guide.settingsPage.factGovernorTitle', body: 'guide.settingsPage.factGovernorBody' },
  { title: 'guide.settingsPage.factSearchTitle', body: 'guide.settingsPage.factSearchBody' },
];

type Impact = 'none' | 'light' | 'moderate' | 'heavy';

const IMPACT_KEY: Record<Impact, TranslationKey> = {
  none: 'guide.settingsPage.impactNone',
  light: 'guide.settingsPage.impactLight',
  moderate: 'guide.settingsPage.impactModerate',
  heavy: 'guide.settingsPage.impactHeavy',
};

interface SettingRow {
  setting: TranslationKey;
  /** Which panel and card it lives in (labels reuse the game's own keys). */
  where: TranslationKey[];
  body: TranslationKey;
  impact: Impact;
}

const GFX = 'hud.options.graphics';

const SETTING_ROWS: SettingRow[] = [
  {
    setting: 'hud.options.graphicsQuality',
    where: [GFX, 'hudChrome.options.gfxSectionQuality'],
    body: 'guide.settingsPage.rowGraphicsQuality',
    impact: 'heavy',
  },
  {
    setting: 'hud.options.terrainDetail',
    where: [GFX, 'hudChrome.options.gfxSectionWorld'],
    body: 'guide.settingsPage.rowTerrainDetail',
    impact: 'moderate',
  },
  {
    setting: 'hud.options.foliageDensity',
    where: [GFX, 'hudChrome.options.gfxSectionWorld'],
    body: 'guide.settingsPage.rowFoliageDensity',
    impact: 'moderate',
  },
  {
    setting: 'hud.options.surfaceDetail',
    where: [GFX, 'hudChrome.options.gfxSectionWorld'],
    body: 'guide.settingsPage.rowSurfaceDetail',
    impact: 'moderate',
  },
  {
    setting: 'hudChrome.options.gfxViewDistance',
    where: [GFX, 'hudChrome.options.gfxSectionWorld'],
    body: 'guide.settingsPage.rowViewDistance',
    impact: 'moderate',
  },
  {
    setting: 'hudChrome.options.gfxWaterQuality',
    where: [GFX, 'hudChrome.options.gfxSectionWorld'],
    body: 'guide.settingsPage.rowWaterQuality',
    impact: 'light',
  },
  {
    setting: 'hudChrome.options.gfxCharacterDetail',
    where: [GFX, 'hudChrome.options.gfxSectionWorld'],
    body: 'guide.settingsPage.rowCharacterDetail',
    impact: 'moderate',
  },
  {
    setting: 'hud.options.effectsQuality',
    where: [GFX, 'hudChrome.options.gfxSectionLighting'],
    body: 'guide.settingsPage.rowEffectsQuality',
    impact: 'heavy',
  },
  {
    setting: 'hud.options.shadowQuality',
    where: [GFX, 'hudChrome.options.gfxSectionLighting'],
    body: 'guide.settingsPage.rowShadowQuality',
    impact: 'moderate',
  },
  {
    setting: 'hudChrome.options.gfxAmbientOcclusion',
    where: [GFX, 'hudChrome.options.gfxSectionLighting'],
    body: 'guide.settingsPage.rowAmbientOcclusion',
    impact: 'moderate',
  },
  {
    setting: 'hudChrome.options.gfxBloom',
    where: [GFX, 'hudChrome.options.gfxSectionLighting'],
    body: 'guide.settingsPage.rowBloom',
    impact: 'light',
  },
  {
    setting: 'hudChrome.options.gfxAntiAliasing',
    where: [GFX, 'hudChrome.options.gfxSectionLighting'],
    body: 'guide.settingsPage.rowAntiAliasing',
    impact: 'light',
  },
  {
    setting: 'hudChrome.options.gfxDynamicLights',
    where: [GFX, 'hudChrome.options.gfxSectionLighting'],
    body: 'guide.settingsPage.rowDynamicLights',
    impact: 'moderate',
  },
  {
    setting: 'hudChrome.options.gfxParticleEffects',
    where: [GFX, 'hudChrome.options.gfxSectionLighting'],
    body: 'guide.settingsPage.rowParticleEffects',
    impact: 'moderate',
  },
  {
    setting: 'hud.options.cameraSpeed',
    where: [GFX, 'hudChrome.options.gfxSectionCamera'],
    body: 'guide.settingsPage.rowCameraSpeed',
    impact: 'none',
  },
  {
    setting: 'hud.options.touchLookSpeed',
    where: [GFX, 'hudChrome.options.gfxSectionCamera'],
    body: 'guide.settingsPage.rowTouchLookSpeed',
    impact: 'none',
  },
  {
    setting: 'hud.options.renderQuality',
    where: [GFX, 'hudChrome.options.gfxSectionDisplay'],
    body: 'guide.settingsPage.rowRenderQuality',
    impact: 'heavy',
  },
  {
    setting: 'hud.options.brightness',
    where: [GFX, 'hudChrome.options.gfxSectionDisplay'],
    body: 'guide.settingsPage.rowBrightness',
    impact: 'none',
  },
  {
    setting: 'hud.options.fieldOfView',
    where: [GFX, 'hudChrome.options.gfxSectionDisplay'],
    body: 'guide.settingsPage.rowFieldOfView',
    impact: 'light',
  },
  {
    setting: 'hud.options.fullscreen',
    where: [GFX, 'hudChrome.options.gfxSectionDisplay'],
    body: 'guide.settingsPage.rowFullscreen',
    impact: 'none',
  },
  {
    setting: 'game.settings.weather',
    where: [GFX, 'hudChrome.options.gfxSectionDisplay'],
    body: 'guide.settingsPage.rowWeather',
    impact: 'light',
  },
  {
    setting: 'hudChrome.options.waterRipples',
    where: [GFX, 'hudChrome.options.gfxSectionDisplay'],
    body: 'guide.settingsPage.rowWaterRipples',
    impact: 'moderate',
  },
  {
    setting: 'game.settings.showOverflowXp',
    where: [GFX, 'hudChrome.options.gfxSectionDisplay'],
    body: 'guide.settingsPage.rowOverflowXp',
    impact: 'none',
  },
  {
    setting: 'hudChrome.options.browserEffects',
    where: [GFX, 'hudChrome.options.gfxSectionSystem'],
    body: 'guide.settingsPage.rowBrowserEffects',
    impact: 'light',
  },
  {
    setting: 'hudChrome.options.interfaceMode',
    where: [GFX, 'hudChrome.options.gfxSectionSystem'],
    body: 'guide.settingsPage.rowInterfaceMode',
    impact: 'none',
  },
  {
    setting: 'hudChrome.perf.enable',
    where: ['hudChrome.perf.title'],
    body: 'guide.settingsPage.rowPerfOverlay',
    impact: 'none',
  },
];

// ---------------------------------------------------------------------------
// The Interface panel, tab by tab. Same shape as the graphics table minus the
// FPS column: these rows change how the game READS, not how fast it draws.
// Tab labels reuse the game's own hudChrome.interfaceTabs.* keys.
// ---------------------------------------------------------------------------

interface InterfaceRow {
  setting: TranslationKey;
  body: TranslationKey;
}

interface InterfaceTabBlock {
  tab: TranslationKey;
  intro: TranslationKey;
  rows: InterfaceRow[];
}

const INTERFACE_TABS: InterfaceTabBlock[] = [
  {
    tab: 'hudChrome.interfaceTabs.general',
    intro: 'guide.settingsPage.ifGeneralIntro',
    rows: [
      { setting: 'hudChrome.options.uiScale', body: 'guide.settingsPage.ifUiScale' },
      { setting: 'hud.options.hudOpacity', body: 'guide.settingsPage.ifHudOpacity' },
      { setting: 'hud.options.tooltipScale', body: 'guide.settingsPage.ifTooltipScale' },
      { setting: 'hud.options.frostedPanels', body: 'guide.settingsPage.rowFrostedPanels' },
      { setting: 'hud.options.highContrastText', body: 'guide.settingsPage.ifHighContrastText' },
      {
        setting: 'hudChrome.options.highContrastBackground',
        body: 'guide.settingsPage.ifHighContrastBackground',
      },
      { setting: 'hud.options.reduceMotion', body: 'guide.settingsPage.rowReduceMotion' },
      { setting: 'hud.options.invertLookY', body: 'guide.settingsPage.ifInvertLookY' },
      { setting: 'hudChrome.options.showItemLevel', body: 'guide.settingsPage.ifShowItemLevel' },
      { setting: 'hudChrome.options.showPlaytime', body: 'guide.settingsPage.ifShowPlaytime' },
      {
        setting: 'hudChrome.options.showOwnNameplate',
        body: 'guide.settingsPage.ifShowOwnNameplate',
      },
      {
        setting: 'hudChrome.options.showPlayerNameplates',
        body: 'guide.settingsPage.ifShowPlayerNameplates',
      },
      {
        setting: 'hudChrome.options.showWalletOnCharacterScreen',
        body: 'guide.settingsPage.ifWallet',
      },
      {
        setting: 'hudChrome.options.showDailyRewardsChest',
        body: 'guide.settingsPage.ifDailyChest',
      },
    ],
  },
  {
    tab: 'hudChrome.interfaceTabs.frames',
    intro: 'guide.settingsPage.ifFramesIntro',
    rows: [
      {
        setting: 'hudChrome.options.playerFrameScale',
        body: 'guide.settingsPage.ifPlayerFrameScale',
      },
      {
        setting: 'hudChrome.options.targetFrameScale',
        body: 'guide.settingsPage.ifTargetFrameScale',
      },
      { setting: 'hudChrome.partyFrames.style', body: 'guide.settingsPage.ifPartyStyle' },
      { setting: 'hudChrome.partyFrames.healthText', body: 'guide.settingsPage.ifPartyHealthText' },
      { setting: 'hudChrome.partyFrames.sort', body: 'guide.settingsPage.ifPartySort' },
      { setting: 'hudChrome.partyFrames.showAuras', body: 'guide.settingsPage.ifPartyShowAuras' },
      {
        setting: 'hudChrome.options.aurasOnPlayerFrame',
        body: 'guide.settingsPage.ifAurasOnPlayerFrame',
      },
      {
        setting: 'hudChrome.options.showTargetOfTarget',
        body: 'guide.settingsPage.ifTargetOfTarget',
      },
      { setting: 'hudChrome.options.showPetFrame', body: 'guide.settingsPage.ifPetFrame' },
    ],
  },
  {
    tab: 'hudChrome.interfaceTabs.chat',
    intro: 'guide.settingsPage.ifChatIntro',
    rows: [
      { setting: 'hud.options.chatFontScale', body: 'guide.settingsPage.ifChatFontScale' },
      { setting: 'hud.options.chatOpacity', body: 'guide.settingsPage.ifChatOpacity' },
      { setting: 'hud.options.compactChat', body: 'guide.settingsPage.ifCompactChat' },
      { setting: 'hudChrome.chatTimestamps.show', body: 'guide.settingsPage.ifChatTimestamps' },
    ],
  },
  {
    tab: 'hudChrome.interfaceTabs.combat',
    intro: 'guide.settingsPage.ifCombatIntro',
    rows: [
      {
        setting: 'hudChrome.options.startAttackOnAbility',
        body: 'guide.settingsPage.ifStartAttack',
      },
      {
        setting: 'hudChrome.options.stopAutoAttackOnTargetSwitch',
        body: 'guide.settingsPage.ifStopAutoAttack',
      },
      {
        setting: 'hudChrome.options.showAttackButton',
        body: 'guide.settingsPage.ifShowAttackButton',
      },
      { setting: 'hudChrome.options.walkByAutoloot', body: 'guide.settingsPage.ifWalkByAutoloot' },
      { setting: 'hudChrome.options.groundReticle', body: 'guide.settingsPage.ifGroundReticle' },
      { setting: 'hudChrome.options.mouseoverCast', body: 'guide.settingsPage.ifMouseoverCast' },
      { setting: 'hudChrome.options.stickyTarget', body: 'guide.settingsPage.ifStickyTarget' },
      { setting: 'hud.options.fctScale', body: 'guide.settingsPage.ifFctScale' },
      {
        setting: 'hudChrome.options.showSecondaryActionBar',
        body: 'guide.settingsPage.ifExtraBars',
      },
      {
        setting: 'hudChrome.options.hideUnusedActionSlots',
        body: 'guide.settingsPage.ifHideUnused',
      },
      { setting: 'hudChrome.options.lockActionBars', body: 'guide.settingsPage.ifLockBars' },
    ],
  },
];

function loadoutCard(l: Loadout): string {
  const badge = l.recommended
    ? `<span class="guide-loadout-badge">${esc(t('guide.settingsPage.recommended'))}</span>`
    : '';
  const rows = l.rows
    .map((r) => {
      const apply = r.apply
        ? ` <span class="guide-tag guide-loadout-reload">${esc(t('guide.settingsPage.tagReload'))}</span>`
        : '';
      return `<li class="guide-loadout-row">
          <span class="guide-loadout-setting">${esc(t(r.setting))}</span>
          <span class="guide-loadout-value">${esc(t(r.value))}${apply}</span>
        </li>`;
    })
    .join('');
  return `
    <section class="guide-loadout guide-loadout-${l.id}${l.recommended ? ' guide-loadout-rec' : ''}">
      ${badge}
      <h3 class="guide-loadout-h">${esc(t(l.title))}</h3>
      <p class="guide-loadout-tagline">${esc(t(l.tagline))}</p>
      <ul class="guide-loadout-rows">${rows}</ul>
      <p class="guide-loadout-why"><span class="guide-loadout-why-h">${esc(t('guide.settingsPage.whyLabel'))}</span> ${esc(t(l.why))}</p>
    </section>`;
}

function settingRow(r: SettingRow): string {
  const where = r.where.map((w) => tag(t(w))).join(' ');
  return `<tr>
      <td class="guide-set-name">${esc(t(r.setting))}<div class="guide-tags">${where}</div></td>
      <td>${esc(t(r.body))}</td>
      <td class="guide-set-impact">${tag(t(IMPACT_KEY[r.impact]), `guide-impact-${r.impact}`)}</td>
    </tr>`;
}

function interfaceTabBlock(b: InterfaceTabBlock): string {
  const rows = b.rows
    .map(
      (r) => `<tr>
      <td class="guide-set-name">${esc(t(r.setting))}</td>
      <td>${esc(t(r.body))}</td>
    </tr>`,
    )
    .join('');
  return `<div class="guide-if-tab">
      <h3>${esc(t(b.tab))}</h3>
      <p>${esc(t(b.intro))}</p>
      <div class="guide-table-scroll">
        <table class="guide-keytable guide-set-table">
          <thead><tr>
            <th>${esc(t('guide.settingsPage.colSetting'))}</th>
            <th>${esc(t('guide.settingsPage.colDoes'))}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

export const settings: GuidePage = {
  titleKey: 'guide.nav.settings',
  render() {
    const loadouts = LOADOUTS.map(loadoutCard).join('');
    const facts = FACTS.map((f) => loreBeat(f.title, f.body)).join('');
    const rows = SETTING_ROWS.map(settingRow).join('');
    const interfaceTabs = INTERFACE_TABS.map(interfaceTabBlock).join('');
    return `
      <article class="guide-article guide-settings">
        ${pageHeader('guide.settingsPage.heading', 'guide.settingsPage.intro')}
        <p>${esc(t('guide.settingsPage.wherePath'))}</p>
        <p>${esc(t('guide.settingsPage.panelsMoreBody'))}</p>
        ${callout(`<p>${esc(t('guide.settingsPage.fairnessBody'))}</p>`, {
          titleKey: 'guide.settingsPage.fairnessTitle',
        })}
        ${section(
          'guide.settingsPage.loadoutsHeading',
          `<p>${esc(t('guide.settingsPage.loadoutsIntro'))}</p>
           <div class="guide-loadouts">${loadouts}</div>`,
        )}
        ${section('guide.settingsPage.howHeading', `<div class="guide-beat-grid">${facts}</div>`)}
        ${section(
          'guide.settingsPage.advancedHeading',
          `<p>${esc(t('guide.settingsPage.advancedBody'))}</p>
           <p>${esc(t('guide.settingsPage.advancedLadder'))}</p>
           <p>${esc(t('guide.settingsPage.advancedMixes'))}</p>`,
        )}
        ${section(
          'guide.settingsPage.tableHeading',
          `<div class="guide-table-scroll">
            <table class="guide-keytable guide-set-table">
              <thead><tr>
                <th>${esc(t('guide.settingsPage.colSetting'))}</th>
                <th>${esc(t('guide.settingsPage.colDoes'))}</th>
                <th>${esc(t('guide.settingsPage.colImpact'))}</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <p class="guide-set-foot">${esc(t('guide.settingsPage.tableFoot'))}</p>`,
        )}
        ${section(
          'guide.settingsPage.interfaceHeading',
          `<p>${esc(t('guide.settingsPage.interfaceIntro'))}</p>
           ${interfaceTabs}
           <p class="guide-set-foot">${esc(t('guide.settingsPage.interfaceFoot'))}</p>`,
        )}
        ${section(
          'guide.settingsPage.keybindsHeading',
          p('guide.settingsPage.keybindsBody') + p('guide.settingsPage.keybindsMouseBody'),
        )}
        ${section('guide.settingsPage.audioTitle', p('guide.settingsPage.audioBody') + p('guide.settingsPage.autolootBody'))}
        ${callout(
          `<p>${esc(t('guide.settingsPage.mobileBody'))}</p><p>${esc(t('guide.settingsPage.touchBody'))}</p>`,
          {
            variant: 'note',
            titleKey: 'guide.settingsPage.mobileTitle',
          },
        )}
        ${related([
          { href: hrefFor('reference/controls'), key: 'guide.nav.controls' },
          { href: hrefFor('reference/interface'), key: 'guide.nav.interface' },
          { href: hrefFor('how-to-play'), key: 'guide.nav.howToPlay' },
          { href: hrefFor('faq'), key: 'guide.nav.faq' },
        ])}
      </article>`;
  },
};
