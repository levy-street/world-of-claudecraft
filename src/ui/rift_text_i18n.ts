// Client re-localization for the Rift and Buried Hoard text the sim emits in
// English: the boss yells (yell-channel chat from MobTemplate.yells and the
// bigCast / deathZoneCast / deathZoneStrike .yell lines of the rift content)
// and the generated place names (theme names, nouns, suffixes and the floor /
// plan grammar of src/sim/rift/rift_gen.ts). The sim stays language-agnostic;
// this module maps the English back to sim.rift.yell.* / sim.rift.place.* keys.
//
// The yell table is DERIVED from the content (template id + slot -> key), so the
// English that reaches the client is always the content literal; the catalog
// English is pinned equal to it by tests/rift_text_i18n.test.ts.

import { CAVE_THEMES } from '../sim/content/rift/cave_themes';
import { INFERNAL_NOUNS, INFERNAL_THEME_NAME } from '../sim/content/rift/infernal_citadel';
import { HOARD_MOBS, RIFT_MOBS } from '../sim/content/rift/mobs';
import { RIFT_THEMES } from '../sim/content/rift/themes';
import { RIFT_SUFFIXES } from '../sim/rift/rift_gen';
import type { MobTemplate } from '../sim/types';
import { formatNumber, type TranslationKey, t } from './i18n';

type YellSlot = 'engage' | 'summon' | 'enrage' | 'bigCast' | 'deathZoneCast' | 'deathZoneStrike';
const YELL_SLOTS: readonly YellSlot[] = [
  'engage',
  'summon',
  'enrage',
  'bigCast',
  'deathZoneCast',
  'deathZoneStrike',
];

function slotText(tmpl: MobTemplate, slot: YellSlot): string | undefined {
  switch (slot) {
    case 'engage':
    case 'summon':
    case 'enrage':
      return tmpl.yells?.[slot];
    default:
      return tmpl[slot]?.yell;
  }
}

/** Boss short id: rift_boss_frost -> frost, hoard_boss_mushroom -> mushroom. */
function bossShortId(templateId: string): string {
  return templateId.replace(/^(rift|hoard)_boss_/, '');
}

/** The catalog key a rift/hoard boss yell slot localizes through. */
export function riftYellKey(templateId: string, slot: YellSlot): TranslationKey {
  const cap = slot.charAt(0).toUpperCase() + slot.slice(1);
  return `sim.rift.yell.${bossShortId(templateId)}${cap}` as TranslationKey;
}

/** Every rift/hoard boss yell the content carries: English literal -> key. */
export function riftYellEntries(): Array<{ templateId: string; slot: YellSlot; text: string }> {
  const out: Array<{ templateId: string; slot: YellSlot; text: string }> = [];
  for (const tmpl of Object.values({ ...HOARD_MOBS, ...RIFT_MOBS })) {
    for (const slot of YELL_SLOTS) {
      const text = slotText(tmpl, slot);
      if (text) out.push({ templateId: tmpl.id, slot, text });
    }
  }
  return out;
}

let yellMap: Map<string, TranslationKey> | null = null;
function yells(): Map<string, TranslationKey> {
  if (!yellMap) {
    yellMap = new Map();
    for (const e of riftYellEntries()) yellMap.set(e.text, riftYellKey(e.templateId, e.slot));
  }
  return yellMap;
}

/** Localize a rift / Buried Hoard boss yell, or null when the text is not one. */
export function localizeRiftBossYell(text: string): string | null {
  const key = yells().get(text);
  return key ? t(key) : null;
}

const lower = (s: string): string => s.toLowerCase();

let themeByName: Map<string, TranslationKey> | null = null;
function themes(): Map<string, TranslationKey> {
  if (!themeByName) {
    themeByName = new Map();
    for (const theme of [...RIFT_THEMES, ...CAVE_THEMES])
      themeByName.set(theme.name, `sim.rift.place.theme.${theme.id}` as TranslationKey);
    themeByName.set(INFERNAL_THEME_NAME, 'sim.rift.place.theme.infernal');
  }
  return themeByName;
}

/** Every English place noun the generator can splice (theme nouns + infernal). */
export function riftPlaceNouns(): string[] {
  const nouns = new Set<string>();
  for (const theme of [...RIFT_THEMES, ...CAVE_THEMES]) for (const n of theme.nouns) nouns.add(n);
  for (const n of INFERNAL_NOUNS) if (n !== 'Infernal') nouns.add(n);
  return [...nouns];
}

function locTheme(name: string): string | null {
  const key = themes().get(name);
  return key ? t(key) : null;
}
function locNoun(noun: string): string | null {
  return riftPlaceNouns().includes(noun)
    ? t(`sim.rift.place.noun.${lower(noun)}` as TranslationKey)
    : null;
}
function locSuffix(suffix: string): string | null {
  return (RIFT_SUFFIXES as readonly string[]).includes(suffix)
    ? t(`sim.rift.place.suffix.${lower(suffix)}` as TranslationKey)
    : null;
}
const depth = (n: string): string => formatNumber(Number(n));

/** Localize a generated rift / Buried Hoard floor or plan name (the floor label,
 *  the enter/descend log lines, the portal nameplate). Null when the name is not
 *  one of the generator's shapes (a free-text upgrade title stays verbatim). */
export function localizeRiftPlaceName(name: string): string | null {
  if (name === 'Buried Hoard entrance') return t('sim.rift.place.hoardEntrance');
  if (name === 'The Infernal Citadel') return t('sim.rift.place.infernalCitadel');
  let m = /^(.+) Buried Hoard$/.exec(name);
  if (m) {
    const theme = locTheme(m[1]);
    if (theme) return t('sim.rift.place.hoardFloor', { theme });
  }
  m = /^(.+) (Sanctum|Reaches): Depth (\d+)$/.exec(name);
  if (m) {
    const theme = locTheme(m[1]);
    if (theme)
      return t(m[2] === 'Sanctum' ? 'sim.rift.place.sanctumFloor' : 'sim.rift.place.reachesFloor', {
        theme,
        depth: depth(m[3]),
      });
  }
  m = /^(.+): (.+) Depth (\d+)$/.exec(name);
  if (m) {
    const theme = locTheme(m[2]);
    if (theme) return t('sim.rift.place.upgradedFloor', { title: m[1], theme, depth: depth(m[3]) });
  }
  m = /^The Buried (.+) Hoard$/.exec(name);
  if (m) {
    const noun = locNoun(m[1]);
    if (noun) return t('sim.rift.place.hoardPlan', { noun });
  }
  m = /^The (.+) Citadel$/.exec(name);
  if (m) {
    const noun = locNoun(m[1]);
    if (noun) return t('sim.rift.place.citadelPlan', { noun });
  }
  m = /^The (\S+) (\S+)$/.exec(name);
  if (m) {
    const noun = locNoun(m[1]);
    const suffix = locSuffix(m[2]);
    if (noun && suffix) return t('sim.rift.place.riftPlan', { noun, suffix });
  }
  return null;
}
