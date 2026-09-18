// Pins src/ui/zone_entry_line_core.ts, the HUD's zone-entry chat line: the
// localized zone welcome while the welcome quest is on offer, the localized
// town-done line once every town quest (src/sim/town_quests.ts) is turned in,
// and null in between. The zh_CN case proves the town-done line is a real
// translated fill, not English leaking through the fallback, and the last
// case pins all five non-Latin fills for every authored line (M16).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ZONES } from '../src/sim/data';
import { townQuestIds } from '../src/sim/town_quests';
import type { QuestState, ZoneDef } from '../src/sim/types';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { zoneEntryLine } from '../src/ui/zone_entry_line_core';
import { expectDefined } from './helpers/defined';

const eastbrook: ZoneDef = expectDefined(ZONES.find((z) => z.id === 'eastbrook_vale'));

function world(states: Readonly<Record<string, QuestState>>, fallback: QuestState) {
  return {
    questState: (questId: string): QuestState => states[questId] ?? fallback,
    cfg: { playerClass: 'warrior' as const },
  };
}

beforeAll(async () => {
  await ensureLocaleLoaded('zh_CN');
});
afterEach(() => setLanguage('en'));

describe('zoneEntryLine', () => {
  it('is the zone welcome hint while the welcome quest is available', () => {
    expect(zoneEntryLine(eastbrook, world({}, 'available'))).toBe(
      'Find Marshal Redbrook in town - he has work for you.',
    );
  });

  it('is null once the welcome quest is taken and the town is still open', () => {
    expect(zoneEntryLine(eastbrook, world({ q_wolves: 'active' }, 'available'))).toBeNull();
    expect(zoneEntryLine(eastbrook, world({ q_wolves: 'done' }, 'available'))).toBeNull();
  });

  it("is the zone's own town-done line once every town quest is turned in", () => {
    const allDone = world({}, 'done');
    expect(townQuestIds(eastbrook).length).toBeGreaterThan(3);
    expect(zoneEntryLine(eastbrook, allDone)).toBe(
      'A quaint seaside town where adventurers come to start their journey.',
    );
    setLanguage('zh_CN');
    const zh = expectDefined(zoneEntryLine(eastbrook, allDone));
    expect(zh).not.toContain('seaside');
    expect(zh).toContain('海滨小镇');
  });

  it('every authored town-done line has a real fill in all five non-Latin locales', async () => {
    const authored = ZONES.filter((z) => z.welcomeDone !== undefined);
    expect(authored.length).toBe(3);
    for (const lang of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      await ensureLocaleLoaded(lang);
      setLanguage(lang);
      for (const z of authored) {
        const line = expectDefined(zoneEntryLine(z, world({}, 'done')));
        expect(line, `${lang} ${z.id}`).not.toBe(z.welcomeDone);
      }
    }
  });
});
