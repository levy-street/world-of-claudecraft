// Settings & Performance reference: three ready-made loadouts (best FPS, balanced,
// best visuals) plus a plain-language tour of every graphics option. Setting and
// value labels reuse the game's own hud.options.* / hudChrome.* catalog keys so the
// wiki always matches the in-game Options menu in every locale; only the guide prose
// is new. Facts mirror src/game/settings.ts + src/render/gfx.ts (tiers, reload
// semantics, first-run detection, the cosmetic-only fairness rule).

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
  /** Marks values that only apply after a reload. */
  reload?: boolean;
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
        reload: true,
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
        reload: true,
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
        value: 'hud.options.graphicsPresetUltra',
        reload: true,
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
  /** Which Options panel it lives in (labels reuse the menu's own keys). */
  where: TranslationKey[];
  body: TranslationKey;
  impact: Impact;
}

const SETTING_ROWS: SettingRow[] = [
  {
    setting: 'hud.options.graphicsQuality',
    where: ['hud.options.graphics'],
    body: 'guide.settingsPage.rowGraphicsQuality',
    impact: 'heavy',
  },
  {
    setting: 'hud.options.renderQuality',
    where: ['hud.options.graphics'],
    body: 'guide.settingsPage.rowRenderQuality',
    impact: 'heavy',
  },
  {
    setting: 'hud.options.fieldOfView',
    where: ['hud.options.graphics'],
    body: 'guide.settingsPage.rowFieldOfView',
    impact: 'light',
  },
  {
    setting: 'hud.options.brightness',
    where: ['hud.options.graphics'],
    body: 'guide.settingsPage.rowBrightness',
    impact: 'none',
  },
  {
    setting: 'game.settings.weather',
    where: ['hud.options.graphics'],
    body: 'guide.settingsPage.rowWeather',
    impact: 'light',
  },
  {
    setting: 'hudChrome.options.browserEffects',
    where: ['hud.options.graphics'],
    body: 'guide.settingsPage.rowBrowserEffects',
    impact: 'light',
  },
  {
    setting: 'hud.options.terrainDetail',
    where: ['hud.options.graphics', 'hud.options.graphicsPresetAdvanced'],
    body: 'guide.settingsPage.rowTerrainDetail',
    impact: 'moderate',
  },
  {
    setting: 'hud.options.foliageDensity',
    where: ['hud.options.graphics', 'hud.options.graphicsPresetAdvanced'],
    body: 'guide.settingsPage.rowFoliageDensity',
    impact: 'moderate',
  },
  {
    setting: 'hud.options.effectsQuality',
    where: ['hud.options.graphics', 'hud.options.graphicsPresetAdvanced'],
    body: 'guide.settingsPage.rowEffectsQuality',
    impact: 'heavy',
  },
  {
    setting: 'hud.options.shadowQuality',
    where: ['hud.options.graphics', 'hud.options.graphicsPresetAdvanced'],
    body: 'guide.settingsPage.rowShadowQuality',
    impact: 'moderate',
  },
  {
    setting: 'hud.options.frostedPanels',
    where: ['hud.options.interface'],
    body: 'guide.settingsPage.rowFrostedPanels',
    impact: 'moderate',
  },
  {
    setting: 'hud.options.reduceMotion',
    where: ['hud.options.interface'],
    body: 'guide.settingsPage.rowReduceMotion',
    impact: 'light',
  },
  {
    setting: 'hudChrome.perf.enable',
    where: ['hudChrome.perf.title'],
    body: 'guide.settingsPage.rowPerfOverlay',
    impact: 'none',
  },
];

function loadoutCard(l: Loadout): string {
  const badge = l.recommended
    ? `<span class="guide-loadout-badge">${esc(t('guide.settingsPage.recommended'))}</span>`
    : '';
  const rows = l.rows
    .map((r) => {
      const reload = r.reload
        ? ` <span class="guide-tag guide-loadout-reload">${esc(t('guide.settingsPage.tagReload'))}</span>`
        : '';
      return `<li class="guide-loadout-row">
          <span class="guide-loadout-setting">${esc(t(r.setting))}</span>
          <span class="guide-loadout-value">${esc(t(r.value))}${reload}</span>
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

export const settings: GuidePage = {
  titleKey: 'guide.nav.settings',
  render() {
    const loadouts = LOADOUTS.map(loadoutCard).join('');
    const facts = FACTS.map((f) => loreBeat(f.title, f.body)).join('');
    const rows = SETTING_ROWS.map(settingRow).join('');
    return `
      <article class="guide-article guide-settings">
        ${pageHeader('guide.settingsPage.heading', 'guide.settingsPage.intro')}
        <p>${esc(t('guide.settingsPage.wherePath'))}</p>
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
          { href: hrefFor('how-to-play'), key: 'guide.nav.howToPlay' },
          { href: hrefFor('faq'), key: 'guide.nav.faq' },
        ])}
      </article>`;
  },
};
