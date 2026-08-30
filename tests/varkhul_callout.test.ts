import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { setLanguage } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { varkhulCalloutKey } from '../src/ui/varkhul_callout';

describe('Varkhul encounter callouts', () => {
  it('maps every structured authority event to a catalogued top-banner key', () => {
    expect([
      varkhulCalloutKey('leftPillarCharging'),
      varkhulCalloutKey('rightPillarCharging'),
      varkhulCalloutKey('bothPillarsCharging'),
      varkhulCalloutKey('leftPillar'),
      varkhulCalloutKey('rightPillar'),
      varkhulCalloutKey('bothPillars'),
      varkhulCalloutKey('portalsOpening'),
      varkhulCalloutKey('artificerApproaches'),
      varkhulCalloutKey('heat75'),
      varkhulCalloutKey('heat90'),
      varkhulCalloutKey('addsDefeated'),
      varkhulCalloutKey('worldfireBegins'),
      varkhulCalloutKey('worldfireClosing'),
      varkhulCalloutKey('worldfireConsumed'),
    ]).toEqual([
      'hudChrome.varkhulCallout.leftPillarCharging',
      'hudChrome.varkhulCallout.rightPillarCharging',
      'hudChrome.varkhulCallout.bothPillarsCharging',
      'hudChrome.varkhulCallout.leftPillar',
      'hudChrome.varkhulCallout.rightPillar',
      'hudChrome.varkhulCallout.bothPillars',
      'hudChrome.varkhulCallout.portalsOpening',
      'hudChrome.varkhulCallout.artificerApproaches',
      'hudChrome.varkhulCallout.heat75',
      'hudChrome.varkhulCallout.heat90',
      'hudChrome.varkhulCallout.addsDefeated',
      'hudChrome.varkhulCallout.worldfireBegins',
      'hudChrome.varkhulCallout.worldfireClosing',
      'hudChrome.varkhulCallout.worldfireConsumed',
    ]);
  });

  it('announces the aria-hidden top banner through the combat live region too', () => {
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const arm = hud.slice(hud.indexOf("case 'varkhulCallout':"), hud.indexOf("case 'chat':"));
    expect(arm).toContain('this.questBanner.show(text);');
    expect(arm).toContain('this.combatAnnouncer.push(text, performance.now());');
  });

  it('localizes all new beam, meltdown, and exposure combat names', () => {
    setLanguage('es_ES');
    try {
      expect(localizeSimAuraName('Crucible Beam')).toBe('Rayo del Crisol');
      expect(localizeSimAuraName('Forge Meltdown')).toBe('Colapso de la Forja');
      expect(localizeSimAuraName('Crucible Exposure')).toBe('Exposición al Crisol');
      expect(localizeSimAuraName('Tempering Ray')).toBe('Rayo de temple');
      expect(localizeSimAuraName('Tempered Wound')).toBe('Herida templada');
      expect(localizeSimAuraName('Worldfire')).toBe('Fuego del Mundo');
      expect(localizeSimAuraName('crucible_quake')).toBe('Seísmo del Crisol');
      expect(localizeSimAuraName('Crucible Stomp')).toBe('Pisotón del Crisol');
      expect(localizeSimAuraName('cinder_recalibrate')).toBe('Recalibrar');
    } finally {
      setLanguage('en');
    }
  });

  it.each([
    ['ja_JP', '焼入れ光線', '焼入れの傷'],
    ['ko_KR', '담금질 광선', '담금질 상처'],
    ['ru_RU', 'Закалочный луч', 'Закалённая рана'],
    ['zh_CN', '淬火射线', '淬火创伤'],
    ['zh_TW', '淬火射線', '淬火創傷'],
  ] as const)('localizes Tempering Ray identities for %s', (language, ray, wound) => {
    setLanguage(language);
    try {
      expect(localizeSimAuraName('Tempering Ray')).toBe(ray);
      expect(localizeSimAuraName('Tempered Wound')).toBe(wound);
    } finally {
      setLanguage('en');
    }
  });
});
